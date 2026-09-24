/** Select a delivery route from complete provider observations, never from bypass privileges. */
export function selectPublicationRoute({
  repository,
  protection,
  targetRules,
  sourceRules,
  sourceProtection = null,
  pushRules,
  sourceBranch,
  requirePersonalSignature = false,
}) {
  const prerequisites = [];
  const reasons = [];
  const stop = (status, reason) => ({
    status,
    route: null,
    reasons: [...reasons, reason],
    prerequisites,
  });
  if (!repository || typeof repository.permissions?.push !== "boolean")
    return stop("unknown", "Publication permissions are unavailable.");
  if (repository.archived || repository.disabled)
    return stop("blocked", "The repository is archived or disabled.");
  if (!repository.permissions.push)
    return stop(
      "blocked",
      "The authenticated actor cannot publish to this repository; a separately selected fork or maintainer handoff is needed.",
    );
  if (![targetRules, sourceRules, pushRules].every(Array.isArray))
    return stop("unknown", "Complete active policy is unavailable.");
  const knownRules = new Set([
    "creation",
    "update",
    "deletion",
    "required_linear_history",
    "required_signatures",
    "pull_request",
    "required_status_checks",
    "non_fast_forward",
    "merge_queue",
    "required_deployments",
    "code_scanning",
    "workflows",
    "code_quality",
    "commit_message_pattern",
    "commit_author_email_pattern",
    "committer_email_pattern",
    "branch_name_pattern",
    "file_path_restriction",
    "max_file_path_length",
    "file_extension_restriction",
    "max_file_size",
  ]);
  for (const rule of [...targetRules, ...sourceRules, ...pushRules]) {
    if (!rule || !knownRules.has(rule.type))
      return stop(
        "unknown",
        `Unsupported active rule: ${rule?.type ?? "invalid rule"}.`,
      );
  }
  if (
    protection?.lock_branch?.enabled ||
    targetRules.some((rule) => rule.type === "update")
  )
    return stop(
      "blocked",
      "Target updates require a bypass, which this workflow does not use.",
    );
  if (protection?.restrictions)
    return stop(
      "unknown",
      "Resolve classic push restrictions against the actual Git transport actor before selecting a route.",
    );
  const contentRules = new Set([
    "commit_message_pattern",
    "commit_author_email_pattern",
    "committer_email_pattern",
    "branch_name_pattern",
    "file_path_restriction",
    "max_file_path_length",
    "file_extension_restriction",
    "max_file_size",
  ]);
  if (
    [...targetRules, ...pushRules].some((rule) => contentRules.has(rule.type))
  )
    prerequisites.push(
      "Validate selected commit content, metadata and branch names against every returned content rule before mutation.",
    );
  if (
    targetRules.some((rule) => rule.type === "required_signatures") ||
    protection?.required_signatures?.enabled
  )
    prerequisites.push(
      "Verify all introduced commits satisfy the provider signing rules as well as the expected local signer.",
    );
  const checkRules = new Set([
    "required_status_checks",
    "required_deployments",
    "code_scanning",
    "workflows",
    "code_quality",
  ]);
  const needsChecks =
    Boolean(protection?.required_status_checks) ||
    targetRules.some((rule) => checkRules.has(rule.type));
  const needsReview =
    Boolean(protection?.required_pull_request_reviews) ||
    targetRules.some((rule) => rule.type === "pull_request");
  const queues = targetRules.filter((rule) => rule.type === "merge_queue");
  const needsConversation =
    protection?.required_conversation_resolution?.enabled === true;
  const needsPullRequest =
    needsChecks || needsReview || needsConversation || queues.length > 0;
  if (!needsPullRequest)
    return {
      status: prerequisites.length ? "viable-with-prerequisites" : "viable",
      route: "direct",
      reasons: ["No observed policy requires PR delivery."],
      prerequisites,
      signatureEffect:
        "The exact locally signed commit is published without rewriting.",
    };
  if (!sourceBranch)
    return stop(
      "unknown",
      "Select a unique PR source branch and inspect its protections before drafting.",
    );
  if (sourceProtection?.restrictions)
    return stop(
      "unknown",
      "Resolve the source branch push restrictions before publication.",
    );
  if (
    sourceProtection?.lock_branch?.enabled ||
    sourceProtection?.required_pull_request_reviews ||
    sourceRules.some((rule) =>
      ["creation", "update", "pull_request", "merge_queue"].includes(rule.type),
    )
  )
    return stop(
      "blocked",
      "The proposed source branch cannot accept ordinary publication; select another permitted source branch and repeat preflight.",
    );
  if (sourceRules.some((rule) => contentRules.has(rule.type)))
    prerequisites.push(
      "Validate selected source content and branch metadata against source-branch rules.",
    );
  if (
    sourceProtection?.required_status_checks ||
    sourceRules.some((rule) => checkRules.has(rule.type))
  )
    prerequisites.push(
      "Satisfy source-branch checks before pushing; target PR checks do not satisfy source publication requirements.",
    );
  if (
    sourceProtection?.required_signatures?.enabled ||
    sourceRules.some((rule) => rule.type === "required_signatures")
  )
    prerequisites.push(
      "Verify source-branch signing requirements for all introduced commits.",
    );
  let methods = new Set(
    ["merge", "squash", "rebase"].filter(
      (method) =>
        repository[
          `allow_${method === "merge" ? "merge_commit" : `${method}_merge`}`
        ] === true,
    ),
  );
  if (
    ["allow_merge_commit", "allow_squash_merge", "allow_rebase_merge"].some(
      (key) => typeof repository[key] !== "boolean",
    )
  )
    return stop("unknown", "Repository merge-method settings are incomplete.");
  for (const rule of targetRules.filter(
    (entry) => entry.type === "pull_request",
  )) {
    const allowed = rule.parameters?.allowed_merge_methods;
    if (allowed !== undefined) {
      if (
        !Array.isArray(allowed) ||
        allowed.some(
          (method) => !["merge", "squash", "rebase"].includes(method),
        )
      )
        return stop("unknown", "Unsupported allowed merge methods.");
      methods = new Set(
        [...methods].filter((method) => allowed.includes(method)),
      );
    }
  }
  if (
    protection?.required_linear_history?.enabled ||
    targetRules.some((rule) => rule.type === "required_linear_history")
  )
    methods.delete("merge");
  if (queues.length) {
    const queueMethods = queues.map((rule) =>
      rule.parameters?.merge_method?.toLowerCase(),
    );
    if (
      queueMethods.some(
        (method) => !["merge", "squash", "rebase"].includes(method),
      ) ||
      new Set(queueMethods).size !== 1
    )
      return stop(
        "unknown",
        "The required merge queue method is unavailable or conflicting.",
      );
    methods = new Set(
      [...methods].filter((method) => method === queueMethods[0]),
    );
    prerequisites.push(
      "Enter the required merge queue and observe actual integration, not just admission.",
    );
  }
  // Rebase recreates commits without preserving their signatures. It is never an implicit fallback.
  methods.delete("rebase");
  if (requirePersonalSignature) methods.delete("squash");
  const method = methods.has("merge")
    ? "merge"
    : methods.has("squash")
      ? "squash"
      : null;
  if (!method)
    return stop(
      "blocked",
      "No allowed merge method meets the accepted signature policy; rebase is not an automatic fallback.",
    );
  prerequisites.push(
    "Confirm token authority to create and merge the PR; satisfy required reviews, checks and conversation resolution on the reviewed head.",
  );
  reasons.push(
    needsReview
      ? "Target policy requires a pull request."
      : "Use a pull request to satisfy target integration prerequisites.",
  );
  return {
    status: "viable-with-prerequisites",
    route: `${queues.length ? "merge-queue" : "pull-request"}-${method}`,
    reasons,
    prerequisites,
    signatureEffect:
      method === "merge"
        ? "Original signed commits remain ancestors; verify the separate integration commit and its signer."
        : "Squash creates a new commit and SHA signed by GitHub; source signatures do not transfer. Disclose this before approval.",
  };
}
