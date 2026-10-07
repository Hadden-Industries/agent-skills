import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import {
  assertEvidencePath,
  captureCommand,
  createProtectedLog,
  reportEvidence,
} from "../../scripts/ci/verificationEvidence.js";

const entryPoint = resolve("scripts/ci/verificationEvidence.js");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ci-evidence-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outputRoot = join(root, "capture");
  mkdirSync(outputRoot);
  const temporaryRoot = join(root, "native");
  mkdirSync(temporaryRoot);
  const nativeStagingRoot = join(root, "native-staging");
  mkdirSync(nativeStagingRoot);
  const summaryPath = join(root, "summary.html");
  let text = "";
  return {
    root,
    outputRoot,
    temporaryRoot,
    nativeStagingRoot,
    summaryPath,
    output: {
      write(chunk) {
        text += chunk;
      },
    },
    text: () => text,
  };
}
async function capture(
  f,
  stage,
  code = "process.stdout.write('native diagnostics\\n')",
  verificationKind = "committing-to-git",
) {
  const publishFixtures =
    verificationKind === "evaluation-conformance"
      ? `const fs=require('node:fs'), path=require('node:path'); for(const name of fs.readdirSync(${JSON.stringify(f.nativeStagingRoot)})) { fs.renameSync(path.join(${JSON.stringify(f.nativeStagingRoot)},name), path.join(${JSON.stringify(f.temporaryRoot)},name)); }\n`
      : "";
  return captureCommand({
    ...f,
    verificationKind,
    stage,
    command: process.execPath,
    arguments_: ["-e", publishFixtures + code],
  });
}
function nativeRecord(f, rootName, file, text) {
  const path = join(f.nativeStagingRoot, rootName, file);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}

test("real child stdout/stderr and native exit survive protected capture", async (t) => {
  const f = fixture(t);
  const result = await capture(
    f,
    "environment",
    "process.stdout.write('::error::untrusted\\n'); process.stderr.write('traceback <details>\\n'); process.exitCode=17",
  );
  assert.equal(result.exitCode, 17);
  assert.deepEqual(result.failures, []);
  assert.match(f.text(), /^::stop-commands::[a-f0-9]{64}\n/u);
  assert.match(f.text(), /::error::untrusted/u);
  assert.match(f.text(), /\n::[a-f0-9]{64}::\n$/u);
  assert.match(
    readFileSync(join(f.outputRoot, "environment.txt"), "utf8"),
    /traceback <details>/u,
  );
  const report = reportEvidence({
    ...f,
    verificationKind: "committing-to-git",
  });
  assert.equal(report.stages[0].exitCode, 17);
  assert.equal(report.stages[1].status, "not-started");
  assert.deepEqual(report.failures, []);
  assert.match(readFileSync(f.summaryPath, "utf8"), /not-started/u);
});

