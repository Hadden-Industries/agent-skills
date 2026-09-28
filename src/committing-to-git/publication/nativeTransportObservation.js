import { request } from "node:https";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createPublicationCommandRunner,
  commandFailure,
} from "./publicationCommands.js";
import { projectTransportObservation } from "./transportIdentity.js";

/** Fixed-host, bounded read; no redirects, token logging, or provider error bodies. */
function githubGet(endpoint, credential) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "api.github.com",
        path: endpoint,
        method: "GET",
        headers: {
          Authorization: `Bearer ${credential}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "committing-to-git-identity-observation",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (Buffer.byteLength(body) > 256 * 1024)
            req.destroy(new Error("Observation limit exceeded."));
        });
        response.on("end", () => {
          if (response.statusCode !== 200)
            return reject(new Error("Identity read unavailable."));
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("Identity response unavailable."));
          }
        });
        response.on("error", () =>
          reject(new Error("Identity read unavailable.")),
        );
      },
    );
    req.setTimeout(10000, () =>
      req.destroy(new Error("Identity read timed out.")),
    );
    req.on("error", () => reject(new Error("Identity read unavailable.")));
    req.end();
  });
}

/**
 * The initial SSH lane admits only the native default OpenSSH context without
 * config files or wrappers. Configured aliases, proxies and Match/Include rules
 * remain unsupported rather than executing config-owned commands to inspect them.
 */
export function observeNativeSsh(
  binding,
  {
    runCommand,
    env = process.env,
    pathExists = existsSync,
    home = homedir(),
    platform = process.platform,
  } = {},
) {
  const unavailable = (reason) => ({ state: "unavailable", reason });
  if (
    !/^(git@github\.com:|ssh:\/\/git@github\.com\/)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/u.test(
      binding.pushUrl,
    )
  )
    return unavailable("unsupported-native-context");
  if (
    Object.keys(env).some((name) =>
      /^(GIT_SSH|GIT_CONFIG|GIT_EXEC_PATH|SSH_ASKPASS)/iu.test(name),
    )
  )
    return unavailable("ssh-environment-override");
  // Git for Windows and system OpenSSH can resolve different executables.
  // Do not claim equivalent transport selection without that qualification.
  if (platform === "win32")
    return unavailable("ssh-executable-binding-unqualified");
  if (
    pathExists(join(home, ".ssh", "config")) ||
    pathExists("/etc/ssh/ssh_config")
  )
    return unavailable("ssh-configuration-unqualified");
  const options = {
    cwd: binding.repositoryRoot,
    env,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 16384,
  };
  const overrides = runCommand(
    "git",
    ["config", "--get-regexp", "^(core\\.sshcommand|ssh\\.variant)$"],
    { ...options, operation: "ssh-context" },
  );
  if (overrides.status !== 1) return unavailable("ssh-configuration-override");
  const execPath = runCommand("git", ["--exec-path"], {
    ...options,
    operation: "ssh-context",
  });
  if (execPath.status !== 0 || pathExists(join(execPath.stdout.trim(), "ssh")))
    return unavailable("ssh-executable-binding-unqualified");
  const version = runCommand("ssh", ["-V"], {
    ...options,
    operation: "ssh-context",
  });
  if (version.status !== 0 || !/^OpenSSH_/u.test(version.stderr))
    return unavailable("unsupported-ssh-client");
  const response = runCommand(
    "ssh",
    [
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UpdateHostKeys=no",
      "-o",
      "ClearAllForwardings=yes",
      "-o",
      "ConnectionAttempts=1",
      "-o",
      "ConnectTimeout=10",
      "git@github.com",
    ],
    { ...options, operation: "ssh-identity" },
  );
  // GitHub's successful no-shell greeting intentionally exits with status 1.
  const greeting =
    /^Hi ([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)?)! You've successfully authenticated, but GitHub does not provide shell access\.\r?\n?$/u.exec(
      response.stderr,
    );
  if (response.status !== 1 || !greeting)
    return unavailable("ssh-authentication-unavailable");
  if (greeting[1].includes("/"))
    return { state: "ambiguous", reason: "repository-deploy-key-principal" };
  return projectTransportObservation({
    state: "established",
    method: "ssh-github-greeting",
    principal: { kind: "user", login: greeting[1] },
  });
}

/**
 * Run only inside the short-lived worker. Git selects the stored credential;
 * authenticated /user identifies its principal. Unknown helper chains and auth
 * overrides are unsupported, never approximated by an account listing.
 */
export async function observeNativeTransport(
  binding,
  {
    runCommand = createPublicationCommandRunner(),
    env = process.env,
    githubGet: get = githubGet,
  } = {},
) {
  const unavailable = (reason, failure = null) => ({
    state: "unavailable",
    reason,
    commandFailure: failure,
  });
  try {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(binding?.repository ?? ""))
      return unavailable("unsupported-native-context");
    if (
      binding.pushUrl?.startsWith("git@") ||
      binding.pushUrl?.startsWith("ssh://")
    )
      return observeNativeSsh(binding, { runCommand, env });
    if (
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/u.test(
        binding?.pushUrl ?? "",
      )
    )
      return unavailable("unsupported-native-context");
    if (
      Object.keys(env).some((name) =>
        /^(GIT_CONFIG|GIT_EXEC_PATH|GIT_ASKPASS|SSH_ASKPASS|GCM_)/iu.test(name),
      )
    )
      return unavailable("authentication-environment-override");
    const options = {
      cwd: binding.repositoryRoot,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 256 * 1024,
      env: {
        ...env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never",
        GCM_GUI_PROMPT: "0",
        GIT_TRACE: "0",
        GIT_TRACE_CURL: "0",
        GIT_CURL_VERBOSE: "0",
        GCM_TRACE: "0",
      },
    };
    const helpers = runCommand(
      "git",
      ["config", "--get-all", "credential.helper"],
      { ...options, operation: "credential-context" },
    );
    if (
      helpers.status !== 0 ||
      !/^(manager|manager-core)\r?\n?$/u.test(helpers.stdout)
    )
      return unavailable("unsupported-credential-helper");
    const overrides = runCommand(
      "git",
      [
        "config",
        "--get-regexp",
        "^(credential\\..*\\.helper|http\\..*|url\\..*|core\\.askpass)$",
      ],
      { ...options, operation: "credential-context" },
    );
    // Native Git decides which settings exist. No custom config interpretation,
    // shell helpers or HTTP overrides are admitted to this initial collector.
    if (overrides.status !== 1)
      return unavailable("authentication-configuration-override");
    const credential = runCommand("git", ["credential", "fill"], {
      ...options,
      operation: "credential-selection",
      input: `url=${binding.pushUrl}\n\n`,
    });
    if (credential.status !== 0)
      return unavailable("stored-credential-unavailable");
    const fields = new Map();
    for (const line of credential.stdout.split(/\r?\n/u)) {
      if (!line) continue;
      const separator = line.indexOf("=");
      if (separator < 1 || fields.has(line.slice(0, separator)))
        return unavailable("ambiguous-credential-response");
      fields.set(line.slice(0, separator), line.slice(separator + 1));
    }
    const token = fields.get("password");
    if (
      fields.get("protocol") !== "https" ||
      fields.get("host") !== "github.com" ||
      !token ||
      /[\r\n\0]/u.test(token)
    )
      return unavailable("unsupported-credential-response");
    const principal = await get("/user", token);
    let permissions = { state: "unavailable", canPush: null };
    try {
      const repository = await get(`/repos/${binding.repository}`, token);
      if (typeof repository?.permissions?.push === "boolean")
        permissions = {
          state: "established",
          canPush: repository.permissions.push,
        };
    } catch {
      /* Identity can remain established when permission metadata is unavailable. */
    }
    return projectTransportObservation({
      state: "established",
      method: "git-credential-github-user",
      principal: { kind: "user", login: principal?.login, id: principal?.id },
      permissions,
    });
  } catch (error) {
    return unavailable("native-observation-failed", commandFailure(error));
  }
}
