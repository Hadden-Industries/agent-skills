import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const MAGIC = Buffer.from("CTG-GIT-TRANSCRIPT-1\n", "ascii");
const FRAME_HEADER_BYTES = 13;
const CHANNEL_IDS = Object.freeze({ stdout: 1, stderr: 2 });
const ID_CHANNELS = Object.freeze({ 1: "stdout", 2: "stderr" });
const SUPPRESSION_MARKER = Buffer.from(
  "\n...[output suppressed]...\n",
  "ascii",
);

function assertContained(parent, child) {
  const path = relative(parent, child);

  if (
    path === "" ||
    path === ".." ||
    path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(
      `Process transcript path escapes its transaction: ${child}`,
    );
  }
}

function ensureDirectory(path, label) {
  const stat = lstatSync(path);

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} is replaced or is not a directory: ${path}`);
  }

  if (realpathSync(path) !== resolve(path)) {
    throw new Error(`${label} does not resolve to its recorded path: ${path}`);
  }
}

function openTranscript(attemptDirectory, operation, instanceId) {
  const normalizedAttempt = resolve(attemptDirectory);

  ensureDirectory(normalizedAttempt, "Transaction attempt directory");
  const directory = join(normalizedAttempt, "process-logs");

  assertContained(normalizedAttempt, directory);

  if (!existsSync(directory)) {
    mkdirSync(directory, { mode: 0o700 });
  }

  ensureDirectory(directory, "Process-log directory");

  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(operation)) {
    throw new Error("Transcript operation must be a bounded lowercase token.");
  }

  if (
    instanceId !== null &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      instanceId,
    )
  ) {
    throw new Error("Transcript instance must be a UUIDv4 when supplied.");
  }

  const path = join(
    directory,
    `${operation}${instanceId === null ? "" : `-${instanceId}`}.transcript.bin`,
  );

  assertContained(normalizedAttempt, path);
  const descriptor = openSync(path, "wx", 0o600);
  return { descriptor, path };
}

function frameBytes(sequence, channel, bytes) {
  const header = Buffer.alloc(FRAME_HEADER_BYTES);

  header.writeBigUInt64BE(BigInt(sequence), 0);
  header.writeUInt8(CHANNEL_IDS[channel], 8);
  header.writeUInt32BE(bytes.length, 9);
  return { header, bytes };
}

function appendTail(current, chunk, maximumBytes) {
  if (maximumBytes === 0 || chunk.length === 0) {
    return Buffer.alloc(0);
  }

  const combined = Buffer.concat([current, chunk]);
  return combined.length <= maximumBytes
    ? combined
    : combined.subarray(combined.length - maximumBytes);
}

function completionDigest(value) {
  return createHash("sha256")
    .update(`${JSON.stringify(value)}\n`, "utf8")
    .digest("hex");
}

export function captureGitProcessTranscript({
  transactionPath,
  attemptDirectory = dirname(resolve(transactionPath)),
  operation,
  instanceId = null,
  child,
  diagnosticBudget = 32 * 1024,
  stdoutCaptureLimit = 0,
  diagnosticWriter = process.stderr,
}) {
  if (!Number.isSafeInteger(diagnosticBudget) || diagnosticBudget < 1024) {
    throw new Error(
      "Git diagnostic budget must be a safe integer of at least 1 KiB.",
    );
  }

  if (
    !Number.isSafeInteger(stdoutCaptureLimit) ||
    stdoutCaptureLimit < 0 ||
    stdoutCaptureLimit > 64 * 1024
  ) {
    throw new Error(
      "Git stdout classification capture must be between 0 and 64 KiB.",
    );
  }

  if (
    child === null ||
    typeof child !== "object" ||
    typeof child.once !== "function" ||
    child.stdout === null ||
    child.stderr === null
  ) {
    throw new Error(
      "Git transcript capture requires one streaming child process.",
    );
  }

  const normalizedAttempt = resolve(attemptDirectory);
  const normalizedTransactionPath = resolve(transactionPath);

  if (dirname(normalizedTransactionPath) !== normalizedAttempt) {
    throw new Error("Transaction handle and attempt directory do not match.");
  }

  const { descriptor, path } = openTranscript(
    normalizedAttempt,
    operation,
    instanceId,
  );
  const transcriptHash = createHash("sha256");
  const channelHashes = {
    stdout: createHash("sha256"),
    stderr: createHash("sha256"),
  };
  const channelByteCounts = { stdout: 0, stderr: 0 };
  const headLimit = Math.min(16 * 1024, diagnosticBudget);
  const tailLimit = Math.max(
    0,
    Math.min(
      16 * 1024,
      diagnosticBudget - headLimit - SUPPRESSION_MARKER.length,
    ),
  );
  let sequence = 0;
  let totalByteCount = 0;
  let mirroredHeadBytes = 0;
  let tail = Buffer.alloc(0);
  let suppressionWritten = false;
  let launchError = null;
  let closed = false;
  let capturedStdout = Buffer.alloc(0);
  let capturedStdoutComplete = true;

  writeSync(descriptor, MAGIC);
  transcriptHash.update(MAGIC);

  function mirror(chunk) {
    const remainingHead = Math.max(0, headLimit - mirroredHeadBytes);
    const head = chunk.subarray(0, remainingHead);

    if (head.length > 0) {
      diagnosticWriter.write(head);
      mirroredHeadBytes += head.length;
    }

    const remainder = chunk.subarray(head.length);

    if (remainder.length > 0) {
      if (!suppressionWritten) {
        diagnosticWriter.write(SUPPRESSION_MARKER);
        suppressionWritten = true;
      }

      tail = appendTail(tail, remainder, tailLimit);
    }
  }

  function record(channel, value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);

    if (bytes.length === 0) {
      return;
    }

    const frame = frameBytes(sequence, channel, bytes);

    if (channel === "stdout" && stdoutCaptureLimit > 0) {
      const remaining = Math.max(0, stdoutCaptureLimit - capturedStdout.length);

      capturedStdout = Buffer.concat([
        capturedStdout,
        bytes.subarray(0, remaining),
      ]);

      if (bytes.length > remaining) {
        capturedStdoutComplete = false;
      }
    }

    writeSync(descriptor, frame.header);
    writeSync(descriptor, frame.bytes);
    transcriptHash.update(frame.header);
    transcriptHash.update(frame.bytes);
    channelHashes[channel].update(bytes);
    channelByteCounts[channel] += bytes.length;
    totalByteCount += bytes.length;
    sequence += 1;
    mirror(bytes);
  }

  child.stdout.on("data", (chunk) => record("stdout", chunk));
  child.stderr.on("data", (chunk) => record("stderr", chunk));

  return new Promise((resolveCompletion, rejectCompletion) => {
    child.once("error", (error) => {
      launchError = {
        code: typeof error.code === "string" ? error.code : null,
        message: error.message,
      };
    });
    child.once("close", (status, signal) => {
      if (closed) {
        return;
      }

      closed = true;

      try {
        if (
          (status !== 0 || signal !== null || launchError !== null) &&
          tail.length > 0
        ) {
          diagnosticWriter.write(tail);
        }

        fsyncSync(descriptor);
        closeSync(descriptor);
        const facts = {
          status,
          signal,
          launchError,
          recordCount: sequence,
          totalByteCount,
          stdoutByteCount: channelByteCounts.stdout,
          stderrByteCount: channelByteCounts.stderr,
          stdoutSha256: channelHashes.stdout.digest("hex"),
          stderrSha256: channelHashes.stderr.digest("hex"),
        };

        resolveCompletion({
          schemaVersion: 1,
          path,
          ...facts,
          sha256: transcriptHash.digest("hex"),
          completionSha256: completionDigest(facts),
          suppressionMarkerCount: suppressionWritten ? 1 : 0,
          mirroredHeadByteCount: mirroredHeadBytes,
          mirroredTailByteCount:
            status !== 0 || signal !== null || launchError !== null
              ? tail.length
              : 0,
          retainRecommended:
            status !== 0 || signal !== null || launchError !== null,
          capturedStdout,
          capturedStdoutComplete,
        });
      } catch (error) {
        try {
          closeSync(descriptor);
        } catch {
          // The original transcript failure is more useful.
        }

        rejectCompletion(error);
      }
    });
  });
}

export function readGitProcessTranscript(path) {
  const bytes = readFileSync(path);

  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Git process transcript has an invalid header.");
  }

  const records = [];
  let offset = MAGIC.length;

  while (offset < bytes.length) {
    if (bytes.length - offset < FRAME_HEADER_BYTES) {
      throw new Error("Git process transcript ends in a partial frame header.");
    }

    const sequence = Number(bytes.readBigUInt64BE(offset));
    const channel = ID_CHANNELS[bytes.readUInt8(offset + 8)];
    const byteCount = bytes.readUInt32BE(offset + 9);
    const start = offset + FRAME_HEADER_BYTES;
    const end = start + byteCount;

    if (!channel || end > bytes.length || sequence !== records.length) {
      throw new Error("Git process transcript contains an invalid frame.");
    }

    records.push({
      sequence,
      channel,
      bytes: Buffer.from(bytes.subarray(start, end)),
    });
    offset = end;
  }

  return records;
}
