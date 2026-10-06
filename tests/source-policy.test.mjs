// SPDX-License-Identifier: MPL-2.0
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const repository = fileURLToPath(new URL("../", import.meta.url));
const attributes =
  "* text=auto eol=lf\nplugins/*/notices/*.LICENSE -text !eol\n";
function git(root, ...arguments_) {
  return execFileSync("git", ["-C", root, ...arguments_], {
    timeout: 10000,
    windowsHide: true,
  });
}
function driftingInputs(root) {
  const failures = [];
  for (const entry of git(root, "ls-files", "--eol", "-z")
    .toString("utf8")
    .split("\0")) {
    if (!entry) {
      continue;
    }
    const split = entry.indexOf("\t");
    assert.ok(split !== -1);
    const metadata = entry.slice(0, split).trim().split(/\s+/u);
    if (metadata[2] === "attr/-text") {
      continue;
    }
    if (metadata.slice(0, 2).some((value) => /\/(crlf|mixed)$/u.test(value))) {
      failures.push(entry.slice(split + 1));
    }
  }
  return failures.sort();
}
test("authored tracked inputs use physical and indexed LF before evidence hashing", () => {
  assert.deepEqual(driftingInputs(repository), []);
  const rawPath = "plugins/example/notices/dependency.LICENSE";
  const policy = git(
    repository,
    "check-attr",
    "-z",
    "text",
    "eol",
    "--",
    rawPath,
  )
    .toString("utf8")
    .split("\0");
  assert.deepEqual(policy, [
    rawPath,
    "text",
    "unset",
    rawPath,
    "eol",
    "unspecified",
    "",
  ]);
});
test("native Git regression preserves original licence bytes and detects checkout drift", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-skills-source-eol-"));
  try {
    git(root, "init", "--quiet");
    git(root, "config", "core.autocrlf", "false");
    writeFileSync(join(root, ".gitattributes"), attributes);
    const licencePath = "plugins/example/notices/dependency.LICENSE";
    mkdirSync(dirname(join(root, licencePath)), { recursive: true });
    const original = Buffer.from(
      "Upstream copyright\r\nOriginal licence text\r\n",
    );
    writeFileSync(join(root, licencePath), original);
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 13, 10, 255]));
    const inputs = ["authored.json", "mixed-é.json", "space name.json"];
    if (process.platform !== "win32") {
      inputs.push("tab\tname.json");
    }
    for (const input of inputs) {
      writeFileSync(
        join(root, input),
        input.startsWith("mixed") ? "one\nsecond\r\n" : "one\r\nsecond\r\n",
      );
    }
    git(root, "add", "--all");
    assert.deepEqual(driftingInputs(root), [...inputs].sort());
    assert.deepEqual(
      git(root, "show", ":authored.json"),
      Buffer.from("one\nsecond\n"),
    );
    assert.deepEqual(git(root, "show", `:${licencePath}`), original);
    assert.deepEqual(readFileSync(join(root, licencePath)), original);
    for (const input of inputs) {
      writeFileSync(
        join(root, input),
        readFileSync(join(root, input), "utf8").replaceAll("\r\n", "\n"),
      );
    }
    assert.deepEqual(driftingInputs(root), []);
    writeFileSync(
      join(root, ".gitattributes"),
      "plugins/*/notices/*.LICENSE -text !eol\n",
    );
    writeFileSync(join(root, "authored.json"), "one\r\nsecond\r\n");
    git(root, "add", "--all");
    writeFileSync(join(root, "authored.json"), "one\nsecond\n");
    assert.deepEqual(driftingInputs(root), ["authored.json"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
