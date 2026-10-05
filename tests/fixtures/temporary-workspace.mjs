import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { deriveOutcomeReference } from "../../scripts/evaluation/derive-reports.js";
import { readStableFile } from "../../src/committing-to-git/filesystem/stableFile.js";

const ownerName = ".test-workspace-owner.json";
const fileTimeEpoch = 11644473600000000000n;
const identity = (path) => {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Fixture directory identity is not ordinary");
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birth: String(stat.birthtimeNs),
    fileTime: String((stat.birthtimeNs + fileTimeEpoch) / 100n),
  };
};
const sameIdentity = (path, expected) => {
  const actual = identity(path);
  return ["dev", "ino", "birth"].every(
    (field) => actual[field] === expected[field],
  );
};

// Only newly allocated test roots enter this interface. Prefixes and old marker
// files never confer ownership of pre-existing directories.
export function createTestWorkspace(
  t,
  prefix,
  { recycle = recycleNative } = {},
) {
  if (!/^[a-z][a-z0-9-]{0,80}-$/u.test(prefix))
    throw new Error("Fixture prefix must be a plain directory-name prefix");
  const parent = realpathSync.native(tmpdir());
  const parentIdentity = identity(parent);
  const root = realpathSync.native(mkdtempSync(join(parent, prefix)));
  const rootIdentity = identity(root);
  const owner = {
    schemaVersion: 1,
    kind: "test-workspace",
    root,
    parent,
    prefix,
    nonce: randomUUID(),
    pid: process.pid,
    test: t.fullName ?? t.name,
  };
  const ownerBytes = Buffer.from(JSON.stringify(owner));
  writeFileSync(join(root, ownerName), ownerBytes, { flag: "wx", mode: 0o600 });
  const children = new Set();
  let explicitRetention = null;
  let disposition = { status: "active", root };

  const verifyOwner = () => {
    if (
      dirname(root) !== parent ||
      !basename(root).startsWith(prefix) ||
      !sameIdentity(parent, parentIdentity) ||
      !sameIdentity(root, rootIdentity) ||
      realpathSync.native(root) !== root
    )
      throw new Error("Fixture path or directory identity changed");
    const marker = join(root, ownerName);
    // Validate and read one bounded file object, rather than checking a path
    // whose target could change before a later pathname read.
    if (!readStableFile(marker, ownerBytes.length).bytes.equals(ownerBytes))
      throw new Error("Fixture ownership marker changed");
  };
  const retain = (reason, ownershipIntact) => {
    disposition = { status: "retained", root, reason };
    // Never write a retention marker into a substituted or unowned directory.
    if (ownershipIntact) {
      try {
        writeFileSync(
          join(root, ".test-workspace-retention.json"),
          JSON.stringify({
            ...disposition,
            owner: owner.nonce,
            test: owner.test,
            cleanupCondition:
              "Reconcile the named failure or recovery state and release its consumers before recoverable disposal",
          }),
          { flag: "wx", mode: 0o600 },
        );
      } catch (error) {
        // A pre-existing marker may be a link to somebody else's file. Never
        // overwrite it, even when this freshly allocated directory is ours.
        t.diagnostic(
          `Retention marker left unchanged at ${root}: ${error.code ?? error.message}`,
        );
        if (error.code !== "EEXIST") throw error;
      }
    }
    t.diagnostic(`Fixture retained at ${root}: ${reason}`);
    return disposition;
  };

  // Register immediately: partial setup, assertions and cancellations all reach
  // the same ownership and retention decision.
  t.after(() => {
    try {
      verifyOwner();
    } catch (error) {
      retain(error.message, false);
      throw error;
    }
    let reason;
    try {
      reason =
        (t.passed !== true ? "test failed or was cancelled" : null) ??
        explicitRetention ??
        (children.size > 0 ? "owned child has not emitted close" : null) ??
        protectedState(root);
    } catch (error) {
      retain(`fixture inventory failed: ${error.message}`, true);
      throw error;
    }
    if (reason !== null) return retain(reason, true);
    try {
      verifyOwner();
      const result = recycle({
        root,
        parent,
        rootFileTime: rootIdentity.fileTime,
        parentFileTime: parentIdentity.fileTime,
        ownerSha256: createHash("sha256").update(ownerBytes).digest("hex"),
      });
      if (result?.status === "unavailable")
        return retain("native recoverable disposal is unavailable", true);
      if (existsSync(root))
        throw new Error("Native disposal left fixture in place");
      disposition = { status: "recycled", root };
      return disposition;
    } catch (error) {
      if (existsSync(root)) {
        try {
          verifyOwner();
          retain(`recoverable disposal failed: ${error.message}`, true);
        } catch {
          retain("disposal outcome or ownership is unknown", false);
        }
      } else {
        retain("disposal outcome is unknown", false);
      }
      throw error;
    }
  });

  return {
    root,
    environment: (base = process.env) => ({
      ...base,
      TEMP: root,
      TMP: root,
      TMPDIR: root,
    }),
    trackChild(child) {
      children.add(child);
      child.once("close", () => children.delete(child));
      return child;
    },
    retain(reason) {
      if (typeof reason !== "string" || reason.length === 0)
        throw new Error("Fixture retention needs a reason");
      explicitRetention = reason;
    },
    get disposition() {
      return disposition;
    },
  };
}

