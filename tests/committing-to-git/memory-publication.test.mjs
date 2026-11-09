import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  prepareMemoryPublication,
  publishMemoryProposal,
  observeMemoryPublication,
} from "../../src/committing-to-git/workflow/memoryPublicationWorkflow.js";
import {
  configureSshSigning,
  createRepositoryFixture,
  git,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

function snapshot(root) {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory()
        ? snapshot(path).map((value) => `${entry.name}/${value}`)
        : [
            `${entry.name}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`,
          ];
    })
    .sort();
}

function command(fixture, args, expected = 0) {
  const child = runCommitWorkflow("workflow publish", args, fixture.repo);
  assert.equal(child.status, expected, child.stdout + child.stderr);
  return JSON.parse(child.stdout);
}

function fixtureWithCommit(t) {
  const fixture = createRepositoryFixture(t, "memory-publication-");
  const remote = join(fixture.base, "remote.git");
  git(["init", "--bare", "--quiet", remote], fixture.repo);
  git(["remote", "add", "origin", remote], fixture.repo);
  if (!configureSshSigning(t, fixture)) return null;
  const publicKey = readFileSync(
    join(fixture.scratch, "signing-key.pub"),
    "utf8",
  ).trim();
  const allowedSigners = join(fixture.scratch, "allowed-signers");
  writeFileSync(allowedSigners, `tests@example.invalid ${publicKey}\n`);
  git(["config", "gpg.ssh.allowedSignersFile", allowedSigners], fixture.repo);
  writeRepositoryFile(fixture.repo, "publish.txt", "exact approved content\n");
  const preparedChild = runCommitWorkflow(
    "workflow prepare",
    [
      "--mode",
      "actual",
      "--scope",
      "full",
      "--evidence",
      "reuse",
      "--basis",
      "authored-current-task",
    ],
    fixture.repo,
  );
  assert.equal(
    preparedChild.status,
    0,
    preparedChild.stdout + preparedChild.stderr,
  );
  const prepared = JSON.parse(preparedChild.stdout);
  const commitChild = runCommitWorkflow(
    "workflow commit",
    [
      ...prepared.commit.arguments.slice(2),
      "--message",
      "fix: Publish the approved content",
    ],
    fixture.repo,
  );
  assert.equal(commitChild.status, 0, commitChild.stdout + commitChild.stderr);
  const committed = JSON.parse(commitChild.stdout);
  return { ...fixture, remote, committed, commitOid: committed.commitOid };
}

function plan(fixture, extra = []) {
  return command(fixture, [
    "--commit-oid",
    fixture.commitOid,
    "--remote",
    "origin",
    "--destination",
    "refs/heads/review",
    ...extra,
  ]);
}

test("memory commit -> read-only publication -> native exact-OID push needs no disk transaction", (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  assert.deepEqual(fixture.committed.publicationPreparation.arguments, [
    "workflow",
    "publish",
    "--commit-oid",
    fixture.commitOid,
    "--verification",
    "required",
  ]);
  const before = snapshot(fixture.base);
  const prepared = plan(fixture);
  assert.equal(prepared.status, "publication-ready");
  assert.equal(prepared.publicationAllowed, false);
  assert.equal(prepared.historicalAssurance, "not-attested");
  assert.deepEqual(prepared.outgoingCommitOids, [fixture.commitOid]);
  assert.deepEqual(snapshot(fixture.base), before);
  const result = command(fixture, prepared.publish.arguments.slice(2));
  assert.equal(result.status, "succeeded");
  assert.equal(result.witnessedOutcome, "witnessed-success");
  assert.equal(result.durableJournal, false);
  assert.equal(result.transaction, null);
  assert.equal(
    git(["rev-parse", "refs/heads/review"], fixture.remote).stdout.trim(),
    fixture.commitOid,
  );
  assert.equal(
    git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
    fixture.commitOid,
  );
  assert.deepEqual(readdirSync(fixture.scratch).sort(), [
    "allowed-signers",
    "signing-key",
    "signing-key.pub",
  ]);
});

