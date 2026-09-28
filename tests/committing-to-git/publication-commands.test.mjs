import assert from "node:assert/strict";
import test from "node:test";
import { createPublicationCommandRunner } from "../../src/committing-to-git/publication/publicationCommands.js";

test("native DCG denial prevents the child and closes the observation session", () => {
  let classifications = 0;
  const run = createPublicationCommandRunner({
    classifyCommand: () => {
      classifications++;
      return {
        status: 1,
        stdout: JSON.stringify({
          schema_version: 1,
          decision: "deny",
          rule_id: "core.git:git-alias-semantic-unverified",
        }),
      };
    },
    launch: () => assert.fail("Denied child executed"),
  });
  for (const command of [
    ["git", ["credential", "fill"]],
    ["ssh", ["-T", "git@github.com"]],
  ]) {
    assert.throws(
      () => run(...command, { operation: "identity-observation" }),
      { code: "COMMAND_GUARD_DENIED", executed: false },
    );
  }
  assert.equal(classifications, 1);
});

test("missing, malformed and failed guard responses never execute the child", () => {
  for (const response of [
    { status: null, error: { code: "ENOENT" }, stdout: "" },
    { status: 0, stdout: "not-json" },
    { status: 0, stdout: "null" },
    { status: 1, stdout: '{"schema_version":1,"decision":"allow"}' },
    { status: 0, stdout: '{"schema_version":2,"decision":"allow"}' },
  ]) {
    const run = createPublicationCommandRunner({
      classifyCommand: () => response,
      launch: () => assert.fail("Child executed without guard approval"),
    });
    assert.throws(
      () => run("git", ["status"], { operation: "local-observation" }),
      { code: "COMMAND_GUARD_UNAVAILABLE", executed: false },
    );
  }
});

test("guard-approved child failures remain command failures, not inferred denials", () => {
  const run = createPublicationCommandRunner({
    classifyCommand: () => ({
      status: 0,
      stdout: '{"schema_version":1,"decision":"allow"}',
    }),
    launch: () => ({ status: 17, stdout: "", stderr: "permission denied" }),
  });
  assert.equal(run("git", ["status"]).status, 17);
});

test("a guard denial during provider discovery survives the policy boundary", async () => {
  const { inspectGitHubPolicy } =
    await import("../../src/committing-to-git/publication/githubPolicy.js");
  const result = inspectGitHubPolicy({
    owner: "owner",
    repository: "project",
    api: () => {
      throw Object.assign(new Error("sensitive native diagnostic"), {
        code: "COMMAND_GUARD_DENIED",
        operation: "github-policy-observation",
        executed: false,
      });
    },
  });
  assert.equal(result.commandFailure?.code, "COMMAND_GUARD_DENIED");
  assert.doesNotMatch(JSON.stringify(result), /sensitive native diagnostic/);
});
