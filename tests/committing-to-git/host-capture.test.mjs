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
  const documentation = readFileSync(
    new URL("references/diagnostics.md", skill),
    "utf8",
  );
  const recipe = documentation.match(/```javascript\r?\n(.*?)\r?\n```/su)?.[1];
  assert.ok(
    recipe,
    "The documented stream-preserving capture must be runnable",
  );
  const wrapper = join(fixture.scratch, "capture-workflow.mjs");
  writeFileSync(wrapper, recipe);
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
  let sequence = 0;
  function invoke(args, expectedExit = 0) {
    const directory = join(fixture.scratch, `capture ${sequence++}`);
    const child = runNodeScript(
      wrapper,
      [directory, helper, ...args],
      fixture.repo,
      { env: { TEMP: fixture.scratch, TMP: fixture.scratch } },
    );
    assert.equal(child.status, expectedExit, child.stdout + child.stderr);
    assert.equal(child.stderr, "");
    // A host combining streams still receives exactly the capture envelope.
    const envelope = JSON.parse(child.stderr + child.stdout);
    assert.equal(envelope.exitCode, expectedExit);
    assert.equal(envelope.signal, null);
    assert.equal(envelope.spawnError, null);
    assert.equal(
      readFileSync(join(directory, "capture.json"), "utf8"),
      child.stdout,
    );
    for (const channel of ["stdout", "stderr"]) {
      assert.equal(
        readFileSync(join(directory, `${channel}.txt`), "utf8"),
        envelope[channel],
      );
    }
    const result = JSON.parse(envelope.stdout);
    assert.equal(envelope.stdout, `${JSON.stringify(result)}\n`);
    assert.equal(result.exitCode, expectedExit);
    return { result, envelope, directory };
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

test("documented capture preserves signed commit and publication through a merged host", (t) => {
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
  assert.match(committed.envelope.stderr, /create mode/u);
  // The original consumer fails on these actual helper bytes.
  assert.throws(() =>
    JSON.parse(committed.envelope.stderr + committed.envelope.stdout),
  );
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
  assert.match(published.envelope.stderr, /capture-remote-diagnostic/u);
  assert.match(published.envelope.stderr, /\[new branch\]/u);
  assert.equal(
    git(
      ["--git-dir", remote, "rev-parse", "refs/heads/review"],
      fixture.repo,
    ).stdout.trim(),
    committed.result.commitOid,
  );
  // A truncated host response is recovered by reading the existing capture,
  // never by invoking the mutation again.
  assert.throws(() =>
    JSON.parse(JSON.stringify(published.envelope).slice(0, 50)),
  );
  const retained = JSON.parse(
    readFileSync(join(published.directory, "capture.json"), "utf8"),
  );
  assert.equal(
    JSON.parse(retained.stdout).commitOid,
    committed.result.commitOid,
  );
  const report = fixture.invoke([
    "workflow",
    "recover",
    "--transaction",
    fixture.transaction,
  ]);
  assert.equal(report.result.publicationState, "published");
  assert.equal(
    git(["rev-list", "--count", "HEAD"], fixture.repo).stdout,
    "1\n",
  );
});

test("documented capture retains a known commit when publication is rejected", (t) => {
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
  assert.match(rejected.envelope.stderr, /capture-rejection/u);
  assert.notEqual(
    git(["--git-dir", remote, "rev-parse", "refs/heads/review"], fixture.repo, {
      allowFailure: true,
    }).status,
    0,
  );
});

test("documented capture retains a signed commit after required verification fails", (t) => {
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
