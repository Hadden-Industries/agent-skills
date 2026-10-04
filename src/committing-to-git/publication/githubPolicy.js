import { spawnSync } from "node:child_process";
import {
  selectPublicationRoute,
  isSupportedPublicationRule,
} from "./publicationPolicy.js";
import { commandFailure } from "./publicationCommands.js";
import {
  GitHubProbeError,
  incompleteProbe,
  parseGitHubResponse,
} from "./githubProbe.js";

/** Bounded GETs and one fixed GraphQL query; no credentials or provider text enter a shell. */
export function githubApi(endpoint, fields = {}, runCommand = spawnSync) {
  const args = [
    "api",
    "--include",
    "--hostname",
    "github.com",
    "--method",
    endpoint === "graphql" ? "POST" : "GET",
    endpoint,
  ];
  for (const [key, value] of Object.entries(fields))
    args.push("-f", `${key}=${value}`);
  const result = runCommand("gh", args, {
    operation: "github-policy-observation",
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
  });
  return parseGitHubResponse(result, endpoint);
}

function pages(api, endpoint) {
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    let batch;
    try {
      batch = api(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
    } catch (error) {
      if (
        page > 1 &&
        error instanceof GitHubProbeError &&
        error.outcome.classification === "not-available"
      )
        throw incompleteProbe(
          "Feature availability changed during pagination.",
          "GITHUB_PAGINATION_INCOMPLETE",
        );
      throw error;
    }
    if (!Array.isArray(batch) || batch.length > 100)
      throw incompleteProbe("Expected a complete policy array.");
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw incompleteProbe(
    "Policy pagination exceeded the bounded discovery limit.",
    "GITHUB_PAGINATION_INCOMPLETE",
  );
}

/** Collect classic, inherited branch and push policy before selecting a route. */
export function inspectGitHubPolicy({
  owner,
  repository,
  destination,
  sourceBranch,
  requirePersonalSignature = false,
  api = githubApi,
}) {
  const observedAt = new Date().toISOString();
  const probes = [];
  let activeProbe = null;
  const probe = (
    name,
    read,
    validate = () => true,
    unavailable = undefined,
  ) => {
    activeProbe = name;
    try {
      const value = read();
      if (!validate(value))
        throw incompleteProbe(
          "Required fields or supported policy semantics are missing.",
        );
      probes.push({
        probe: name,
        classification: "observed",
        code: "GITHUB_PROBE_OBSERVED",
        reason: "Complete provider observation.",
        resolution:
          "Use this observation within its task and freshness limits.",
        httpStatus: null,
      });
      return value;
    } catch (error) {
      const failure = commandFailure(error);
      const outcome =
        error instanceof GitHubProbeError
          ? error.outcome
          : {
              classification: "inaccessible",
              code: failure?.code ?? "GITHUB_OBSERVATION_UNRESOLVED",
              reason:
                "The observation could not establish its required evidence.",
              resolution:
                "Resolve the named probe's native command or access prerequisite, then repeat workflow preflight.",
              httpStatus: null,
            };
      probes.push({ probe: name, ...outcome });
      if (
        outcome.classification === "not-available" &&
        unavailable !== undefined
      )
        return unavailable;
      throw error;
    }
  };
  const object = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const rules = (value) =>
    Array.isArray(value) &&
    value.every((rule) => {
      if (!isSupportedPublicationRule(rule)) return false;
      if (rule.parameters !== undefined && !object(rule.parameters))
        return false;
      const methods = rule.parameters?.allowed_merge_methods;
      if (
        rule.type === "pull_request" &&
        methods !== undefined &&
        (!Array.isArray(methods) ||
          methods.some(
            (method) => !["merge", "squash", "rebase"].includes(method),
          ))
      )
        return false;
      if (
        rule.type === "merge_queue" &&
        (typeof rule.parameters?.merge_method !== "string" ||
          !["MERGE", "SQUASH", "REBASE"].includes(
            rule.parameters.merge_method.toUpperCase(),
          ))
      )
        return false;
      return true;
    });
  const protectionFields = [
    "required_status_checks",
    "required_pull_request_reviews",
    "restrictions",
    "lock_branch",
    "required_signatures",
    "required_conversation_resolution",
    "required_linear_history",
    "allow_force_pushes",
    "enforce_admins",
  ];
  const protectionBody = (value) =>
    object(value) &&
    protectionFields.some((key) => Object.hasOwn(value, key)) &&
    protectionFields.every(
      (key) =>
        value[key] === null ||
        value[key] === undefined ||
        (object(value[key]) &&
          (value[key].enabled === undefined ||
            typeof value[key].enabled === "boolean")),
    );
  try {
    const prefix = `repos/${owner}/${repository}`;
    const actor = probe(
      "api-actor",
      () => api("user"),
      (value) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/u.test(value?.login ?? ""),
    ).login;
    const metadata = probe(
      "repository",
      () => api(prefix),
      (value) =>
        object(value) &&
        typeof value.default_branch === "string" &&
        value.default_branch.length > 0 &&
        typeof value.archived === "boolean" &&
        typeof value.disabled === "boolean",
    );
    probe(
      "repository-merge-methods",
      () => metadata,
      (value) =>
        [
          "allow_merge_commit",
          "allow_squash_merge",
          "allow_rebase_merge",
        ].every((key) => typeof value[key] === "boolean"),
    );
    // These permissions belong to the API account, not the Git transport actor.
    probes.push({
      probe: "api-permissions",
      classification:
        typeof metadata.permissions?.push === "boolean"
          ? "observed"
          : "incomplete",
      code:
        typeof metadata.permissions?.push === "boolean"
          ? "GITHUB_PROBE_OBSERVED"
          : "GITHUB_API_PERMISSIONS_UNAVAILABLE",
      reason:
        "API account permissions do not establish Git transport write permission.",
      resolution:
        "Establish API mutation authority before PR creation or merge; retain separate Git transport evidence.",
      httpStatus: null,
      required: false,
    });
    const branch = destination
      ? destination.slice("refs/heads/".length)
      : metadata.default_branch;
    const encoded = encodeURIComponent(branch);
    const target = probe(
      "target-branch",
      () => api(`${prefix}/branches/${encoded}`),
      (value) =>
        typeof value?.protected === "boolean" &&
        /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value.commit?.sha ?? ""),
    );
    const targetRules = probe(
      "target-rules",
      () => pages(api, `${prefix}/rules/branches/${encoded}`),
      rules,
      [],
    );
    const classic = probe(
      "classic-protection-inventory",
      () =>
        api("graphql", {
          query:
            "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){branchProtectionRules(first:100){nodes{pattern} pageInfo{hasNextPage}}}}",
          owner,
          name: repository,
        }).data?.repository?.branchProtectionRules,
      (value) =>
        Array.isArray(value?.nodes) &&
        value.pageInfo?.hasNextPage === false &&
        value.nodes.every((node) => typeof node?.pattern === "string"),
    );
    const matches = (name) =>
      classic.nodes.filter(
        ({ pattern }) => pattern === name || /[*?[\\]/u.test(pattern),
      );
    const protection =
      target.protected && matches(branch).length
        ? probe(
            "target-classic-protection",
            () => api(`${prefix}/branches/${encoded}/protection`),
            protectionBody,
          )
        : null;
    if (target.protected && !protection && targetRules.length === 0)
      probe("effective-target-policy", () => {
        throw incompleteProbe(
          "Protected branch has no readable effective policy.",
        );
      });
    const summaries = probe(
      "push-ruleset-inventory",
      () => pages(api, `${prefix}/rulesets?includes_parents=true`),
      (value) =>
        Array.isArray(value) &&
        value.every(
          (summary) =>
            object(summary) &&
            ["active", "evaluate", "disabled"].includes(summary.enforcement) &&
            ["push", "branch", "tag"].includes(summary.target) &&
            Number.isSafeInteger(summary.id) &&
            summary.id > 0,
        ),
      [],
    );
    if (
      probes.some((entry) => entry.classification === "not-available") &&
      (targetRules.length > 0 || summaries.length > 0)
    )
      probe("ruleset-consistency", () => {
        throw incompleteProbe(
          "Ruleset feature absence conflicts with observed rulesets; repeat discovery.",
        );
      });
    const pushRules = [];
    for (const summary of summaries) {
      if (summary.enforcement !== "active" || summary.target !== "push")
        continue;
      const detail = probe(
        `push-ruleset-${summary.id}`,
        () => api(`${prefix}/rulesets/${summary.id}`),
        (value) =>
          value?.enforcement === "active" &&
          value.target === "push" &&
          rules(value.rules),
      );
      pushRules.push(...detail.rules);
    }
    const policy = {
      repository: {
        archived: metadata.archived,
        disabled: metadata.disabled,
        permissions: metadata.permissions,
        allow_merge_commit: metadata.allow_merge_commit,
        allow_squash_merge: metadata.allow_squash_merge,
        allow_rebase_merge: metadata.allow_rebase_merge,
      },
      protection,
      sourceProtection: null,
      targetRules,
      sourceRules: [],
      pushRules,
      sourceBranch,
      requirePersonalSignature,
      permissionBasis: "transport-not-observed",
    };
    const targetRoute = selectPublicationRoute(policy);
    if (targetRoute.route !== "direct" && sourceBranch) {
      policy.sourceRules = probe(
        "source-rules",
        () =>
          pages(
            api,
            `${prefix}/rules/branches/${encodeURIComponent(sourceBranch)}`,
          ),
        rules,
        [],
      );
      if (matches(sourceBranch).length) {
        // An absent branch has no effective classic REST endpoint. Do not approximate GitHub fnmatch.
        policy.sourceProtection = probe(
          "source-classic-protection",
          () =>
            api(
              `${prefix}/branches/${encodeURIComponent(sourceBranch)}/protection`,
            ),
          protectionBody,
        );
      }
    }
    // Source discovery can expose contradictory feature availability too. Check
    // after all policy observations so no later rule can escape this invariant.
    if (
      probes.some((entry) => entry.classification === "not-available") &&
      (policy.targetRules.length > 0 ||
        policy.sourceRules.length > 0 ||
        summaries.length > 0)
    )
      probe("ruleset-consistency", () => {
        throw incompleteProbe(
          "Ruleset feature absence conflicts with observed rulesets; repeat discovery.",
        );
      });
    const selection = selectPublicationRoute(policy);
    if (selection.status === "unknown")
      probes.push({
        probe: "policy-evaluation",
        classification: "incomplete",
        code: "GITHUB_POLICY_SEMANTICS_INCOMPLETE",
        reason: selection.reasons.join(" "),
        resolution:
          "Resolve the named policy semantics and repeat workflow preflight.",
        httpStatus: null,
      });
    return {
      ...selection,
      probes,
      provider: "github",
      repository: `${owner}/${repository}`,
      actor,
      destination: `refs/heads/${branch}`,
      targetOid: target.commit.sha,
      observedAt,
      policy,
      permissionBasis: policy.permissionBasis,
    };
  } catch (error) {
    const failure = commandFailure(error);
    return {
      status: "unknown",
      route: null,
      reasons: [
        failure
          ? "The provider observation command was unavailable; no publication was attempted."
          : `${activeProbe}: ${probes.at(-1)?.code ?? "GITHUB_OBSERVATION_UNRESOLVED"}. ${probes.at(-1)?.reason ?? "Policy evidence is unresolved."}`,
      ],
      ...(failure
        ? {
            commandFailure: failure,
            nextAction: "resolve-command-prerequisite",
          }
        : {}),
      prerequisites: [],
      probes,
      observedAt,
    };
  }
}
