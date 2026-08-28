import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import {
  buildIndexMutationGitArguments,
  buildReadOnlyGitArguments,
} from "../../src/committing-to-git/git/gitRepository.js";
import { createRepositoryFixture } from "./harness.mjs";

const TRANSCRIPT_MODULE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "committing-to-git",
  "git",
  "gitProcessTranscript.js",
);

function fakeChild({ pid = 12345 } = {}) {
  const child = new EventEmitter();

  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

function finishChild(child, status = 0, signal = null) {
  child.stdout.end();
  child.stderr.end();
  queueMicrotask(() => child.emit("close", status, signal));
}

test("projected-index Git operations keep path data out of argv", () => {
  assert.deepEqual(buildIndexMutationGitArguments("update-index-info"), [
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "color.ui=false",
    "update-index",
    "--replace",
    "-z",
    "--index-info",
  ]);
  assert.deepEqual(buildReadOnlyGitArguments("diff-files-names"), [
    "--no-lazy-fetch",
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "color.ui=false",
    "diff-files",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--name-only",
    "-z",
    "--no-renames",
    "--ignore-submodules=none",
    "--",
  ]);
  assert.deepEqual(buildIndexMutationGitArguments("refresh-index"), [
    "--no-pager",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "color.ui=false",
    "update-index",
    "--really-refresh",
    "-q",
  ]);
  assert.throws(
    () => buildIndexMutationGitArguments("update-index-info", ["path.txt"]),
    /not permitted/u,
  );
  assert.throws(
    () => buildReadOnlyGitArguments("diff-files-names", ["path.txt"]),
    /not permitted/u,
  );
  assert.throws(
    () =>
      buildReadOnlyGitArguments("diff-paths", [
        "--quiet",
        "--no-renames",
        "--",
        "path.txt",
      ]),
    /Unsupported read-only Git operation/u,
  );
});

test("transcript preserves interleaved binary channels while diagnostics stay bounded", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-transcript-");
  const transactionPath = join(fixture.scratch, "transaction.json");
  const attemptDirectory = fixture.scratch;
  const child = fakeChild();
  const diagnosticChunks = [];
  const payload = Buffer.alloc(10 * 1024 * 1024, 0xa5);
  const { captureGitProcessTranscript, readGitProcessTranscript } =
    await import(pathToFileURL(TRANSCRIPT_MODULE));
  const completion = captureGitProcessTranscript({
    transactionPath,
    attemptDirectory,
    operation: "commit",
    child,
    diagnosticBudget: 32 * 1024,
    diagnosticWriter: {
      write(chunk) {
        diagnosticChunks.push(Buffer.from(chunk));
        return true;
      },
    },
  });

  child.stdout.write(Buffer.from([0x00, 0xff, 0x41]));
  child.stderr.write(Buffer.from("hook-start\n"));
  child.stdout.write(payload);
  child.stderr.write(Buffer.from("hook-end\n"));
  finishChild(child, 1);

  const transcript = await completion;
  const records = readGitProcessTranscript(transcript.path);
  const visible = Buffer.concat(diagnosticChunks);

  assert.equal(transcript.status, 1);
  assert.equal(transcript.totalByteCount, payload.length + 23);
  assert.deepEqual(
    records.map(({ sequence, channel }) => ({ sequence, channel })),
    [
      { sequence: 0, channel: "stdout" },
      { sequence: 1, channel: "stderr" },
      { sequence: 2, channel: "stdout" },
      { sequence: 3, channel: "stderr" },
    ],
  );
  assert.deepEqual(records[0].bytes, Buffer.from([0x00, 0xff, 0x41]));
  assert.deepEqual(records[2].bytes, payload);
  assert.ok(visible.length <= 32 * 1024);
  assert.equal(
    visible.toString("utf8").match(/output suppressed/gu)?.length,
    1,
  );
  assert.ok(visible.includes(Buffer.from("hook-end\n")));
  assert.equal(transcript.retainRecommended, true);
  assert.equal(
    transcript.sha256,
    createHash("sha256").update(readFileSync(transcript.path)).digest("hex"),
  );
  assert.equal(
    transcript.stdoutSha256,
    createHash("sha256")
      .update(Buffer.concat([Buffer.from([0x00, 0xff, 0x41]), payload]))
      .digest("hex"),
  );
  assert.equal(
    transcript.stderrSha256,
    createHash("sha256")
      .update(Buffer.from("hook-start\nhook-end\n"))
      .digest("hex"),
  );
  assert.match(transcript.completionSha256, /^[0-9a-f]{64}$/u);
});

test("successful transcript mirrors only its non-overlapping head and marks suppression once", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-transcript-success-");
  const child = fakeChild();
  const diagnosticChunks = [];
  const { captureGitProcessTranscript } = await import(
    pathToFileURL(TRANSCRIPT_MODULE)
  );
  const completion = captureGitProcessTranscript({
    transactionPath: join(fixture.scratch, "transaction.json"),
    attemptDirectory: fixture.scratch,
    operation: "commit",
    child,
    diagnosticBudget: 32 * 1024,
    diagnosticWriter: {
      write(chunk) {
        diagnosticChunks.push(Buffer.from(chunk));
        return true;
      },
    },
  });
  const head = Buffer.alloc(16 * 1024, 0x48);
  const omitted = Buffer.alloc(16 * 1024, 0x4f);
  const tail = Buffer.alloc(16 * 1024, 0x54);

  child.stderr.write(head);
  child.stdout.write(omitted);
  child.stderr.write(tail);
  finishChild(child, 0);

  const transcript = await completion;
  const visible = Buffer.concat(diagnosticChunks);

  assert.equal(transcript.status, 0);
  assert.equal(transcript.retainRecommended, false);
  assert.ok(visible.length <= 32 * 1024);
  assert.ok(visible.subarray(0, 16 * 1024).equals(head));
  assert.equal(visible.includes(tail), false);
  assert.equal(
    visible.toString("ascii").match(/output suppressed/gu)?.length,
    1,
  );
});

test("optional stdout classification capture is bounded without truncating the transcript", async (t) => {
  const fixture = createRepositoryFixture(t, "commit-transcript-classify-");
  const child = fakeChild();
  const payload = Buffer.alloc(4096, 0x50);
  const { captureGitProcessTranscript, readGitProcessTranscript } =
    await import(pathToFileURL(TRANSCRIPT_MODULE));
  const completion = captureGitProcessTranscript({
    transactionPath: join(fixture.scratch, "transaction.json"),
    attemptDirectory: fixture.scratch,
    operation: "push",
    child,
    stdoutCaptureLimit: 1024,
    diagnosticWriter: { write: () => true },
  });

  child.stdout.write(payload);
  finishChild(child, 1);

  const transcript = await completion;
  const records = readGitProcessTranscript(transcript.path);

  assert.equal(transcript.capturedStdout.length, 1024);
  assert.equal(transcript.capturedStdoutComplete, false);
  assert.equal(records[0].bytes.length, payload.length);
  assert.equal(transcript.stdoutByteCount, payload.length);
});