test("CLI preserves a nonzero native exit and signal", (t) => {
  const f = fixture(t);
  const result = spawnSync(
    process.execPath,
    [
      entryPoint,
      "capture",
      "--verification-kind",
      "committing-to-git",
      "--output-root",
      f.outputRoot,
      "--stage",
      "environment",
      "--",
      process.execPath,
      "-e",
      "process.exit(23)",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 23, result.stderr);
  if (process.platform !== "win32") {
    const signalRoot = join(f.root, "signal");
    const signalled = spawnSync(
      process.execPath,
      [
        entryPoint,
        "capture",
        "--verification-kind",
        "committing-to-git",
        "--output-root",
        signalRoot,
        "--stage",
        "environment",
        "--",
        process.execPath,
        "-e",
        "process.kill(process.pid, 'SIGTERM')",
      ],
      { encoding: "utf8" },
    );
    assert.equal(signalled.signal, "SIGTERM");
    assert.match(signalled.stdout, /\n::[a-f0-9]{64}::\n$/u);
  }
});

test("a split suspension token cannot restore command interpretation", () => {
  let text = "";
  const log = createProtectedLog({
    write(chunk) {
      text += chunk;
    },
  });
  const token = text.match(/::stop-commands::([a-f0-9]+)/u)[1];
  log.write(Buffer.from(`prefix\n::${token.slice(0, 19)}`));
  log.write(Buffer.from(`${token.slice(19)}::\n::error::payload\n`));
  assert.equal(log.finish().hasCollision, true);
  assert.equal(text.split(`::${token}::`).length, 2);
  assert.match(text, /suspension token collision/u);
});

test("protected writes preserve non-BMP UTF-8 text at the collision buffer boundary", () => {
  const chunks = [];
  const log = createProtectedLog({
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
  });
  const text = "😀".repeat(100);
  log.write(Buffer.from(text));
  assert.equal(log.finish().hasCollision, false);
  const rendered = Buffer.concat(chunks).toString("utf8");
  assert.ok(rendered.includes(text));
  assert.doesNotMatch(rendered, /\uFFFD/u);
});

test("inherited launch failure cannot replace a later command's native exit", async (t) => {
  const f = fixture(t);
  await captureCommand({
    ...f,
    verificationKind: "committing-to-git",
    stage: "environment",
    command: join(f.root, "missing-executable"),
  });
  const result = spawnSync(
    process.execPath,
    [
      entryPoint,
      "capture",
      "--verification-kind",
      "committing-to-git",
      "--output-root",
      f.outputRoot,
      "--stage",
      "install",
      "--",
      process.execPath,
      "-e",
      "process.exit(23)",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 23, result.stderr);
  const outcome = JSON.parse(
    readFileSync(join(f.outputRoot, "install.result.json"), "utf8"),
  );
  assert.equal(outcome.exitCode, 23);
  assert.match(outcome.failures.join(), /Native launch failed/u);
});

test("prior and post-command stat errors retain the actual native outcome", async (t) => {
  const f = fixture(t);
  const marker = join(f.root, "native-ran");
  const originalStat = fs.lstatSync;
  t.mock.method(fs, "lstatSync", (path, ...options) => {
    if (
      path === join(f.outputRoot, "environment.result.json") ||
      (path === f.temporaryRoot && existsSync(marker))
    ) {
      const error = new Error("fixture stat permission denied");
      error.code = "EACCES";
      throw error;
    }
    return originalStat(path, ...options);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  const result = await captureCommand({
    ...f,
    verificationKind: "evaluation-conformance",
    stage: "tests",
    command: process.execPath,
    arguments_: [
      "-e",
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran'); process.exitCode=22`,
    ],
  });
  assert.equal(result.exitCode, 22);
  assert.match(result.failures.join(), /stat permission denied/u);
  assert.ok(existsSync(join(f.outputRoot, "tests.result.json")));
  assert.equal(readFileSync(marker, "utf8"), "ran");
});

test("missing executable is a failed capture with readable launch evidence", async (t) => {
  const f = fixture(t);
  const result = await captureCommand({
    ...f,
    verificationKind: "committing-to-git",
    stage: "environment",
    command: join(f.root, "missing-executable"),
  });
  assert.equal(result.exitCode, null);
  assert.match(result.failures.join(), /Native launch failed/u);
  assert.ok(existsSync(join(f.outputRoot, "environment.result.json")));
});

test("report emits malformed middle records and every repeated sibling without parsing away diagnostics", async (t) => {
  const f = fixture(t);
  nativeRecord(
    f,
    "evaluation-conformance-one",
    "commands.json",
    '{"stdout":"first native output"}',
  );
  nativeRecord(
    f,
    "evaluation-conformance-two",
    "commands.json",
    "not JSON: traceback\n::error::hostile",
  );
  const lastPath = nativeRecord(
    f,
    "evaluation-conformance-three",
    "receipt.json",
    '{"status":"consumer-smoke-passed"}',
  );
  nativeRecord(
    f,
    "evaluation-conformance-three",
    "home/credentials.json",
    "NEVER-PRINT-CREDENTIALS",
  );
  nativeRecord(
    f,
    "evaluation-conformance-three",
    "qualification/evals/eval.yaml",
    "NEVER-PRINT-CONFIG",
  );
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  const result = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.equal(result.identities.length, 4);
  assert.match(f.text(), /first native output/u);
  assert.match(f.text(), /not JSON: traceback/u);
  assert.match(f.text(), /consumer-smoke-passed/u);
  assert.doesNotMatch(f.text(), /NEVER-PRINT/u);
  const lastIdentity = result.identities.find(
    (identity) =>
      identity.path ===
      join(f.temporaryRoot, relative(f.nativeStagingRoot, lastPath)),
  );
  assert.equal(
    lastIdentity.sha256,
    createHash("sha256").update(readFileSync(lastIdentity.path)).digest("hex"),
  );
});

test("required capture and started native process records are missing even on failure", async (t) => {
  const f = fixture(t);
  nativeRecord(
    f,
    "evaluation-process-matrix-one",
    "normal/consumer.stderr.log",
    "native process failed",
  );
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  rmSync(join(f.outputRoot, "environment.txt"));
  const result = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.match(
    result.failures.join(),
    /Missing required evidence:.*environment.txt/u,
  );
  assert.match(
    result.failures.join(),
    /Missing required evidence:.*observation.json/u,
  );
  assert.match(f.text(), /native process failed/u);
});

test("summary escapes hostile markup and command arguments", async (t) => {
  const f = fixture(t);
  await capture(
    f,
    "environment",
    "process.stdout.write('<script>bad</script> `markdown` ::error::x'); process.exitCode=1",
  );
  reportEvidence({ ...f, verificationKind: "committing-to-git" });
  const summary = readFileSync(f.summaryPath, "utf8");
  assert.match(summary, /&lt;script&gt;bad&lt;\/script&gt;/u);
  assert.doesNotMatch(summary, /<script>/u);
  assert.ok(Buffer.byteLength(summary) <= 64 * 1024);
});

test("redirected directories and out-of-root or hardlinked files are rejected", async (t) => {
  const f = fixture(t);
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "receipt.json"), "OUTSIDE-SECRET");
  assert.throws(
    () => assertEvidencePath(f.temporaryRoot, join(outside, "receipt.json")),
    /outside root/u,
  );
  const redirected = join(
    f.nativeStagingRoot,
    "evaluation-conformance-redirect",
  );
  symlinkSync(
    outside,
    redirected,
    process.platform === "win32" ? "junction" : "dir",
  );
  const hardlinked = nativeRecord(
    f,
    "evaluation-conformance-hardlink",
    "commands.json",
    "original",
  );
  rmSync(hardlinked);
  linkSync(join(outside, "receipt.json"), hardlinked);
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  const result = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.match(result.failures.join(), /Redirected evidence path/u);
  assert.match(result.failures.join(), /Hardlinked evidence file/u);
  assert.doesNotMatch(f.text(), /OUTSIDE-SECRET/u);
});

test("acquisition failure evidence survives skipped conformance and excludes downloads", async (t) => {
  const f = fixture(t);
  await capture(
    f,
    "environment",
    "process.stdout.write('environment')",
    "evaluation-conformance",
  );
  await capture(
    f,
    "install",
    "process.stdout.write('install')",
    "evaluation-conformance",
  );
  const acquisitionRoot = join(f.root, "acquisition-failures");
  mkdirSync(acquisitionRoot);
  writeFileSync(
    join(acquisitionRoot, "failure-old.json"),
    "NEVER-PRINT-HISTORICAL-FAILURE",
  );
  writeFileSync(
    join(acquisitionRoot, "downloaded.json"),
    "NEVER-PRINT-DOWNLOAD",
  );
  await captureCommand({
    ...f,
    verificationKind: "evaluation-conformance",
    stage: "acquisition",
    acquisitionRoot,
    command: process.execPath,
    arguments_: [
      "-e",
      `require('node:fs').writeFileSync(${JSON.stringify(join(acquisitionRoot, "failure-fixture.json"))}, '{"stage":"archive-verify","stderr":"setup traceback"}'); process.exitCode=5`,
    ],
  });
  const result = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
    acquisitionRoot,
  });
  assert.match(f.text(), /setup traceback/u);
  assert.doesNotMatch(f.text(), /NEVER-PRINT/u);
  assert.equal(result.identities.length, 4);
});

