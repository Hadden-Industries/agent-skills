import { spawnSync } from "node:child_process";
import {
  activeGitOperations,
  repositoryRoot,
  buildReadOnlyGitArguments,
} from "../git/gitRepository.js";
import { inspectSignatureRequirements } from "../signature/signaturePreflight.js";
import { inspectGitHubPolicy, githubApi } from "./githubPolicy.js";
import {
  commandFailure,
  PublicationCommandError,
} from "./publicationCommands.js";
import {
  assessTransportIdentity,
  collectTransportObservation,
} from "./transportIdentity.js";
import {
  discoveryEvidence,
  reuseDiscoveryEvidence,
} from "./discoveryEvidence.js";

function gitRead(
  runCommand,
  cwd,
  args,
  allowAbsent = false,
  operation = "git-discovery",
) {
  const result = runCommand(
    "git",
    ["--no-lazy-fetch", "--no-pager", "-c", "core.fsmonitor=false", ...args],
    {
      cwd,
      operation,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_NO_LAZY_FETCH: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
      },
    },
  );
  if (!result.error && allowAbsent && result.status === 1) return null;
  if (result.error)
    throw new PublicationCommandError("COMMAND_UNAVAILABLE", operation, {
      executed: result.pid > 0,
    });
  if (result.status !== 0)
    throw new PublicationCommandError("COMMAND_FAILED", operation, {
      executed: true,
    });
  return result.stdout.trim();
}

/** Identify only canonical GitHub remotes; unknown transports never imply a writable target. */
export function githubRemoteIdentity(url) {
  const match =
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u.exec(
      url,
    );
  return match ? { owner: match[1], repository: match[2] } : null;
}

/**
 * Discover a route without mutations and return task-local reuse guidance.
 * Reuse is advisory: callers retain task/transport identity and authorization;
 * Git and the provider still enforce each actual publication attempt.
 */
