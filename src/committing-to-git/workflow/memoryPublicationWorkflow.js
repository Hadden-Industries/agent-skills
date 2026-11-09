import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { TextDecoder } from "node:util";

import { createWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import {
  repositoryRoot,
  runGit,
  runReadOnlyGit,
  streamGit,
} from "../git/gitRepository.js";
import { inspectCommitObject } from "../report/commitReport.js";
import {
  applyVerificationPolicy,
  verifyCommitSignature,
} from "../signature/commitSignature.js";
import { inspectSignatureRequirements } from "../signature/signaturePreflight.js";
import {
  assertNoGitStorageOverrides,
  preflightVerificationPolicy,
} from "./prepareWorkflow.js";
import {
  classifyPushCompletion,
  observePublicationDestination,
  validateDestination,
} from "./publishWorkflow.js";

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const PREFIX = "ctgp1.";
const MAXIMUM_TOKEN_BYTES = 4096;
const MAXIMUM_CAPTURE_BYTES = 64 * 1024;
const POLICIES = new Set(["required", "advisory", "skipped"]);
const consumedProposals = new Set();

function fail(code, message, disposition = "unmet-prerequisite") {
  throw new WorkflowDiagnosticError(code, message, {
    disposition,
    state: {
      publicationState:
        disposition === "outcome-unknown" ? "unknown" : "not-requested",
      recoveryRequired: disposition === "outcome-unknown",
    },
  });
}
function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function encode(binding) {
  const token =
    PREFIX + Buffer.from(JSON.stringify(binding)).toString("base64url");
  if (Buffer.byteLength(token) > MAXIMUM_TOKEN_BYTES) {
    fail(
      "PUBLICATION_BINDING_TOO_LARGE",
      "The exact publication binding exceeds its memory transport limit; no push was attempted.",
    );
  }
  return token;
}
function decodePublicationProposal(token) {
  let value;
  try {
    if (
      typeof token !== "string" ||
      Buffer.byteLength(token) > MAXIMUM_TOKEN_BYTES ||
      !token.startsWith(PREFIX) ||
      !/^[A-Za-z0-9_-]+$/u.test(token.slice(PREFIX.length))
    )
      throw new Error();
    value = JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(
        Buffer.from(token.slice(PREFIX.length), "base64url"),
      ),
    );
    const keys = [
      "schema",
      "proposalId",
      "repositoryRoot",
      "commitOid",
      "commit",
      "verificationPolicy",
      "signer",
      "remote",
      "pushUrl",
      "observationUrl",
      "destination",
      "destinationOid",
      "outgoingSha256",
      "outgoingCount",
    ];
    if (
      value === null ||
      typeof value !== "object" ||
      !same(Object.keys(value), keys) ||
      value.schema !== "publication-proposal/v1" ||
      !/^[0-9a-f-]{36}$/u.test(value.proposalId) ||
      typeof value.repositoryRoot !== "string" ||
      !OID.test(value.commitOid) ||
      !POLICIES.has(value.verificationPolicy) ||
      typeof value.remote !== "string" ||
      typeof value.pushUrl !== "string" ||
      typeof value.observationUrl !== "string" ||
      typeof value.destination !== "string" ||
      (value.destinationOid !== null && !OID.test(value.destinationOid)) ||
      !DIGEST.test(value.outgoingSha256) ||
      !Number.isSafeInteger(value.outgoingCount) ||
      value.outgoingCount < 0 ||
      encode(value) !== token
    )
      throw new Error();
    const commit = value.commit;
    if (
      commit === null ||
      typeof commit !== "object" ||
      !same(Object.keys(commit), [
        "treeOid",
        "parentOids",
        "messageSha256",
        "signed",
      ]) ||
      !OID.test(commit.treeOid) ||
      !Array.isArray(commit.parentOids) ||
      !commit.parentOids.every((oid) => OID.test(oid)) ||
      !DIGEST.test(commit.messageSha256) ||
      commit.signed !== true
    )
      throw new Error();
    if (
      value.signer !== null &&
      (typeof value.signer !== "object" || Array.isArray(value.signer))
    )
      throw new Error();
  } catch {
    fail(
      "INVALID_PUBLICATION_PROPOSAL",
      "Supply the exact caller-held publicationProposal returned by read-only publication preparation.",
      "invalid-input",
    );
  }
  return value;
}
function assertSafeUrl(text) {
  if (/[\p{Cc}]/u.test(text))
    fail(
      "PUBLICATION_ENDPOINT_INVALID",
      "A publication endpoint contains control characters.",
    );
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      fail(
        "PUBLICATION_ENDPOINT_INVALID",
        "The effective push URL cannot be safely bound.",
      );
    }
    if (
      url.password ||
      (/^https?:$/u.test(url.protocol) && url.username) ||
      url.search ||
      url.hash
    ) {
      fail(
        "PUBLICATION_ENDPOINT_SENSITIVE",
        "Remove embedded credentials or query/fragment data from the effective push endpoint before preparing a caller-held binding.",
      );
    }
  }
}
function pushUrlFor(root, remote) {
  const urls = runReadOnlyGit(root, "publication-push-urls", [remote])
    .stdout.toString("utf8")
    .split(/\r?\n/u)
    .filter(Boolean);
  if (urls.length !== 1)
    fail(
      "PUBLICATION_ENDPOINT_AMBIGUOUS",
      "Memory publication requires exactly one effective push URL.",
    );
  const pushUrl = urls[0];
  assertSafeUrl(pushUrl);
  const pushUrls = runReadOnlyGit(
    root,
    "publication-raw-urls",
    [remote, "pushurl"],
    { allowFailure: true },
  );
  if (![0, 1].includes(pushUrls.status))
    fail(
      "PUBLICATION_ENDPOINT_INVALID",
      "The configured push URL could not be read.",
    );
  const raw =
    pushUrls.status === 0
      ? pushUrls.stdout
      : runReadOnlyGit(root, "publication-raw-urls", [remote, "url"]).stdout;
  const rawUrls = raw.toString("utf8").split(/\r?\n/u).filter(Boolean);
  if (rawUrls.length !== 1)
    fail(
      "PUBLICATION_ENDPOINT_AMBIGUOUS",
      "Memory publication requires one raw configured push URL.",
    );
  for (const candidate of new Set([rawUrls[0], pushUrl])) {
    const resolved = runReadOnlyGit(
      root,
      "publication-resolve-url",
      [candidate],
      { allowFailure: true },
    );
    if (
      resolved.status === 0 &&
      resolved.stdout.toString("utf8").replace(/\r?\n$/u, "") === pushUrl
    ) {
      assertSafeUrl(candidate);
      return { pushUrl, observationUrl: candidate };
    }
  }
  fail(
    "PUBLICATION_ENDPOINT_REWRITE_UNRESOLVED",
    "Native read-only URL resolution cannot bind an observation to the effective push endpoint. Resolve that transport prerequisite before publication.",
  );
}
async function observe(root, pushUrl, destination) {
  return observePublicationDestination(root, pushUrl, destination, {
    stream: (_operation, args, options) =>
      streamGit("publication-ls-remote", args, options),
  });
}
function commitFacts(root, commitOid) {
  const object = inspectCommitObject(root, commitOid);
  return {
    treeOid: object.treeOid,
    parentOids: object.parents,
    messageSha256: digest(object.messageBytes),
    signed: object.signed,
  };
}
async function outgoingFacts(root, commitOid, destinationOid) {
  const oids = [];
  let count = 0;
  let pending = "";
  let invalid = false;
  const args = [
    commitOid,
    ...(destinationOid === null ? [] : [destinationOid]),
  ];
  const result = await streamGit("publication-outgoing", args, {
    cwd: root,
    allowFailure: true,
    onStdout(chunk) {
      const lines = (pending + chunk.toString("ascii")).split("\n");
      pending = lines.pop();
      if (pending.length > 64) {
        invalid = true;
        pending = pending.slice(-65);
      }
      for (const oid of lines) {
        invalid ||= !OID.test(oid);
        count += 1;
        if (oids.length < 256) oids.push(oid);
      }
    },
  });
  if (
    result.status !== 0 ||
    invalid ||
    pending !== "" ||
    !Number.isSafeInteger(count)
  ) {
    fail(
      "PUBLICATION_OUTGOING_INCOMPLETE",
      "Complete outgoing ancestry could not be observed; no push was attempted.",
    );
  }
  return {
    sha256: result.stdoutSha256,
    count,
    oids: count <= 256 ? oids : null,
    inspection:
      count <= 256
        ? null
        : {
            arguments: [
              "git",
              "--no-lazy-fetch",
              "--no-pager",
              "rev-list",
              "--topo-order",
              commitOid,
              ...(destinationOid === null ? [] : [`^${destinationOid}`]),
              "--",
            ],
            environment: {
              GIT_NO_REPLACE_OBJECTS: "1",
              GIT_NO_LAZY_FETCH: "1",
              GIT_OPTIONAL_LOCKS: "0",
            },
            reason:
              "Inspect every outgoing commit using the exact bound range; the inline result never truncates it.",
          },
  };
}
function verify(root, commitOid, policy, signatureVerifier) {
  const preflight = preflightVerificationPolicy({
    root,
    verificationPolicy: policy,
    signaturePreflightInspector: inspectSignatureRequirements,
  });
  const attempt =
    policy === "skipped"
      ? null
      : policy === "advisory" &&
          preflight.backend === "ssh" &&
          preflight.trustSource?.state !== "readable"
        ? {
            status: "unavailable",
            reason: "trust-store-unreadable",
            backend: "ssh",
            identity: null,
            timestamp: new Date().toISOString(),
          }
        : signatureVerifier(root, commitOid, {
            backend: preflight.backend,
            invoke: (args, options) =>
              runGit(args, {
                ...options,
                env: { GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1" },
              }),
          });
  return applyVerificationPolicy({
    commitOid,
    initialPolicy: policy,
    finalPolicy: policy,
    verificationAttempt: attempt,
  });
}
async function inspectBinding({
  commitOid,
  remote,
  destination,
  verificationPolicy,
  cwd,
  environment,
  remoteObserver,
  signatureVerifier,
  proposalId = randomUUID(),
}) {
  assertNoGitStorageOverrides(environment);
  if (!OID.test(commitOid) || !POLICIES.has(verificationPolicy)) {
    fail(
      "INVALID_PUBLICATION_INPUT",
      "Memory publication needs an exact full commit OID and required, advisory or skipped verification.",
      "invalid-input",
    );
  }
  const root = repositoryRoot(cwd);
  const historyFiles = runReadOnlyGit(root, "publication-history-files")
    .stdout.toString("utf8")
    .trim()
    .split(/\r?\n/u);
  if (
    ["GIT_SHALLOW_FILE", "GIT_GRAFT_FILE"].some((key) =>
      Object.hasOwn(environment, key),
    ) ||
    historyFiles.some((path) => existsSync(path))
  ) {
    fail(
      "PUBLICATION_HISTORY_INCOMPLETE",
      "Shallow or grafted history cannot establish complete outgoing ancestry for a memory publication binding.",
    );
  }
  validateDestination(root, remote, destination);
  const { pushUrl, observationUrl } = pushUrlFor(root, remote);
  const commit = commitFacts(root, commitOid);
  if (!commit.signed)
    fail(
      "PUBLICATION_BLOCKED",
      "The selected existing commit has no signature header.",
    );
  const verification = verify(
    root,
    commitOid,
    verificationPolicy,
    signatureVerifier,
  );
  if (verification.blocksPush)
    fail(
      "PUBLICATION_BLOCKED",
      "Current native signature verification blocks publication of the existing commit.",
    );
  const observation = await remoteObserver(root, observationUrl, destination);
  if (!["observed", "absent"].includes(observation.status)) {
    fail(
      "PUBLICATION_DESTINATION_UNAVAILABLE",
      "A complete live destination observation is required; no push was attempted.",
    );
  }
  const destinationOid = observation.observedOid;
  if (destinationOid !== null) {
    const ancestry = runReadOnlyGit(
      root,
      "publication-is-ancestor",
      [destinationOid, commitOid],
      { allowFailure: true },
    );
    if (ancestry.status !== 0)
      fail(
        "PUBLICATION_ANCESTRY_UNRESOLVED",
        "The live destination must be locally available and an ancestor of the authorized commit. Reconcile ancestry and scope without force pushing.",
      );
  }
  const outgoing = await outgoingFacts(root, commitOid, destinationOid);
  const effective = verification.attempts[verification.effectiveAttempt];
  const binding = {
    schema: "publication-proposal/v1",
    proposalId,
    repositoryRoot: root,
    commitOid,
    commit,
    verificationPolicy,
    signer:
      effective.status === "verified"
        ? { backend: effective.backend, identity: effective.identity }
        : null,
    remote,
    pushUrl,
    observationUrl,
    destination,
    destinationOid,
    outgoingSha256: outgoing.sha256,
    outgoingCount: outgoing.count,
  };
  return { binding, verification, observation, outgoing };
}
function resultFor(binding, status, data = {}, commitState = "created") {
  const unknown = status === "unknown";
  const success = [
    "succeeded",
    "observed-matching",
    "publication-ready",
  ].includes(status);
  const token = encode(binding);
  return createWorkflowResult({
    disposition: success
      ? "succeeded"
      : unknown
        ? "outcome-unknown"
        : "rejected",
    status,
    code: success
      ? null
      : unknown
        ? "PUBLICATION_OUTCOME_UNKNOWN"
        : "PUBLICATION_REJECTED",
    phase:
      status === "publication-ready"
        ? "reported"
        : success
          ? "published"
          : unknown
            ? "publication-pending"
            : "reported",
    commitState,
    publicationState:
      status === "publication-ready"
        ? "not-requested"
        : success
          ? "published"
          : unknown
            ? "unknown"
            : "rejected",
    publicationAllowed: false,
    recoveryRequired: unknown,
    documentation: "references/publication-recovery.md",
    recovery: {
      kind: unknown ? "inspect-state" : "none",
      automatic: false,
      requiredInputs: unknown
        ? [
            "Confirm the prior Git process and its children ended before any separately authorized new attempt.",
          ]
        : [],
      commands: unknown
        ? [
            {
              arguments: [
                "workflow",
                "publish",
                "--observe-publication",
                token,
              ],
            },
          ]
        : [],
    },
    data: {
      stateStorage: "memory",
      transaction: null,
      commitOid: binding.commitOid,
      historicalAssurance: "not-attested",
      durableJournal: false,
      publication: {
        status,
        remote: binding.remote,
        destination: binding.destination,
        commitOid: binding.commitOid,
      },
      displayText:
        status === "publication-ready"
          ? `Existing commit ${binding.commitOid}: publication prepared for ${binding.remote} ${binding.destination}. This observation grants no push authority. Inspect all ${binding.outgoingCount} outgoing commits and current policy before the authorized attempt.
`
          : `Publication ${status}: ${binding.commitOid} to ${binding.remote} ${binding.destination}.
`,
      ...data,
    },
  });
}
export async function prepareMemoryPublication({
  verificationPolicy = "required",
  cwd = process.cwd(),
  environment = process.env,
  remoteObserver = observe,
  signatureVerifier = verifyCommitSignature,
  ...options
}) {
  const { binding, verification, observation, outgoing } = await inspectBinding(
    {
      ...options,
      verificationPolicy,
      cwd,
      environment,
      remoteObserver,
      signatureVerifier,
    },
  );
  const token = encode(binding);
  return resultFor(binding, "publication-ready", {
    publicationProposal: token,
    binding,
    verification,
    observation,
    outgoingCommitOids: outgoing.oids,
    outgoingInspection: outgoing.inspection,
    publish: {
      arguments: ["workflow", "publish", "--publication-proposal", token],
    },
  });
}
function classifyMemoryPushCompletion(transcript, binding) {
  const outcome = classifyPushCompletion(transcript, binding.destination);
  if (outcome !== "witnessed-success") return outcome;
  if (!transcript.capturedStdoutComplete) return "unknown";

  const refspec = `${binding.commitOid}:${binding.destination}`;
  const records = transcript.capturedStdout
    .toString("utf8")
    .split(/\r?\n/u)
    .map((line) => line.split("\t"))
    .filter(([, ref]) => ref === refspec);
  if (records.length !== 1) return "unknown";
  const [[flag]] = records;
  if (flag === "=") return "observed-matching";
  return flag === " " || flag === "*" ? "witnessed-success" : "unknown";
}

async function pushOnce(
  binding,
  { environment, processLauncher, diagnosticWriter },
) {
  let child;
  try {
    child = processLauncher(
      "git",
      [
        "-c",
        `remote.${binding.remote}.mirror=false`,
        "push",
        "--porcelain",
        "--no-force",
        // inspectBinding proved this exact old tip is an ancestor, or absent.
        `--force-with-lease=${binding.destination}:${binding.destinationOid ?? ""}`,
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        binding.remote,
        `${binding.commitOid}:${binding.destination}`,
      ],
      {
        cwd: binding.repositoryRoot,
        env: {
          ...environment,
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_NO_LAZY_FETCH: "1",
          GIT_PAGER: "cat",
          PAGER: "cat",
          NO_COLOR: "1",
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch {
    return {
      outcome: "known-rejection",
      reason: "not-launched",
      exitCode: null,
      signal: null,
    };
  }
  return new Promise((resolveCompletion) => {
    let stdout = Buffer.alloc(0);
    const stdoutHash = createHash("sha256");
    let complete = true;
    let launchError = null;
    child.stdout.on("data", (chunk) => {
      stdoutHash.update(chunk);
      const remaining = Math.max(0, MAXIMUM_CAPTURE_BYTES - stdout.length);
      stdout = Buffer.concat([stdout, chunk.subarray(0, remaining)]);
      complete &&= chunk.length <= remaining;
    });
    child.stderr.on("data", (chunk) => {
      try {
        diagnosticWriter.write(chunk);
      } catch {
        // Diagnostic delivery does not determine the Git child's outcome.
      }
    });
    child.once("error", (error) => {
      launchError = { code: error.code ?? null };
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.once("error", (error) => {
        launchError ??= { code: error.code ?? null };
      });
    }
    child.once("close", (status, signal) =>
      resolveCompletion({
        outcome: classifyMemoryPushCompletion(
          {
            status,
            signal,
            launchError,
            capturedStdoutComplete: complete,
            capturedStdout: stdout,
          },
          binding,
        ),
        exitCode: status,
        signal,
        stdoutSha256: stdoutHash.digest("hex"),
        stdoutComplete: complete,
      }),
    );
  });
}
export async function publishMemoryProposal({
  publicationProposal,
  cwd = process.cwd(),
  environment = process.env,
  remoteObserver = observe,
  signatureVerifier = verifyCommitSignature,
  processLauncher = spawn,
  diagnosticWriter = { write() {} },
}) {
  const binding = decodePublicationProposal(publicationProposal);
  if (consumedProposals.has(publicationProposal))
    fail(
      "PUBLICATION_PROPOSAL_CONSUMED",
      "This process already consumed the publication proposal. Observe the destination; never replay an unknown attempt.",
      "outcome-unknown",
    );
  const current = await inspectBinding({
    ...binding,
    cwd,
    environment,
    remoteObserver,
    signatureVerifier,
  });
  if (!same(current.binding, binding)) {
    fail(
      "PUBLICATION_PROPOSAL_STALE",
      "The repository, commit, signature, effective push endpoint, live ref or outgoing ancestry changed. Reconcile the changed facts and authority before preparing again.",
      "rejected",
    );
  }
  if (consumedProposals.has(publicationProposal))
    fail(
      "PUBLICATION_PROPOSAL_CONSUMED",
      "This process already consumed the publication proposal. Observe before another attempt.",
      "outcome-unknown",
    );
  consumedProposals.add(publicationProposal);
  if (binding.destinationOid === binding.commitOid) {
    return resultFor(binding, "observed-matching", {
      observation: current.observation,
      witnessedOutcome: null,
    });
  }
  const endpoint = pushUrlFor(binding.repositoryRoot, binding.remote);
  if (
    endpoint.pushUrl !== binding.pushUrl ||
    endpoint.observationUrl !== binding.observationUrl
  )
    fail(
      "PUBLICATION_PROPOSAL_STALE",
      "The effective push endpoint changed before launch; no push was attempted.",
      "rejected",
    );
  const completion = await pushOnce(binding, {
    environment,
    processLauncher,
    diagnosticWriter,
  });
  if (completion.outcome === "observed-matching") {
    return resultFor(binding, "observed-matching", {
      completion,
      witnessedOutcome: null,
      verification: current.verification,
    });
  }
  const status =
    completion.outcome === "witnessed-success"
      ? "succeeded"
      : completion.outcome === "known-rejection"
        ? "rejected"
        : "unknown";
  return resultFor(binding, status, {
    completion,
    witnessedOutcome: completion.outcome,
    verification: current.verification,
  });
}
export async function observeMemoryPublication({
  publicationProposal,
  cwd = process.cwd(),
  environment = process.env,
  remoteObserver = observe,
}) {
  const binding = decodePublicationProposal(publicationProposal);
  const unavailable = (reason, commitState = "unknown") =>
    resultFor(
      binding,
      "unknown",
      {
        observation: { status: "unavailable", observedOid: null, reason },
        witnessedOutcome: null,
      },
      commitState,
    );
  let root;
  try {
    assertNoGitStorageOverrides(environment);
    root = repositoryRoot(cwd);
    validateDestination(root, binding.remote, binding.destination);
    const endpoint = pushUrlFor(root, binding.remote);
    if (
      root !== binding.repositoryRoot ||
      endpoint.pushUrl !== binding.pushUrl ||
      endpoint.observationUrl !== binding.observationUrl
    ) {
      return unavailable("local-binding-changed");
    }
  } catch {
    return unavailable("local-binding-unavailable");
  }
  let commitState = "unknown";
  try {
    commitFacts(root, binding.commitOid);
    commitState = "created";
  } catch {
    // The remote can still be observed when the local commit is unavailable.
  }
  let observation;
  try {
    observation = await remoteObserver(
      root,
      binding.observationUrl,
      binding.destination,
    );
  } catch {
    return unavailable("remote-query-unavailable", commitState);
  }
  return resultFor(
    binding,
    observation.status === "observed" &&
      observation.observedOid === binding.commitOid
      ? "observed-matching"
      : "unknown",
    { observation, witnessedOutcome: null },
    commitState,
  );
}