test("older memory result adoption observes Git facts without claiming authenticated provenance", (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  // An old result contributes only its OID. Fabricated historical comparisons,
  // successful-check receipts and signature reports are never admitted inputs.
  const prepared = plan(fixture);
  assert.equal(prepared.binding.commitOid, fixture.commitOid);
  assert.equal(
    prepared.binding.commit.treeOid,
    fixture.committed.commit.treeOid,
  );
  assert.equal(prepared.verification.attempts[0].status, "verified");
  command(
    fixture,
    [
      "--commit-oid",
      fixture.commitOid,
      "--transaction",
      "forged.json",
      "--remote",
      "origin",
      "--destination",
      "refs/heads/review",
    ],
    2,
  );
  command(
    fixture,
    [
      "--publication-proposal",
      prepared.publicationProposal,
      "--verification",
      "skipped",
    ],
    2,
  );
});

test("memory publication rejects endpoint, destination, commit and signer drift before launching", async (t) => {
  for (const change of [
    "endpoint",
    "destination",
    "message",
    "signer",
    "outgoing",
  ]) {
    await t.test(change, async (st) => {
      const fixture = fixtureWithCommit(st);
      if (!fixture) return;
      const prepared = plan(fixture);
      let token = prepared.publicationProposal;
      if (change === "endpoint") {
        const other = join(fixture.base, "other.git");
        git(["init", "--bare", "--quiet", other], fixture.repo);
        git(["remote", "set-url", "--push", "origin", other], fixture.repo);
      } else if (change === "destination") {
        git(
          ["push", "origin", `${fixture.commitOid}:refs/heads/review`],
          fixture.repo,
        );
      } else {
        const binding = JSON.parse(
          Buffer.from(token.slice("ctgp1.".length), "base64url").toString(
            "utf8",
          ),
        );
        if (change === "message") binding.commit.messageSha256 = "0".repeat(64);
        if (change === "signer")
          binding.signer.identity.keyFingerprint = "SHA256:forged";
        if (change === "outgoing") binding.outgoingSha256 = "0".repeat(64);
        token =
          "ctgp1." + Buffer.from(JSON.stringify(binding)).toString("base64url");
      }
      await assert.rejects(
        publishMemoryProposal({
          publicationProposal: token,
          cwd: fixture.repo,
          processLauncher() {
            assert.fail("Stale plan launched a push");
          },
        }),
        { code: "PUBLICATION_PROPOSAL_STALE" },
      );
    });
  }
});

test("memory publication protects the bound branch value at push time", async (t) => {
  for (const change of [
    "deleted",
    "created",
    "already-matching",
    "unchanged",
  ]) {
    await t.test(change, async (st) => {
      const fixture = fixtureWithCommit(st);
      if (!fixture) return;
      const { repo, remote, commitOid: ancestor } = fixture;
      const destination = "refs/heads/review";
      const existsInitially = ["deleted", "unchanged"].includes(change);
      const initialRef = existsInitially ? destination : "refs/heads/seed";
      git(["push", "origin", `${ancestor}:${initialRef}`], repo);
      writeRepositoryFile(repo, "next.txt", "approved next commit\n");
      git(["add", "next.txt"], repo);
      git(["commit", "-S", "--quiet", "-m", "fix: Publish next commit"], repo);
      const commitOid = git(["rev-parse", "HEAD"], repo).stdout.trim();
      const prepared = await prepareMemoryPublication({
        commitOid,
        cwd: repo,
        remote: "origin",
        destination,
      });
      assert.equal(
        prepared.binding.destinationOid,
        existsInitially ? ancestor : null,
      );
      const result = await publishMemoryProposal({
        publicationProposal: prepared.publicationProposal,
        cwd: repo,
        processLauncher(command, args, options) {
          if (change === "deleted") {
            git(["update-ref", "-d", destination, ancestor], remote);
          } else if (change === "created") {
            git(["update-ref", destination, ancestor], remote);
          } else if (change === "already-matching") {
            git(["push", "origin", `${commitOid}:${destination}`], repo);
          }
          return spawn(command, args, options);
        },
      });
      const live = git(["rev-parse", "--verify", destination], remote, {
        allowFailure: true,
      });
      if (change === "unchanged") {
        assert.equal(live.stdout.trim(), commitOid);
        assert.equal(result.status, "succeeded");
        assert.equal(result.witnessedOutcome, "witnessed-success");
      } else if (change === "already-matching") {
        assert.equal(live.stdout.trim(), commitOid);
        assert.equal(result.status, "observed-matching");
        assert.equal(result.witnessedOutcome, null);
      } else {
        assert.equal(live.stdout.trim(), change === "created" ? ancestor : "");
        assert.equal(result.status, "rejected");
        assert.equal(result.witnessedOutcome, "known-rejection");
      }
      assert.equal(result.recovery.automatic, false);
    });
  }
});