test("native root discovery binds required records to the actual command stage", async (t) => {
  const f = fixture(t);
  await capture(
    f,
    "environment",
    "process.stdout.write('environment')",
    "evaluation-conformance",
  );
  await capture(
    f,
    "install",
    "process.stdout.write('install')",
    "evaluation-conformance",
  );
  await capture(
    f,
    "acquisition",
    "process.stdout.write('acquisition')",
    "evaluation-conformance",
  );
  await capture(
    f,
    "build-check",
    "process.stdout.write('build')",
    "evaluation-conformance",
  );
  const nativeRoot = join(f.temporaryRoot, "evaluation-conformance-partial");
  await capture(
    f,
    "conformance",
    `require('node:fs').mkdirSync(${JSON.stringify(nativeRoot)}); process.exitCode=7`,
    "evaluation-conformance",
  );
  const result = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.match(
    result.failures.join(),
    /Missing required evidence:.*commands.json/u,
  );
  assert.equal(
    result.stages.find((stage) => stage.stage === "conformance").exitCode,
    7,
  );
});

test("summary overflow is visible and creates no replacement archive", async (t) => {
  const f = fixture(t);
  for (let index = 0; index < 240; index++) {
    nativeRecord(
      f,
      `evaluation-conformance-${index}-${"x".repeat(180)}`,
      "commands.json",
      "diagnostic",
    );
  }
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  const result = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.equal(result.identities.length, 241);
  assert.match(result.failures.join(), /Summary evidence limit/u);
  const summary = readFileSync(f.summaryPath, "utf8");
  assert.match(summary, /incomplete/u);
  assert.ok(Buffer.byteLength(summary) <= 64 * 1024);
});

