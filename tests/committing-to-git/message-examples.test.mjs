import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateApprovedMessage } from "../../src/committing-to-git/message/approvedMessage.js";

const reference = readFileSync(
  new URL(
    "../../skills/committing-to-git/references/message-format.md",
    import.meta.url,
  ),
  "utf8",
);
const messages = [...reference.matchAll(/```text\r?\n([\s\S]*?)```/gu)].map(
  (match) => match[1].replaceAll("\r\n", "\n"),
);
const twoPaths = ["src/parser.js", "tests/parser.test.js"];
const tenPaths = [
  "src/csv.js",
  "src/fields.js",
  "src/import.js",
  "src/parser.js",
  "src/quotes.js",
  "src/records.js",
  "src/tsv.js",
  "tests/csv.test.js",
  "tests/parser.test.js",
  "tests/tsv.test.js",
];

test("complete reference examples pass the real message validator for their selected paths", () => {
  assert.equal(
    messages.length,
    4,
    "Expect subject, body, two-path and ten-path examples",
  );
  for (const [index, paths] of [
    twoPaths,
    twoPaths,
    twoPaths,
    tenPaths,
  ].entries()) {
    const result = validateApprovedMessage({
      manifest: {
        schemaVersion: 2,
        indexTreeOid: "a".repeat(40),
        changeUnitCount: paths.length,
        changeUnits: paths.map((path, ordinal) => ({
          id: `F${String(ordinal + 1).padStart(6, "0")}`,
          kind: "modified",
          sourcePath: null,
          destinationPath: path,
          sourcePathBytesBase64: null,
          destinationPathBytesBase64: Buffer.from(path).toString("base64"),
        })),
      },
      route: "extended",
      bytes: Buffer.from(messages[index]),
      repositoryTypePolicy: { allowedTypes: [] },
      messageSource: "checked-file",
    });
    assert.equal(result.valid, true);
    assert.equal(result.sections.fileChanges.present, index >= 2);
    assert.equal(result.presentationWarnings.count, 0);
  }
});