function protectedState(root) {
  let visited = 0;
  function visit(path) {
    if (++visited > 50000) return "fixture inventory exceeds inspection bound";
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      return "fixture contains a link or reparse point";
    if (basename(path) === ".test-workspace-retention.json")
      return "fixture contains an explicitly retained fixture";
    if (stat.isDirectory()) {
      const names = readdirSync(path);
      if (basename(path) === ".leases" && names.length > 0)
        return "unresolved evaluation home lease";
      if (
        (names.includes("attempt.json") && !names.includes("run.json")) ||
        (names.includes("authorization-consumption.json") &&
          !names.includes("result.json"))
      )
        return "consumed evaluation attempt lacks a terminal run";
      for (const name of names) {
        const reason = visit(join(path, name));
        if (reason !== null) return reason;
      }
    } else if (
      stat.isFile() &&
      ["run.json", "result.json"].includes(basename(path))
    ) {
      if (stat.size > 2097152) return "run evidence exceeds inspection bound";
      let bytes;
      let run;
      try {
        bytes = readStableFile(path, 2097152).bytes;
        run = JSON.parse(bytes.toString("utf8"));
      } catch {
        return "run evidence is unreadable";
      }
      // result.json is also a common ordinary fixture filename; the trial
      // discriminator or consumption record identifies an evaluation result.
      const evaluationResult =
        basename(path) === "run.json" ||
        run?.artifactType === "evaluation-trial-result" ||
        existsSync(join(dirname(path), "authorization-consumption.json"));
      if (evaluationResult && run?.closure?.status !== "safe")
        return "evaluation process closure is unsafe or unknown";
      if (evaluationResult) {
        // Reuse the maintained outcome validator; a lone "safe" string is not
        // sufficient evidence to release a consumed evaluation fixture.
        try {
          const reference = deriveOutcomeReference({
            path,
            profile: "test-fixture-cleanup",
            transmissionSha256: run.transmissionSha256,
            evidenceLayout:
              basename(path) === "run.json"
                ? "legacy-v1"
                : "evaluation-trial-v1",
          });
          // The validator independently rereads the outcome. It must validate
          // the same bytes inspected here, including their safe closure.
          if (
            reference.authoritativeSha256 !==
              createHash("sha256").update(bytes).digest("hex") ||
            reference.closureStatus !== "safe"
          )
            return "terminal evaluation evidence changed during validation";
        } catch {
          return "terminal evaluation evidence cannot be validated";
        }
      }
    } else if (!stat.isFile()) {
      return "fixture contains a nonregular object";
    }
    return null;
  }
  return visit(root);
}

function recycleNative(request) {
  let command;
  let args;
  let input;
  if (process.platform === "win32") {
    command = join(
      process.env.SystemRoot ?? process.env.WINDIR,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    args = [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join(import.meta.dirname, "recycle-test-workspace.ps1"),
    ];
    input = JSON.stringify(request);
  } else if (existsSync("/usr/bin/gio")) {
    command = "/usr/bin/gio";
    args = ["trash", "--", request.root];
  } else {
    return { status: "unavailable" };
  }
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 16384,
  });
  if (result.status !== 0)
    throw new Error(
      `Native recoverable disposal failed: ${result.error?.code ?? result.status}; ${result.stderr}`,
    );
  return { status: "recycled" };
}
