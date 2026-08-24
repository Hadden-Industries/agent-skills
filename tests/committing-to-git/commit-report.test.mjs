// Post-commit fact collection and human-readable reporting.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  collectCommitReport,
  renderCommitReport,
} from "../../src/committing-to-git/report/commitReport.js";
import {
  commitAll,
  createRepositoryFixture,
  git,
  readGitTraceArguments,
  readJson,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function skippedVerification(commitOid = "1".repeat(40)) {
  return {
    schemaVersion: 2,
    commitOid,
    initialPolicy: "skipped",
    finalPolicy: "skipped",
    attempts: [
      {
        status: "skipped",
        reason: "user-policy",
        backend: null,
        identity: null,
        timestamp: "2026-08-23T12:00:00.000Z",
      },
    ],
    effectiveAttempt: 0,
    blocksPush: false,
  };
}

test("report labels binary line statistics as unavailable", () => {
  const text = renderCommitReport({
    commit: {
      signed: false,
      shortOid: "1".repeat(12),
      branch: "main",
      subject: "build: Preserve binary assets",
      author: { name: "Test", email: "test@example.invalid" },
      committer: { name: "Test", email: "test@example.invalid" },
      treeMatches: true,
      messageMatches: true,
      parentMatches: true,
    },
    statistics: {
      files: 1,
      additions: 0,
      deletions: 0,
      binaryFiles: 1,
      kinds: { modified: 1 },
    },
    verification: skippedVerification(),
    checks: { checks: [] },
    publication: { status: "not-requested" },
    workspace: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  });

  assert.match(text, /1 binary file with unavailable line counts/u);
  assert.doesNotMatch(text, /0 insertions, 0 deletions$/mu);
});

test("report discloses line statistics deferred by the snapshot budget", () => {
  const text = renderCommitReport({
    commit: {
      signed: false,
      shortOid: "1".repeat(12),
      branch: "main",
      subject: "perf: Bound presentation work",
      author: { name: "Test", email: "test@example.invalid" },
      committer: { name: "Test", email: "test@example.invalid" },
      treeMatches: true,
      messageMatches: true,
      parentMatches: true,
    },
    statistics: {
      files: 1,
      additions: null,
      deletions: null,
      binaryFiles: null,
      kinds: { modified: 1 },
    },
    verification: skippedVerification(),
    checks: { checks: [] },
    publication: { status: "not-requested" },
    workspace: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  });

  assert.match(
    text,
    /line statistics deferred by the approved snapshot budget/u,
  );
  assert.doesNotMatch(text, /null insertion|null deletion/u);
});

test("report does not overclaim OpenPGP identity authorization", () => {
  const text = renderCommitReport({
    commit: {
      signed: true,
      shortOid: "1".repeat(12),
      branch: "main",
      subject: "build: Preserve signed history",
      author: { name: "Test", email: "test@example.invalid" },
      committer: { name: "Test", email: "test@example.invalid" },
      treeMatches: true,
      messageMatches: true,
      parentMatches: true,
    },
    statistics: {
      files: 1,
      additions: 1,
      deletions: 0,
      binaryFiles: 0,
      kinds: { added: 1 },
    },
    verification: {
      schemaVersion: 2,
      commitOid: "1".repeat(40),
      initialPolicy: "required",
      finalPolicy: "required",
      attempts: [
        {
          status: "verified",
          reason: null,
          backend: "openpgp",
          identity: {
            signer: "Test Signer <test@example.invalid>",
            primaryKeyFingerprint: "1".repeat(40),
            signingSubkeyFingerprint: null,
          },
          timestamp: "2026-08-23T12:00:00.000Z",
        },
      ],
      effectiveAttempt: 0,
      blocksPush: false,
    },
    checks: { checks: [] },
    publication: { status: "not-requested" },
    workspace: { staged: [], unstaged: [], untracked: [], conflicted: [] },
  });

  assert.match(text, /OpenPGP signature is cryptographically valid/u);
  assert.match(text, /identity authorization was not assessed/u);
  assert.doesNotMatch(text, /Trusted verification succeeded/u);
});

test("report preserves normalized Git change kinds", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-kinds-");
  const message = "build: Preserve Git change semantics\n";

  writeRepositoryFile(fixture.repo, "script.sh", "#!/bin/sh\nexit 0\n");
  writeRepositoryFile(fixture.repo, "type-entry", "regular file\n");
  commitAll(fixture.repo);

  const oldLinkOid = git(["hash-object", "-w", "--stdin"], fixture.repo, {
    input: "old-target",
  }).stdout.trim();

  git(
    ["update-index", "--add", "--cacheinfo", `120000,${oldLinkOid},link-entry`],
    fixture.repo,
  );
  git(["commit", "--quiet", "-m", "add symlink fixture"], fixture.repo);

  const parentOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const newLinkOid = git(["hash-object", "-w", "--stdin"], fixture.repo, {
    input: "new-target",
  }).stdout.trim();

  git(["update-index", "--chmod=+x", "script.sh"], fixture.repo);
  git(
    ["update-index", "--cacheinfo", `120000,${newLinkOid},type-entry`],
    fixture.repo,
  );
  git(
    ["update-index", "--cacheinfo", `120000,${newLinkOid},link-entry`],
    fixture.repo,
  );
  git(
    [
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${parentOid},vendor/component`,
    ],
    fixture.repo,
  );

  const approvedTree = git(["write-tree"], fixture.repo).stdout.trim();

  git(["commit", "--quiet", "-m", message.trim()], fixture.repo);
  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const report = collectCommitReport({
    root: fixture.repo,
    commitOid,
    manifest: { headOid: parentOid, indexTreeOid: approvedTree },
    approvedMessage: message,
    verification: skippedVerification(commitOid),
    checks: { schemaVersion: 1, checks: [] },
  });

  assert.deepEqual(report.statistics.kinds, {
    "mode-changed": 1,
    "submodule-changed": 1,
    "symlink-changed": 1,
    "type-changed": 1,
  });
});

test("report counts a similar destination with a retained source as added", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-adapted-");
  const message = "feat(parser): Add adapted parser support\n";
  const sharedLines = Array.from(
    { length: 80 },
    (_, index) => `shared line ${String(index + 1).padStart(3, "0")}`,
  );
  const source = [
    ...sharedLines,
    ...Array.from({ length: 20 }, (_, index) => `source line ${index + 1}`),
  ].join("\n");
  const destination = [
    ...sharedLines,
    ...Array.from({ length: 20 }, (_, index) => `adapted line ${index + 1}`),
  ].join("\n");

  writeRepositoryFile(fixture.repo, "src/source-parser.js", `${source}\n`);
  commitAll(fixture.repo);

  const parentOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  writeRepositoryFile(
    fixture.repo,
    "src/adapted-parser.js",
    `${destination}\n`,
  );
  git(["add", "--", "src/adapted-parser.js"], fixture.repo);

  const approvedTree = git(["write-tree"], fixture.repo).stdout.trim();

  git(["commit", "--quiet", "-m", message.trim()], fixture.repo);

  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const report = collectCommitReport({
    root: fixture.repo,
    commitOid,
    manifest: { headOid: parentOid, indexTreeOid: approvedTree },
    approvedMessage: message,
    verification: skippedVerification(commitOid),
    checks: { schemaVersion: 1, checks: [] },
  });

  assert.deepEqual(report.statistics.kinds, { added: 1 });
});

test("normal report uses actual commit facts and groups remaining workspace state", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-");
  const messagePath = join(fixture.scratch, "message.txt");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const verificationPath = join(fixture.scratch, "verification.json");
  const checksPath = join(fixture.scratch, "checks.json");
  const outputJson = join(fixture.scratch, "report.json");
  const outputText = join(fixture.scratch, "report.txt");
  const tracePath = join(fixture.scratch, "report-git-trace.json");
  const message = [
    "feat(parser): Prevent malformed token acceptance",
    "",
    "File Changes:",
    "1. `src/parser.js`",
    "   - Reject malformed tokens before structural parsing",
    "",
  ].join("\n");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(
    fixture.repo,
    "src/parser.js",
    "export const parser = true;\n",
  );
  git(["add", "-A"], fixture.repo);
  const approvedTree = git(["write-tree"], fixture.repo).stdout.trim();

  writeFileSync(messagePath, message);
  git(
    ["commit", "--quiet", "--cleanup=verbatim", "-F", messagePath],
    fixture.repo,
  );
  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  writeJson(manifestPath, {
    schemaVersion: 2,
    headOid: git(["rev-parse", "HEAD^"], fixture.repo).stdout.trim(),
    indexTreeOid: approvedTree,
    changeUnitCount: 1,
    changeUnits: [{ kind: "added" }],
    statistics: {
      files: 1,
      additions: 1,
      deletions: 0,
      binaryFiles: 0,
    },
  });
  writeJson(verificationPath, skippedVerification(commitOid));
  writeJson(checksPath, { schemaVersion: 1, checks: [] });

  writeRepositoryFile(fixture.repo, "seed.txt", "remaining change\n");
  writeRepositoryFile(fixture.repo, "notes.txt", "untracked\n");

  const result = runCommitWorkflow(
    "report create",
    [
      "--commit",
      commitOid,
      "--manifest",
      manifestPath,
      "--approved-message",
      messagePath,
      "--verification",
      verificationPath,
      "--checks",
      checksPath,
      "--output-json",
      outputJson,
      "--output-text",
      outputText,
    ],
    fixture.repo,
    { env: { GIT_TRACE2_EVENT: tracePath } },
  );

  assert.equal(result.status, 0, result.stderr);

  const report = readJson(outputJson);
  const text = readFileSync(outputText, "utf8");

  assert.equal(report.commit.oid, commitOid);
  assert.equal(report.commit.treeMatches, true);
  assert.equal(report.commit.messageMatches, true);
  assert.deepEqual(report.statistics, {
    files: 1,
    additions: 1,
    deletions: 0,
    binaryFiles: 0,
    kinds: { added: 1 },
  });
  assert.equal(
    readGitTraceArguments(tracePath).some((args) => args.includes("diff-tree")),
    false,
  );
  assert.deepEqual(
    report.workspace.unstaged.map(({ path }) => path),
    ["seed.txt"],
  );
  assert.deepEqual(
    report.workspace.untracked.map(({ path }) => path),
    ["notes.txt"],
  );
  assert.match(
    text,
    new RegExp("Created commit `" + commitOid.slice(0, 12), "u"),
  );
  assert.match(text, /Snapshot: Matches the approved staged tree/u);
  assert.match(text, /Policy: skipped/u);
  assert.match(text, /Result: Skipped by user policy/u);
  assert.match(text, /No checks were run in this workflow/u);
  assert.match(text, /Not requested; not attempted by this workflow/u);
  assert.doesNotMatch(text, /Includes/u);
});

test("report renders an explicitly recorded publication result", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-push-");
  const messagePath = join(fixture.scratch, "message.txt");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const verificationPath = join(fixture.scratch, "verification.json");
  const checksPath = join(fixture.scratch, "checks.json");
  const publicationPath = join(fixture.scratch, "publication.json");
  const outputJson = join(fixture.scratch, "report.json");
  const outputText = join(fixture.scratch, "report.txt");
  const message = "docs: Explain publication status\n";

  writeRepositoryFile(fixture.repo, "published.md", "published\n");
  git(["add", "-A"], fixture.repo);
  const approvedTree = git(["write-tree"], fixture.repo).stdout.trim();
  writeFileSync(messagePath, message);
  git(
    ["commit", "--quiet", "--cleanup=verbatim", "-F", messagePath],
    fixture.repo,
  );
  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  writeJson(manifestPath, {
    schemaVersion: 1,
    headOid: null,
    indexTreeOid: approvedTree,
    changeUnitCount: 1,
    changeUnits: [],
  });
  writeJson(verificationPath, skippedVerification(commitOid));
  writeJson(checksPath, { schemaVersion: 1, checks: [] });
  writeJson(publicationPath, {
    schemaVersion: 1,
    status: "pushed",
    commitOid,
    remote: "origin",
    destination: "refs/heads/main",
    refspec: `${commitOid}:refs/heads/main`,
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
  });

  const result = runCommitWorkflow(
    "report create",
    [
      "--commit",
      commitOid,
      "--manifest",
      manifestPath,
      "--approved-message",
      messagePath,
      "--verification",
      verificationPath,
      "--checks",
      checksPath,
      "--publication",
      publicationPath,
      "--output-json",
      outputJson,
      "--output-text",
      outputText,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readJson(outputJson).publication, {
    schemaVersion: 1,
    status: "pushed",
    commitOid,
    remote: "origin",
    destination: "refs/heads/main",
    refspec: `${commitOid}:refs/heads/main`,
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
  });
  assert.ok(
    readFileSync(outputText, "utf8").includes(
      `Pushed \`${commitOid}\` to \`origin\` \`refs/heads/main\``,
    ),
  );
});

test("report rejects a merge commit even when its first parent matches", (t) => {
  const fixture = createRepositoryFixture(t, "commit-report-merge-");
  const messagePath = join(fixture.scratch, "message.txt");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const verificationPath = join(fixture.scratch, "verification.json");
  const checksPath = join(fixture.scratch, "checks.json");
  const outputJson = join(fixture.scratch, "report.json");
  const outputText = join(fixture.scratch, "report.txt");
  const message = "Merge feature branch\n";

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  git(["switch", "-c", "feature"], fixture.repo);
  writeRepositoryFile(fixture.repo, "feature.txt", "feature\n");
  commitAll(fixture.repo, "feature");
  git(["switch", "main"], fixture.repo);
  writeRepositoryFile(fixture.repo, "main.txt", "main\n");
  commitAll(fixture.repo, "main");

  const expectedParent = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();

  git(["merge", "--no-ff", "feature", "-m", message.trim()], fixture.repo);

  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const approvedTree = git(
    ["rev-parse", "HEAD^{tree}"],
    fixture.repo,
  ).stdout.trim();

  writeFileSync(messagePath, message);
  writeJson(manifestPath, {
    schemaVersion: 1,
    headOid: expectedParent,
    indexTreeOid: approvedTree,
    changeUnitCount: 1,
    changeUnits: [],
  });
  writeJson(verificationPath, skippedVerification(commitOid));
  writeJson(checksPath, { schemaVersion: 1, checks: [] });

  const result = runCommitWorkflow(
    "report create",
    [
      "--commit",
      commitOid,
      "--manifest",
      manifestPath,
      "--approved-message",
      messagePath,
      "--verification",
      verificationPath,
      "--checks",
      checksPath,
      "--output-json",
      outputJson,
      "--output-text",
      outputText,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 1, result.stderr);
  assert.equal(readJson(outputJson).commit.parentMatches, false);
  assert.match(readFileSync(outputText, "utf8"), /Parent: DIFFERS/u);
});
