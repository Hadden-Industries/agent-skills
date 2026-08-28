import assert from "node:assert/strict";
import test from "node:test";

import { semanticContentContract } from "../../src/committing-to-git/message/semanticContentContract.js";
import { validateCompleteSemanticContent } from "../../src/committing-to-git/message/semanticContentValidation.js";

function completeDetailedContent() {
  return {
    schemaVersion: 3,
    authoringState: "complete",
    evidenceGroups: [
      {
        selection: { all: true },
        policy: "reuse",
        basis: { kind: "authored-current-task", note: null },
      },
    ],
    subject: {
      type: "fix",
      scope: "parser",
      description: "Preserve parser behavior",
    },
    sharedRationales: [],
    userExperienceChanges: [],
    mode: "detailed",
    fileNotes: [],
  };
}

test("semantic authoring contracts are bounded, complete, and isolated per call", () => {
  const detailed = semanticContentContract("detailed");
  const bulk = semanticContentContract("bulk");

  assert.equal(detailed.schemaVersion, 1);
  assert.equal(detailed.contentSchemaVersion, 3);
  assert.deepEqual(detailed.completion, {
    field: "authoringState",
    value: "complete",
  });
  assert.deepEqual(detailed.helperOwnedFields, [
    "schemaVersion",
    "evidenceGroups",
    "mode",
  ]);
  assert.deepEqual(detailed.subject.requiredFields, [
    "type",
    "scope",
    "description",
  ]);
  assert.deepEqual(detailed.detailed.fileNote.requiredFields, [
    "selection",
    "reasons",
  ]);
  assert.equal(detailed.bulk, null);
  assert.deepEqual(bulk.bulk.domain.requiredFields, [
    "title",
    "selection",
    "reasons",
  ]);
  assert.equal(bulk.detailed, null);
  assert.deepEqual(detailed.selection.scopeFileContrast, {
    scopeFileField: "includePaths",
    semanticField: "destinationPaths",
  });
  assert.deepEqual(detailed.supportedSections, [
    "Rationale",
    "User Experience Changes",
    "File Changes",
  ]);
  assert.ok(Buffer.byteLength(JSON.stringify(detailed), "utf8") < 80 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(bulk), "utf8") < 80 * 1024);

  detailed.selection.allowedFields.push("invented");
  assert.equal(
    semanticContentContract("detailed").selection.allowedFields.includes(
      "invented",
    ),
    false,
  );
});

test("semantic structural validation accepts a complete detailed worksheet", () => {
  const validation = validateCompleteSemanticContent(completeDetailedContent());

  assert.equal(validation.valid, true);
  assert.equal(validation.diagnostics.count, 0);
  assert.deepEqual(validation.diagnostics.samples, []);
  assert.equal(validation.diagnostics.truncated, false);
  assert.match(validation.diagnostics.sha256, /^[0-9a-f]{64}$/u);
});

test("semantic structural validation reports stable bounded JSON-Pointer samples", () => {
  const malformed = completeDetailedContent();

  malformed.authoringState = "ready";
  malformed.subject = "fix(parser): Preserve parser behavior";
  malformed.fileNotes = [
    {
      selection: { includePaths: ["parser.js"] },
      notes: ["Preserve parser behavior"],
    },
  ];

  const first = validateCompleteSemanticContent(malformed);
  const second = validateCompleteSemanticContent(malformed);

  assert.deepEqual(second, first);
  assert.equal(first.valid, false);
  assert.equal(first.diagnostics.truncated, false);
  assert.equal(first.diagnostics.count, first.diagnostics.samples.length);
  assert.ok(first.diagnostics.count >= 6);
  assert.deepEqual(
    first.diagnostics.samples.map(({ pointer }) => pointer),
    [
      "/authoringState",
      "/subject",
      "/fileNotes/0/reasons",
      "/fileNotes/0/notes",
      "/fileNotes/0/selection/includePaths",
      "/fileNotes/0/selection",
    ],
  );
});

test("semantic structural validation hashes diagnostics beyond its fixed sample ceiling", () => {
  const malformed = completeDetailedContent();

  for (let index = 0; index < 80; index += 1) {
    malformed[`unknown-${String(index).padStart(2, "0")}`] = true;
  }

  const result = validateCompleteSemanticContent(malformed);

  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.count, 80);
  assert.equal(result.diagnostics.samples.length, 64);
  assert.equal(result.diagnostics.truncated, true);
  assert.match(result.diagnostics.sha256, /^[0-9a-f]{64}$/u);
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") < 80 * 1024);
});
