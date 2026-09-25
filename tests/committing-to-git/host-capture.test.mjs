import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  configureSshSigning,
  createRepositoryFixture,
  git,
  runNodeScript,
  writeRepositoryFile,
} from "./harness.mjs";

const skill = new URL("../../skills/committing-to-git/", import.meta.url);
const helper = fileURLToPath(new URL("scripts/commitWorkflow.mjs", skill));

function captureFixture(t, { trusted = true } = {}) {
  const fixture = createRepositoryFixture(t, "host-capture-");
  assert.ok(configureSshSigning(t, fixture));
  const key = git(
    ["config", "--path", "user.signingkey"],
    fixture.repo,
  ).stdout.trim();
  const signers = join(fixture.scratch, "allowed-signers");
  writeFileSync(
    signers,
    trusted
      ? `tests@example.invalid ${readFileSync(`${key}.pub`, "utf8")}`
      : "# No trusted keys\n",
  );
  git(["config", "gpg.ssh.allowedSignersFile", signers], fixture.repo);
  writeRepositoryFile(fixture.repo, "example.txt", "Capture both streams\n");
  function invoke(args, expectedExit = 0) {
    const child = runNodeScript(helper, args, fixture.repo, {
      env: { TEMP: fixture.scratch, TMP: fixture.scratch },
    });
    assert.equal(child.status, expectedExit, child.stdout + child.stderr);
    assert.equal(child.stderr, "");
    const result = JSON.parse(child.stdout + child.stderr);
    assert.equal(child.stdout, `${JSON.stringify(result)}\n`);
    assert.equal(result.exitCode, expectedExit);
    return { result };
  }
  const { result: prepared } = invoke([
    "workflow",
    "prepare",
    "--mode",
    "actual",
    "--scope",
    "full",
    "--evidence",
    "message",
    "--basis",
    "authored-current-task",
    "--verification",
    "required",
  ]);
  const commit = (exit = 0) =>
    invoke(
      [
        "workflow",
        "commit",
        "--transaction",
        prepared.transaction,
        "--message",
        "fix(capture): Preserve machine result",
      ],
      exit,
    );
  return { ...fixture, invoke, commit, transaction: prepared.transaction };
}

test("direct JSON invocation preserves signed commit and publication through a merged host", (t) => {
  const fixture = captureFixture(t);
  const remote = join(fixture.base, "remote.git");
  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  writeFileSync(
    join(remote, "hooks", "pre-receive"),
    '#!/bin/sh\nprintf "capture-remote-diagnostic\\n"\n',
    { mode: 0o755 },
  );
  const committed = fixture.commit();
  assert.equal(committed.result.commitState, "created");
  assert.equal(committed.result.report.commit.signed, true);
  const published = fixture.invoke([
    "workflow",
    "publish",
    "--transaction",
    fixture.transaction,
    "--remote",
    "origin",
    "--destination",
    "refs/heads/review",
  ]);
  assert.equal(published.result.publicationState, "published");
  const detail = fixture.invoke(
    published.result.processDiagnostics.arguments,
  ).result;
  assert.match(
    detail.processDiagnostics.operations[0].stdout.text,
    /create mode/u,
  );
  assert.match(
    detail.processDiagnostics.operations[1].stderr.text,
    /capture-remote-diagnostic/u,
  );
  assert.match(
    detail.processDiagnostics.operations[1].stdout.text,
    /\[new branch\]/u,
  );
  assert.equal(
    git(
      ["--git-dir", remote, "rev-parse", "refs/heads/review"],
      fixture.repo,
    ).stdout.trim(),
    committed.result.commitOid,
  );
  // Lost output is recovered through the public transaction command only.
  const report = fixture.invoke([
    "workflow",
    "recover",
    "--transaction",
    fixture.transaction,
  ]);
  assert.equal(report.result.publicationState, "published");
  assert.equal(report.result.commitOid, committed.result.commitOid);
  assert.deepEqual(
    report.result.processDiagnostics,
    published.result.processDiagnostics,
  );
  assert.equal(
    git(["rev-list", "--count", "HEAD"], fixture.repo).stdout,
    "1\n",
  );
});

