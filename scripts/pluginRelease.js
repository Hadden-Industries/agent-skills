import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const releaseLedgerPath = "scripts/plugin-releases.json";

// Git owns revision parsing and object retrieval. Arguments are never a shell
// command; status/release inspection does not execute installed plugin code.
export function gitBytes(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// These are deliberately only our ordered dev-release identifiers, not a
// replacement for a general SemVer parser. BigInt avoids numeric truncation.
function releaseNumbers(version) {
  if (
    typeof version !== "string" ||
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-dev\.([1-9][0-9]*)$/u.test(
      version,
    )
  ) {
    throw new Error(`Expected an ordered numeric dev version; got ${version}.`);
  }
  return version.replace("-dev.", ".").split(".").map(BigInt);
}

function orderedAfter(left, right) {
  const previous = releaseNumbers(right);
  const next = releaseNumbers(left);
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== previous[index]) {
      return next[index] > previous[index];
    }
  }
  return false;
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

// A ledger is append-only relative to the checkout's committed ledger. Source
// exports have no Git history; their ledger is an input, not authenticated proof.
export function validateReleaseLedger(ledger, previous) {
  if (
    !exactKeys(ledger, ["schemaVersion", "plugins"]) ||
    ledger.schemaVersion !== 1 ||
    !exactKeys(ledger.plugins, ["committing-to-git"])
  ) {
    throw new Error("Invalid plugin release ledger schema/version.");
  }
  for (const [name, releases] of Object.entries(ledger.plugins)) {
    if (!Array.isArray(releases) || releases.length === 0) {
      throw new Error(`Missing release records for ${name}.`);
    }
    for (const [index, release] of releases.entries()) {
      if (
        !exactKeys(release, ["version", "contentSha256"]) ||
        typeof release.contentSha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(release.contentSha256)
      ) {
        throw new Error(`Invalid release record for ${name}.`);
      }
      releaseNumbers(release.version);
      if (
        index > 0 &&
        !orderedAfter(release.version, releases[index - 1].version)
      ) {
        throw new Error(`Release versions must increase for ${name}.`);
      }
    }
    const oldReleases = previous?.plugins?.[name] ?? [];
    if (
      releases.length < oldReleases.length ||
      oldReleases.some(
        (old, index) =>
          old.version !== releases[index].version ||
          old.contentSha256 !== releases[index].contentSha256,
      )
    ) {
      throw new Error(
        `Release bindings are immutable for ${name}; append a new release.`,
      );
    }
  }
  return ledger;
}

export function readReleaseLedger(repositoryRoot) {
  const ledger = JSON.parse(
    readFileSync(join(repositoryRoot, releaseLedgerPath), "utf8"),
  );
  if (!existsSync(join(repositoryRoot, ".git"))) {
    return validateReleaseLedger(ledger);
  }
  let previous;
  const tree = gitBytes(repositoryRoot, [
    "ls-tree",
    "HEAD",
    "--",
    releaseLedgerPath,
  ]);
  if (tree.length > 0) {
    previous = validateReleaseLedger(
      JSON.parse(
        gitBytes(repositoryRoot, ["show", `HEAD:${releaseLedgerPath}`]),
      ),
    );
  }
  return validateReleaseLedger(ledger, previous);
}

// This inventory digest binds every published input, including host manifest
// fields, while excluding only the manifests' version fields to avoid a cycle.
export function packageInputSha256(files, manifests) {
  const digest = createHash("sha256");
  for (const [path, bytes] of [...files, ...manifests].sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  )) {
    digest.update(JSON.stringify([path, sha256(bytes)]));
  }
  return digest.digest("hex");
}
