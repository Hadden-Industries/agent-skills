import { spawnSync } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";

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

function defaultReadableProbe(path) {
  try {
    accessSync(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function inspectSignatureRequirements(
  root,
  {
    runConfig = (args) => runGitConfig(root, args),
    probeReadable = defaultReadableProbe,
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
        readable: false,
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

  return {
    backend: "ssh",
    trustSource: {
      configured: true,
      origin,
      path,
      readable: probeReadable(path),
    },
  };
}
