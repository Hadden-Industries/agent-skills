import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { TextDecoder } from "node:util";

import { safeBoundedText, sha256Bytes } from "./inlineEvidenceCapsule.js";

export const MAXIMUM_PACKET_LINES = 200;
export const MAXIMUM_PACKET_BYTES = 16 * 1024;

const MAXIMUM_RAW_SEGMENT_BYTES = 4 * 1024;
const MAXIMUM_RAW_SEGMENT_LINES = 160;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function ensureOutputDirectories(outputDirectory) {
  for (const name of ["packets", "raw"]) {
    const path = join(outputDirectory, name);

    if (!existsSync(path)) {
      mkdirSync(path);
    }
  }
}

function countNewlines(bytes) {
  let count = 0;

  for (const byte of bytes) {
    count += byte === 10 ? 1 : 0;
  }

  return count;
}

function lineCount(bytes) {
  if (bytes.length === 0) {
    return 0;
  }

  const newlines = countNewlines(bytes);

  return newlines + (bytes.at(-1) === 10 ? 0 : 1);
}

function sourceIterable(source) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    return (async function* bytes() {
      yield Buffer.from(source);
    })();
  }

  if (source && typeof source[Symbol.asyncIterator] === "function") {
    return source;
  }

  if (source && typeof source[Symbol.iterator] === "function") {
    return (async function* chunks() {
      for (const chunk of source) {
        yield chunk;
      }
    })();
  }

  throw new Error("Packet source must be bytes or an iterable byte stream.");
}

function sourceIterableSync(source) {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    return [Buffer.from(source)];
  }

  if (source && typeof source[Symbol.iterator] === "function") {
    return source;
  }

  throw new Error("Synchronous packet source must be bytes or an iterable.");
}

function publishTemporaryFile(temporaryPath, finalPath) {
  if (existsSync(finalPath)) {
    if (!filesEqualBounded(finalPath, temporaryPath)) {
      throw new Error(`Content-addressed packet collision at ${finalPath}.`);
    }

    unlinkSync(temporaryPath);
    return;
  }

  renameSync(temporaryPath, finalPath);
}

function readChunkExactly(descriptor, buffer, length, position) {
  let total = 0;

  while (total < length) {
    const count = readSync(
      descriptor,
      buffer,
      total,
      length - total,
      position + total,
    );

    if (count === 0) {
      break;
    }

    total += count;
  }

  return total;
}

function filesEqualBounded(leftPath, rightPath) {
  const left = openSync(leftPath, "r");
  const right = openSync(rightPath, "r");

  try {
    const leftSize = Number(fstatSync(left, { bigint: true }).size);
    const rightSize = Number(fstatSync(right, { bigint: true }).size);

    if (leftSize !== rightSize) {
      return false;
    }

    // Content-addressed collisions are exceptionally rare, but equality must
    // still be proved without loading an arbitrarily large raw artifact.
    const leftBuffer = Buffer.alloc(MAXIMUM_PACKET_BYTES);
    const rightBuffer = Buffer.alloc(MAXIMUM_PACKET_BYTES);

    for (let position = 0; position < leftSize;) {
      const length = Math.min(MAXIMUM_PACKET_BYTES, leftSize - position);
      const leftCount = readChunkExactly(left, leftBuffer, length, position);
      const rightCount = readChunkExactly(right, rightBuffer, length, position);

      if (
        leftCount !== length ||
        rightCount !== length ||
        !leftBuffer.subarray(0, length).equals(rightBuffer.subarray(0, length))
      ) {
        return false;
      }

      position += length;
    }

    return true;
  } finally {
    closeSync(right);
    closeSync(left);
  }
}

async function spoolSource(outputDirectory, source) {
  const temporaryPath = join(outputDirectory, `.raw-${randomUUID()}.tmp`);
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let validUtf8 = true;
  let byteCount = 0;
  let newlineCount = 0;
  let complete = false;

  try {
    for await (const value of sourceIterable(source)) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);

      if (chunk.length === 0) {
        continue;
      }

      writeFileSync(descriptor, chunk);
      hash.update(chunk);
      byteCount += chunk.length;
      newlineCount += countNewlines(chunk);

      if (validUtf8) {
        try {
          decoder.decode(chunk, { stream: true });
        } catch {
          validUtf8 = false;
        }
      }
    }

    if (validUtf8) {
      try {
        decoder.decode();
      } catch {
        validUtf8 = false;
      }
    }

    fsyncSync(descriptor);
    complete = true;
  } finally {
    closeSync(descriptor);

    if (!complete && existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }

  const rawSha256 = hash.digest("hex");
  const rawArtifact = `raw/${rawSha256}.bin`;
  const finalPath = join(outputDirectory, rawArtifact);

  publishTemporaryFile(temporaryPath, finalPath);

  return {
    path: finalPath,
    rawArtifact,
    rawSha256,
    byteCount,
    newlineCount,
    validUtf8,
  };
}