test("memory publisher binds all outgoing ancestry and never adds current HEAD or auto-followed tags", (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  const oid = fixture.commitOid;
  writeRepositoryFile(fixture.repo, "later.txt", "later unrelated work\n");
  git(["add", "later.txt"], fixture.repo);
  git(
    ["commit", "-S", "--quiet", "-m", "fix: Preserve later local work"],
    fixture.repo,
  );
  git(["tag", "-a", "private-tag", oid, "-m", "Private tag"], fixture.repo);
  git(["config", "push.followTags", "true"], fixture.repo);
  git(["config", "remote.origin.mirror", "true"], fixture.repo);
  const before = snapshot(fixture.repo);
  const prepared = plan(fixture);
  const result = command(fixture, prepared.publish.arguments.slice(2));
  assert.equal(result.commitOid, oid);
  assert.equal(
    git(["rev-parse", "refs/heads/review"], fixture.remote).stdout.trim(),
    oid,
  );
  assert.equal(
    git(["show-ref", "--tags"], fixture.remote, { allowFailure: true }).status,
    1,
  );
  // Native Git may update matching remote-tracking refs and their reflogs even
  // when the endpoint is passed as a URL. All other local state stays exact.
  const withoutTracking = (entries) =>
    entries.filter(
      (entry) =>
        !entry.startsWith(".git/refs/remotes/") &&
        !entry.startsWith(".git/logs/refs/remotes/"),
    );
  assert.deepEqual(
    withoutTracking(snapshot(fixture.repo)),
    withoutTracking(before),
  );
});

test("unknown publication produces only observation recovery and consumes the in-process proposal", async (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  const prepared = plan(fixture);
  let launches = 0;
  const result = await publishMemoryProposal({
    publicationProposal: prepared.publicationProposal,
    cwd: fixture.repo,
    processLauncher() {
      launches++;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, "SIGTERM");
      });
      return child;
    },
  });
  assert.equal(result.exitCode, 4);
  assert.equal(result.status, "unknown");
  assert.equal(result.recovery.automatic, false);
  assert.equal(
    result.recovery.commands[0].arguments[2],
    "--observe-publication",
  );
  await assert.rejects(
    publishMemoryProposal({
      publicationProposal: prepared.publicationProposal,
      cwd: fixture.repo,
      processLauncher() {
        launches++;
      },
    }),
    { code: "PUBLICATION_PROPOSAL_CONSUMED" },
  );
  assert.equal(launches, 1);
  const absent = command(
    fixture,
    result.recovery.commands[0].arguments.slice(2),
    4,
  );
  assert.equal(absent.status, "unknown");
  assert.equal(absent.witnessedOutcome, null);
  git(
    ["push", "origin", `${fixture.commitOid}:refs/heads/review`],
    fixture.repo,
  );
  const matching = command(
    fixture,
    result.recovery.commands[0].arguments.slice(2),
  );
  assert.equal(matching.status, "observed-matching");
  assert.equal(matching.witnessedOutcome, null);
});

test("a forged recovery token can only observe, never report witnessed success or retry permission", async (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  const prepared = plan(fixture);
  git(
    ["push", "origin", `${fixture.commitOid}:refs/heads/review`],
    fixture.repo,
  );
  const result = await observeMemoryPublication({
    publicationProposal: prepared.publicationProposal,
    cwd: fixture.repo,
  });
  assert.equal(result.status, "observed-matching");
  assert.equal(result.witnessedOutcome, null);
  assert.equal(result.historicalAssurance, "not-attested");
  assert.equal(result.retryPermitted, undefined);
  assert.equal(result.publicationProposal, undefined);
});

test("native remote hook rejection is known, preserves commit and has no automatic retry", (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  writeFileSync(
    join(fixture.remote, "hooks", "pre-receive"),
    "#!/bin/sh\necho rejected-by-test >&2\nexit 1\n",
    { mode: 0o755 },
  );
  const prepared = plan(fixture);
  const result = command(fixture, prepared.publish.arguments.slice(2), 1);
  assert.equal(result.status, "rejected");
  assert.equal(result.witnessedOutcome, "known-rejection");
  assert.equal(result.recovery.automatic, false);
  assert.equal(
    git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
    fixture.commitOid,
  );
  assert.equal(
    git(["rev-parse", "--verify", "refs/heads/review"], fixture.remote, {
      allowFailure: true,
    }).status,
    128,
  );
});

