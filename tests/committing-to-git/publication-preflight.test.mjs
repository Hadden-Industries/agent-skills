import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { selectPublicationRoute } from "../../src/committing-to-git/publication/publicationPolicy.js";
import {
  githubApi,
  inspectGitHubPolicy,
} from "../../src/committing-to-git/publication/githubPolicy.js";
import {
  githubRemoteIdentity,
  inspectPublicationFeasibility as inspectNativePublicationFeasibility,
} from "../../src/committing-to-git/publication/publicationPreflight.js";
import { createRepositoryFixture, git } from "./harness.mjs";

// Exercise the real repository observations independently of workstation guard
// policy. The operation-marker command is represented by its documented native
// output; it is never executed here (the installed strict pack denies it).
function fixtureCommand(executable, args, options) {
  if (options.operation === "git-operation-markers") {
    const paths = [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "rebase-merge",
      "rebase-apply",
      "sequencer",
    ];
    return {
      status: 0,
      stdout: paths.map((path) => join(options.cwd, ".git", path)).join("\n"),
    };
  }
  return spawnSync(executable, args, options);
}
function inspectPublicationFeasibility(options) {
  return inspectNativePublicationFeasibility({
    runCommand: fixtureCommand,
    ...options,
  });
}

const cli = fileURLToPath(
  new URL("../../src/committing-to-git/cli/commitWorkflow.js", import.meta.url),
);

