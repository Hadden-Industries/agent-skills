import assert from "node:assert/strict";
import test from "node:test";
import {
  observeNativeTransport,
  observeNativeSsh,
} from "../../src/committing-to-git/publication/nativeTransportObservation.js";
import { assessTransportIdentity } from "../../src/committing-to-git/publication/transportIdentity.js";

const binding = {
  repositoryRoot: "/fixture",
  repository: "owner/project",
  pushUrl: "https://github.com/owner/project.git",
};
const secret = "credential-canary-PRIVATE";
function nativeGit(executable, args, options) {
  assert.equal(executable, "git");
  const command = args.join(" ");
  if (command.includes("credential fill")) {
    assert.equal(options.env.GCM_INTERACTIVE, "never");
    assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(options.input, `url=${binding.pushUrl}\n\n`);
    return {
      status: 0,
      stdout: `protocol=https\nhost=github.com\nusername=arbitrary\npassword=${secret}\n\n`,
    };
  }
  if (command.includes("--get-all credential.helper"))
    return { status: 0, stdout: "manager\n" };
  if (command.includes("--get-regexp")) return { status: 1, stdout: "" };
  throw new Error(`Unexpected fixture operation: ${command}`);
}

test("HTTPS evidence uses the selected token principal, never the credential username", async () => {
  const calls = [];
  const result = await observeNativeTransport(binding, {
    runCommand: nativeGit,
    env: {},
    githubGet: async (endpoint, credential) => {
      calls.push(endpoint);
      assert.equal(credential, secret);
      return endpoint === "/user"
        ? { login: "publisher", id: 42 }
        : { permissions: { push: true } };
    },
  });
  assert.equal(result.state, "established");
  assert.deepEqual(result.principal, {
    kind: "user",
    login: "publisher",
    id: 42,
  });
  assert.deepEqual(calls, ["/user", "/repos/owner/project"]);
  assert.doesNotMatch(JSON.stringify(result), /credential-canary|arbitrary/);
});

test("native SSH distinguishes GitHub exit-one success from a deploy-key principal", () => {
  for (const [login, expected] of [
    ["publisher", "established"],
    ["owner/project", "ambiguous"],
  ]) {
    const result = observeNativeSsh(
      { ...binding, pushUrl: "git@github.com:owner/project.git" },
      {
        env: {},
        platform: "linux",
        pathExists: () => false,
        runCommand: (executable, args) => {
          if (args.includes("--get-regexp")) return { status: 1, stdout: "" };
          if (args.includes("--exec-path"))
            return { status: 0, stdout: "/usr/lib/git-core" };
          if (args.includes("-V"))
            return { status: 0, stderr: "OpenSSH_9.5p2" };
          assert.equal(executable, "ssh");
          assert.ok(args.includes("BatchMode=yes"));
          assert.ok(args.includes("StrictHostKeyChecking=yes"));
          assert.ok(args.includes("UpdateHostKeys=no"));
          return {
            status: 1,
            stderr: `Hi ${login}! You've successfully authenticated, but GitHub does not provide shell access.\n`,
          };
        },
      },
    );
    assert.equal(result.state, expected);
  }
});

test("denied selection and secret-bearing native errors never reach public evidence or trigger another operation", async () => {
  for (const guardDenied of [true, false]) {
    let selections = 0;
    const result = await observeNativeTransport(binding, {
      env: {},
      runCommand: (...args) => {
        if (args[1].includes("fill")) {
          selections++;
          throw Object.assign(
            new Error(secret),
            guardDenied
              ? {
                  code: "COMMAND_GUARD_DENIED",
                  operation: "credential-selection",
                  executed: false,
                }
              : {},
          );
        }
        return nativeGit(...args);
      },
      githubGet: () =>
        assert.fail("Network must not run after selection fails"),
    });
    assert.equal(selections, 1);
    assert.equal(result.state, "unavailable");
    assert.doesNotMatch(JSON.stringify(result), /credential-canary/);
    if (guardDenied) assert.equal(result.commandFailure.executed, false);
  }
});

test("only explicit account constraints and established permission denial block optional identity", () => {
  assert.equal(
    assessTransportIdentity({ observation: { state: "unavailable" } }).blocking,
    false,
  );
  assert.equal(
    assessTransportIdentity({
      observation: { state: "unavailable" },
      authorizedTransportActor: "publisher",
    }).blocking,
    true,
  );
  assert.equal(
    assessTransportIdentity({
      observation: { state: "unavailable" },
      restricted: true,
    }).blocking,
    true,
  );
  assert.equal(
    assessTransportIdentity({
      observation: {
        state: "established",
        method: "git-credential-github-user",
        principal: { kind: "user", login: "publisher", id: 42 },
        permissions: { state: "established", canPush: false },
      },
    }).blocking,
    true,
  );
});
