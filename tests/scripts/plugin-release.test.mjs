import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  gitBytes,
  readReleaseLedger,
  validateReleaseLedger,
} from "../../scripts/pluginRelease.js";

const first = { version: "0.1.1-dev.1", contentSha256: "a".repeat(64) };
function ledger(releases) {
  return { schemaVersion: 1, plugins: { "committing-to-git": releases } };
}

test("release bindings cannot be edited or removed; new versions must increase", () => {
  const previous = ledger([first]);
  assert.throws(
    () =>
      validateReleaseLedger(
        ledger([{ ...first, contentSha256: "b".repeat(64) }]),
        previous,
      ),
    /immutable/u,
  );
  assert.throws(() => validateReleaseLedger(ledger([]), previous), /Missing/u);
  assert.throws(
    () => validateReleaseLedger(ledger([first, { ...first }]), previous),
    /increase/u,
  );
  assert.throws(
    () =>
      validateReleaseLedger(ledger([{ ...first, version: "0.1.1-dev.01" }])),
    /numeric dev/u,
  );
  const next = ledger([
    first,
    { version: "0.1.1-dev.2", contentSha256: "b".repeat(64) },
  ]);
  assert.equal(validateReleaseLedger(next, previous), next);
  // Numeric comparison must not accidentally sort dev.10 below dev.9.
  assert.doesNotThrow(() =>
    validateReleaseLedger(
      ledger([
        { ...first, version: "0.1.1-dev.9" },
        { ...first, version: "0.1.1-dev.10" },
      ]),
    ),
  );
});

test("a checkout enforces committed bindings; source exports read their supplied ledger", () => {
  const root = mkdtempSync(join(tmpdir(), "plugin-release-ledger-"));
  try {
    mkdirSync(join(root, "scripts"));
    const path = join(root, "scripts/plugin-releases.json");
    writeFileSync(path, JSON.stringify(ledger([first])));
    assert.deepEqual(readReleaseLedger(root), ledger([first]));
    gitBytes(root, ["init", "-q"]);
    gitBytes(root, ["add", "scripts/plugin-releases.json"]);
    gitBytes(root, [
      "-c",
      "user.name=Release Test",
      "-c",
      "user.email=release@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    ]);
    writeFileSync(
      path,
      JSON.stringify(ledger([{ ...first, contentSha256: "b".repeat(64) }])),
    );
    assert.throws(() => readReleaseLedger(root), /immutable/u);
    writeFileSync(
      path,
      JSON.stringify(
        ledger([
          first,
          { version: "0.1.1-dev.2", contentSha256: "b".repeat(64) },
        ]),
      ),
    );
    assert.equal(
      readReleaseLedger(root).plugins["committing-to-git"][1].version,
      "0.1.1-dev.2",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
