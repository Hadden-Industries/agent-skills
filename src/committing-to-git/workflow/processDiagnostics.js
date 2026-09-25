import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import { transactionDiagnosticState } from "../transaction/transactionDiagnosticState.js";
import { readTransaction } from "../transaction/transactionWorkspace.js";
import {
  acquireTransactionStateLock,
  releaseTransactionStateLock,
} from "../transaction/transactionRecovery.js";

const MAGIC = Buffer.from("CTG-GIT-TRANSCRIPT-1\n");
const PREVIEW_BYTES = 4096;

function invalid() {
  throw new WorkflowDiagnosticError(
    "PROCESS_DIAGNOSTICS_INVALID",
    "Retained process evidence is missing, replaced or corrupt. Preserve known mutation state; do not replay the operation.",
  );
}

/** Verify all bytes while retaining only a bounded preview of each channel. */
function previewTranscript(evidence, expectedPath) {
  if (
    resolve(evidence.path) !== expectedPath ||
    realpathSync(expectedPath) !== expectedPath
  )
    invalid();
  const fd = openSync(expectedPath, "r");
  const hash = createHash("sha256");
  const channels = {
    stdout: { bytes: Buffer.alloc(0), total: 0 },
    stderr: { bytes: Buffer.alloc(0), total: 0 },
  };
  function read(size, allowEnd = false) {
    const bytes = Buffer.alloc(size);
    let count = 0;
    while (count < size) {
      const n = readSync(fd, bytes, count, size - count, null);
      if (n === 0) {
        if (allowEnd && count === 0) return null;
        invalid();
      }
      count += n;
    }
    hash.update(bytes);
    return bytes;
  }
  try {
    if (!read(MAGIC.length).equals(MAGIC)) invalid();
    let sequence = 0n;
    for (let header = read(13, true); header; header = read(13, true)) {
      if (header.readBigUInt64BE(0) !== sequence++) invalid();
      const channel = channels[{ 1: "stdout", 2: "stderr" }[header[8]]];
      if (!channel) invalid();
      let remaining = header.readUInt32BE(9);
      channel.total += remaining;
      while (remaining > 0) {
        const bytes = read(Math.min(remaining, 64 * 1024));
        const available = PREVIEW_BYTES - channel.bytes.length;
        if (available > 0)
          channel.bytes = Buffer.concat([
            channel.bytes,
            bytes.subarray(0, available),
          ]);
        remaining -= bytes.length;
      }
    }
    if (
      hash.digest("hex") !== evidence.sha256 ||
      channels.stdout.total !== evidence.stdoutByteCount ||
      channels.stderr.total !== evidence.stderrByteCount
    )
      invalid();
    const summary = ({ bytes, total }) => ({
      text: bytes.toString("utf8"),
      totalByteCount: total,
      omittedByteCount: total - bytes.length,
    });
    return {
      path: expectedPath,
      sha256: evidence.sha256,
      stdout: summary(channels.stdout),
      stderr: summary(channels.stderr),
    };
  } finally {
    closeSync(fd);
  }
}

export function readProcessDiagnostics({
  transactionPath,
  cursor = null,
  refresh = false,
}) {
  if (cursor !== null || refresh)
    throw new WorkflowDiagnosticError(
      "DETAIL_ARGUMENT_CONFLICT",
      "Process diagnostics accepts neither --cursor nor --refresh.",
    );
  const lock = acquireTransactionStateLock({
    transactionPath,
    operation: "report-detail",
  });
  try {
    const transaction = readTransaction(transactionPath);
    const operations = [];
    const directory = resolve(transaction.attemptDirectory, "process-logs");
    const add = (operation, evidence, filename, attemptId = null) => {
      if (!evidence) return;
      operations.push({
        operation,
        attemptId,
        ...previewTranscript(evidence, join(directory, filename)),
      });
    };
    try {
      add("commit", transaction.commit?.transcript, "commit.transcript.bin");
      const latest = transaction.publicationAttempts.at(-1);
      if (latest)
        add(
          "publish",
          latest.transcript,
          `push-${latest.attemptId}.transcript.bin`,
          latest.attemptId,
        );
    } catch {
      invalid();
    }
    return createWorkflowResult({
      disposition: "succeeded",
      status: "diagnostics-read",
      ...transactionDiagnosticState(transaction, transactionPath),
      data: {
        commitOid: transaction.commit?.commitOid ?? null,
        processDiagnostics: {
          operations,
          omittedPublicationAttempts: Math.max(
            0,
            transaction.publicationAttempts.length - 1,
          ),
        },
      },
    });
  } finally {
    releaseTransactionStateLock(lock);
  }
}