test("publication preflight is a discoverable transaction-free read-only command", () => {
  const help = spawnSync(process.execPath, [cli, "--help"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /workflow preflight/);
  const result = spawnSync(
    process.execPath,
    [cli, "workflow", "preflight", "--help"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /read-only/);
  assert.match(result.stdout, /--remote/);
  assert.doesNotMatch(result.stdout, /--transaction/);
});

test("local guards stop before provider access when publication is not ready", (t) => {
  for (const scenario of [
    "operation",
    "multiple-remotes",
    "missing-trust",
    "missing-key",
  ]) {
    const fixture = createRepositoryFixture(t);
    git(
      ["remote", "add", "origin", "https://github.com/owner/project.git"],
      fixture.repo,
    );
    git(["config", "gpg.format", "openpgp"], fixture.repo);
    if (scenario === "operation")
      writeFileSync(
        join(fixture.repo, ".git", "MERGE_HEAD"),
        "a".repeat(40) + "\n",
      );
    if (scenario === "multiple-remotes") {
      git(
        [
          "config",
          "--add",
          "remote.origin.pushurl",
          "https://github.com/owner/project.git",
        ],
        fixture.repo,
      );
      git(
        [
          "config",
          "--add",
          "remote.origin.pushurl",
          "https://github.com/owner/other.git",
        ],
        fixture.repo,
      );
    }
    if (scenario === "missing-trust" || scenario === "missing-key") {
      git(["config", "gpg.format", "ssh"], fixture.repo);
      const trust = join(fixture.repo, "allowed-signers");
      git(["config", "gpg.ssh.allowedSignersFile", trust], fixture.repo);
      if (scenario === "missing-key") {
        writeFileSync(trust, "");
        git(["config", "user.signingkey", ""], fixture.repo);
        git(["config", "gpg.ssh.defaultKeyCommand", ""], fixture.repo);
      }
    }
    let calls = 0;
    const result = inspectPublicationFeasibility({
      cwd: fixture.repo,
      remote: "origin",
      api: () => {
        calls++;
        throw new Error("Unexpected provider access");
      },
    });
    assert.equal(calls, 0, scenario);
    assert.equal(result.route, null, scenario);
    assert.equal(
      result.status,
      scenario === "multiple-remotes" ? "unknown" : "blocked",
      JSON.stringify(result),
    );
    assert.match(
      result.summary,
      {
        operation: /existing Git operation/,
        "multiple-remotes": /Multiple push URLs/,
        "missing-trust": /allowed-signers/,
        "missing-key": /neither a configured signing key/,
      }[scenario],
    );
  }
});

test("a PR source cannot be the protected destination", (t) => {
  const fixture = createRepositoryFixture(t);
  git(["config", "gpg.format", "openpgp"], fixture.repo);
  git(
    ["remote", "add", "origin", "https://github.com/owner/project.git"],
    fixture.repo,
  );
  const result = inspectPublicationFeasibility({
    cwd: fixture.repo,
    remote: "origin",
    sourceBranch: "main",
    api: apiFixture(),
  });
  assert.equal(result.status, "blocked");
  assert.match(result.summary, /source branch must differ/);
});

function policy(overrides = {}) {
  return {
    repository: {
      archived: false,
      disabled: false,
      permissions: { push: true },
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: true,
    },
    protection: null,
    targetRules: [],
    sourceRules: [],
    pushRules: [],
    sourceBranch: "delivery/change",
    ...overrides,
  };
}

test("direct publication wins only when no active policy requires a PR or checks", () => {
  assert.equal(selectPublicationRoute(policy()).route, "direct");
  const result = selectPublicationRoute(
    policy({
      protection: {
        required_pull_request_reviews: { required_approving_review_count: 1 },
      },
    }),
  );
  assert.equal(result.route, "pull-request-merge");
  assert.equal(result.status, "viable-with-prerequisites");
});

test("layered linear history selects disclosed squash without treating admin as bypass", () => {
  const result = selectPublicationRoute(
    policy({
      repository: {
        ...policy().repository,
        permissions: { push: true, admin: true },
      },
      targetRules: [
        {
          type: "pull_request",
          parameters: { allowed_merge_methods: ["merge", "squash"] },
        },
        { type: "required_linear_history" },
      ],
    }),
  );
  assert.equal(result.route, "pull-request-squash");
  assert.match(result.signatureEffect, /new commit/);
});

test("signature preservation blocks squash-only and rebase-only delivery", () => {
  for (const methods of [["squash"], ["rebase"]]) {
    const result = selectPublicationRoute(
      policy({
        requirePersonalSignature: true,
        targetRules: [
          {
            type: "pull_request",
            parameters: { allowed_merge_methods: methods },
          },
        ],
      }),
    );
    assert.equal(result.status, "blocked");
    assert.equal(result.route, null);
  }
});

test("unknown rule semantics cannot silently authorize publication", () => {
  const result = selectPublicationRoute(
    policy({ targetRules: [{ type: "future_security_rule" }] }),
  );
  assert.equal(result.status, "unknown");
  assert.equal(result.route, null);
});

test("queue method overrides preference but never personal-signature constraints", () => {
  const queued = policy({
    targetRules: [
      { type: "merge_queue", parameters: { merge_method: "SQUASH" } },
    ],
  });
  assert.equal(selectPublicationRoute(queued).route, "merge-queue-squash");
  assert.equal(
    selectPublicationRoute({ ...queued, requirePersonalSignature: true })
      .status,
    "blocked",
  );
});

test("restricted source branch and inaccessible permissions are not viable routes", () => {
  const required = [{ type: "pull_request" }];
  assert.equal(
    selectPublicationRoute(
      policy({ targetRules: required, sourceRules: [{ type: "creation" }] }),
    ).status,
    "blocked",
  );
  assert.equal(
    selectPublicationRoute(
      policy({
        repository: { ...policy().repository, permissions: undefined },
      }),
    ).status,
    "unknown",
  );
});

test("content restrictions remain prerequisites until the exact selected payload is inspected", () => {
  const result = selectPublicationRoute(
    policy({
      pushRules: [
        {
          type: "file_path_restriction",
          parameters: { restricted_file_paths: ["secrets/**"] },
        },
      ],
    }),
  );
  assert.equal(result.status, "viable-with-prerequisites");
  assert.match(result.prerequisites.join(" "), /selected.*content/);
});

function apiFixture(overrides = {}) {
  const responses = {
    user: { login: "owner" },
    "repos/owner/project": {
      ...policy().repository,
      default_branch: "main",
      full_name: "owner/project",
    },
    "repos/owner/project/branches/main": {
      name: "main",
      protected: true,
      commit: { sha: "a".repeat(40) },
    },
    "repos/owner/project/rules/branches/main?per_page=100&page=1": [],
    "repos/owner/project/rules/branches/delivery%2Fchange?per_page=100&page=1":
      [],
    "repos/owner/project/rulesets?includes_parents=true&per_page=100&page=1":
      [],
    graphql: {
      data: {
        repository: {
          branchProtectionRules: {
            nodes: [{ pattern: "main" }],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    },
    "repos/owner/project/branches/main/protection": {
      required_pull_request_reviews: { required_approving_review_count: 0 },
    },
    ...overrides,
  };
  return (endpoint) => {
    assert.ok(
      Object.hasOwn(responses, endpoint),
      `Unexpected API read: ${endpoint}`,
    );
    if (responses[endpoint] instanceof Error) throw responses[endpoint];
    return responses[endpoint];
  };
}

// Native gh responses are the external boundary; the collector and route stay real.
function planUnavailable(endpoint) {
  try {
    githubApi(endpoint, {}, () => ({
      status: 1,
      stdout: `HTTP/2.0 403 Forbidden\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(
        {
          message:
            "Upgrade to GitHub Pro or make this repository public to enable this feature.",
          documentation_url:
            "https://docs.github.com/rest/repos/rules#get-rules-for-a-branch",
          status: "403",
        },
      )}`,
      stderr: "gh: Upgrade to GitHub Pro (HTTP 403)",
    }));
  } catch (error) {
    return error;
  }
  assert.fail("The native response must carry its classified outcome");
}

test("plan-gated rules are definitive evidence for an unprotected direct route", () => {
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    api: apiFixture({
      "repos/owner/project/branches/main": {
        protected: false,
        commit: { sha: "a".repeat(40) },
      },
      "repos/owner/project/rules/branches/main?per_page=100&page=1":
        planUnavailable("repos/owner/project/rules/branches/main"),
      graphql: {
        data: {
          repository: {
            branchProtectionRules: {
              nodes: [],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      },
    }),
  });
  assert.equal(result.status, "viable", JSON.stringify(result));
  assert.equal(result.route, "direct");
  assert.equal(
    result.probes.find(({ probe }) => probe === "target-rules").classification,
    "not-available",
  );
  assert.equal(
    result.probes.find(({ probe }) => probe === "target-rules").code,
    "GITHUB_FEATURE_NOT_AVAILABLE",
  );
});

function nativeError(
  endpoint,
  {
    status = 403,
    body = { message: "Resource not accessible by integration" },
    headers = "",
    error,
    exitCode,
  } = {},
) {
  try {
    githubApi(endpoint, {}, () => ({
      status: exitCode ?? (error ? null : status >= 400 ? 1 : 0),
      error,
      stdout: `HTTP/2.0 ${status} Response\r\nContent-Type: application/json\r\n${headers}\r\n${typeof body === "string" ? body : JSON.stringify(body)}`,
      stderr: "secret-provider-output https://token@provider.invalid/",
    }));
  } catch (caught) {
    return caught;
  }
  assert.fail("Expected an unresolved native observation");
}

// Each issued endpoint is tested through native classification and real routing.
// Source and push fixtures establish that the collector actually reaches those probes.
const probeEndpoints = [
  ["api-actor", "user"],
  ["repository", "repos/owner/project"],
  ["target-branch", "repos/owner/project/branches/main"],
  [
    "target-rules",
    "repos/owner/project/rules/branches/main?per_page=100&page=1",
  ],
  ["classic-protection-inventory", "graphql"],
  ["target-classic-protection", "repos/owner/project/branches/main/protection"],
  [
    "push-ruleset-inventory",
    "repos/owner/project/rulesets?includes_parents=true&per_page=100&page=1",
  ],
  ["push-ruleset-7", "repos/owner/project/rulesets/7"],
  [
    "source-rules",
    "repos/owner/project/rules/branches/delivery%2Fchange?per_page=100&page=1",
  ],
  [
    "source-classic-protection",
    "repos/owner/project/branches/delivery%2Fchange/protection",
  ],
];

for (const [probeName, endpoint] of probeEndpoints) {
  for (const [scenario, response, classification, code] of [
    ["permission denial", {}, "inaccessible", "GITHUB_POLICY_FORBIDDEN"],
    [
      "ambiguous 404",
      { status: 404 },
      "inaccessible",
      "GITHUB_POLICY_NOT_FOUND_OR_HIDDEN",
    ],
    [
      "authentication",
      { status: 401 },
      "inaccessible",
      "GITHUB_AUTHENTICATION_REQUIRED",
    ],
    [
      "SSO enforcement",
      {
        headers:
          "X-GitHub-SSO: required; url=https://github.com/orgs/owner/sso\r\n",
      },
      "inaccessible",
      "GITHUB_POLICY_FORBIDDEN",
    ],
    [
      "rate limit",
      { headers: "X-RateLimit-Remaining: 0\r\n" },
      "transient",
      "GITHUB_RATE_LIMITED",
    ],
    [
      "secondary rate limit",
      { status: 429 },
      "transient",
      "GITHUB_RATE_LIMITED",
    ],
    [
      "service failure",
      { status: 503, body: "not JSON" },
      "transient",
      "GITHUB_SERVICE_UNAVAILABLE",
    ],
    [
      "timeout",
      { error: { code: "ETIMEDOUT" } },
      "transient",
      "GITHUB_NETWORK_FAILURE",
    ],
    [
      "malformed JSON",
      { status: 200, body: "{" },
      "incomplete",
      "GITHUB_RESPONSE_INCOMPLETE",
    ],
    [
      "bounded output",
      { error: { code: "ENOBUFS" } },
      "incomplete",
      "GITHUB_RESPONSE_LIMIT",
    ],
  ]) {
    test(`${probeName} classifies ${scenario} without clearing unreadable policy`, () => {
      const result = inspectGitHubPolicy({
        owner: "owner",
        repository: "project",
        sourceBranch: "delivery/change",
        api: apiFixture({
          graphql: {
            data: {
              repository: {
                branchProtectionRules: {
                  nodes: [{ pattern: "main" }, { pattern: "delivery/change" }],
                  pageInfo: { hasNextPage: false },
                },
              },
            },
          },
          "repos/owner/project/rulesets?includes_parents=true&per_page=100&page=1":
            [{ id: 7, target: "push", enforcement: "active" }],
          "repos/owner/project/rulesets/7": {
            target: "push",
            enforcement: "active",
            rules: [],
          },
          "repos/owner/project/branches/delivery%2Fchange/protection": {
            allow_force_pushes: { enabled: false },
          },
          [endpoint]: nativeError(endpoint, response),
        }),
      });
      assert.equal(result.status, "unknown");
      assert.equal(result.route, null);
      const outcome = result.probes.find(({ probe }) => probe === probeName);
      assert.ok(outcome, JSON.stringify(result));
      assert.equal(outcome.classification, classification);
      assert.equal(outcome.code, code);
      assert.ok(outcome.resolution);
      assert.doesNotMatch(
        JSON.stringify(result),
        /secret-provider-output|token@|query failed/,
      );
    });
  }
}

test("plan absence is bound to its exact endpoint, status, message and documentation", () => {
  const plan = {
    message:
      "Upgrade to GitHub Pro or make this repository public to enable this feature.",
    documentation_url:
      "https://docs.github.com/rest/repos/rules#get-rules-for-a-branch",
  };
  for (const [endpoint, response, expected] of [
    [
      "repos/owner/project/rules/branches/main",
      { body: plan },
      "not-available",
    ],
    ["repos/owner/project/rulesets", { body: plan }, "not-available"],
    [
      "repos/owner/project/rules/branches/main",
      { status: 404, body: plan },
      "inaccessible",
    ],
    [
      "repos/owner/project/rules/branches/main",
      { body: { ...plan, message: "Upgrade required" } },
      "inaccessible",
    ],
    [
      "repos/owner/project/rules/branches/main",
      {
        body: {
          ...plan,
          documentation_url: "https://evil.invalid/rest/repos/rules",
        },
      },
      "inaccessible",
    ],
    [
      "repos/owner/project/rules/branches/main",
      { body: plan, headers: "Retry-After: 60\r\n" },
      "transient",
    ],
    [
      "repos/owner/project/branches/main/protection",
      { body: plan },
      "inaccessible",
    ],
    ["repos/owner/project/rulesets/7", { body: plan }, "inaccessible"],
    ["user", { body: plan }, "inaccessible"],
  ])
    assert.equal(
      nativeError(endpoint, response).outcome.classification,
      expected,
    );
});

test("malformed bodies and unrecognized rules name the exact incomplete probe", () => {
  for (const [probeName, endpoint, body] of [
    ["api-actor", "user", { login: null }],
    ["repository", "repos/owner/project", {}],
    [
      "repository-merge-methods",
      "repos/owner/project",
      {
        ...policy().repository,
        default_branch: "main",
        allow_merge_commit: "yes",
      },
    ],
    [
      "target-branch",
      "repos/owner/project/branches/main",
      { protected: true, commit: { sha: "a".repeat(41) } },
    ],
    [
      "target-rules",
      "repos/owner/project/rules/branches/main?per_page=100&page=1",
      [{ type: "future_rule" }],
    ],
    [
      "target-rules",
      "repos/owner/project/rules/branches/main?per_page=100&page=1",
      [
        {
          type: "pull_request",
          parameters: { allowed_merge_methods: ["future_method"] },
        },
      ],
    ],
    [
      "classic-protection-inventory",
      "graphql",
      {
        data: {
          repository: {
            branchProtectionRules: {
              nodes: [],
              pageInfo: { hasNextPage: true },
            },
          },
        },
      },
    ],
    [
      "target-classic-protection",
      "repos/owner/project/branches/main/protection",
      {},
    ],
    [
      "push-ruleset-inventory",
      "repos/owner/project/rulesets?includes_parents=true&per_page=100&page=1",
      [{ id: 7, enforcement: "future", target: "push" }],
    ],
  ]) {
    const result = inspectGitHubPolicy({
      owner: "owner",
      repository: "project",
      api: apiFixture({ [endpoint]: body }),
    });
    assert.equal(result.status, "unknown", probeName);
    assert.equal(result.probes.at(-1).probe, probeName);
    assert.equal(result.probes.at(-1).classification, "incomplete");
  }
});

test("truncated pagination and changing feature availability cannot erase earlier rules", () => {
  const endpoint = "repos/owner/project/rules/branches/main";
  for (const changed of [false, true]) {
    const result = inspectGitHubPolicy({
      owner: "owner",
      repository: "project",
      api: (path) => {
        if (path.startsWith(endpoint)) {
          if (changed && path.endsWith("page=2"))
            throw planUnavailable(endpoint);
          return Array.from({ length: 100 }, () => ({
            type: "non_fast_forward",
          }));
        }
        return apiFixture()(path);
      },
    });
    assert.equal(result.status, "unknown");
    assert.equal(result.probes.at(-1).probe, "target-rules");
    assert.equal(result.probes.at(-1).code, "GITHUB_PAGINATION_INCOMPLETE");
  }
});

test("GraphQL partial results retain access and transient classifications", () => {
  for (const [type, expected] of [
    ["FORBIDDEN", "inaccessible"],
    ["NOT_FOUND", "inaccessible"],
    ["RATE_LIMITED", "transient"],
    ["UNKNOWN", "incomplete"],
  ]) {
    const error = nativeError("graphql", {
      status: 200,
      exitCode: 1,
      body: {
        data: { repository: {} },
        errors: [{ type, message: "secret-provider-output" }],
      },
    });
    assert.equal(error.outcome.classification, expected);
    assert.doesNotMatch(
      JSON.stringify(error.outcome),
      /secret-provider-output/,
    );
  }
});

test("gh authentication-required exit names access resolution without a provider response", () => {
  let response;
  try {
    githubApi("user", {}, () => ({
      status: 4,
      stdout: "",
      stderr: "secret-provider-output",
    }));
  } catch (error) {
    response = error;
  }
  assert.equal(response?.outcome?.classification, "inaccessible");
  assert.equal(response.outcome.code, "GITHUB_AUTHENTICATION_REQUIRED");
});

test("source rules cannot contradict a target ruleset plan-absence observation", () => {
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    sourceBranch: "delivery/change",
    api: apiFixture({
      "repos/owner/project/rules/branches/main?per_page=100&page=1":
        planUnavailable("repos/owner/project/rules/branches/main"),
      "repos/owner/project/rules/branches/delivery%2Fchange?per_page=100&page=1":
        [{ type: "required_signatures" }],
    }),
  });
  assert.equal(result.status, "unknown", JSON.stringify(result));
  assert.equal(result.probes.at(-1).probe, "ruleset-consistency");
  assert.equal(result.probes.at(-1).classification, "incomplete");
});

test("native successful responses with empty headers and CLI failures stay bounded", () => {
  for (const newline of ["\r\n", "\n"]) {
    assert.deepEqual(
      githubApi("user", {}, () => ({
        status: 0,
        stdout: `HTTP/2.0 200 OK${newline}${newline}{"login":"owner"}`,
      })),
      { login: "owner" },
    );
  }
  for (const [error, expected] of [
    [{ code: "ENOENT" }, "inaccessible"],
    [{ code: "ECONNRESET" }, "transient"],
  ])
    assert.equal(
      nativeError("user", { error }).outcome.classification,
      expected,
    );
});

test("unprotected plan-gated feasibility stays viable and retains publication handoff outcomes", (t) => {
  const fixture = createRepositoryFixture(t);
  git(["config", "gpg.format", "openpgp"], fixture.repo);
  git(
    ["remote", "add", "origin", "https://github.com/owner/project.git"],
    fixture.repo,
  );
  const result = inspectPublicationFeasibility({
    cwd: fixture.repo,
    remote: "origin",
    taskId: "plan-fixture",
    api: apiFixture({
      "repos/owner/project/branches/main": {
        protected: false,
        commit: { sha: "a".repeat(40) },
      },
      "repos/owner/project/rules/branches/main?per_page=100&page=1":
        planUnavailable("repos/owner/project/rules/branches/main"),
      "repos/owner/project/rulesets?includes_parents=true&per_page=100&page=1":
        planUnavailable("repos/owner/project/rulesets"),
      graphql: {
        data: {
          repository: {
            branchProtectionRules: {
              nodes: [],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      },
    }),
    observeContext: () => ({ supported: true, fingerprint: "b".repeat(64) }),
  });
  assert.equal(result.status, "viable", JSON.stringify(result));
  assert.equal(result.nextAction, "verify-publication-payload");
  assert.ok(
    result.probes.some(
      ({ classification }) => classification === "not-available",
    ),
  );
  assert.deepEqual(result.discoveryReuse.probes, result.probes);
  assert.ok(
    result.discoveryEvidence.provider.probes.some(
      ({ classification }) => classification === "not-available",
    ),
  );
});

test("GitHub discovery combines classic protection with an empty rules response", () => {
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    sourceBranch: "delivery/change",
    api: apiFixture(),
  });
  assert.equal(result.route, "pull-request-merge");
  assert.equal(result.actor, "owner");
  assert.equal(result.destination, "refs/heads/main");
});

test("policy API denial is unknown, never an unprotected default", () => {
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    sourceBranch: "delivery/change",
    api: apiFixture({
      "repos/owner/project/branches/main/protection": new Error("HTTP 403"),
    }),
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.route, null);
});

test("active push rules are collected and evaluate-only rules are ignored", () => {
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    sourceBranch: "delivery/change",
    api: apiFixture({
      "repos/owner/project/rulesets?includes_parents=true&per_page=100&page=1":
        [
          {
            id: 7,
            target: "push",
            enforcement: "active",
            source_type: "Repository",
          },
          { id: 8, target: "push", enforcement: "evaluate" },
        ],
      "repos/owner/project/rulesets/7": {
        target: "push",
        enforcement: "active",
        rules: [{ type: "max_file_size", parameters: { max_file_size: 10 } }],
      },
    }),
  });
  assert.equal(result.policy.pushRules.length, 1);
  assert.match(result.prerequisites.join(" "), /content/);
});

test("canonical GitHub remotes identify the push target without accepting URL credentials or shell text", () => {
  for (const url of [
    "https://github.com/owner/project.git",
    "git@github.com:owner/project.git",
    "ssh://git@github.com/owner/project.git",
  ])
    assert.deepEqual(githubRemoteIdentity(url), {
      owner: "owner",
      repository: "project",
    });
  for (const url of [
    "https://token@github.com/owner/project",
    "https://github.com.evil/owner/project",
    "$(secret)",
    "https://github.com/owner/project?token=secret",
  ])
    assert.equal(githubRemoteIdentity(url), null);
});

test("preflight reads a real repository without modifying its working tree or index", (t) => {
  const fixture = createRepositoryFixture(t);
  git(["config", "gpg.format", "openpgp"], fixture.repo);
  git(
    ["remote", "add", "origin", "https://github.com/owner/project.git"],
    fixture.repo,
  );
  const before = git(
    ["status", "--porcelain=v1", "-uall"],
    fixture.repo,
  ).stdout;
  const result = inspectPublicationFeasibility({
    cwd: fixture.repo,
    remote: "origin",
    sourceBranch: "delivery/change",
    api: apiFixture(),
  });
  assert.equal(result.route, "pull-request-merge", JSON.stringify(result));
  assert.equal(result.discoveryReuse.eligible, true);
  assert.equal(result.discoveryReuse.scope, "current-task");
  assert.equal(
    resolve(result.discoveryReuse.binding.repositoryRoot),
    fixture.repo,
  );
  assert.equal(
    result.discoveryReuse.binding.pushUrl,
    "https://github.com/owner/project.git",
  );
  assert.equal(result.discoveryReuse.binding.remote, "origin");
  assert.equal(result.discoveryReuse.binding.repository, "owner/project");
  assert.equal(result.discoveryReuse.binding.destination, "refs/heads/main");
  assert.equal(result.discoveryReuse.binding.sourceBranch, "delivery/change");
  assert.equal(result.discoveryReuse.binding.apiActor, "owner");
  assert.equal(result.discoveryReuse.binding.requirePersonalSignature, false);
  assert.equal(
    git(["status", "--porcelain=v1", "-uall"], fixture.repo).stdout,
    before,
  );
});

test("discovery reuse binds the effective push target rather than the fetch URL", (t) => {
  const fixture = createRepositoryFixture(t);
  git(["config", "gpg.format", "openpgp"], fixture.repo);
  git(
    ["remote", "add", "delivery", "https://github.com/elsewhere/fetch.git"],
    fixture.repo,
  );
  git(
    [
      "remote",
      "set-url",
      "--push",
      "delivery",
      "git@github.com:owner/project.git",
    ],
    fixture.repo,
  );
  const result = inspectPublicationFeasibility({
    cwd: fixture.repo,
    remote: "delivery",
    sourceBranch: "delivery/change",
    requirePersonalSignature: true,
    api: apiFixture(),
  });
  assert.equal(result.route, "pull-request-merge");
  assert.equal(result.discoveryReuse.eligible, true);
  assert.equal(
    result.discoveryReuse.binding.pushUrl,
    "git@github.com:owner/project.git",
  );
  assert.equal(result.discoveryReuse.binding.remote, "delivery");
  assert.equal(result.discoveryReuse.binding.requirePersonalSignature, true);
});

test("blocked and incomplete discovery never offer optimistic route reuse", (t) => {
  const fixture = createRepositoryFixture(t);
  git(["config", "gpg.format", "openpgp"], fixture.repo);
  git(
    ["remote", "add", "origin", "https://github.com/owner/project.git"],
    fixture.repo,
  );
  for (const [want, options] of [
    ["blocked", { remote: "-invalid" }],
    ["unknown", { api: apiFixture({ user: new Error("HTTP 403") }) }],
    [
      "blocked",
      {
        api: apiFixture({
          "repos/owner/project": {
            ...policy().repository,
            default_branch: "main",
            full_name: "owner/project",
            archived: true,
          },
        }),
      },
    ],
  ]) {
    const result = inspectPublicationFeasibility({
      cwd: fixture.repo,
      remote: "origin",
      sourceBranch: "delivery/change",
      api: apiFixture(),
      ...options,
    });
    assert.equal(result.status, want, JSON.stringify(result));
    assert.equal(result.discoveryReuse.eligible, false);
    assert.equal(result.discoveryReuse.binding, null);
  }
});

test("unsupported provider returns an honest non-authorizing CLI result", (t) => {
  const fixture = createRepositoryFixture(t);
  git(
    ["remote", "add", "origin", "https://example.invalid/owner/project.git"],
    fixture.repo,
  );
  const process = spawnSync(
    globalThis.process.execPath,
    [cli, "workflow", "preflight", "--remote", "origin"],
    { cwd: fixture.repo, encoding: "utf8", windowsHide: true },
  );
  assert.equal(process.status, 5, process.stdout + process.stderr);
  const result = JSON.parse(process.stdout);
  assert.equal(result.feasibility.status, "unknown");
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.transaction, null);
});

test("discovery follows later rule pages before deciding direct publication", () => {
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    sourceBranch: "delivery/change",
    api: apiFixture({
      graphql: {
        data: {
          repository: {
            branchProtectionRules: {
              nodes: [],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      },
      "repos/owner/project/rules/branches/main?per_page=100&page=1": Array.from(
        { length: 100 },
        () => ({ type: "deletion" }),
      ),
      "repos/owner/project/rules/branches/main?per_page=100&page=2": [
        {
          type: "pull_request",
          parameters: { allowed_merge_methods: ["squash"] },
        },
      ],
    }),
  });
  assert.equal(result.route, "pull-request-squash");
});

test("missing classic policy body is unknown even when active rules exist", () => {
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    sourceBranch: "delivery/change",
    api: apiFixture({
      "repos/owner/project/rules/branches/main?per_page=100&page=1": [
        { type: "required_signatures" },
      ],
      "repos/owner/project/branches/main/protection": null,
    }),
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.route, null);
});

test("unprotected targets do not need unrelated source-branch discovery", () => {
  const api = apiFixture({
    "repos/owner/project/branches/main": {
      name: "main",
      protected: false,
      commit: { sha: "a".repeat(40) },
    },
    graphql: {
      data: {
        repository: {
          branchProtectionRules: {
            nodes: [{ pattern: "delivery/*" }],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    },
  });
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    sourceBranch: "delivery/change",
    api,
  });
  assert.equal(result.route, "direct");
});

test("preflight rejects invalid format using the shared diagnostic contract", () => {
  const result = spawnSync(
    process.execPath,
    [cli, "workflow", "preflight", "--remote", "origin", "--format", "yaml"],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 2, result.stdout + result.stderr);
});

test("a denied local discovery command returns an unmet prerequisite without further commands", (t) => {
  const fixture = createRepositoryFixture(t);
  const attempts = [];
  const result = inspectPublicationFeasibility({
    cwd: fixture.repo,
    remote: "origin",
    api: () => assert.fail("Provider access must not follow a command denial"),
    runCommand: (executable, args) => {
      attempts.push([executable, args]);
      throw Object.assign(new Error("private guard output must not escape"), {
        code: "COMMAND_GUARD_DENIED",
        operation: "git-repository-root",
        executed: false,
        ruleId: "core.git:git-alias-semantic-unverified",
      });
    },
  });
  assert.equal(attempts.length, 1);
  assert.equal(result.status, "unknown");
  assert.equal(result.route, null);
  assert.equal(result.commandFailure.code, "COMMAND_GUARD_DENIED");
  assert.equal(result.commandFailure.executed, false);
  assert.equal(result.nextAction, "resolve-command-prerequisite");
  assert.doesNotMatch(JSON.stringify(result), /private guard output/);
});

test("a local executable that cannot launch is not reported as executed", () => {
  const result = inspectPublicationFeasibility({
    remote: "origin",
    runCommand: () => ({ error: { code: "ENOENT" }, status: null, pid: 0 }),
  });
  assert.equal(result.commandFailure.code, "COMMAND_UNAVAILABLE");
  assert.equal(result.commandFailure.executed, false);
});

test("preflight evaluates authenticated transport evidence instead of requiring actor equality", (t) => {
  const fixture = createRepositoryFixture(t);
  git(
    ["remote", "add", "origin", "https://github.com/owner/project.git"],
    fixture.repo,
  );
  git(["config", "gpg.format", "openpgp"], fixture.repo);
  const result = inspectPublicationFeasibility({
    cwd: fixture.repo,
    remote: "origin",
    taskId: "identity-task",
    sourceBranch: "delivery/change",
    authorizedTransportActor: "publisher",
    api: apiFixture(),
    observeContext: () => ({
      supported: true,
      transport: "https",
      fingerprint: "a".repeat(64),
    }),
    observeTransport: () => ({
      state: "established",
      method: "git-credential-github-user",
      principal: { kind: "user", login: "publisher", id: 52 },
      permissions: { state: "established", canPush: true },
    }),
  });
  assert.equal(result.transportIdentity?.state, "established");
  assert.equal(result.transportIdentity.principal.login, "publisher");
  assert.equal(result.transportPermissions.state, "established");
  assert.equal(result.identityRelationship, "authorized-different");
  assert.equal(result.discoveryReuse.eligible, true);
  assert.equal(result.nextAction, "verify-publication-payload");
  assert.doesNotMatch(
    result.prerequisites.join(" "),
    /matches the observed API actor/,
  );
});

test("an optional identity denial preserves an authorized ordinary route without a prompt or another probe", (t) => {
  const fixture = createRepositoryFixture(t);
  git(
    ["remote", "add", "origin", "https://github.com/owner/project.git"],
    fixture.repo,
  );
  git(["config", "gpg.format", "openpgp"], fixture.repo);
  let probes = 0;
  const result = inspectPublicationFeasibility({
    cwd: fixture.repo,
    remote: "origin",
    taskId: "optional-identity",
    sourceBranch: "delivery/change",
    api: apiFixture(),
    observeContext: () => ({
      supported: true,
      transport: "https",
      fingerprint: "a".repeat(64),
    }),
    observeTransport: () => {
      probes++;
      throw Object.assign(new Error("not executed"), {
        code: "COMMAND_GUARD_DENIED",
        operation: "git-credential-selection",
        executed: false,
      });
    },
  });
  assert.equal(probes, 1);
  assert.equal(result.route, "pull-request-merge");
  assert.equal(result.status, "viable-with-prerequisites");
  assert.equal(result.transportIdentity.state, "unavailable");
  assert.equal(result.transportIdentity.required, false);
  assert.equal(result.nextAction, "verify-publication-payload");
  assert.equal(
    result.warnings[0].code,
    "TRANSPORT_IDENTITY_OPTIONAL_UNAVAILABLE",
  );
});

test("API account write permission is not a prerequisite for a direct Git publication route", () => {
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    api: apiFixture({
      "repos/owner/project": {
        ...policy().repository,
        default_branch: "main",
        permissions: { push: false },
      },
      "repos/owner/project/branches/main": {
        protected: false,
        commit: { sha: "a".repeat(40) },
      },
      "repos/owner/project/rules/branches/main?per_page=100&page=1": [],
      graphql: {
        data: {
          repository: {
            branchProtectionRules: {
              nodes: [],
              pageInfo: { hasNextPage: false },
            },
          },
        },
      },
    }),
  });
  assert.equal(result.route, "direct", JSON.stringify(result));
  assert.equal(result.policy.repository.permissions.push, false);
  assert.equal(result.permissionBasis, "transport-not-observed");
});