test("unsigned commits, missing trust, multiple push endpoints and non-fast-forward destinations block preparation", async (t) => {
  for (const change of ["unsigned", "trust", "multiple", "diverged"]) {
    await t.test(change, (st) => {
      const fixture = fixtureWithCommit(st);
      if (!fixture) return;
      if (change === "unsigned") {
        writeRepositoryFile(fixture.repo, "unsigned.txt", "unsigned\n");
        git(["add", "unsigned.txt"], fixture.repo);
        git(
          [
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "fix: Unsigned commit",
          ],
          fixture.repo,
        );
        fixture.commitOid = git(
          ["rev-parse", "HEAD"],
          fixture.repo,
        ).stdout.trim();
      }
      if (change === "trust")
        git(
          [
            "config",
            "gpg.ssh.allowedSignersFile",
            join(fixture.scratch, "missing"),
          ],
          fixture.repo,
        );
      if (change === "multiple") {
        git(
          ["config", "--add", "remote.origin.pushurl", fixture.remote],
          fixture.repo,
        );
        git(
          [
            "config",
            "--add",
            "remote.origin.pushurl",
            join(fixture.base, "other.git"),
          ],
          fixture.repo,
        );
      }
      if (change === "diverged") {
        writeRepositoryFile(fixture.repo, "newer.txt", "newer\n");
        git(["add", "newer.txt"], fixture.repo);
        git(
          ["commit", "-S", "--quiet", "-m", "fix: Newer remote content"],
          fixture.repo,
        );
        git(["push", "origin", "HEAD:refs/heads/review"], fixture.repo);
      }
      const child = runCommitWorkflow(
        "workflow publish",
        [
          "--commit-oid",
          fixture.commitOid,
          "--remote",
          "origin",
          "--destination",
          "refs/heads/review",
        ],
        fixture.repo,
      );
      assert.notEqual(child.status, 0, child.stdout);
      assert.equal(
        JSON.parse(child.stdout).code,
        {
          unsigned: "PUBLICATION_BLOCKED",
          trust: "SIGNATURE_TRUST_ACCESS_REQUIRED",
          multiple: "PUBLICATION_ENDPOINT_AMBIGUOUS",
          diverged: "PUBLICATION_ANCESTRY_UNRESOLVED",
        }[change],
      );
      assert.equal(git(["rev-parse", "HEAD"], fixture.repo).status, 0);
    });
  }
});

test("effective push endpoint, rather than fetch URL, owns memory observation and push", (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  const pushRemote = join(fixture.base, "push.git");
  git(["init", "--bare", "--quiet", pushRemote], fixture.repo);
  git(["remote", "set-url", "--push", "origin", pushRemote], fixture.repo);
  const prepared = plan(fixture);
  command(fixture, prepared.publish.arguments.slice(2));
  assert.equal(
    git(["rev-parse", "refs/heads/review"], pushRemote).stdout.trim(),
    fixture.commitOid,
  );
  assert.equal(
    git(["show-ref"], fixture.remote, { allowFailure: true }).status,
    1,
  );
});

test("a matching live destination is observation success and never launches a push", async (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  git(
    ["push", "origin", `${fixture.commitOid}:refs/heads/review`],
    fixture.repo,
  );
  const prepared = plan(fixture);
  assert.deepEqual(prepared.outgoingCommitOids, []);
  const result = await publishMemoryProposal({
    publicationProposal: prepared.publicationProposal,
    cwd: fixture.repo,
    processLauncher() {
      assert.fail("Matching destination launched push");
    },
  });
  assert.equal(result.status, "observed-matching");
  assert.equal(result.witnessedOutcome, null);
});