export function inspectPublicationFeasibility({
  cwd = process.cwd(),
  remote,
  destination,
  sourceBranch,
  requirePersonalSignature = false,
  api,
  runCommand = spawnSync,
  taskId,
  authorizedTransportActor,
  transportProbe = "auto",
  priorDiscovery,
  observeContext = () => ({ supported: false }),
  observeTransport = () => ({ state: "unavailable" }),
}) {
  const stop = (status, reason) => ({
    status,
    route: null,
    reasons: [reason],
    prerequisites: [],
    summary: reason,
    observedAt: new Date().toISOString(),
    discoveryReuse: { eligible: false, binding: null },
  });
  const read = (root, args, allowAbsent = false) =>
    gitRead(runCommand, root, args, allowAbsent);
  const observe = (root, operation, args = []) =>
    gitRead(
      runCommand,
      root,
      buildReadOnlyGitArguments(operation, args),
      false,
      `git-${operation}`,
    );
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(remote ?? ""))
      return stop("blocked", "Select an exact configured remote name.");
    const root = repositoryRoot(cwd, observe);
    if (destination && !destination.startsWith("refs/heads/"))
      return stop(
        "blocked",
        "Destination must be a full refs/heads/ branch ref.",
      );
    if (destination) read(root, ["check-ref-format", destination]);
    if (sourceBranch)
      read(root, ["check-ref-format", `refs/heads/${sourceBranch}`]);
    const urls = read(root, [
      "remote",
      "get-url",
      "--push",
      "--all",
      remote,
    ]).split(/\r?\n/u);
    if (urls.length !== 1)
      return stop(
        "unknown",
        "Multiple push URLs require an explicit single-target publication design.",
      );
    const identity = githubRemoteIdentity(urls[0]);
    if (!identity)
      return stop(
        "unknown",
        "This provider or transport is not supported by GitHub preflight; no publication permission is inferred.",
      );
    if (activeGitOperations(root, observe).length)
      return stop(
        "blocked",
        "Finish or explicitly resolve the existing Git operation before starting a new commit workflow.",
      );
    read(root, ["var", "GIT_AUTHOR_IDENT"]);
    read(root, ["var", "GIT_COMMITTER_IDENT"]);
    const signature = inspectSignatureRequirements(root, {
      runConfig: (args) =>
        runCommand("git", args, {
          cwd: root,
          operation: "git-signing-discovery",
          encoding: null,
        }),
    });
    if (
      signature.backend === "ssh" &&
      signature.trustSource?.state !== "readable"
    )
      return stop(
        "blocked",
        "Required SSH verification needs its configured readable allowed-signers file.",
      );
    const signingKey = read(root, ["config", "--get", "user.signingkey"], true);
    if (
      signature.backend === "ssh" &&
      !signingKey &&
      !read(root, ["config", "--get", "gpg.ssh.defaultKeyCommand"], true)
    )
      return stop(
        "blocked",
        "SSH signing has neither a configured signing key nor a default key command.",
      );
    const providerApi =
      api ?? ((endpoint, fields) => githubApi(endpoint, fields, runCommand));
    const bindingFor = (provider) => ({
      taskId: taskId ?? null,
      repositoryRoot: root,
      repository: `${identity.owner}/${identity.repository}`,
      remote,
      pushUrl: urls[0],
      destination: provider.destination,
      sourceBranch: sourceBranch ?? null,
      apiActor: provider.actor,
      requirePersonalSignature,
    });
    let context = null;
    let contextFailed = false;
    let observation = { state: "unavailable", reason: "not-collected" };
    let reused = null;
    if (priorDiscovery && taskId) {
      const actor = providerApi("user").login;
      const candidateBinding = bindingFor({
        actor,
        destination: destination ?? priorDiscovery.binding?.destination,
      });
      try {
        context = observeContext(candidateBinding);
        reused = reuseDiscoveryEvidence(
          priorDiscovery,
          candidateBinding,
          context,
        );
      } catch (error) {
        contextFailed = true;
        observation = {
          state: "unavailable",
          commandFailure: commandFailure(error),
        };
      }
    }
    const result = reused
      ? structuredClone(reused.provider)
      : inspectGitHubPolicy({
          ...identity,
          destination,
          sourceBranch,
          requirePersonalSignature,
          api: providerApi,
        });
    const binding = bindingFor(result);
    if (reused) observation = reused.observation;
    if (priorDiscovery && !reused && !contextFailed)
      observation = {
        state: "binding-changed",
        reason: "retained-discovery-not-reusable",
      };
    if (
      !priorDiscovery &&
      !contextFailed &&
      taskId &&
      transportProbe === "auto" &&
      !result.commandFailure &&
      result.policy
    ) {
      try {
        context ??= observeContext(binding);
        if (context.supported)
          observation = collectTransportObservation(
            observeTransport,
            binding,
            context,
          );
      } catch (error) {
        observation = {
          state: "unavailable",
          commandFailure: commandFailure(error),
        };
      }
    }
    const assessment = assessTransportIdentity({
      observation,
      apiActor: result.actor,
      authorizedTransportActor,
      restricted: Boolean(
        result.policy?.protection?.restrictions ||
        result.policy?.sourceProtection?.restrictions,
      ),
    });
    const retainedEvidence = discoveryEvidence(
      binding,
      context,
      structuredClone(result),
      assessment.transportIdentity,
    );
    if (assessment.blocking) {
      return {
        ...stop("unknown", assessment.reason),
        ...assessment,
        nextAction: "resolve-required-transport-evidence",
      };
    }
    if (
      sourceBranch &&
      result.destination === `refs/heads/${sourceBranch}` &&
      result.route !== "direct"
    )
      return stop(
        "blocked",
        "The PR source branch must differ from the target branch.",
      );
    if (result.route) {
      result.prerequisites.push(
        "Verify signing-key availability and the expected signer during the signed commit workflow. API identity and permissions are not Git transport identity or permissions.",
      );
      result.prerequisites.push(
        "Check selected scope, outgoing ancestry and target freshness before publication; this preflight does not authorize mutations or prove a future push will succeed.",
      );
      result.status = "viable-with-prerequisites";
    }
    return {
      ...result,
      ...assessment,
      discoveryEvidence: retainedEvidence,
      discoveryReused: Boolean(reused),
      nextAction: result.commandFailure
        ? "resolve-command-prerequisite"
        : result.route
          ? "verify-publication-payload"
          : "resolve-route-prerequisite",
      remote,
      sourceBranch: sourceBranch ?? null,
      localSignatureBackend: signature.backend,
      discoveryReuse: result.route
        ? {
            eligible: true,
            scope: "current-task",
            binding: {
              repositoryRoot: root,
              repository: result.repository,
              remote,
              pushUrl: urls[0],
              destination: result.destination,
              sourceBranch: sourceBranch ?? null,
              apiActor: result.actor,
              requirePersonalSignature,
            },
            refreshWhen: [
              "A new task starts or the prior discovery context is unavailable.",
              "A binding value, Git transport identity or signing requirement changes or becomes uncertain.",
              "A policy change is known or publication is definitively rejected.",
            ],
            beforePublication: [
              "Verify the exact authorized commits, signatures, outgoing ancestry and current destination refs.",
              "Satisfy the observed route's content, check, review and integration-method prerequisites on the current head.",
            ],
            onUnknownOutcome:
              "Reconcile the existing attempt through publication recovery before considering any retry.",
          }
        : { eligible: false, binding: null },
      summary: result.route
        ? `Publication route: ${result.route}. Reuse discovery within the unchanged task; check exact payload, live refs and prerequisites before effects. Rediscover after context/policy changes or definitive rejection; reconcile unknown outcomes before retry.`
        : result.reasons.join(" "),
    };
  } catch (error) {
    return {
      ...stop(
        "unknown",
        "Local repository, identity, remote or signing readiness could not be established. Inspect the failing prerequisite without attempting publication.",
      ),
      commandFailure: commandFailure(error),
      nextAction: "resolve-command-prerequisite",
    };
  }
}
