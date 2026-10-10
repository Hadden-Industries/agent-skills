/** Authenticate prior conformance evidence; unavailable proof requires fresh CI.
 * Receipts are inert metadata, never executable payloads. GitHub's current run,
 * attempt, job and Git-object observations remain authoritative over the receipt.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const WORKFLOW = ".github/workflows/evaluation-conformance.yml";
const POLICY = "scripts/ci/conformanceReuse.js";
const LANES = ["conformance (windows-2025)", "conformance (ubuntu-24.04)"];
const NATIVE_STEPS = [
  "Check out the candidate",
  "Set up the assessed Node runtime",
  "Select the assessed npm toolchain",
  "Set up the assessed Python runtime",
  "Acquire locked dependencies and pinned native consumer",
  "Verify generated distribution and deterministic consumer contracts",
  "Report conformance and acquisition diagnostics",
];
const MAX_RECEIPT_BYTES = 16 * 1024;
const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const fact = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};
const sameRepository = (repository, context) =>
  repository?.id === context.repositoryId &&
  repository.full_name === context.repository;
const receiptName = (run) => `conformance-proof-${run.id}-${run.run_attempt}`;

function validSnapshot(snapshot) {
  return (
    snapshot &&
    ["commit", "tree", "workflow", "policy"].every((key) =>
      SHA.test(snapshot[key] ?? ""),
    ) &&
    Array.isArray(snapshot.parents) &&
    snapshot.parents.length === 2 &&
    snapshot.parents.every((parent) => SHA.test(parent))
  );
}

function ordinaryMerge(context) {
  const { event, snapshot } = context;
  return (
    context.eventName === "push" &&
    context.ref === "refs/heads/main" &&
    event.ref === context.ref &&
    event.after === context.sha &&
    event.forced === false &&
    event.deleted === false &&
    event.created === false &&
    sameRepository(event.repository, context) &&
    event.repository.default_branch === "main" &&
    validSnapshot(snapshot) &&
    snapshot.commit === context.sha &&
    snapshot.parents[0] === event.before
  );
}

function completeList(result, key) {
  fact(
    Array.isArray(result?.[key]) &&
      result[key].length <= 100 &&
      result.total_count === result[key].length,
    "Incomplete GitHub evidence inventory",
  );
  return result[key];
}

function successfulRun(run, context, head, now) {
  fact(
    positiveId(run?.id) &&
      positiveId(run.run_attempt) &&
      run.event === "pull_request" &&
      run.path === WORKFLOW &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.head_sha === head &&
      sameRepository(run.repository, context) &&
      sameRepository(run.head_repository, context) &&
      Date.parse(run.created_at) <= Date.parse(run.updated_at) &&
      Date.parse(run.updated_at) <= now,
    "PR workflow is not an exact completed success",
  );
}

function validArtifact(artifact, run, context, now) {
  fact(
    positiveId(artifact?.id) &&
      artifact.name === receiptName(run) &&
      artifact.expired === false &&
      Date.parse(artifact.expires_at) > now &&
      Number.isSafeInteger(artifact.size_in_bytes) &&
      artifact.size_in_bytes > 0 &&
      artifact.size_in_bytes <= MAX_RECEIPT_BYTES &&
      DIGEST.test(artifact.digest ?? "") &&
      artifact.workflow_run?.id === run.id &&
      artifact.workflow_run.repository_id === context.repositoryId &&
      artifact.workflow_run.head_repository_id === context.repositoryId &&
      artifact.workflow_run.head_sha === run.head_sha,
    "Receipt artifact identity is invalid",
  );
}

/** Select only the latest run of the unique same-repository, exact-base merged PR.
 * Throws on ambiguity, lookup limits or unavailable proof; the CLI falls back.
 */
