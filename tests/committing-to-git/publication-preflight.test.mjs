import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { selectPublicationRoute } from "../../src/committing-to-git/publication/publicationPolicy.js";
import { inspectGitHubPolicy } from "../../src/committing-to-git/publication/githubPolicy.js";
import {
  githubRemoteIdentity,
  inspectPublicationFeasibility,
} from "../../src/committing-to-git/publication/publicationPreflight.js";
import { createRepositoryFixture, git } from "./harness.mjs";

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
  assert.equal(
    git(["status", "--porcelain=v1", "-uall"], fixture.repo).stdout,
    before,
  );
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
