// Exact-OID, explicit-destination publication and durable result capture.
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  commitAll,
  createRepositoryFixture,
  git,
  readJson,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

test("publication pushes the exact commit to an explicit branch ref", (t) => {
  const fixture = createRepositoryFixture(t, "commit-publication-");
  const remote = join(fixture.base, "remote.git");
  const output = join(fixture.scratch, "publication.json");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  writeRepositoryFile(fixture.repo, "published.txt", "published\n");
  commitAll(fixture.repo, "publish fixture");

  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const result = runCommitWorkflow(
    "publication push",
    [
      "--commit",
      commitOid,
      "--remote",
      "origin",
      "--destination",
      "refs/heads/review",
      "--output",
      output,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    git(["rev-parse", "refs/heads/review"], remote).stdout.trim(),
    commitOid,
  );
  assert.deepEqual(
    {
      ...readJson(output),
      stdout: "<recorded>",
      stderr: "<recorded>",
    },
    {
      schemaVersion: 1,
      status: "pushed",
      commitOid,
      remote: "origin",
      destination: "refs/heads/review",
      refspec: `${commitOid}:refs/heads/review`,
      exitCode: 0,
      stdout: "<recorded>",
      stderr: "<recorded>",
    },
  );
});

test("publication records a failed push without claiming success", (t) => {
  const fixture = createRepositoryFixture(t, "commit-publication-failure-");
  const output = join(fixture.scratch, "publication.json");

  writeRepositoryFile(fixture.repo, "local.txt", "local\n");
  commitAll(fixture.repo, "local fixture");

  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const result = runCommitWorkflow(
    "publication push",
    [
      "--commit",
      commitOid,
      "--remote",
      "missing-remote",
      "--destination",
      "refs/heads/main",
      "--output",
      output,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 1);
  assert.equal(readJson(output).status, "failed");
  assert.equal(readJson(output).commitOid, commitOid);
  assert.match(readJson(output).stderr, /missing-remote/u);
});

test("publication rejects an abbreviated destination before invoking push", (t) => {
  const fixture = createRepositoryFixture(t, "commit-publication-ref-");
  const output = join(fixture.scratch, "publication.json");

  writeRepositoryFile(fixture.repo, "local.txt", "local\n");
  commitAll(fixture.repo, "local fixture");

  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const result = runCommitWorkflow(
    "publication push",
    [
      "--commit",
      commitOid,
      "--remote",
      "origin",
      "--destination",
      "main",
      "--output",
      output,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /refs\/heads/u);
});

test("publication rejects an unusable output path before invoking push", (t) => {
  const fixture = createRepositoryFixture(t, "commit-publication-output-");
  const remote = join(fixture.base, "remote.git");

  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  writeRepositoryFile(fixture.repo, "published.txt", "published\n");
  commitAll(fixture.repo, "publish fixture");

  const commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  const result = runCommitWorkflow(
    "publication push",
    [
      "--commit",
      commitOid,
      "--remote",
      "origin",
      "--destination",
      "refs/heads/review",
      "--output",
      fixture.scratch,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 2);
  assert.notEqual(
    git(["show-ref", "--verify", "refs/heads/review"], remote, {
      allowFailure: true,
    }).status,
    0,
  );
});