export async function selectProof({ context, read, now = Date.now() }) {
  fact(
    ordinaryMerge(context),
    "Fresh testing required for this event or merge shape",
  );
  const prs = await read(`/commits/${context.sha}/pulls?per_page=100`);
  fact(
    Array.isArray(prs) && prs.length < 100,
    "Incomplete merged PR inventory",
  );
  const matches = prs.filter(
    (pr) =>
      positiveId(pr.number) &&
      pr.state === "closed" &&
      Date.parse(pr.merged_at) <= now &&
      pr.base?.ref === "main" &&
      pr.base.sha === context.snapshot.parents[0] &&
      pr.head?.sha === context.snapshot.parents[1] &&
      sameRepository(pr.base.repo, context) &&
      sameRepository(pr.head.repo, context),
  );
  fact(matches.length === 1, "No unique same-repository merged PR");
  const pr = matches[0];
  const runs = completeList(
    await read(
      `/actions/workflows/evaluation-conformance.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`,
    ),
    "workflow_runs",
  ).sort((left, right) => right.id - left.id);
  // Do not look past a newer failed, pending or cancelled run for an old success.
  const run = runs[0];
  successfulRun(run, context, pr.head.sha, now);
  const artifacts = completeList(
    await read(`/actions/runs/${run.id}/artifacts?per_page=100`),
    "artifacts",
  ).filter((artifact) => artifact.name === receiptName(run));
  fact(artifacts.length === 1, "No unique receipt for the latest attempt");
  const artifact = artifacts[0];
  validArtifact(artifact, run, context, now);
  return { pullRequest: pr.number, run, artifact };
}

/** Record a successful full same-repository PR merge, never a reused result. */
export function createReceipt(context, needs, now = Date.now()) {
  const pr = context.event.pull_request;
  fact(
    context.eventName === "pull_request" &&
      pr?.base?.ref === "main" &&
      positiveId(context.event.number) &&
      context.ref === `refs/pull/${context.event.number}/merge` &&
      sameRepository(pr.base.repo, context) &&
      sameRepository(pr.head?.repo, context) &&
      positiveId(context.runId) &&
      positiveId(context.runAttempt) &&
      validSnapshot(context.snapshot) &&
      context.snapshot.commit === context.sha &&
      isDeepStrictEqual(context.snapshot.parents, [pr.base.sha, pr.head.sha]) &&
      needs.verification?.result === "success" &&
      needs.verification.outputs?.reuse === "false" &&
      needs.conformance?.result === "success",
    "Receipt requires full successful same-repository PR conformance",
  );
  return {
    schemaVersion: 1,
    mode: "FRESH",
    repository: context.repository,
    repositoryId: context.repositoryId,
    runId: context.runId,
    runAttempt: context.runAttempt,
    pullRequest: context.event.number,
    snapshot: context.snapshot,
    lanes: LANES,
    recordedAt: new Date(now).toISOString(),
  };
}

/** Reobserve metadata after download, then bind receipt and both jobs to the merge.
 * A failed/restarted source run or an altered download selection forces fresh CI.
 */
