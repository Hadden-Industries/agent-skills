import { commandFailure } from "./publicationCommands.js";

const LOGIN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u;

/** Project native observation data; caller labels and account lists are not proof. */
export function projectTransportObservation(observation) {
  const unavailable = {
    state: "unavailable",
    principal: null,
    method: null,
    permissions: { state: "unavailable", canPush: null },
  };
  if (observation?.state !== "established") {
    return {
      ...unavailable,
      state: ["ambiguous", "binding-changed"].includes(observation?.state)
        ? observation.state
        : "unavailable",
      reason: /^[a-z][a-z0-9-]{0,80}$/u.test(observation?.reason ?? "")
        ? observation.reason
        : "native-evidence-unavailable",
      commandFailure: commandFailure(observation?.commandFailure),
    };
  }
  const principal = observation.principal;
  const https = observation.method === "git-credential-github-user";
  const ssh = observation.method === "ssh-github-greeting";
  if (
    (!https && !ssh) ||
    !LOGIN.test(principal?.login ?? "") ||
    principal?.kind !== "user" ||
    (https && (!Number.isSafeInteger(principal.id) || principal.id < 1))
  )
    return unavailable;
  return {
    state: "established",
    method: observation.method,
    principal: {
      kind: "user",
      login: principal.login,
      ...(https ? { id: principal.id } : {}),
    },
    permissions:
      observation.permissions?.state === "established" &&
      typeof observation.permissions.canPush === "boolean"
        ? { state: "established", canPush: observation.permissions.canPush }
        : { state: "unavailable", canPush: null },
  };
}

/**
 * Identity observation is supplementary unless a concrete actor constraint needs
 * it. Absence never transfers API permissions to Git and never creates a prompt.
 */
export function assessTransportIdentity({
  observation,
  apiActor,
  authorizedTransportActor,
  restricted = false,
}) {
  const identity = projectTransportObservation(observation);
  const required = Boolean(authorizedTransportActor) || restricted;
  const established = identity.state === "established";
  const matchesConstraint =
    !authorizedTransportActor ||
    (established &&
      identity.principal.login.toLowerCase() ===
        authorizedTransportActor.toLowerCase());
  const conflict = established && !matchesConstraint;
  const denied =
    identity.permissions.state === "established" &&
    identity.permissions.canPush === false;
  return {
    transportIdentity: { ...identity, required },
    transportPermissions: identity.permissions,
    identityRelationship: !established
      ? "not-established"
      : identity.principal.login.toLowerCase() === apiActor?.toLowerCase()
        ? "same-account"
        : authorizedTransportActor && matchesConstraint
          ? "authorized-different"
          : "different-accounts",
    blocking: conflict || denied || (required && !established),
    reason: conflict
      ? "The observed Git account differs from the explicitly authorized transport account."
      : denied
        ? "The authenticated transport credential has no observed ordinary write permission."
        : required && !established
          ? "An explicit account constraint or actor-specific provider restriction requires transport evidence."
          : null,
    warnings:
      !established && !required
        ? [
            {
              code: "TRANSPORT_IDENTITY_OPTIONAL_UNAVAILABLE",
              message:
                "Supplementary transport identity evidence is unavailable. Continue the established authorized route without retrying the probe or prompting solely for it.",
            },
          ]
        : [],
  };
}

/** A rejected optional method stays rejected; no alternate method is selected. */
export function collectTransportObservation(observe, binding, context) {
  try {
    return projectTransportObservation(observe(binding, context));
  } catch (error) {
    return projectTransportObservation({
      state: "unavailable",
      reason: "native-observation-failed",
      commandFailure: commandFailure(error),
    });
  }
}