test("direct JSON invocation retains a known commit when publication is rejected", (t) => {
  const fixture = captureFixture(t);
  const remote = join(fixture.base, "remote.git");
  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  writeFileSync(
    join(remote, "hooks", "pre-receive"),
    '#!/bin/sh\nprintf "capture-rejection\\n"\nexit 1\n',
    { mode: 0o755 },
  );
  const committed = fixture.commit();
  const rejected = fixture.invoke(
    [
      "workflow",
      "publish",
      "--transaction",
      fixture.transaction,
      "--remote",
      "origin",
      "--destination",
      "refs/heads/review",
    ],
    1,
  );
  assert.equal(rejected.result.publicationState, "rejected");
  assert.equal(rejected.result.commitOid, committed.result.commitOid);
  assert.equal(rejected.result.commitState, "created");
  assert.equal(rejected.result.recovery.automatic, false);
  const detail = fixture.invoke(
    rejected.result.processDiagnostics.arguments,
  ).result;
  assert.match(
    detail.processDiagnostics.operations[1].stderr.text,
    /capture-rejection/u,
  );
  assert.notEqual(
    git(["--git-dir", remote, "rev-parse", "refs/heads/review"], fixture.repo, {
      allowFailure: true,
    }).status,
    0,
  );
});

test("direct JSON invocation retains a signed commit after required verification fails", (t) => {
  const fixture = captureFixture(t, { trusted: false });
  const failed = fixture.commit(3);
  assert.equal(failed.result.disposition, "completed-with-failure");
  assert.equal(failed.result.commitState, "created");
  assert.equal(failed.result.publicationAllowed, false);
  assert.equal(failed.result.recovery.automatic, false);
  assert.equal(
    failed.result.commitOid,
    git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
  );
  const report = fixture.invoke(
    ["workflow", "recover", "--transaction", fixture.transaction],
    3,
  );
  assert.equal(report.result.commitOid, failed.result.commitOid);
  assert.equal(
    git(["rev-list", "--count", "HEAD"], fixture.repo).stdout,
    "1\n",
  );
});

test("JSON diagnostics are bounded, retained and hash-checked without replay", (t) => {
  const fixture = captureFixture(t);
  writeFileSync(
    join(fixture.repo, ".git", "hooks", "pre-commit"),
    "#!/bin/sh\nprintf '%020000d\\n' 0\n",
    { mode: 0o755 },
  );
  const committed = fixture.commit();
  const detail = fixture.invoke(
    committed.result.processDiagnostics.arguments,
  ).result;
  const evidence = detail.processDiagnostics.operations[0];
  assert.equal(evidence.stderr.text.length, 4096);
  assert.ok(evidence.stderr.omittedByteCount > 15000);
  assert.ok(readFileSync(evidence.path).length > 20000);
  writeFileSync(evidence.path, "corrupt evidence");
  const corrupt = fixture.invoke(
    committed.result.processDiagnostics.arguments,
    2,
  ).result;
  assert.equal(corrupt.code, "PROCESS_DIAGNOSTICS_INVALID");
  assert.equal(corrupt.commitState, "created");
  assert.equal(
    git(["rev-list", "--count", "HEAD"], fixture.repo).stdout,
    "1\n",
  );
});

test("text mode still streams child diagnostics", (t) => {
  const fixture = captureFixture(t);
  const child = runNodeScript(
    helper,
    [
      "workflow",
      "commit",
      "--transaction",
      fixture.transaction,
      "--message",
      "fix(capture): Preserve human output",
      "--format",
      "text",
    ],
    fixture.repo,
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.match(child.stderr, /create mode/u);
  assert.match(child.stdout, /Created signed commit/u);
});

test("argument rejection is one JSON result through merged capture", (t) => {
  const fixture = createRepositoryFixture(t);
  const child = runNodeScript(
    helper,
    ["workflow", "commit", "--unknown"],
    fixture.repo,
  );
  assert.equal(child.status, 2);
  assert.equal(child.stderr, "");
  assert.equal(
    JSON.parse(child.stdout + child.stderr).disposition,
    "invalid-input",
  );
});

test("explicit cleanup can remove retained diagnostics without losing the commit", (t) => {
  const fixture = captureFixture(t);
  const committed = fixture.commit();
  fixture.invoke(["workflow", "cleanup", "--transaction", fixture.transaction]);
  const detail = fixture.invoke(
    committed.result.processDiagnostics.arguments,
    2,
  ).result;
  assert.equal(detail.code, "PROCESS_DIAGNOSTICS_INVALID");
  assert.equal(detail.commitOid, committed.result.commitOid);
  const recovered = fixture.invoke([
    "workflow",
    "recover",
    "--transaction",
    fixture.transaction,
  ]).result;
  assert.equal(recovered.commitOid, committed.result.commitOid);
});
