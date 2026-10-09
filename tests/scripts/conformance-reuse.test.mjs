import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  selectProof,
  verifyProof,
  createReceipt,
  requireQualification,
  readSnapshot,
  readReceipt,
  createGithubReader,
  verifyReceiptProvenance,
  runCommand,
} from "../../scripts/ci/conformanceReuse.js";

const sha = (digit) => digit.repeat(40);
const now = Date.parse("2026-10-10T10:00:00Z");

// External GitHub metadata is mocked; the merge admission decision remains real.
function proofFixture() {
  const repository = {
    id: 42,
    full_name: "owner/skills",
    default_branch: "main",
  };
  const context = {
    eventName: "push",
    ref: "refs/heads/main",
    sha: sha("a"),
    repository: repository.full_name,
    repositoryId: repository.id,
    runId: 200,
    runAttempt: 1,
    event: {
      repository,
      ref: "refs/heads/main",
      before: sha("b"),
      after: sha("a"),
      forced: false,
      deleted: false,
      created: false,
    },
    snapshot: {
      commit: sha("a"),
      tree: sha("c"),
      parents: [sha("b"), sha("d")],
      workflow: sha("e"),
      policy: sha("f"),
    },
  };
  const pr = {
    number: 7,
    state: "closed",
    merged_at: "2026-10-10T09:00:00Z",
    base: { ref: "main", sha: sha("b"), repo: repository },
    head: { sha: sha("d"), repo: repository },
  };
  const run = {
    id: 100,
    run_attempt: 2,
    event: "pull_request",
    path: ".github/workflows/evaluation-conformance.yml",
    status: "completed",
    conclusion: "success",
    head_sha: sha("d"),
    repository,
    head_repository: repository,
    created_at: "2026-10-10T08:00:00Z",
    updated_at: "2026-10-10T08:30:00Z",
  };
  const artifact = {
    id: 300,
    name: "conformance-proof-100-2",
    expired: false,
    size_in_bytes: 1024,
    digest: `sha256:${"1".repeat(64)}`,
    expires_at: "2026-10-17T08:30:00Z",
    workflow_run: {
      id: 100,
      repository_id: 42,
      head_repository_id: 42,
      head_sha: sha("d"),
    },
  };
  const replies = {
    [`/commits/${sha("a")}/pulls?per_page=100`]: [pr],
    [`/actions/workflows/evaluation-conformance.yml/runs?event=pull_request&head_sha=${sha("d")}&per_page=100`]:
      { total_count: 1, workflow_runs: [run] },
    "/actions/runs/100/artifacts?per_page=100": {
      total_count: 1,
      artifacts: [artifact],
    },
  };
  const read = async (path) => {
    assert.ok(Object.hasOwn(replies, path), `Unexpected GitHub read: ${path}`);
    return structuredClone(replies[path]);
  };
  const receipt = {
    schemaVersion: 1,
    mode: "FRESH",
    repository: "owner/skills",
    repositoryId: 42,
    runId: 100,
    runAttempt: 2,
    pullRequest: 7,
    snapshot: { ...structuredClone(context.snapshot), commit: sha("9") },
    recordedAt: "2026-10-10T08:20:00.000Z",
    lanes: ["conformance (windows-2025)", "conformance (ubuntu-24.04)"],
  };
  const jobs = receipt.lanes.map((name, index) => ({
    id: index + 400,
    name,
    run_id: 100,
    run_attempt: 2,
    status: "completed",
    conclusion: "success",
    steps: [
      "Check out the candidate",
      "Set up the assessed Node runtime",
      "Set up the assessed Python runtime",
      "Acquire locked dependencies and pinned native consumer",
      "Verify generated distribution and deterministic consumer contracts",
      "Report conformance and acquisition diagnostics",
    ].map((stepName) => ({
      name: stepName,
      status: "completed",
      conclusion: "success",
    })),
  }));
  replies[`/git/commits/${sha("9")}`] = {
    sha: sha("9"),
    tree: { sha: sha("c") },
    parents: [{ sha: sha("b") }, { sha: sha("d") }],
  };
  replies["/actions/runs/100/attempts/2/jobs?per_page=100"] = {
    total_count: 2,
    jobs,
  };
  const certificate = {
    issuer: "https://token.actions.githubusercontent.com",
    subjectAlternativeName:
      "https://github.com/owner/skills/.github/workflows/evaluation-conformance.yml@refs/pull/7/merge",
    buildSignerDigest: sha("9"),
    buildSignerURI:
      "https://github.com/owner/skills/.github/workflows/evaluation-conformance.yml@refs/pull/7/merge",
    buildConfigDigest: sha("9"),
    buildConfigURI:
      "https://github.com/owner/skills/.github/workflows/evaluation-conformance.yml@refs/pull/7/merge",
    sourceRepositoryDigest: sha("9"),
    sourceRepositoryURI: "https://github.com/owner/skills",
    sourceRepositoryIdentifier: "42",
    sourceRepositoryRef: "refs/pull/7/merge",
    buildTrigger: "pull_request",
    runInvocationURI:
      "https://github.com/owner/skills/actions/runs/100/attempts/2",
  };
  const attestations = [{ verificationResult: { signature: { certificate } } }];
  const authenticate = (facts) =>
    verifyReceiptProvenance({
      ...facts,
      path: "fixture-receipt.json",
      execute: () => ({ status: 0, stdout: JSON.stringify(attestations) }),
    });
  return {
    context,
    pr,
    run,
    artifact,
    replies,
    read,
    receipt,
    jobs,
    certificate,
    attestations,
    authenticate,
  };
}