function spoolSourceSync(outputDirectory, source) {
  const temporaryPath = join(outputDirectory, `.raw-${randomUUID()}.tmp`);
  const descriptor = openSync(temporaryPath, "wx", 0o600);
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let validUtf8 = true;
  let byteCount = 0;
  let newlineCount = 0;
  let complete = false;

  try {
    for (const value of sourceIterableSync(source)) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);

      if (chunk.length === 0) {
        continue;
      }

      writeFileSync(descriptor, chunk);
      hash.update(chunk);
      byteCount += chunk.length;
      newlineCount += countNewlines(chunk);

      if (validUtf8) {
        try {
          decoder.decode(chunk, { stream: true });
        } catch {
          validUtf8 = false;
        }
      }
    }

    if (validUtf8) {
      try {
        decoder.decode();
      } catch {
        validUtf8 = false;
      }
    }

    fsyncSync(descriptor);
    complete = true;
  } finally {
    closeSync(descriptor);

    if (!complete && existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
  }

  const rawSha256 = hash.digest("hex");
  const rawArtifact = `raw/${rawSha256}.bin`;
  const finalPath = join(outputDirectory, rawArtifact);

  publishTemporaryFile(temporaryPath, finalPath);

  return {
    path: finalPath,
    rawArtifact,
    rawSha256,
    byteCount,
    newlineCount,
    validUtf8,
  };
}

function utf8Boundary(buffer, candidateEnd) {
  if (candidateEnd >= buffer.length) {
    return candidateEnd;
  }

  let boundary = candidateEnd;

  while (boundary > 0 && buffer[boundary] >= 0x80 && buffer[boundary] <= 0xbf) {
    boundary -= 1;
  }

  return boundary > 0 ? boundary : candidateEnd;
}

function* readRawSegments(path, byteCount, validUtf8) {
  const descriptor = openSync(path, "r");
  let start = 0;

  try {
    while (start < byteCount) {
      const available = Math.min(
        MAXIMUM_RAW_SEGMENT_BYTES + 4,
        byteCount - start,
      );
      const buffer = Buffer.alloc(available);
      const bytesRead = readSync(descriptor, buffer, 0, available, start);

      if (bytesRead === 0) {
        throw new Error(
          "Raw packet spool ended before its recorded byte count.",
        );
      }

      const candidate = buffer.subarray(0, bytesRead);
      let segmentLength = Math.min(MAXIMUM_RAW_SEGMENT_BYTES, bytesRead);
      let newlines = 0;

      for (let index = 0; index < segmentLength; index += 1) {
        if (candidate[index] === 10) {
          newlines += 1;

          if (newlines === MAXIMUM_RAW_SEGMENT_LINES) {
            segmentLength = index + 1;
            break;
          }
        }
      }

      if (validUtf8) {
        segmentLength = utf8Boundary(candidate, segmentLength);
      }

      if (segmentLength < 1) {
        segmentLength = Math.min(MAXIMUM_RAW_SEGMENT_BYTES, bytesRead);
      }

      const end = start + segmentLength;
      yield {
        start,
        end,
        bytes: Buffer.from(candidate.subarray(0, segmentLength)),
      };
      start = end;
    }
  } finally {
    closeSync(descriptor);
  }
}

function finalByte(path, byteCount) {
  if (byteCount === 0) {
    return null;
  }

  const descriptor = openSync(path, "r");
  const byte = Buffer.alloc(1);

  try {
    readSync(descriptor, byte, 0, 1, byteCount - 1);
    return byte[0];
  } finally {
    closeSync(descriptor);
  }
}

function escapedHex(bytes, absoluteStart) {
  const lines = [];

  for (let offset = 0; offset < bytes.length; offset += 24) {
    const row = bytes.subarray(offset, offset + 24);
    const hex = [...row]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
    lines.push(`${String(absoluteStart + offset).padStart(12, "0")}: ${hex}`);
  }

  return Buffer.from(`${lines.join("\n")}\n`, "ascii");
}

function boundedIdentity(value, label) {
  if (value === null || value === undefined) {
    return null;
  }

  return safeBoundedText(Buffer.from(String(value), "utf8"), label);
}

