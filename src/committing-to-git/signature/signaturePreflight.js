import { spawnSync } from "node:child_process";
import { closeSync, fstatSync, openSync } from "node:fs";

const TRUST_SOURCE_STATES = new Set([
  "readable",
  "not-configured",
  "not-found",
  "permission-denied",
  "invalid-file-type",
  "probe-error",
]);

function runGitConfig(root, args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: null,
    env: process.env,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

function configText(result, label) {
  if (result?.error) {
    throw new Error(`${label} could not run: ${result.error.message}`);
  }

  if (result?.status !== 0 && result?.status !== 1) {
    const diagnostic = Buffer.from(result?.stderr ?? Buffer.alloc(0))
      .toString("utf8")
      .trim();

    throw new Error(
      `${label} failed${diagnostic ? `: ${diagnostic}` : ` with exit ${result?.status}`}.`,
    );
  }

  return result.status === 0
    ? Buffer.from(result.stdout ?? Buffer.alloc(0))
        .toString("utf8")
        .replace(/\r?\n$/u, "")
    : null;
}

function defaultTrustSourceProbe(path) {
  let descriptor = null;

  try {
    // This is capability discovery, not a security authorization check. Open
    // the same configured path Git will later use so path aliases and links
    // follow host filesystem semantics; the final Git verification remains
    // authoritative if access changes after this preflight.
    descriptor = openSync(path, "r");
    const stat = fstatSync(descriptor);

    return stat.isFile()
      ? { state: "readable", errorCode: null }
      : { state: "invalid-file-type", errorCode: null };
  } catch (error) {
    const errorCode = typeof error.code === "string" ? error.code : null;

    if (new Set(["ENOENT", "ENOTDIR"]).has(errorCode)) {
      return { state: "not-found", errorCode };
    }

    if (new Set(["EACCES", "EPERM"]).has(errorCode)) {
      return { state: "permission-denied", errorCode };
    }

    if (new Set(["EISDIR", "ELOOP"]).has(errorCode)) {
      return { state: "invalid-file-type", errorCode };
    }

    return { state: "probe-error", errorCode };
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

function normalizeTrustSourceProbe(result) {
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    !TRUST_SOURCE_STATES.has(result.state) ||
    result.state === "not-configured" ||
    !Object.hasOwn(result, "errorCode") ||
    (result.errorCode !== null && typeof result.errorCode !== "string")
  ) {
    throw new Error("SSH allowed-signers probe returned an invalid result.");
  }

  return { state: result.state, errorCode: result.errorCode };
}

export function describeSshTrustSourceFailure(trustSource) {
  if (
    trustSource === null ||
    typeof trustSource !== "object" ||
    trustSource.state === "readable"
  ) {
    throw new Error(
      "SSH trust-source failure description requires an unavailable source.",
    );
  }

  const permissionDenied = trustSource.state === "permission-denied";
  const capability = permissionDenied
    ? {
        kind: "read-file",
        path: trustSource.path,
        origin: trustSource.origin,
      }
    : null;
  const action = permissionDenied
    ? { kind: "request-read-capability", capability }
    : {
        kind: "repair-configuration",
        configKey: "gpg.ssh.allowedSignersFile",
        origin: trustSource.origin,
        path: trustSource.path,
      };
  const messageByState = {
    "not-configured":
      "Required SSH verification has no configured allowed-signers file.",
    "not-found":
      "Required SSH verification cannot find Git's configured allowed-signers file.",
    "permission-denied":
      "Required SSH verification cannot read Git's configured allowed-signers file because access was denied.",
    "invalid-file-type":
      "Required SSH verification configured an allowed-signers path that is not a readable regular file.",
    "probe-error":
      "Required SSH verification could not inspect Git's configured allowed-signers file.",
  };

  return {
    message:
      messageByState[trustSource.state] ??
      "Required SSH verification cannot use Git's configured allowed-signers file.",
    action,
    capability,
    trustSource,
    policyAlternatives: ["advisory", "skipped"],
  };
}

export function inspectSignatureRequirements(
  root,
  {
    runConfig = (args) => runGitConfig(root, args),
    probeTrustSource = defaultTrustSourceProbe,
  } = {},
) {
  const format = configText(
    runConfig(["config", "--get", "gpg.format"]),
    "Git signature backend discovery",
  );
  const backend =
    format === null || format === "" || format === "openpgp"
      ? "openpgp"
      : format.toLowerCase();

  if (!new Set(["openpgp", "ssh"]).has(backend)) {
    throw new Error(
      `Unsupported Git signature backend ${JSON.stringify(backend)}.`,
    );
  }

  if (backend !== "ssh") {
    return { backend, trustSource: null };
  }

  const configured = configText(
    runConfig([
      "config",
      "--show-origin",
      "--path",
      "--get",
      "gpg.ssh.allowedSignersFile",
    ]),
    "SSH allowed-signers discovery",
  );

  if (configured === null) {
    return {
      backend: "ssh",
      trustSource: {
        configured: false,
        origin: null,
        path: null,
        state: "not-configured",
        errorCode: null,
      },
    };
  }

  const separator = configured.indexOf("\t");

  if (separator < 1 || separator === configured.length - 1) {
    throw new Error(
      "Git returned an invalid origin/path record for gpg.ssh.allowedSignersFile.",
    );
  }

  const origin = configured.slice(0, separator);
  const path = configured.slice(separator + 1);
  const probe = normalizeTrustSourceProbe(probeTrustSource(path));

  return {
    backend: "ssh",
    trustSource: {
      configured: true,
      origin,
      path,
      ...probe,
    },
  };
}