test("provenance verification delegates cryptography and enforces exact source flags with bounded execution", () => {
  const f = proofFixture();
  let invocation;
  assert.equal(
    verifyReceiptProvenance({
      ...f,
      path: "receipt.json",
      execute: (...args) => {
        invocation = args;
        return { status: 0, stdout: JSON.stringify(f.attestations) };
      },
    }),
    true,
  );
  const [command, args, options] = invocation;
  assert.equal(command, "gh");
  assert.deepEqual(args.slice(0, 3), ["attestation", "verify", "receipt.json"]);
  for (const [flag, value] of [
    ["--repo", "owner/skills"],
    ["--source-digest", sha("9")],
    ["--signer-digest", sha("9")],
    ["--source-ref", "refs/pull/7/merge"],
    ["--cert-identity", f.certificate.subjectAlternativeName],
    ["--limit", "2"],
  ]) {
    assert.equal(args[args.indexOf(flag) + 1], value);
  }
  assert.ok(args.includes("--deny-self-hosted-runners"));
  assert.ok(!args.includes("--signer-workflow"));
  assert.ok(options.timeout > 0 && options.timeout <= 15000);
  assert.equal(options.maxBuffer, 1024 * 1024);
  for (const result of [
    { status: 1 },
    { status: null },
    { status: 0, stdout: "bad" },
    { status: 0, stdout: "[]" },
  ]) {
    assert.throws(() =>
      verifyReceiptProvenance({
        ...f,
        path: "receipt.json",
        execute: () => result,
      }),
    );
  }
});

test("an ordinary main merge selects the exact successful PR attempt and immutable receipt", async () => {
  const fixture = proofFixture();
  assert.notEqual(fixture.context.sha, fixture.run.head_sha);
  const selected = await selectProof({ ...fixture, now });
  assert.equal(selected.run.id, 100);
  assert.equal(selected.run.run_attempt, 2);
  assert.equal(selected.artifact.id, 300);
  assert.equal(selected.pullRequest, 7);
});

test("different synthetic and landed commit IDs can qualify only with identical Git inputs and passed native steps", async () => {
  const fixture = proofFixture();
  const selection = await selectProof({ ...fixture, now });
  assert.notEqual(fixture.receipt.snapshot.commit, fixture.context.sha);
  const proof = await verifyProof({ ...fixture, selection, now });
  assert.equal(proof.sourceRunId, 100);
  assert.equal(proof.sourceRunAttempt, 2);
  assert.equal(proof.sourceCommit, sha("9"));
  assert.equal(proof.receiptId, 300);
  assert.equal(proof.receiptDigest, `sha256:${"1".repeat(64)}`);
  assert.deepEqual(proof.snapshot, fixture.context.snapshot);
});