function packetHeader({
  id,
  kind,
  rawSha256,
  rawByteCount,
  rawStart,
  rawEnd,
  validUtf8,
  changeUnitId,
  pathIdentity,
  changeUnitRanges,
  changeUnitCount,
  context,
  segmentBytes,
}) {
  const contextBytes = Buffer.from(context ?? "", "utf8");
  const boundedContext =
    contextBytes.length === 0
      ? null
      : {
          prefix: safeBoundedText(
            contextBytes.subarray(0, 64),
            "context-prefix",
          ),
          suffix: safeBoundedText(contextBytes.subarray(-64), "context-suffix"),
          byteCount: contextBytes.length,
          sha256: sha256Bytes(contextBytes),
        };
  const metadata = {
    id,
    kind,
    changeUnitId: boundedIdentity(changeUnitId, "change-unit"),
    pathIdentity: boundedIdentity(pathIdentity, "path"),
    changeUnitCoverage: {
      changeUnitCount,
      rangeCount: changeUnitRanges.length,
      firstRange: changeUnitRanges[0] ?? null,
      lastRange: changeUnitRanges.at(-1) ?? null,
      rangesSha256: sha256Bytes(
        Buffer.from(JSON.stringify(changeUnitRanges), "utf8"),
      ),
    },
    rawByteRange: { start: rawStart, end: rawEnd },
    rawByteCount,
    rawSha256,
    encoding: validUtf8 ? "utf-8" : "escaped-hex",
    continued: rawStart > 0 || rawEnd < rawByteCount,
    context: boundedContext,
    hunkContext: {
      prefix: safeBoundedText(
        segmentBytes.subarray(0, 64),
        "hunk-prefix-bytes",
      ),
      suffix: safeBoundedText(segmentBytes.subarray(-64), "hunk-suffix-bytes"),
      byteCount: segmentBytes.length,
      sha256: sha256Bytes(segmentBytes),
    },
  };

  return Buffer.from(
    `# Review evidence packet\n${JSON.stringify(metadata)}\n---\n`,
    "utf8",
  );
}

function writePacket(outputDirectory, descriptorData, payload) {
  const packetBytes = Buffer.concat([descriptorData.header, payload]);

  if (packetBytes.length > descriptorData.maximumPacketBytes) {
    throw new Error(
      `Packet ${descriptorData.id} exceeds ${descriptorData.maximumPacketBytes} bytes.`,
    );
  }

  const packetLineCount = lineCount(packetBytes);

  if (packetLineCount > descriptorData.maximumPacketLines) {
    throw new Error(
      `Packet ${descriptorData.id} exceeds ${descriptorData.maximumPacketLines} lines.`,
    );
  }

  const digest = sha256Bytes(packetBytes);
  const artifact = `packets/${digest}.packet`;
  const temporaryPath = join(
    outputDirectory,
    "packets",
    `.packet-${randomUUID()}.tmp`,
  );

  writeFileSync(temporaryPath, packetBytes, { flag: "wx", mode: 0o600 });
  publishTemporaryFile(temporaryPath, join(outputDirectory, artifact));

  return {
    id: descriptorData.id,
    kind: descriptorData.kind,
    artifact,
    byteCount: packetBytes.length,
    lineCount: packetLineCount,
    sha256: digest,
    rawArtifact: descriptorData.rawArtifact,
    rawByteStart: descriptorData.rawStart,
    rawByteEnd: descriptorData.rawEnd,
    rawByteCount: descriptorData.rawByteCount,
    rawSha256: descriptorData.rawSha256,
    encoding: descriptorData.validUtf8 ? "utf-8" : "escaped-hex",
    changeUnitRanges: descriptorData.changeUnitRanges,
    changeUnitCount: descriptorData.changeUnitCount,
  };
}

function validateWriterOptions({
  idPrefix,
  startingOrdinal,
  maximumPacketBytes,
  maximumPacketLines,
}) {
  if (!/^[A-Z]$/u.test(idPrefix)) {
    throw new Error("Packet idPrefix must be one uppercase ASCII letter.");
  }

  if (
    !Number.isSafeInteger(startingOrdinal) ||
    startingOrdinal < 1 ||
    !Number.isSafeInteger(maximumPacketBytes) ||
    maximumPacketBytes < 1024 ||
    !Number.isSafeInteger(maximumPacketLines) ||
    maximumPacketLines < 10
  ) {
    throw new Error("Packet writer limits and starting ordinal are invalid.");
  }
}

