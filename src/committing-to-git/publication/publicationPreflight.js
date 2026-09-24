import { spawnSync } from "node:child_process";
import { activeGitOperations, repositoryRoot } from "../git/gitRepository.js";
import { inspectSignatureRequirements } from "../signature/signaturePreflight.js";
import { inspectGitHubPolicy } from "./githubPolicy.js";

function gitRead(cwd, args, allowAbsent = false) {
  const result = spawnSync(
    "git",
    ["--no-lazy-fetch", "--no-pager", "-c", "core.fsmonitor=false", ...args],
    {
      cwd,
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
  if (result.error || result.status !== 0)
    throw new Error(`Read-only Git ${args[0]} observation failed.`);
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

/** Observe without staging, committing, changing branches, fetching or writing workflow artifacts. */
export function inspectPublicationFeasibility({
  cwd = process.cwd(),
  remote,
  destination,
  sourceBranch,
  requirePersonalSignature = false,
  api,
}) {
  const stop = (status, reason) => ({
    status,
    route: null,
    reasons: [reason],
    prerequisites: [],
    summary: reason,
    observedAt: new Date().toISOString(),
  });
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(remote ?? ""))
      return stop("blocked", "Select an exact configured remote name.");
    const root = repositoryRoot(cwd);
    if (activeGitOperations(root).length)
      return stop(
        "blocked",
        "Finish or explicitly resolve the existing Git operation before starting a new commit workflow.",
      );
    if (destination && !destination.startsWith("refs/heads/"))
      return stop(
        "blocked",
        "Destination must be a full refs/heads/ branch ref.",
      );
    if (destination) gitRead(root, ["check-ref-format", destination]);
    if (sourceBranch)
      gitRead(root, ["check-ref-format", `refs/heads/${sourceBranch}`]);
    const urls = gitRead(root, [
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
    gitRead(root, ["var", "GIT_AUTHOR_IDENT"]);
    gitRead(root, ["var", "GIT_COMMITTER_IDENT"]);
    const signature = inspectSignatureRequirements(root);
    if (
      signature.backend === "ssh" &&
      signature.trustSource?.state !== "readable"
    )
      return stop(
        "blocked",
        "Required SSH verification needs its configured readable allowed-signers file.",
      );
    const signingKey = gitRead(
      root,
      ["config", "--get", "user.signingkey"],
      true,
    );
    if (
      signature.backend === "ssh" &&
      !signingKey &&
      !gitRead(root, ["config", "--get", "gpg.ssh.defaultKeyCommand"], true)
    )
      return stop(
        "blocked",
        "SSH signing has neither a configured signing key nor a default key command.",
      );
    const result = inspectGitHubPolicy({
      ...identity,
      destination,
      sourceBranch,
      requirePersonalSignature,
      api,
    });
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
        "Confirm the Git transport actor matches the observed API actor, and verify signing-key availability and expected signer during the signed commit workflow.",
      );
      result.prerequisites.push(
        "Check selected scope, outgoing ancestry and target freshness before publication; this preflight does not authorize mutations or prove a future push will succeed.",
      );
      result.status = "viable-with-prerequisites";
    }
    return {
      ...result,
      remote,
      sourceBranch: sourceBranch ?? null,
      localSignatureBackend: signature.backend,
      summary: result.route
        ? `Publication route: ${result.route}. Resolve the listed prerequisites before the corresponding mutation.`
        : result.reasons.join(" "),
    };
  } catch {
    return stop(
      "unknown",
      "Local repository, identity, remote or signing readiness could not be established. Inspect the failing prerequisite without attempting publication.",
    );
  }
}