const selectionFailures = {
  "manual dispatch": (f) => {
    f.context.eventName = "workflow_dispatch";
  },
  "pull request event": (f) => {
    f.context.eventName = "pull_request";
  },
  "nondefault branch": (f) => {
    f.context.ref = "refs/heads/feature";
  },
  "direct or squash push": (f) => {
    f.context.snapshot.parents.pop();
  },
  "multi-merge push with different before": (f) => {
    f.context.event.before = sha("8");
  },
  "force push": (f) => {
    f.context.event.forced = true;
  },
  "deleted branch": (f) => {
    f.context.event.deleted = true;
  },
  "created branch": (f) => {
    f.context.event.created = true;
  },
  "changed base": (f) => {
    f.pr.base.sha = sha("8");
  },
  "fork PR": (f) => {
    f.pr.head.repo = { id: 43, full_name: "fork/skills" };
  },
  "ambiguous PR": (f) => {
    f.replies[`/commits/${sha("a")}/pulls?per_page=100`].push(
      structuredClone(f.pr),
    );
  },
  "newer failed run": (f) => {
    const result =
      f.replies[
        `/actions/workflows/evaluation-conformance.yml/runs?event=pull_request&head_sha=${sha("d")}&per_page=100`
      ];
    result.workflow_runs.push({ ...f.run, id: 101, conclusion: "failure" });
    result.total_count++;
  },
  "pending run": (f) => {
    f.run.status = "in_progress";
    f.run.conclusion = null;
  },
  "cancelled run": (f) => {
    f.run.conclusion = "cancelled";
  },
  "wrong workflow": (f) => {
    f.run.path = ".github/workflows/other.yml";
  },
  "wrong run head": (f) => {
    f.run.head_sha = sha("8");
  },
  "foreign source repository": (f) => {
    f.run.head_repository = { id: 43, full_name: "fork/skills" };
  },
  "missing receipt from rerun": (f) => {
    f.run.run_attempt++;
  },
  "expired artifact": (f) => {
    f.artifact.expired = true;
  },
  "past expiry": (f) => {
    f.artifact.expires_at = "2026-10-10T09:59:59Z";
  },
  "missing digest": (f) => {
    delete f.artifact.digest;
  },
  "oversized artifact": (f) => {
    f.artifact.size_in_bytes = 16385;
  },
  "different artifact run": (f) => {
    f.artifact.workflow_run.id = 99;
  },
  "different artifact repository": (f) => {
    f.artifact.workflow_run.repository_id = 99;
  },
  "different artifact head": (f) => {
    f.artifact.workflow_run.head_sha = sha("8");
  },
  "duplicate receipt": (f) => {
    const result = f.replies["/actions/runs/100/artifacts?per_page=100"];
    result.artifacts.push({ ...f.artifact, id: 301 });
    result.total_count++;
  },
  "incomplete run inventory": (f) => {
    f.replies[
      `/actions/workflows/evaluation-conformance.yml/runs?event=pull_request&head_sha=${sha("d")}&per_page=100`
    ].total_count++;
  },
  "incomplete artifact inventory": (f) => {
    f.replies["/actions/runs/100/artifacts?per_page=100"].total_count++;
  },
};
for (const [scenario, change] of Object.entries(selectionFailures)) {
  test(`fresh testing is required: ${scenario}`, async () => {
    const fixture = proofFixture();
    change(fixture);
    await assert.rejects(selectProof({ ...fixture, now }));
  });
}

