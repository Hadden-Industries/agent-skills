/** Fixed, sanitized probe outcomes; provider prose is classification input only. */
export class GitHubProbeError extends Error {
  constructor(classification, code, reason, resolution, httpStatus = null) {
    super(reason);
    this.outcome = { classification, code, reason, resolution, httpStatus };
  }
}

/** Malformed, partial or unsupported observations never establish absent policy. */
export function incompleteProbe(reason, code = "GITHUB_RESPONSE_INCOMPLETE") {
  return new GitHubProbeError(
    "incomplete",
    code,
    reason,
    "Repeat workflow preflight after the provider returns a complete supported response.",
  );
}

/** Parse gh --include's bounded native response, without retaining headers or bodies. */
export function parseGitHubResponse(result, endpoint) {
  if (result.error) {
    const code = result.error.code;
    if (code === "ENOBUFS")
      throw incompleteProbe(
        "Provider response exceeded the observation byte limit.",
        "GITHUB_RESPONSE_LIMIT",
      );
    if (code === "ENOENT" || code === "EACCES")
      throw new GitHubProbeError(
        "inaccessible",
        "GITHUB_COMMAND_UNAVAILABLE",
        "GitHub CLI could not be launched.",
        "Restore the approved GitHub CLI executable, then repeat workflow preflight.",
      );
    throw new GitHubProbeError(
      "transient",
      "GITHUB_NETWORK_FAILURE",
      "Provider observation timed out or failed before a complete response.",
      "Check provider/network availability, then repeat workflow preflight; do not publish to test access.",
    );
  }
  const match =
    /^HTTP\/\S+ (\d{3})[^\r\n]*\r?\n((?:[^\r\n]+\r?\n)*)\r?\n([\s\S]*)$/u.exec(
      result.stdout ?? "",
    );
  if (!match) {
    if (result.status === 4)
      throw new GitHubProbeError(
        "inaccessible",
        "GITHUB_AUTHENTICATION_REQUIRED",
        "GitHub CLI requires authentication before this observation.",
        "Restore the approved CLI authentication, then repeat workflow preflight.",
      );
    if (result.status !== 0)
      throw new GitHubProbeError(
        "transient",
        "GITHUB_RESPONSE_UNAVAILABLE",
        "GitHub CLI returned no complete HTTP response.",
        "Check CLI authentication and network availability, then repeat workflow preflight.",
      );
    throw incompleteProbe(
      "GitHub CLI response is missing HTTP status and headers.",
    );
  }
  const status = Number(match[1]);
  const headers = new Map(
    match[2].split(/\r?\n/u).map((line) => {
      const separator = line.indexOf(":");
      return [
        line.slice(0, separator).trim().toLowerCase(),
        line.slice(separator + 1).trim(),
      ];
    }),
  );
  let body;
  try {
    body = JSON.parse(match[3]);
  } catch {
    if (status >= 200 && status < 300)
      throw incompleteProbe("Provider response is not valid JSON.");
  }
  const transient =
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    (status === 403 &&
      (headers.get("x-ratelimit-remaining") === "0" ||
        headers.has("retry-after") ||
        /^(?:API rate limit exceeded|You have exceeded a (?:secondary )?rate limit)/u.test(
          body?.message ?? "",
        )));
  if (transient)
    throw new GitHubProbeError(
      "transient",
      status === 403 || status === 429
        ? "GITHUB_RATE_LIMITED"
        : "GITHUB_SERVICE_UNAVAILABLE",
      "Provider observation is rate limited or temporarily unavailable.",
      "Wait for the provider rate-limit reset or service recovery, then repeat workflow preflight. No automatic retry is performed.",
      status,
    );
  // Only an exact response on the rules feature endpoints can establish plan absence.
  // A status alone (especially 403/404) may conceal policy and must never clear it.
  const path = endpoint.split("?")[0];
  const rulesEndpoint =
    /^repos\/[^/]+\/[^/]+\/(?:rules\/branches\/[^/]+|rulesets)$/u.test(path);
  const planMessage =
    body?.message ===
      "Upgrade to GitHub Pro or make this repository public to enable this feature." ||
    body?.message ===
      "Upgrade to GitHub Team or make this repository public to enable this feature.";
  const rulesDocumentation =
    /^https:\/\/docs\.github\.com\/(?:en\/)?rest\/repos\/rules(?:#[-a-z]+)?$/u.test(
      body?.documentation_url ?? "",
    );
  if (status === 403 && rulesEndpoint && planMessage && rulesDocumentation)
    throw new GitHubProbeError(
      "not-available",
      "GITHUB_FEATURE_NOT_AVAILABLE",
      "Rulesets are not available on this repository plan (403 plan-gated).",
      "Continue with the other complete policy observations; retain this feature limitation in the publication handoff.",
      status,
    );
  if (status < 200 || status >= 300)
    throw new GitHubProbeError(
      "inaccessible",
      status === 401
        ? "GITHUB_AUTHENTICATION_REQUIRED"
        : status === 403
          ? "GITHUB_POLICY_FORBIDDEN"
          : status === 404
            ? "GITHUB_POLICY_NOT_FOUND_OR_HIDDEN"
            : "GITHUB_HTTP_UNRESOLVED",
      "The provider response does not establish readable policy or feature absence.",
      "Resolve CLI authentication, repository/token permissions or SSO access for this probe, then repeat workflow preflight. A 404 is not proof of absent policy.",
      status,
    );
  if (body?.errors) {
    const errors = Array.isArray(body.errors) ? body.errors : [];
    if (
      errors.some(
        (error) =>
          error?.type === "RATE_LIMITED" ||
          error?.extensions?.code === "RATE_LIMITED",
      )
    )
      throw new GitHubProbeError(
        "transient",
        "GITHUB_RATE_LIMITED",
        "GraphQL policy observation is rate limited.",
        "Wait for the provider rate-limit reset, then repeat workflow preflight.",
        status,
      );
    if (
      errors.some((error) =>
        ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(
          error?.type ?? error?.extensions?.code,
        ),
      )
    )
      throw new GitHubProbeError(
        "inaccessible",
        "GITHUB_GRAPHQL_ACCESS_DENIED",
        "GraphQL did not establish readable policy.",
        "Resolve token permissions, authentication or SSO access, then repeat workflow preflight.",
        status,
      );
    throw incompleteProbe(
      "GraphQL returned partial or erroneous policy observations.",
      "GITHUB_GRAPHQL_INCOMPLETE",
    );
  }
  if (result.status !== 0)
    throw incompleteProbe(
      "GitHub CLI did not complete the successful HTTP response.",
    );
  return body;
}