function packetsForSpool(
  outputDirectory,
  spooled,
  {
    idPrefix,
    startingOrdinal,
    kind,
    changeUnitRanges,
    changeUnitCount,
    changeUnitId,
    pathIdentity,
    context,
    maximumPacketBytes,
    maximumPacketLines,
  },
) {
  const packets = [];
  let index = 0;

  for (const segment of readRawSegments(
    spooled.path,
    spooled.byteCount,
    spooled.validUtf8,
  )) {
    const id = `${idPrefix}${String(startingOrdinal + index).padStart(6, "0")}`;
    const header = packetHeader({
      id,
      kind,
      rawSha256: spooled.rawSha256,
      rawByteCount: spooled.byteCount,
      rawStart: segment.start,
      rawEnd: segment.end,
      validUtf8: spooled.validUtf8,
      changeUnitId,
      pathIdentity,
      changeUnitRanges,
      changeUnitCount,
      context,
      segmentBytes: segment.bytes,
    });
    const payload = spooled.validUtf8
      ? Buffer.from(STRICT_UTF8_DECODER.decode(segment.bytes), "utf8")
      : escapedHex(segment.bytes, segment.start);

    packets.push(
      writePacket(
        outputDirectory,
        {
          id,
          kind,
          header,
          maximumPacketBytes,
          maximumPacketLines,
          rawArtifact: spooled.rawArtifact,
          rawStart: segment.start,
          rawEnd: segment.end,
          rawByteCount: spooled.byteCount,
          rawSha256: spooled.rawSha256,
          validUtf8: spooled.validUtf8,
          changeUnitRanges,
          changeUnitCount,
        },
        payload,
      ),
    );
    index += 1;
  }

  return {
    packets,
    rawArtifact: spooled.rawArtifact,
    rawByteCount: spooled.byteCount,
    rawLineCount:
      spooled.newlineCount +
      (spooled.byteCount > 0 &&
      finalByte(spooled.path, spooled.byteCount) !== 10
        ? 1
        : 0),
    rawSha256: spooled.rawSha256,
    encoding: spooled.validUtf8 ? "utf-8" : "escaped-hex",
  };
}

export async function writePacketStream({
  outputDirectory,
  source,
  idPrefix,
  startingOrdinal = 1,
  kind,
  changeUnitRanges = [],
  changeUnitCount = 0,
  changeUnitId = null,
  pathIdentity = null,
  context = "",
  maximumPacketBytes = MAXIMUM_PACKET_BYTES,
  maximumPacketLines = MAXIMUM_PACKET_LINES,
}) {
  const options = {
    idPrefix,
    startingOrdinal,
    kind,
    changeUnitRanges,
    changeUnitCount,
    changeUnitId,
    pathIdentity,
    context,
    maximumPacketBytes,
    maximumPacketLines,
  };

  validateWriterOptions(options);
  ensureOutputDirectories(outputDirectory);
  const spooled = await spoolSource(outputDirectory, source);

  return packetsForSpool(outputDirectory, spooled, options);
}

export function writePacketBytes(options) {
  return writePacketStream(options);
}

export function writePacketChunksSync({
  outputDirectory,
  source,
  idPrefix,
  startingOrdinal = 1,
  kind,
  changeUnitRanges = [],
  changeUnitCount = 0,
  changeUnitId = null,
  pathIdentity = null,
  context = "",
  maximumPacketBytes = MAXIMUM_PACKET_BYTES,
  maximumPacketLines = MAXIMUM_PACKET_LINES,
}) {
  const options = {
    idPrefix,
    startingOrdinal,
    kind,
    changeUnitRanges,
    changeUnitCount,
    changeUnitId,
    pathIdentity,
    context,
    maximumPacketBytes,
    maximumPacketLines,
  };

  validateWriterOptions(options);
  ensureOutputDirectories(outputDirectory);
  const spooled = spoolSourceSync(outputDirectory, source);

  return packetsForSpool(outputDirectory, spooled, options);
}

export function writePacketBytesSync(options) {
  if (
    !Buffer.isBuffer(options.source) &&
    !(options.source instanceof Uint8Array)
  ) {
    throw new Error("Synchronous packet input must be bytes.");
  }

  return writePacketChunksSync({ ...options, source: [options.source] });
}

export function readRawPacketBytes(path, { start = 0, length } = {}) {
  const descriptor = openSync(path, "r");

  try {
    const statBytes = fstatSync(descriptor).size;
    const byteLength = length ?? statBytes - start;
    const result = Buffer.alloc(byteLength);
    const bytesRead = readSync(descriptor, result, 0, byteLength, start);

    return result.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}