const verificationFailures = {
  "missing authenticated producer": (f) => {
    delete f.authenticate;
  },
  "source tested another merge despite a matching receipt": (f) => {
    f.certificate.sourceRepositoryDigest = sha("8");
  },
  "different producing workflow": (f) => {
    f.certificate.buildSignerDigest = sha("8");
  },
  "different build configuration": (f) => {
    f.certificate.buildConfigDigest = sha("8");
  },
  "different build configuration URI": (f) => {
    f.certificate.buildConfigURI =
      "https://github.com/owner/skills/.github/workflows/other.yml@refs/pull/7/merge";
  },
  "different signer URI": (f) => {
    f.certificate.buildSignerURI =
      "https://github.com/owner/skills/.github/workflows/other.yml@refs/pull/7/merge";
  },
  "different signing workflow path": (f) => {
    f.certificate.subjectAlternativeName =
      "https://github.com/owner/skills/.github/workflows/other.yml@refs/pull/7/merge";
  },
  "different certificate repository": (f) => {
    f.certificate.sourceRepositoryIdentifier = "43";
  },
  "different certificate repository URL": (f) => {
    f.certificate.sourceRepositoryURI = "https://github.com/fork/skills";
  },
  "different certificate PR": (f) => {
    f.certificate.sourceRepositoryRef = "refs/pull/8/merge";
  },
  "different certificate trigger": (f) => {
    f.certificate.buildTrigger = "push";
  },
  "different certificate attempt": (f) => {
    f.certificate.runInvocationURI =
      "https://github.com/owner/skills/actions/runs/100/attempts/1";
  },
  "different certificate issuer": (f) => {
    f.certificate.issuer = "https://untrusted.invalid";
  },
  "predicate claims cannot substitute for certificate identity": (f) => {
    f.attestations[0].verificationResult.statement = {
      predicate: { certificate: f.certificate },
    };
    delete f.attestations[0].verificationResult.signature;
  },
  "changed receipt tree": (f) => {
    f.receipt.snapshot.tree = sha("8");
  },
  "changed workflow": (f) => {
    f.receipt.snapshot.workflow = sha("8");
  },
  "changed verification policy": (f) => {
    f.receipt.snapshot.policy = sha("8");
  },
  "reordered parents": (f) => {
    f.receipt.snapshot.parents.reverse();
  },
  "wrong receipt attempt": (f) => {
    f.receipt.runAttempt = 1;
  },
  "wrong receipt run": (f) => {
    f.receipt.runId = 99;
  },
  "wrong receipt repository": (f) => {
    f.receipt.repositoryId = 99;
  },
  "wrong receipt PR": (f) => {
    f.receipt.pullRequest = 8;
  },
  "reused source receipt": (f) => {
    f.receipt.mode = "REUSED";
  },
  "missing receipt lane": (f) => {
    f.receipt.lanes.pop();
  },
  "receipt before source run": (f) => {
    f.receipt.recordedAt = "2026-10-10T07:00:00Z";
  },
  "receipt after source completion": (f) => {
    f.receipt.recordedAt = "2026-10-10T09:00:00Z";
  },
  "old receipt": (f) => {
    f.run.created_at = "2026-09-30T08:00:00Z";
    f.run.updated_at = "2026-09-30T08:30:00Z";
    f.receipt.recordedAt = "2026-09-30T08:20:00Z";
  },
  "GitHub tree disagrees": (f) => {
    f.replies[`/git/commits/${sha("9")}`].tree.sha = sha("8");
  },
  "GitHub parents disagree": (f) => {
    f.replies[`/git/commits/${sha("9")}`].parents.reverse();
  },
  "failed platform": (f) => {
    f.jobs[0].conclusion = "failure";
  },
  "skipped platform": (f) => {
    f.jobs[0].conclusion = "skipped";
  },
  "wrong job attempt": (f) => {
    f.jobs[0].run_attempt = 1;
  },
  "wrong job run": (f) => {
    f.jobs[0].run_id = 99;
  },
  "skipped native tests": (f) => {
    f.jobs[0].steps[4].conclusion = "skipped";
  },
  "missing acquisition step": (f) => {
    f.jobs[0].steps.splice(3, 1);
  },
  "missing platform": (f) => {
    f.jobs.pop();
    f.replies["/actions/runs/100/attempts/2/jobs?per_page=100"].total_count--;
  },
  "duplicate platform": (f) => {
    f.jobs.push(structuredClone(f.jobs[0]));
    f.replies["/actions/runs/100/attempts/2/jobs?per_page=100"].total_count++;
  },
  "incomplete jobs inventory": (f) => {
    f.replies["/actions/runs/100/attempts/2/jobs?per_page=100"].total_count++;
  },
};
for (const [scenario, change] of Object.entries(verificationFailures)) {
  test(`downloaded proof is rejected: ${scenario}`, async () => {
    const fixture = proofFixture();
    change(fixture);
    const selection = await selectProof({ ...fixture, now });
    await assert.rejects(verifyProof({ ...fixture, selection, now }));
  });
}

test("proof metadata is reobserved after transport, including digest and rerun races", async () => {
  for (const change of [
    (f) => {
      f.artifact.digest = `sha256:${"2".repeat(64)}`;
    },
    (f) => {
      f.run.run_attempt++;
    },
  ]) {
    const fixture = proofFixture();
    const selection = await selectProof({ ...fixture, now });
    change(fixture);
    await assert.rejects(verifyProof({ ...fixture, selection, now }));
  }
});

function prContext(fixture) {
  return {
    ...fixture.context,
    eventName: "pull_request",
    ref: "refs/pull/7/merge",
    sha: sha("9"),
    runId: 100,
    runAttempt: 2,
    snapshot: structuredClone(fixture.receipt.snapshot),
    event: { number: 7, pull_request: structuredClone(fixture.pr) },
  };
}
const freshNeeds = () => ({
  verification: { result: "success", outputs: { reuse: "false" } },
  conformance: { result: "success" },
});

