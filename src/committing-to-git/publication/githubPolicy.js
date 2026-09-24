import { spawnSync } from "node:child_process";
import { selectPublicationRoute } from "./publicationPolicy.js";

/** Bounded GETs and one fixed GraphQL query; no credentials or provider text enter a shell. */
export function githubApi(endpoint, fields = {}) {
  const args = [
    "api",
    "--hostname",
    "github.com",
    "--method",
    endpoint === "graphql" ? "POST" : "GET",
    endpoint,
  ];
  for (const [key, value] of Object.entries(fields))
    args.push("-f", `${key}=${value}`);
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat" },
  });
  if (result.error || result.status !== 0) {
    // Never echo raw provider output: it may include credential-bearing URLs or untrusted prose.
    throw new Error(
      `GitHub policy query failed (${result.error?.code ?? `exit ${result.status}`}) at ${endpoint.split("?")[0]}.`,
    );
  }
  const body = JSON.parse(result.stdout);
  if (body?.errors)
    throw new Error("GitHub returned incomplete GraphQL policy observations.");
  return body;
}

function pages(api, endpoint) {
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = api(
      `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch))
      throw new Error("Expected a complete policy array.");
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error("Policy pagination exceeded the bounded discovery limit.");
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
  try {
    const prefix = `repos/${owner}/${repository}`;
    const actor = api("user").login;
    const metadata = api(prefix);
    if (
      typeof actor !== "string" ||
      typeof metadata.default_branch !== "string"
    )
      throw new Error("Provider identity or default branch is unavailable.");
    const branch = destination
      ? destination.slice("refs/heads/".length)
      : metadata.default_branch;
    const encoded = encodeURIComponent(branch);
    const target = api(`${prefix}/branches/${encoded}`);
    if (
      typeof target.protected !== "boolean" ||
      !/^[a-f0-9]{40,64}$/u.test(target.commit?.sha ?? "")
    )
      throw new Error("Target branch observation is incomplete.");
    const targetRules = pages(api, `${prefix}/rules/branches/${encoded}`);
    const classic = api("graphql", {
      query:
        "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){branchProtectionRules(first:100){nodes{pattern} pageInfo{hasNextPage}}}}",
      owner,
      name: repository,
    }).data?.repository?.branchProtectionRules;
    if (
      !Array.isArray(classic?.nodes) ||
      classic.pageInfo?.hasNextPage !== false ||
      classic.nodes.some((node) => typeof node.pattern !== "string")
    )
      throw new Error("Classic protection inventory is incomplete.");
    const matches = (name) =>
      classic.nodes.filter(
        ({ pattern }) => pattern === name || /[*?[\\]/u.test(pattern),
      );
    const protection =
      target.protected && matches(branch).length
        ? api(`${prefix}/branches/${encoded}/protection`)
        : null;
    if (
      target.protected &&
      matches(branch).length &&
      (!protection ||
        typeof protection !== "object" ||
        Array.isArray(protection))
    )
      throw new Error("Classic protection body is incomplete.");
    if (target.protected && !protection && targetRules.length === 0)
      throw new Error("Protected branch has no readable effective policy.");
    const summaries = pages(api, `${prefix}/rulesets?includes_parents=true`);
    const pushRules = [];
    for (const summary of summaries) {
      if (summary.enforcement !== "active" || summary.target !== "push")
        continue;
      if (!Number.isSafeInteger(summary.id))
        throw new Error("Invalid push ruleset identity.");
      const detail = api(`${prefix}/rulesets/${summary.id}`);
      if (
        detail.enforcement !== "active" ||
        detail.target !== "push" ||
        !Array.isArray(detail.rules)
      )
        throw new Error(
          "Push ruleset changed during observation; repeat discovery.",
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
    };
    const targetRoute = selectPublicationRoute(policy);
    if (targetRoute.route !== "direct" && sourceBranch) {
      policy.sourceRules = pages(
        api,
        `${prefix}/rules/branches/${encodeURIComponent(sourceBranch)}`,
      );
      if (matches(sourceBranch).length) {
        // An absent branch has no effective classic REST endpoint. Do not approximate GitHub fnmatch.
        policy.sourceProtection = api(
          `${prefix}/branches/${encodeURIComponent(sourceBranch)}/protection`,
        );
        if (
          !policy.sourceProtection ||
          typeof policy.sourceProtection !== "object" ||
          Array.isArray(policy.sourceProtection)
        )
          throw new Error("Source classic protection body is incomplete.");
      }
    }
    return {
      ...selectPublicationRoute(policy),
      provider: "github",
      repository: `${owner}/${repository}`,
      actor,
      destination: `refs/heads/${branch}`,
      targetOid: target.commit.sha,
      observedAt,
      policy,
    };
  } catch (error) {
    return {
      status: "unknown",
      route: null,
      reasons: [error.message],
      prerequisites: [],
      observedAt,
    };
  }
}