test("same-task evidence reuse refreshes API identity without repeating policy or a denied credential probe", (t) => {
  const fixture = createRepositoryFixture(t);
  git(
    ["remote", "add", "origin", "https://github.com/owner/project.git"],
    fixture.repo,
  );
  git(["config", "gpg.format", "openpgp"], fixture.repo);
  const options = {
    cwd: fixture.repo,
    remote: "origin",
    taskId: "reuse-task",
    sourceBranch: "delivery/change",
    observeContext: () => ({ supported: true, fingerprint: "b".repeat(64) }),
  };
  const first = inspectPublicationFeasibility({
    ...options,
    api: apiFixture(),
    observeTransport: () => {
      throw Object.assign(new Error("denied"), {
        code: "COMMAND_GUARD_DENIED",
        operation: "credential-selection",
        executed: false,
      });
    },
  });
  assert.ok(first.discoveryEvidence);
  const reads = [];
  const second = inspectPublicationFeasibility({
    ...options,
    priorDiscovery: first.discoveryEvidence,
    api: (endpoint) => {
      reads.push(endpoint);
      assert.equal(endpoint, "user");
      return { login: "owner" };
    },
    observeTransport: () => assert.fail("Denied probe must never be retried"),
  });
  assert.equal(second.discoveryReused, true);
  assert.equal(second.route, "pull-request-merge");
  assert.deepEqual(reads, ["user"]);
  assert.equal(
    second.transportIdentity.commandFailure.code,
    "COMMAND_GUARD_DENIED",
  );
  assert.equal(second.transportIdentity.required, false);
  const changed = inspectPublicationFeasibility({
    ...options,
    taskId: "different-task",
    priorDiscovery: first.discoveryEvidence,
    api: apiFixture(),
    observeTransport: () =>
      assert.fail("Invalid reuse must not automatically reprobe"),
  });
  assert.equal(changed.discoveryReused, false);
  assert.equal(changed.transportIdentity.state, "binding-changed");
  assert.equal(changed.route, "pull-request-merge");
});