test("only a full passing same-repository PR merge can issue a small fresh receipt", () => {
  const fixture = proofFixture();
  const context = prContext(fixture);
  const receipt = createReceipt(
    context,
    freshNeeds(),
    Date.parse("2026-10-10T08:20:00Z"),
  );
  assert.deepEqual(receipt, fixture.receipt);
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) < 16384);
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    const needs = freshNeeds();
    needs.conformance.result = result;
    assert.throws(() => createReceipt(context, needs, now));
  }
  context.event.pull_request.head.repo.id++;
  assert.throws(() => createReceipt(context, freshNeeds(), now));
  assert.throws(() => createReceipt(fixture.context, freshNeeds(), now));
});

test("aggregate qualification rejects failed, cancelled and skipped tests instead of masking them", async () => {
  const fixture = proofFixture();
  assert.deepEqual(requireQualification(fixture.context, freshNeeds()), {
    mode: "FRESH",
  });
  for (const key of ["conformance"]) {
    for (const result of ["failure", "cancelled", "skipped"]) {
      const needs = freshNeeds();
      needs[key].result = result;
      assert.throws(() => requireQualification(fixture.context, needs));
    }
  }
  const selection = await selectProof({ ...fixture, now });
  const proof = await verifyProof({ ...fixture, selection, now });
  const needs = {
    verification: {
      result: "success",
      outputs: { reuse: "true", proof: JSON.stringify(proof) },
    },
    conformance: { result: "skipped" },
  };
  assert.equal(requireQualification(fixture.context, needs).mode, "REUSED");
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert.throws(() =>
      requireQualification(fixture.context, {
        ...needs,
        verification: { ...needs.verification, result },
      }),
    );
  }
  needs.verification.outputs.proof = "{}";
  assert.throws(() => requireQualification(fixture.context, needs));
});

test("successful fresh lanes qualify even when the optional strategy failed or has no outputs", () => {
  for (const verification of [
    undefined,
    { result: "failure" },
    { result: "cancelled" },
    { result: "skipped" },
    { result: "success", outputs: { reuse: "true", proof: "bad" } },
  ]) {
    assert.deepEqual(
      requireQualification(null, {
        verification,
        conformance: { result: "success" },
      }),
      { mode: "FRESH" },
    );
  }
});

test("provenance subprocess retains a positive timeout at the deadline boundary", (t) => {
  const f = proofFixture();
  let calls = 0;
  t.mock.method(Date, "now", () => (calls++ === 0 ? 99 : 100));
  assert.equal(
    verifyReceiptProvenance({
      ...f,
      path: "receipt.json",
      deadline: 100,
      execute: (_command, _args, options) => {
        assert.equal(options.timeout, 1);
        return { status: 0, stdout: JSON.stringify(f.attestations) };
      },
    }),
    true,
  );
});

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "conformance-reuse-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("receipt transport accepts only one ordinary bounded JSON file in native action layouts", (t) => {
  const root = workspace(t);
  const name = "conformance-proof-100-2";
  const receipt = proofFixture().receipt;
  writeFileSync(join(root, "receipt.json"), JSON.stringify(receipt));
  assert.deepEqual(readReceipt(root, name), receipt);
  rmSync(join(root, "receipt.json"));
  mkdirSync(join(root, name));
  writeFileSync(join(root, name, "receipt.json"), JSON.stringify(receipt));
  assert.deepEqual(readReceipt(root, name), receipt);
  writeFileSync(join(root, name, "unexpected.txt"), "not proof");
  assert.throws(() => readReceipt(root, name));
  rmSync(join(root, name, "unexpected.txt"));
  writeFileSync(join(root, name, "receipt.json"), " ".repeat(16385));
  assert.throws(() => readReceipt(root, name));
  assert.throws(() => readReceipt(root, "../escape"));
});

test("receipt transport rejects symlinked evidence where supported", (t) => {
  const root = workspace(t);
  const real = join(root, "real");
  mkdirSync(real);
  writeFileSync(
    join(real, "receipt.json"),
    JSON.stringify(proofFixture().receipt),
  );
  try {
    symlinkSync(
      real,
      join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      t.skip("Host disallows symlink creation");
      return;
    }
    throw error;
  }
  assert.throws(() =>
    readReceipt(join(root, "linked"), "conformance-proof-100-2"),
  );
});