export async function verifyProof({
  context,
  selection,
  receipt,
  read,
  authenticate,
  now = Date.now(),
}) {
  const current = await selectProof({ context, read, now });
  fact(
    isDeepStrictEqual(current, selection),
    "Selected proof changed during transport",
  );
  fact(
    receipt?.schemaVersion === 1 &&
      receipt.mode === "FRESH" &&
      receipt.repository === context.repository &&
      receipt.repositoryId === context.repositoryId &&
      receipt.runId === current.run.id &&
      receipt.runAttempt === current.run.run_attempt &&
      receipt.pullRequest === current.pullRequest &&
      isDeepStrictEqual(receipt.lanes, LANES) &&
      Date.parse(receipt.recordedAt) >= Date.parse(current.run.created_at) &&
      Date.parse(receipt.recordedAt) <= Date.parse(current.run.updated_at) &&
      now - Date.parse(receipt.recordedAt) <= 7 * 24 * 60 * 60 * 1000 &&
      validSnapshot(receipt.snapshot) &&
      receipt.snapshot.tree === context.snapshot.tree &&
      receipt.snapshot.workflow === context.snapshot.workflow &&
      receipt.snapshot.policy === context.snapshot.policy &&
      isDeepStrictEqual(receipt.snapshot.parents, context.snapshot.parents),
    "Receipt does not qualify this merge",
  );
  fact(
    typeof authenticate === "function" &&
      (await authenticate({ context, run: current.run, receipt })) === true,
    "Producing merge and workflow identity is unauthenticated",
  );
  // PR synthetic merge and landed merge can have different commit IDs. The
  // actual GitHub Git object must establish equal tree AND ordered parents.
  const tested = await read(`/git/commits/${receipt.snapshot.commit}`);
  fact(
    tested.sha === receipt.snapshot.commit &&
      tested.tree?.sha === context.snapshot.tree &&
      isDeepStrictEqual(
        tested.parents?.map((parent) => parent.sha),
        context.snapshot.parents,
      ),
    "Tested Git object does not match the landed merge",
  );
  const jobs = completeList(
    await read(
      `/actions/runs/${current.run.id}/attempts/${current.run.run_attempt}/jobs?per_page=100`,
    ),
    "jobs",
  );
  for (const lane of LANES) {
    const matching = jobs.filter((job) => job.name === lane);
    fact(matching.length === 1, "Expected exactly one job per platform");
    const job = matching[0];
    fact(
      job.run_id === current.run.id &&
        job.run_attempt === current.run.run_attempt &&
        job.status === "completed" &&
        job.conclusion === "success",
      "Platform job did not pass",
    );
    for (const name of NATIVE_STEPS) {
      const steps = job.steps?.filter((step) => step.name === name);
      fact(
        steps?.length === 1 &&
          steps[0].status === "completed" &&
          steps[0].conclusion === "success",
        "Required conformance step did not pass",
      );
    }
  }
  return {
    sourceRunId: current.run.id,
    sourceRunAttempt: current.run.run_attempt,
    sourceCommit: receipt.snapshot.commit,
    receiptId: current.artifact.id,
    receiptDigest: current.artifact.digest,
    snapshot: context.snapshot,
  };
}

/** Delegate signatures/trust roots to gh; only certificate claims bind identity.
 * Predicate metadata is workflow-controlled and is never used as identity.
 */