test("all installation modes and Windows closure records remain diagnostic evidence", async (t) => {
  const f = fixture(t);
  for (const skill of [
    "committing-to-git",
    "defining-concepts",
    "naming-objects-in-software-engineering",
    "reading-epubs",
  ]) {
    for (const mode of ["explicit", "default", "full-depth"]) {
      nativeRecord(
        f,
        "evaluation-installation-one",
        `${skill}-${mode}/process.json`,
        JSON.stringify({ stdout: `${skill}-${mode}` }),
      );
    }
  }
  for (const file of [
    "host-result.json",
    "host-result.json.ready.json",
    "host-result.json.closure.json",
    "wrapper-result.json",
  ]) {
    nativeRecord(
      f,
      "windows-job-contract-one",
      file,
      JSON.stringify({ diagnostic: file }),
    );
  }
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  const result = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.equal(result.identities.length, 17);
  assert.match(f.text(), /host-result.json.closure.json/u);
  assert.deepEqual(result.failures, []);
});

test("live output budget reports omitted bytes and remains fatal across later stages", async (t) => {
  const f = fixture(t);
  // Discard streamed bytes; inspect the bounded native record and failure text.
  f.output = { write() {} };
  const first = await capture(
    f,
    "environment",
    "process.stdout.write(Buffer.alloc(33*1024*1024, 65))",
  );
  assert.equal(first.emittedBytes, 32 * 1024 * 1024);
  assert.equal(first.omittedBytes, 1024 * 1024);
  assert.match(first.failures.join(), /omitted 1048576 bytes/u);
  const next = await capture(f, "install", "process.stdout.write('later')");
  assert.equal(next.emittedBytes, 0);
  assert.equal(next.omittedBytes, 5);
  const report = reportEvidence({
    ...f,
    verificationKind: "committing-to-git",
  });
  assert.match(report.failures.join(), /Evidence limit/u);
  assert.doesNotMatch(report.failures.join(), /Missing stage evidence/u);
});

test("only roots created by the current captured invocation are published", async (t) => {
  const f = fixture(t);
  const historicalRoot = join(
    f.temporaryRoot,
    "evaluation-conformance-historical",
  );
  mkdirSync(historicalRoot);
  writeFileSync(
    join(historicalRoot, "commands.json"),
    "NEVER-PRINT-HISTORICAL",
  );
  nativeRecord(
    f,
    "evaluation-conformance-current",
    "commands.json",
    "current diagnostics",
  );
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  const report = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.match(f.text(), /current diagnostics/u);
  assert.doesNotMatch(f.text(), /NEVER-PRINT-HISTORICAL/u);
  assert.equal(report.identities.length, 2);
});