test("the complete outgoing list includes every unpublished ancestor and leaves unrelated staging alone", (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  const first = fixture.commitOid;
  for (const name of ["second", "third"]) {
    writeRepositoryFile(fixture.repo, `${name}.txt`, `${name}\n`);
    git(["add", `${name}.txt`], fixture.repo);
    git(
      ["commit", "-S", "--quiet", "-m", `fix: Add ${name} content`],
      fixture.repo,
    );
  }
  fixture.commitOid = git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  writeRepositoryFile(
    fixture.repo,
    "private.txt",
    "unrelated staged content\n",
  );
  git(["add", "private.txt"], fixture.repo);
  const before = snapshot(fixture.repo);
  const prepared = plan(fixture);
  assert.equal(prepared.outgoingCommitOids.length, 3);
  assert.equal(prepared.outgoingCommitOids.at(-1), first);
  assert.equal(prepared.binding.outgoingCount, 3);
  assert.deepEqual(snapshot(fixture.repo), before);
  command(fixture, prepared.publish.arguments.slice(2));
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout.trim(),
    "private.txt",
  );
  assert.equal(
    git(["ls-tree", fixture.commitOid, "private.txt"], fixture.repo).stdout,
    "",
  );
});

test("sensitive endpoints and shallow/grafted ancestry never become publication bindings", async (t) => {
  for (const change of ["credentials", "shallow", "grafts"]) {
    await t.test(change, async (st) => {
      const fixture = fixtureWithCommit(st);
      if (!fixture) return;
      if (change === "credentials")
        git(
          [
            "remote",
            "set-url",
            "--push",
            "origin",
            "https://secret-token@example.invalid/project.git",
          ],
          fixture.repo,
        );
      if (change === "shallow")
        writeFileSync(
          join(fixture.repo, ".git", "shallow"),
          `${fixture.commitOid}\n`,
        );
      if (change === "grafts")
        writeFileSync(
          join(fixture.repo, ".git", "info", "grafts"),
          `${fixture.commitOid}\n`,
        );
      await assert.rejects(
        prepareMemoryPublication({
          commitOid: fixture.commitOid,
          remote: "origin",
          destination: "refs/heads/review",
          cwd: fixture.repo,
          remoteObserver() {
            assert.fail("Rejected preparation contacted the endpoint");
          },
        }),
        {
          code:
            change === "credentials"
              ? "PUBLICATION_ENDPOINT_SENSITIVE"
              : "PUBLICATION_HISTORY_INCOMPLETE",
        },
      );
    });
  }
});

test("truncated rejection, asynchronous launch failure and process signals remain unknown without retries", async (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  for (const kind of ["truncated", "launch-error", "signal"]) {
    const prepared = plan(fixture);
    let launches = 0;
    const result = await publishMemoryProposal({
      publicationProposal: prepared.publicationProposal,
      cwd: fixture.repo,
      processLauncher() {
        launches++;
        const child = new EventEmitter();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        queueMicrotask(() => {
          if (kind === "truncated")
            child.stdout.write("!\t" + "x".repeat(70 * 1024));
          if (kind === "launch-error")
            child.emit(
              "error",
              Object.assign(new Error("unavailable"), { code: "ENOENT" }),
            );
          child.stdout.end();
          child.stderr.end();
          child.emit(
            "close",
            kind === "truncated" ? 1 : null,
            kind === "signal" ? "SIGTERM" : null,
          );
        });
        return child;
      },
    });
    assert.equal(result.exitCode, 4, kind);
    assert.equal(result.witnessedOutcome, "unknown", kind);
    assert.equal(launches, 1);
  }
});

test("large outgoing ancestry remains memory-only with a complete count, digest and inspection command", (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  const records = [];
  for (let index = 1; index <= 300; index++) {
    records.push(
      `commit refs/heads/archive\nmark :${index}\ncommitter Tests <tests@example.invalid> ${1700000000 + index} +0000\ndata 8\nhistory\n${index === 1 ? "" : `from :${index - 1}\n`}\n`,
    );
  }
  git(["fast-import", "--quiet"], fixture.repo, { input: records.join("") });
  const parent = git(
    ["rev-parse", "refs/heads/archive"],
    fixture.repo,
  ).stdout.trim();
  const tree = fixture.committed.commit.treeOid;
  fixture.commitOid = git(
    [
      "commit-tree",
      "-S",
      tree,
      "-p",
      parent,
      "-m",
      "fix: Preserve complete ancestry",
    ],
    fixture.repo,
  ).stdout.trim();
  const before = snapshot(fixture.base);
  const prepared = plan(fixture);
  assert.equal(prepared.outgoingCommitOids, null);
  assert.equal(prepared.binding.outgoingCount, 301);
  const inspection = prepared.outgoingInspection;
  assert.equal(inspection.arguments[0], "git");
  const full = git(inspection.arguments.slice(1), fixture.repo, {
    env: { ...process.env, ...inspection.environment },
  }).stdout;
  assert.equal(full.trim().split("\n").length, 301);
  assert.equal(
    createHash("sha256").update(full).digest("hex"),
    prepared.binding.outgoingSha256,
  );
  assert.deepEqual(snapshot(fixture.base), before);
  const published = command(fixture, prepared.publish.arguments.slice(2));
  assert.equal(published.witnessedOutcome, "witnessed-success");
  assert.equal(
    git(["rev-parse", "refs/heads/review"], fixture.remote).stdout.trim(),
    fixture.commitOid,
  );
});

