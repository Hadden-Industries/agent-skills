// Snapshot binding for the structured canonical message route.
import assert from "node:assert/strict";
import test from "node:test";

import { renderCommitMessage } from "../../src/committing-to-git/message/commitMessageRenderer.js";

test("the structured renderer binds v2 content and rejects old worksheets", () => {
  const path = "src/parser.js";
  const manifest = {
    schemaVersion: 2,
    indexTreeOid: "e".repeat(40),
    changeUnitCount: 1,
    changeUnits: [
      {
        id: "F000001",
        kind: "modified",
        sourcePath: null,
        destinationPath: path,
        sourcePathBytesBase64: null,
        destinationPathBytesBase64: Buffer.from(path).toString("base64"),
      },
    ],
  };
  const groups = [
    {
      selection: { all: true },
      policy: "review",
      basis: {
        kind: "unknown-preexisting",
        note: "The user requested review of the parser change",
      },
    },
  ];
  const catalog = {
    catalogSha256: "c".repeat(64),
    evidencePlanSha256: "d".repeat(64),
  };
  const evidencePlan = {
    evidencePlanSha256: "d".repeat(64),
    groups,
  };
  const content = {
    schemaVersion: 2,
    authoringState: "complete",
    review: {
      schemaVersion: 1,
      catalogSha256: catalog.catalogSha256,
      evidencePlanSha256: evidencePlan.evidencePlanSha256,
      requiredPacketsReviewed: true,
      additionalPacketIds: [],
    },
    evidenceGroups: groups,
    subject: {
      type: "fix",
      scope: "parser",
      description: "Prevent malformed token acceptance",
    },
    sharedRationales: [],
    userExperienceChanges: [],
    mode: "detailed",
    fileNotes: [],
  };
  const rendered = renderCommitMessage({
    manifest,
    content,
    reviewCatalog: catalog,
    evidencePlan,
    repositoryTypePolicy: { allowedTypes: ["fix"] },
  });

  assert.equal(rendered.validation.valid, true);
  assert.equal(rendered.validation.messageSha256.length, 64);
  assert.match(rendered.displayText, /`src\/parser\.js`/u);

  assert.throws(
    () =>
      renderCommitMessage({
        manifest,
        content: {
          subject: content.subject,
          rationale: [],
          userExperienceChanges: [],
          mode: "detailed",
          changeEntries: [],
        },
        reviewCatalog: catalog,
        evidencePlan,
      }),
    (error) => error.code === "INCOMPLETE_SEMANTIC_CONTENT",
  );
});
