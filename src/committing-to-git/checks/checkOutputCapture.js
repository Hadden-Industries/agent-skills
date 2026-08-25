import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

export const CHECK_OUTPUT_SEGMENT_BYTES = 256 * 1024;
export const CHECK_FAILURE_DIAGNOSTIC_BYTES = 32 * 1024;

function assertContained(parent, child) {
  const path = relative(parent, child);

  if (
    path === "" ||
    path === ".." ||
    path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Check output path escapes its transaction: ${child}`);
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

function processLogDirectory(attemptDirectory) {
  const normalizedAttempt = resolve(attemptDirectory);

  ensureDirectory(normalizedAttempt, "Transaction attempt directory");
  const directory = join(normalizedAttempt, "process-logs");

  assertContained(normalizedAttempt, directory);

  if (!existsSync(directory)) {
    mkdirSync(directory, { mode: 0o700 });
  }

  ensureDirectory(directory, "Process-log directory");
  return directory;
}

function writeSegment(directory, receiptId, channel, segment, bytes) {
  if (bytes.length === 0) {
    return null;
  }

  const path = join(directory, `check-${receiptId}-${channel}-${segment}.bin`);

  assertContained(directory, path);
  const descriptor = openSync(path, "wx", 0o600);

  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  return path;
}

function appendTail(current, chunk, maximumBytes) {
  if (chunk.length >= maximumBytes) {
    return Buffer.from(chunk.subarray(chunk.length - maximumBytes));
  }

  const combined = Buffer.concat([current, chunk]);
  return combined.length <= maximumBytes
    ? combined
    : Buffer.from(combined.subarray(combined.length - maximumBytes));
}

function channelCapture() {
  return {
    hash: createHash("sha256"),
    totalByteCount: 0,
    head: Buffer.alloc(0),
    rollingTail: Buffer.alloc(0),
  };
}

function recordChannel(capture, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);

  capture.hash.update(bytes);
  capture.totalByteCount += bytes.length;

  if (capture.head.length < CHECK_OUTPUT_SEGMENT_BYTES) {
    const remaining = CHECK_OUTPUT_SEGMENT_BYTES - capture.head.length;

    capture.head = Buffer.concat([capture.head, bytes.subarray(0, remaining)]);
  }

  capture.rollingTail = appendTail(
    capture.rollingTail,
    bytes,
    CHECK_OUTPUT_SEGMENT_BYTES,
  );
}

function finalizeChannel(directory, receiptId, channel, capture) {
  const uncoveredByteCount = Math.max(
    0,
    capture.totalByteCount - capture.head.length,
  );
  const tailByteCount = Math.min(
    uncoveredByteCount,
    capture.rollingTail.length,
  );
  const tail =
    tailByteCount === 0
      ? Buffer.alloc(0)
      : Buffer.from(
          capture.rollingTail.subarray(
            capture.rollingTail.length - tailByteCount,
          ),
        );
  const headPath = writeSegment(
    directory,
    receiptId,
    channel,
    "head",
    capture.head,
  );
  const tailPath = writeSegment(directory, receiptId, channel, "tail", tail);

  return {
    facts: {
      totalByteCount: capture.totalByteCount,
      sha256: capture.hash.digest("hex"),
      headPath,
      headByteCount: capture.head.length,
      headSha256:
        headPath === null
          ? null
          : createHash("sha256").update(capture.head).digest("hex"),
      tailPath,
      tailByteCount: tail.length,
      tailSha256:
        tailPath === null
          ? null
          : createHash("sha256").update(tail).digest("hex"),
      truncated: capture.totalByteCount > capture.head.length + tail.length,
    },
    head: capture.head,
    tail,
  };
}

function diagnosticForChannel(channel, capture, remaining) {
  if (remaining <= 0 || capture.facts.totalByteCount === 0) {
    return Buffer.alloc(0);
  }

  const label = Buffer.from(`\n[${channel}]\n`, "ascii");
  const potentialHeadByteCount = Math.min(16 * 1024, capture.head.length);
  const potentialTailByteCount = Math.min(16 * 1024, capture.tail.length);
  const needsMarker =
    capture.facts.totalByteCount >
    potentialHeadByteCount + potentialTailByteCount;
  const marker = needsMarker
    ? Buffer.from("\n...[check output suppressed]...\n", "ascii")
    : Buffer.alloc(0);
  const budget = Math.max(0, remaining - label.length - marker.length);
  const headBudget = Math.min(16 * 1024, budget);
  const head = capture.head.subarray(0, headBudget);
  const tailBudget = Math.min(16 * 1024, Math.max(0, budget - head.length));
  const tail = capture.tail.subarray(
    Math.max(0, capture.tail.length - tailBudget),
  );
  const pieces = [label, head];

  if (marker.length > 0) {
    pieces.push(marker);
  }

  pieces.push(tail);
  return Buffer.concat(pieces).subarray(0, remaining);
}

function failureDiagnostic(output) {
  const pieces = [];
  let remaining = CHECK_FAILURE_DIAGNOSTIC_BYTES;
  const channels = [
    ["stderr", output.stderr],
    ["stdout", output.stdout],
  ].filter(([, capture]) => capture.facts.totalByteCount > 0);

  for (const [index, [channel, capture]] of channels.entries()) {
    // Divide the remaining budget between still-unseen streams so a noisy
    // stderr cannot erase all evidence that stdout also produced content.
    const channelBudget = Math.floor(remaining / (channels.length - index));
    const piece = diagnosticForChannel(channel, capture, channelBudget);

    pieces.push(piece);
    remaining -= piece.length;
  }

  return Buffer.concat(pieces);
}

export function captureCheckProcessOutput({
  attemptDirectory,
  receiptId,
  child,
  timeoutMilliseconds = null,
}) {
  if (
    child === null ||
    typeof child !== "object" ||
    typeof child.once !== "function" ||
    child.stdout === null ||
    child.stderr === null
  ) {
    throw new Error(
      "Check output capture requires one streaming child process.",
    );
  }

  if (
    timeoutMilliseconds !== null &&
    (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1)
  ) {
    throw new Error("Check timeout must be a positive safe integer.");
  }

  const directory = processLogDirectory(attemptDirectory);
  const captures = {
    stdout: channelCapture(),
    stderr: channelCapture(),
  };
  let launchError = null;
  let timedOut = false;
  let timer = null;

  child.stdout.on("data", (chunk) => recordChannel(captures.stdout, chunk));
  child.stderr.on("data", (chunk) => recordChannel(captures.stderr, chunk));

  return new Promise((resolveCompletion, rejectCompletion) => {
    child.once("error", (error) => {
      launchError = {
        code: typeof error.code === "string" ? error.code : null,
        message: error.message,
      };
    });

    if (timeoutMilliseconds !== null) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMilliseconds);
    }

    child.once("close", (exitCode, signal) => {
      if (timer !== null) {
        clearTimeout(timer);
      }

      try {
        const stdout = finalizeChannel(
          directory,
          receiptId,
          "stdout",
          captures.stdout,
        );
        const stderr = finalizeChannel(
          directory,
          receiptId,
          "stderr",
          captures.stderr,
        );
        const output = {
          schemaVersion: 1,
          stdout: stdout.facts,
          stderr: stderr.facts,
        };
        const outcome = launchError
          ? "launch-error"
          : timedOut
            ? "timed-out"
            : signal !== null
              ? "signaled"
              : exitCode === 0
                ? "passed"
                : "failed";

        resolveCompletion({
          exitCode,
          signal,
          launchError,
          timedOut,
          outcome,
          output,
          diagnostic: failureDiagnostic({ stdout, stderr }),
        });
      } catch (error) {
        rejectCompletion(error);
      }
    });
  });
}