test("recovery preserves ambiguity after configuration loss and does not trust a token's local-commit claim", async (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  const prepared = plan(fixture);
  const forged = JSON.parse(
    Buffer.from(
      prepared.publicationProposal.slice("ctgp1.".length),
      "base64url",
    ).toString("utf8"),
  );
  forged.commitOid = "0".repeat(40);
  const token =
    "ctgp1." + Buffer.from(JSON.stringify(forged)).toString("base64url");
  const missingCommit = await observeMemoryPublication({
    publicationProposal: token,
    cwd: fixture.repo,
  });
  assert.equal(missingCommit.status, "unknown");
  assert.equal(missingCommit.commitState, "unknown");
  assert.equal(missingCommit.witnessedOutcome, null);
  git(["remote", "remove", "origin"], fixture.repo);
  const missingRemote = await observeMemoryPublication({
    publicationProposal: prepared.publicationProposal,
    cwd: fixture.repo,
    remoteObserver() {
      assert.fail("Unbound endpoint was queried");
    },
  });
  assert.equal(missingRemote.exitCode, 4);
  assert.equal(missingRemote.status, "unknown");
  assert.equal(missingRemote.observation.reason, "local-binding-unavailable");
  assert.equal(missingRemote.publicationProposal, undefined);
});

test("effective URL rewrites are applied once through the authorized configured remote", async (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  const other = join(fixture.base, "other.git");
  git(["init", "--bare", "--quiet", other], fixture.repo);
  git(
    ["config", `url.${fixture.remote}.insteadOf`, "c2g-fixture:project"],
    fixture.repo,
  );
  git(["config", `url.${other}.insteadOf`, fixture.remote], fixture.repo);
  git(["remote", "set-url", "origin", "c2g-fixture:project"], fixture.repo);
  assert.equal(
    git(["remote", "get-url", "--push", "origin"], fixture.repo).stdout.trim(),
    fixture.remote,
  );
  const prepared = await prepareMemoryPublication({
    commitOid: fixture.commitOid,
    remote: "origin",
    destination: "refs/heads/review",
    cwd: fixture.repo,
  });
  await publishMemoryProposal({
    publicationProposal: prepared.publicationProposal,
    cwd: fixture.repo,
  });
  assert.equal(
    git(["rev-parse", "--verify", "refs/heads/review"], fixture.remote, {
      allowFailure: true,
    }).status,
    0,
  );
  assert.equal(git(["show-ref"], other, { allowFailure: true }).status, 1);
});

test("pushInsteadOf observation reaches the push endpoint while named transport retains native rewrite semantics", async (t) => {
  const fixture = fixtureWithCommit(t);
  if (!fixture) return;
  const raw = "c2g-push-fixture:project";
  git(["config", `url.${fixture.remote}.pushInsteadOf`, raw], fixture.repo);
  git(["remote", "set-url", "origin", raw], fixture.repo);
  const prepared = await prepareMemoryPublication({
    commitOid: fixture.commitOid,
    remote: "origin",
    destination: "refs/heads/review",
    cwd: fixture.repo,
  });
  assert.equal(prepared.binding.observationUrl, fixture.remote);
  await publishMemoryProposal({
    publicationProposal: prepared.publicationProposal,
    cwd: fixture.repo,
  });
  assert.equal(
    git(["rev-parse", "refs/heads/review"], fixture.remote).stdout.trim(),
    fixture.commitOid,
  );
});