export function verifyReceiptProvenance({
  context,
  run,
  receipt,
  path,
  execute = spawnSync,
  deadline = Date.now() + 15000,
}) {
  const ref = `refs/pull/${receipt.pullRequest}/merge`;
  const repositoryUrl = `https://github.com/${context.repository}`;
  const signer = `${repositoryUrl}/${WORKFLOW}@${ref}`;
  const remaining = Math.min(15000, deadline - Date.now());
  fact(remaining > 0, "Provenance lookup budget exceeded");
  const result = execute(
    "gh",
    [
      "attestation",
      "verify",
      path,
      "--repo",
      context.repository,
      "--signer-digest",
      receipt.snapshot.commit,
      "--source-digest",
      receipt.snapshot.commit,
      "--source-ref",
      ref,
      "--cert-identity",
      signer,
      "--cert-oidc-issuer",
      "https://token.actions.githubusercontent.com",
      "--deny-self-hosted-runners",
      "--limit",
      "2",
      "--format",
      "json",
    ],
    {
      encoding: "utf8",
      timeout: remaining,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  fact(result.status === 0, "Receipt signature verification failed");
  const verified = JSON.parse(result.stdout);
  fact(
    Array.isArray(verified) && verified.length > 0 && verified.length <= 2,
    "Invalid receipt provenance inventory",
  );
  return verified.some(({ verificationResult }) => {
    const certificate = verificationResult?.signature?.certificate;
    return (
      certificate?.issuer === "https://token.actions.githubusercontent.com" &&
      certificate.subjectAlternativeName === signer &&
      certificate.buildSignerDigest === receipt.snapshot.commit &&
      certificate.buildSignerURI === signer &&
      certificate.buildConfigDigest === receipt.snapshot.commit &&
      certificate.buildConfigURI === signer &&
      certificate.sourceRepositoryDigest === receipt.snapshot.commit &&
      certificate.sourceRepositoryURI === repositoryUrl &&
      certificate.sourceRepositoryIdentifier === String(context.repositoryId) &&
      certificate.sourceRepositoryRef === ref &&
      certificate.buildTrigger === "pull_request" &&
      certificate.runInvocationURI ===
        `${repositoryUrl}/actions/runs/${run.id}/attempts/${run.run_attempt}`
    );
  });
}

/** Reject masked failures or skipped tests; reused qualification requires proof. */
export function requireQualification(context, needs) {
  if (needs.conformance?.result === "success") {
    return { mode: "FRESH" };
  }
  fact(
    needs.verification?.result === "success",
    "Verification strategy did not finish",
  );
  const outputs = needs.verification.outputs;
  if (outputs?.reuse === "true") {
    const proof = JSON.parse(outputs.proof);
    fact(
      ordinaryMerge(context) &&
        needs.conformance?.result === "skipped" &&
        isDeepStrictEqual(proof.snapshot, context.snapshot) &&
        positiveId(proof.sourceRunId) &&
        positiveId(proof.sourceRunAttempt) &&
        SHA.test(proof.sourceCommit ?? "") &&
        positiveId(proof.receiptId) &&
        DIGEST.test(proof.receiptDigest ?? ""),
      "Invalid reused qualification",
    );
    return { mode: "REUSED", ...proof };
  }
  throw new Error("Fresh conformance did not pass both platforms");
}

/** Bound Git observations and read raw parents even from a shallow checkout. */
export function readSnapshot(directory = process.cwd()) {
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    fact(result.status === 0, "Could not establish tested Git inputs");
    return result.stdout.trim();
  };
  return {
    commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    parents: git("cat-file", "-p", "HEAD")
      .split("\n\n", 1)[0]
      .split("\n")
      .filter((line) => /^parent [a-f0-9]{40}$/u.test(line))
      .map((line) => line.slice(7)),
    workflow: git("rev-parse", `HEAD:${WORKFLOW}`),
    policy: git("rev-parse", `HEAD:${POLICY}`),
  };
}

/** Read only bounded GitHub JSON; never follow response URLs or expose tokens. */
export function createGithubReader(
  repository,
  token,
  fetchImpl = fetch,
  deadline = Date.now() + 45000,
) {
  fact(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? "") && token,
    "Read-only GitHub access is unavailable",
  );
  let requests = 0;
  return async (path) => {
    fact(
      /^\/(?:commits|actions|git)\/[A-Za-z0-9_./?=&%-]+$/u.test(path) &&
        !path.includes("..") &&
        ++requests <= 16 &&
        Date.now() < deadline,
      "GitHub lookup budget or path rejected",
    );
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}${path}`,
      {
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(5000, deadline - Date.now())),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2026-03-10",
        },
      },
    );
    fact(response.ok && response.body, "GitHub evidence read failed");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      fact(
        bytes <= 1024 * 1024 && Date.now() < deadline,
        "GitHub response limit exceeded",
      );
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
}

function readJson(path, limit = 256 * 1024) {
  const stat = lstatSync(path);
  fact(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.nlink === 1 &&
      stat.size <= limit,
    "Invalid evidence file type or size",
  );
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Accept only the official action's one-artifact layouts and an inert JSON file. */
function receiptPath(root, name) {
  fact(
    /^conformance-proof-[1-9][0-9]*-[1-9][0-9]*$/u.test(name),
    "Invalid artifact name",
  );
  let directory = resolve(root);
  for (const leaf of [null, name]) {
    const stat = lstatSync(directory);
    fact(
      stat.isDirectory() && !stat.isSymbolicLink(),
      "Invalid receipt directory",
    );
    const entries = readdirSync(directory);
    if (entries.length === 1 && entries[0] === "receipt.json") {
      return join(directory, "receipt.json");
    }
    fact(
      leaf === null && entries.length === 1 && entries[0] === name,
      "Unexpected receipt inventory",
    );
    directory = join(directory, name);
  }
  throw new Error("Missing receipt");
}

export function readReceipt(root, name) {
  return readJson(receiptPath(root, name), MAX_RECEIPT_BYTES);
}

function contextFromEnvironment(env) {
  return {
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    repository: env.GITHUB_REPOSITORY,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID),
    runId: Number(env.GITHUB_RUN_ID),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    event: readJson(env.GITHUB_EVENT_PATH),
    snapshot: readSnapshot(),
  };
}

function output(env, values) {
  for (const [key, value] of Object.entries(values)) {
    const text =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    fact(!/[\r\n]/u.test(text), "Invalid workflow output");
    appendFileSync(env.GITHUB_OUTPUT, `${key}=${text}\n`);
  }
}

/** Workflow CLI: optimization failures select fresh; aggregate/test failures fail. */
export async function runCommand(
  command,
  env = process.env,
  { fetchImpl = fetch, execute = spawnSync } = {},
) {
  const root =
    env.CONFORMANCE_REUSE_ROOT ||
    (env.RUNNER_TEMP && join(env.RUNNER_TEMP, "conformance-reuse"));
  fact(root, "Missing workflow evidence root");
  mkdirSync(root, { recursive: true });
  if (command === "select" || command === "verify") {
    const deadline = Date.now() + 45000;
    try {
      const context = contextFromEnvironment(env);
      // PRs and manual runs never download or reuse earlier evidence.
      fact(ordinaryMerge(context), "Fresh event");
      const read = createGithubReader(
        context.repository,
        env.GH_TOKEN,
        fetchImpl,
        deadline,
      );
      if (command === "select") {
        const selection = await selectProof({ context, read });
        writeFileSync(join(root, "selection.json"), JSON.stringify(selection));
        output(env, {
          available: true,
          run_id: selection.run.id,
          artifact_id: selection.artifact.id,
        });
      } else {
        fact(
          env.PROOF_DOWNLOAD_OUTCOME === "success",
          "Proof download unavailable",
        );
        const selection = readJson(join(root, "selection.json"));
        const receipt = readReceipt(
          join(root, "download"),
          receiptName(selection.run),
        );
        const proof = await verifyProof({
          context,
          selection,
          receipt,
          read,
          authenticate: (facts) =>
            verifyReceiptProvenance({
              ...facts,
              execute,
              deadline,
              path: receiptPath(
                join(root, "download"),
                receiptName(selection.run),
              ),
            }),
        });
        output(env, { reuse: true, proof });
      }
    } catch {
      // Deliberately omit remote/error text: it can contain untrusted content.
      output(
        env,
        command === "select" ? { available: false } : { reuse: false },
      );
    }
    return;
  }
  const needs = JSON.parse(env.REQUIRED_JOB_RESULTS_JSON);
  if (command === "require") {
    // Completed fresh lanes qualify independently of bounded reuse lookups.
    const context =
      needs.conformance?.result !== "success" &&
      needs.verification?.outputs?.reuse === "true"
        ? contextFromEnvironment(env)
        : null;
    const qualification = requireQualification(context, needs);
    const source =
      qualification.mode === "REUSED"
        ? ` Source: [run ${qualification.sourceRunId}, attempt ${qualification.sourceRunAttempt}](https://github.com/${context.repository}/actions/runs/${qualification.sourceRunId}/attempts/${qualification.sourceRunAttempt}); receipt ${qualification.receiptId}, ${qualification.receiptDigest}.`
        : " Both Windows and Linux conformance lanes passed.";
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      `Conformance qualification: **${qualification.mode}**.${source}\n`,
    );
  } else if (command === "record") {
    try {
      const receipt = createReceipt(contextFromEnvironment(env), needs);
      writeFileSync(join(root, "receipt.json"), JSON.stringify(receipt));
      output(env, { recorded: true });
    } catch {
      output(env, { recorded: false });
    }
  } else {
    throw new Error("Unknown conformance command");
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  runCommand(process.argv[2]).catch(() => {
    console.error("Conformance qualification could not be established.");
    process.exitCode = 1;
  });
}
