import { createHash } from "node:crypto";
import { createPublicationCommandRunner } from "./publicationCommands.js";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Opaque context fingerprint, never a credential/account proof. */
export function observeTransportContext(
  binding,
  runCommand = createPublicationCommandRunner(),
) {
  const result = runCommand(
    "git",
    ["config", "--null", "--list", "--show-origin"],
    {
      cwd: binding.repositoryRoot,
      operation: "transport-context",
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) return { supported: false };
  const environment = Object.entries(process.env)
    .filter(([key]) => /^(GIT_|GCM_|SSH_|HOME$|USERPROFILE$|PATH$)/iu.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  return { supported: true, fingerprint: digest([result.stdout, environment]) };
}

/**
 * Integrity detects truncation/editing, not authorship. Only retain an actually
 * witnessed helper result from this task; this is not a transferable credential.
 */
export function discoveryEvidence(binding, context, provider, observation) {
  if (!binding.taskId || !context?.fingerprint || !provider.route) return null;
  const data = {
    schemaVersion: 1,
    binding,
    context: context.fingerprint,
    provider,
    observation,
  };
  return { ...data, integrity: digest(data) };
}

/** A mismatch never triggers a credential retry or establishes a new principal. */
export function reuseDiscoveryEvidence(evidence, binding, context) {
  if (
    !evidence ||
    evidence.schemaVersion !== 1 ||
    !context?.fingerprint ||
    !binding.taskId
  )
    return null;
  const { integrity, ...data } = evidence;
  if (integrity !== digest(data) || evidence.context !== context.fingerprint)
    return null;
  if (
    digest(evidence.binding) !== digest(binding) ||
    !evidence.provider?.route ||
    !evidence.provider?.policy
  )
    return null;
  return { provider: evidence.provider, observation: evidence.observation };
}