test("GitHub reader uses a fixed origin, read-only bounded requests and rejects redirects and overflow", async () => {
  const observed = [];
  const reader = createGithubReader(
    "owner/skills",
    "private-token",
    async (url, options) => {
      observed.push({ url, options });
      return new Response(JSON.stringify({ ok: true }));
    },
  );
  assert.deepEqual(await reader("/actions/runs/100"), { ok: true });
  assert.equal(
    observed[0].url,
    "https://api.github.com/repos/owner/skills/actions/runs/100",
  );
  assert.equal(observed[0].options.redirect, "error");
  assert.equal(observed[0].options.method, undefined);
  for (const path of [
    "https://attacker.test/token",
    "/actions/../secrets",
    "/issues/1",
  ]) {
    await assert.rejects(reader(path));
  }
  assert.equal(observed.length, 1);
  const oversized = createGithubReader(
    "owner/skills",
    "token",
    async () => new Response(" ".repeat(1024 * 1024 + 1)),
  );
  await assert.rejects(oversized("/actions/runs/100"));
  const unavailable = createGithubReader(
    "owner/skills",
    "token",
    async () => new Response("denied", { status: 403 }),
  );
  await assert.rejects(unavailable("/actions/runs/100"));
});

test("raw Git snapshot preserves merge parents through a shallow checkout and the CLI qualifies or falls back safely", async (t) => {
  const root = workspace(t);
  const repo = join(root, "repository");
  mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-b", "main");
  const commit = (message) =>
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      message,
    );
  mkdirSync(join(repo, ".github/workflows"), { recursive: true });
  mkdirSync(join(repo, "scripts/ci"), { recursive: true });
  writeFileSync(
    join(repo, ".github/workflows/evaluation-conformance.yml"),
    "fixture\n",
  );
  writeFileSync(join(repo, "scripts/ci/conformanceReuse.js"), "// fixture\n");
  git("add", ".");
  commit("base");
  const base = git("rev-parse", "HEAD");
  // Native commit-tree gives a real ordered two-parent merge without switching branches.
  writeFileSync(join(repo, "head.txt"), "head");
  git("add", ".");
  commit("head");
  const source = git("rev-parse", "HEAD");
  const merged = git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit-tree",
    git("rev-parse", "HEAD^{tree}"),
    "-p",
    base,
    "-p",
    source,
    "-m",
    "merge",
  );
  assert.notEqual(source, merged);
  git("update-ref", "refs/heads/main", merged);
  writeFileSync(join(repo, ".git/shallow"), `${merged}\n`);
  assert.equal(git("rev-list", "--parents", "-1", "HEAD"), merged);
  const snapshot = readSnapshot(repo);
  assert.deepEqual(snapshot.parents, [base, source]);
  assert.equal(snapshot.commit, merged);
  const eventPath = join(root, "event.json");
  writeFileSync(eventPath, JSON.stringify(proofFixture().context.event));
  const output = join(root, "output.txt");
  const summary = join(root, "summary.txt");
  const env = {
    ...process.env,
    RUNNER_TEMP: root,
    CONFORMANCE_REUSE_ROOT: "",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: merged,
    GITHUB_REPOSITORY: "owner/skills",
    GITHUB_REPOSITORY_ID: "42",
    GITHUB_RUN_ID: "200",
    GITHUB_RUN_ATTEMPT: "1",
    GH_TOKEN: "",
    REQUIRED_JOB_RESULTS_JSON: JSON.stringify(freshNeeds()),
  };
  const cli = resolve("scripts/ci/conformanceReuse.js");
  const run = (command) =>
    spawnSync(process.execPath, [cli, command], {
      cwd: repo,
      env,
      encoding: "utf8",
    });
  assert.equal(run("select").status, 0);
  assert.equal(run("verify").status, 0);
  assert.equal(readFileSync(output, "utf8"), "available=false\nreuse=false\n");
  assert.equal(run("require").status, 0);
  assert.match(readFileSync(summary, "utf8"), /\*\*FRESH\*\*/u);
  // Fresh qualification depends on completed jobs, not optimization metadata size.
  writeFileSync(
    eventPath,
    JSON.stringify({ description: "x".repeat(256 * 1024) }),
  );
  assert.equal(run("require").status, 0);
  assert.equal(run("record").status, 0);
  assert.match(readFileSync(output, "utf8"), /recorded=false\n$/u);
  writeFileSync(eventPath, JSON.stringify(proofFixture().context.event));
  env.REQUIRED_JOB_RESULTS_JSON = JSON.stringify({
    ...freshNeeds(),
    conformance: { result: "failure" },
  });
  assert.notEqual(run("require").status, 0);
  env.GITHUB_EVENT_NAME = "push";
  env.GITHUB_SHA = proofFixture().context.sha; // Snapshot mismatch also forces a fresh fallback.
  assert.equal(run("verify").status, 0);
  assert.match(readFileSync(output, "utf8"), /reuse=false\n$/u);

  // Drive the complete command route with real Git/files and mocked provider I/O.
  const f = proofFixture();
  f.context.snapshot = snapshot;
  f.context.sha = merged;
  f.context.event.before = base;
  f.context.event.after = merged;
  f.pr.base.sha = base;
  f.pr.head.sha = source;
  f.run.head_sha = source;
  f.artifact.workflow_run.head_sha = source;
  f.receipt.snapshot = snapshot;
  const timestamp = Date.now();
  f.pr.merged_at = new Date(timestamp - 500).toISOString();
  f.run.created_at = new Date(timestamp - 60000).toISOString();
  f.receipt.recordedAt = new Date(timestamp - 30000).toISOString();
  f.run.updated_at = new Date(timestamp - 1000).toISOString();
  f.artifact.expires_at = new Date(timestamp + 86400000).toISOString();
  for (const key of [
    "buildSignerDigest",
    "buildConfigDigest",
    "sourceRepositoryDigest",
  ])
    f.certificate[key] = merged;
  const replies = {
    [`/commits/${merged}/pulls?per_page=100`]: [f.pr],
    [`/actions/workflows/evaluation-conformance.yml/runs?event=pull_request&head_sha=${source}&per_page=100`]:
      { total_count: 1, workflow_runs: [f.run] },
    "/actions/runs/100/artifacts?per_page=100": {
      total_count: 1,
      artifacts: [f.artifact],
    },
    [`/git/commits/${merged}`]: {
      sha: merged,
      tree: { sha: snapshot.tree },
      parents: snapshot.parents.map((parent) => ({ sha: parent })),
    },
    "/actions/runs/100/attempts/2/jobs?per_page=100": {
      total_count: 2,
      jobs: f.jobs,
    },
  };
  const io = {
    fetchImpl: async (url) => {
      const path = url.replace("https://api.github.com/repos/owner/skills", "");
      assert.ok(Object.hasOwn(replies, path), path);
      return new Response(JSON.stringify(replies[path]));
    },
    execute: (command, args) => {
      assert.equal(command, "gh");
      assert.equal(readFileSync(args[2], "utf8"), JSON.stringify(f.receipt));
      return { status: 0, stdout: JSON.stringify(f.attestations) };
    },
  };
  env.GITHUB_SHA = merged;
  env.GH_TOKEN = "fixture-token";
  env.PROOF_DOWNLOAD_OUTCOME = "success";
  writeFileSync(eventPath, JSON.stringify(f.context.event));
  mkdirSync(join(root, "conformance-reuse/download"), { recursive: true });
  writeFileSync(
    join(root, "conformance-reuse/download/receipt.json"),
    JSON.stringify(f.receipt),
  );
  const previous = process.cwd();
  try {
    process.chdir(repo);
    writeFileSync(output, "");
    await runCommand("select", env, io);
    assert.match(
      readFileSync(output, "utf8"),
      /^available=true\nrun_id=100\nartifact_id=300\n$/u,
    );
    writeFileSync(output, "");
    await runCommand("verify", env, io);
    const lines = readFileSync(output, "utf8").trim().split("\n");
    assert.equal(lines[0], "reuse=true");
    env.REQUIRED_JOB_RESULTS_JSON = JSON.stringify({
      verification: {
        result: "success",
        outputs: { reuse: "true", proof: lines[1].slice(6) },
      },
      conformance: { result: "skipped" },
    });
    await runCommand("require", env, io);
    assert.match(
      readFileSync(summary, "utf8"),
      /\*\*REUSED\*\*.*run 100, attempt 2/u,
    );
    f.certificate.sourceRepositoryDigest = sha("8");
    writeFileSync(output, "");
    await runCommand("verify", env, io);
    assert.equal(readFileSync(output, "utf8"), "reuse=false\n");
  } finally {
    process.chdir(previous);
  }
});