test("discovery limits and unreadable prior results never suppress the native command", async (t) => {
  const f = fixture(t);
  const acquisitionRoot = join(f.root, "acquisition");
  mkdirSync(acquisitionRoot);
  for (let index = 0; index < 257; index++) {
    mkdirSync(join(f.temporaryRoot, `evaluation-conformance-old-${index}`));
    writeFileSync(
      join(acquisitionRoot, `failure-old-${index}.json`),
      "historical",
    );
  }
  writeFileSync(join(f.outputRoot, "environment.result.json"), "not JSON");
  const marker = join(f.root, "native-command-ran");
  const result = await captureCommand({
    ...f,
    acquisitionRoot,
    verificationKind: "evaluation-conformance",
    stage: "tests",
    command: process.execPath,
    arguments_: [
      "-e",
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran'); process.stdout.write('still native'); process.exitCode=19`,
    ],
  });
  assert.equal(readFileSync(marker, "utf8"), "ran");
  assert.equal(result.exitCode, 19);
  assert.match(result.failures.join(), /Evidence discovery limit/u);
  assert.match(result.failures.join(), /Acquisition evidence discovery limit/u);
  assert.match(result.failures.join(), /JSON/u);
  assert.equal(result.emittedBytes, 0);
  assert.deepEqual(result.nativeRoots, []);
  assert.deepEqual(result.acquisitionRecords, []);
});

test("supplemental UTF-8 replacement expansion is counted before emission", async (t) => {
  const f = fixture(t);
  nativeRecord(
    f,
    "evaluation-conformance-invalid",
    "commands.json",
    Buffer.alloc(12 * 1024 * 1024, 0xff),
  );
  nativeRecord(
    f,
    "evaluation-conformance-sibling",
    "receipt.json",
    "readable sibling",
  );
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  const result = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.match(result.failures.join(), /Evidence limit/u);
  assert.match(f.text(), /readable sibling/u);
  assert.doesNotMatch(f.text(), /\uFFFD/u);
  assert.ok(result.emittedBytes < 32 * 1024 * 1024);
});

test("live capture never truncates inside a UTF-8 character", async (t) => {
  const f = fixture(t);
  f.output = { write() {} };
  const result = await capture(
    f,
    "environment",
    "process.stdout.write(Buffer.alloc(32*1024*1024-1,65)); process.stdout.write('€');",
  );
  const text = readFileSync(join(f.outputRoot, "environment.txt"), "utf8");
  assert.equal(result.emittedBytes, 32 * 1024 * 1024 - 1);
  assert.equal(result.omittedBytes, 3);
  assert.doesNotMatch(text, /\uFFFD/u);
  assert.match(result.failures.join(), /omitted 3 bytes/u);
});

test("dangling allowlisted redirects are rejected even when optional", async (t) => {
  const f = fixture(t);
  const recordPath = nativeRecord(
    f,
    "evaluation-conformance-dangling",
    "receipt.json",
    "placeholder",
  );
  rmSync(recordPath);
  symlinkSync(
    join(f.root, "absent"),
    recordPath,
    process.platform === "win32" ? "junction" : "file",
  );
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  const report = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.match(report.failures.join(), /Redirected evidence path/u);
});

test("dangling native scenario directories are rejected before missing-file checks", async (t) => {
  const f = fixture(t);
  const path = nativeRecord(
    f,
    "evaluation-process-matrix-dangling",
    "normal/placeholder",
    "placeholder",
  );
  rmSync(resolve(path, ".."), { recursive: true });
  symlinkSync(
    join(f.root, "absent"),
    resolve(path, ".."),
    process.platform === "win32" ? "junction" : "dir",
  );
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  const report = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.match(report.failures.join(), /Redirected evidence path/u);
});

test("oversized supplemental record fails visibly while readable siblings survive", async (t) => {
  const f = fixture(t);
  nativeRecord(
    f,
    "evaluation-conformance-one",
    "commands.json",
    Buffer.alloc(33 * 1024 * 1024, 65),
  );
  nativeRecord(
    f,
    "evaluation-conformance-two",
    "receipt.json",
    "small sibling",
  );
  await capture(
    f,
    "environment",
    "process.exitCode=1",
    "evaluation-conformance",
  );
  const result = reportEvidence({
    ...f,
    verificationKind: "evaluation-conformance",
  });
  assert.match(result.failures.join(), /omitted 34603008 bytes/u);
  assert.match(f.text(), /small sibling/u);
});
