import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  COMMAND_ARGUMENTS,
  commandOptions,
} from "../../src/committing-to-git/cli/commandArguments.js";

const cli = fileURLToPath(
  new URL("../../src/committing-to-git/cli/commitWorkflow.js", import.meta.url),
);

const optionsByCommand = Object.fromEntries(
  Object.keys(COMMAND_ARGUMENTS).map((command) => [
    command,
    Object.keys(commandOptions(command)),
  ]),
);

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
    for (const option of [...options, "help"]) {
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
