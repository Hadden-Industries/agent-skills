import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(
  new URL("../../src/committing-to-git/cli/commitWorkflow.js", import.meta.url),
);

const optionsByCommand = {
  "workflow prepare": [
    "mode",
    "scope",
    "evidence",
    "basis",
    "evidence-plan",
    "scope-file",
    "path",
    "path-prefix",
    "exclude-path",
    "exclude-path-prefix",
    "allowed-type",
    "verification",
  ],
  "workflow resume": ["transaction"],
  "workflow extend": ["transaction", "reason"],
  "workflow review-next": ["transaction", "cursor"],
  "workflow promote": ["transaction"],
  "message check": ["transaction"],
  "message finalize": ["transaction"],
  "workflow check": [
    "transaction",
    "label",
    "working-directory",
    "timeout-ms",
    "retry-after-attempt",
  ],
  "workflow check-detail": [
    "transaction",
    "receipt",
    "stream",
    "segment",
    "offset",
  ],
  "workflow commit": [
    "transaction",
    "message",
    "verification",
    "acknowledge-failed-check",
    "retain-review-artifacts",
    "retain-process-logs",
  ],
  "workflow verify": ["transaction", "verification"],
  "workflow report-detail": ["transaction", "cursor", "refresh"],
  "workflow publish": [
    "transaction",
    "remote",
    "destination",
    "retry-after-attempt",
  ],
  "workflow recover": ["transaction", "resolution"],
  "workflow cleanup": ["transaction", "purge"],
};

for (const [command, options] of Object.entries(optionsByCommand)) {
  test(`${command} help describes every accepted option without a transaction`, () => {
    const result = spawnSync(
      process.execPath,
      [cli, ...command.split(" "), "--help"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const descriptions = result.stdout.split("Options:\n")[1];
    assert.ok(
      descriptions,
      "Help must include option descriptions, not only a synopsis",
    );
    for (const option of [...options, "format", "help"]) {
      assert.match(
        descriptions,
        new RegExp(`^  --${option}(?:[ ,<]|$)`, "m"),
        option,
      );
    }
    assert.match(descriptions, /default: json/i);
    assert.match(descriptions, /repeatable/i);
  });
}
