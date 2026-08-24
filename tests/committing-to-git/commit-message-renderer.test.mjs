// Structured canonical output after removal of the low-level CLI.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ordinalLayout,
  renderCommitMessage,
  scaffoldContent,
} from "../../src/committing-to-git/message/commitMessageRenderer.js";

const CATALOG_SHA256 = "c".repeat(64);
const PLAN_SHA256 = "d".repeat(64);

function changeUnit(id, path) {
  return {
    id,
    kind: "modified",
    sourcePath: null,
    destinationPath: path,
    path,
    sourcePathBytesBase64: null,
    destinationPathBytesBase64: Buffer.from(path).toString("base64"),
    displayPath: path,
  };
}

function structuredManifest(count, overrides = {}) {
  const changeUnits = Array.from({ length: count }, (_, index) =>
    changeUnit(
      `F${String(index + 1).padStart(6, "0")}`,
      `src/domain/file-${String(index + 1).padStart(4, "0")}.js`,
    ),
  );

  return {
    schemaVersion: 2,
    indexTreeOid: "7".repeat(40),
    changeUnitCount: changeUnits.length,
    changeUnits,
    ...overrides,
  };
}

function reviewReceipt() {
  return {
    schemaVersion: 1,
    catalogSha256: CATALOG_SHA256,
    evidencePlanSha256: PLAN_SHA256,
    requiredPacketsReviewed: true,
    additionalPacketIds: [],
  };
}

function evidenceGroups() {
  return [
    {
      selection: { all: true },
      policy: "reuse",
      basis: { kind: "authored-current-task", note: null },
    },
  ];
}

function detailedContent(overrides = {}) {
  return {
    schemaVersion: 2,
    authoringState: "complete",
    review: reviewReceipt(),
    evidenceGroups: evidenceGroups(),
    subject: {
      type: "refactor",
      scope: "parser",
      description: "Simplify parser dispatch",
    },
    sharedRationales: [],
    userExperienceChanges: [],
    mode: "detailed",
    fileNotes: [],
    ...overrides,
  };
}

function bulkContent(overrides = {}) {
  return {
    schemaVersion: 2,
    authoringState: "complete",
    review: reviewReceipt(),
    evidenceGroups: evidenceGroups(),
    subject: {
      type: "build",
      scope: "generated",
      description: "Synchronize generated parser sources",
    },
    sharedRationales: [],
    userExperienceChanges: [],
    mode: "bulk",
    domains: [
      {
        title: "Generated parser sources",
        selection: { all: true },
        reasons: ["Keep generated output aligned with the grammar"],
      },
    ],
    ...overrides,
  };
}

function renderStructured(manifest, content) {
  return renderCommitMessage({
    manifest,
    content,
    reviewCatalog: {
      catalogSha256: CATALOG_SHA256,
      evidencePlanSha256: PLAN_SHA256,
    },
    evidencePlan: {
      evidencePlanSha256: PLAN_SHA256,
      groups: evidenceGroups(),
    },
    repositoryTypePolicy: { allowedTypes: [] },
  });
}

test("one ordinal formula aligns titles, bullets, and continuations through four digits", () => {
  for (const [itemCount, index, expected] of [
    [
      1,
      1,
      {
        titlePrefix: "  1. ",
        bulletPrefix: "     - ",
        continuationPrefix: "       ",
      },
    ],
    [
      10,
      1,
      {
        titlePrefix: "   1. ",
        bulletPrefix: "      - ",
        continuationPrefix: "        ",
      },
    ],
    [
      100,
      1,
      {
        titlePrefix: "    1. ",
        bulletPrefix: "       - ",
        continuationPrefix: "         ",
      },
    ],
    [
      1_000,
      1,
      {
        titlePrefix: "     1. ",
        bulletPrefix: "        - ",
        continuationPrefix: "          ",
      },
    ],
  ]) {
    assert.deepEqual(ordinalLayout(index, itemCount), expected);
  }
});

test("structured detailed rendering shares rationale and derives path layout", () => {
  const rendered = renderStructured(
    structuredManifest(10),
    detailedContent({
      sharedRationales: [
        {
          selection: { all: true },
          reasons: ["Keep parser behavior consistent across dispatch paths"],
        },
      ],
      fileNotes: [
        {
          selection: { ids: ["F000001"] },
          reasons: ["Preserve the diagnostic code for callers"],
        },
      ],
    }),
  );

  assert.match(rendered.displayText, /^refactor\(parser\):/u);
  assert.match(rendered.displayText, /Rationale:\n {2}- Keep parser behavior/u);
  assert.match(
    rendered.displayText,
    /File Changes:\n {3}1\. `src\/domain\/file-0001\.js`/u,
  );
  assert.doesNotMatch(rendered.displayText, /File Changes \(10 files\):/u);
  assert.equal(rendered.validation.valid, true);
});

test("a file note cannot repeat a shared reason byte-for-byte", () => {
  const reason = "Keep parser behavior consistent";

  assert.throws(
    () =>
      renderStructured(
        structuredManifest(1),
        detailedContent({
          sharedRationales: [{ selection: { all: true }, reasons: [reason] }],
          fileNotes: [{ selection: { all: true }, reasons: [reason] }],
        }),
      ),
    /duplicates a shared rationale/iu,
  );
});

test("bulk counts derive singular, plural, rename-as-one, and additions", () => {
  const rename = {
    ...changeUnit("F000001", "src/new.js"),
    kind: "renamed",
    sourcePath: "old/entry.js",
    sourcePathBytesBase64: Buffer.from("old/entry.js").toString("base64"),
  };
  const addition = {
    ...changeUnit("F000002", "src/new-adapter.js"),
    kind: "added",
    sourcePath: "old/entry.js",
    sourcePathBytesBase64: Buffer.from("old/entry.js").toString("base64"),
  };
  const rendered = renderStructured(
    structuredManifest(2, { changeUnits: [rename, addition] }),
    bulkContent({
      domains: [
        {
          title: "Rename migration",
          selection: { ids: ["F000001"] },
          reasons: ["Move the implementation to its maintained path"],
        },
        {
          title: "New adapter",
          selection: { remaining: true },
          reasons: ["Add the adapter without inventing copy provenance"],
        },
      ],
    }),
  );

  assert.match(rendered.displayText, /1\. Rename migration \(1 file\)/u);
  assert.match(rendered.displayText, /2\. New adapter \(1 file\)/u);
  assert.deepEqual(
    rendered.coverage.domains.map(({ units }) => units.length),
    [1, 1],
  );
});

test("structured paths preserve Unicode and lossless byte fallbacks", () => {
  const unicodePath = "src/caf\u00e9.js";
  const invalid = Buffer.from([0x73, 0x72, 0x63, 0x2f, 0xff]);
  const rendered = renderStructured(
    structuredManifest(2, {
      changeUnits: [
        changeUnit("F000001", unicodePath),
        {
          ...changeUnit("F000002", "src/invalid"),
          destinationPathBytesBase64: invalid.toString("base64"),
        },
      ],
    }),
    detailedContent(),
  );

  assert.match(rendered.displayText, /`src\/caf\u00e9\.js`/u);
  assert.match(
    rendered.displayText,
    new RegExp(invalid.toString("base64"), "u"),
  );
  assert.doesNotMatch(rendered.displayText, /�/u);
});

test("a thousand-file scaffold and bulk render stay selector-sized", () => {
  const manifest = structuredManifest(1_000);
  const evidencePlan = {
    evidencePlanSha256: PLAN_SHA256,
    groups: evidenceGroups(),
  };
  const catalog = {
    catalogSha256: CATALOG_SHA256,
    evidencePlanSha256: PLAN_SHA256,
    requiredSynopsisPacketIds: [],
    exactInventoryPacketIds: [],
    fullPatchPacketIds: [],
  };
  const scaffold = scaffoldContent(manifest, catalog, evidencePlan);
  const rendered = renderStructured(manifest, bulkContent());

  assert.equal(scaffold.recommendedMode, "bulk");
  assert.ok(Buffer.byteLength(JSON.stringify(scaffold)) < 8 * 1024);
  assert.match(
    rendered.displayText,
    /Generated parser sources \(1000 files\)/u,
  );
  assert.ok(Buffer.byteLength(rendered.displayText) < 1_000);
  assert.equal(rendered.validation.files.listedCount, 1_000);
});

test("forty-nine unusually long paths recommend selector-sized bulk content", () => {
  const changeUnits = Array.from({ length: 49 }, (_, index) => {
    const path = `src/${String(index).padStart(2, "0")}-${"x".repeat(800)}.js`;

    return changeUnit(`F${String(index + 1).padStart(6, "0")}`, path);
  });
  const manifest = structuredManifest(49, { changeUnits });
  const scaffold = scaffoldContent(
    manifest,
    {
      catalogSha256: CATALOG_SHA256,
      evidencePlanSha256: PLAN_SHA256,
      requiredSynopsisPacketIds: [],
      exactInventoryPacketIds: [],
      fullPatchPacketIds: [],
    },
    { evidencePlanSha256: PLAN_SHA256, groups: evidenceGroups() },
  );

  assert.equal(scaffold.recommendedMode, "bulk");
  assert.ok(Buffer.byteLength(JSON.stringify(scaffold)) < 8 * 1024);
});

test("evidence binding ignores key and selector-value presentation order", () => {
  const manifest = structuredManifest(2);
  const content = detailedContent({
    evidenceGroups: [
      {
        selection: { kinds: ["modified"], ids: ["F000002", "F000001"] },
        policy: "reuse",
        basis: { note: null, kind: "authored-current-task" },
      },
    ],
  });

  assert.doesNotThrow(() =>
    renderCommitMessage({
      manifest,
      content,
      reviewCatalog: {
        catalogSha256: CATALOG_SHA256,
        evidencePlanSha256: PLAN_SHA256,
      },
      evidencePlan: {
        evidencePlanSha256: PLAN_SHA256,
        groups: [
          {
            selection: {
              ids: ["F000001", "F000002"],
              kinds: ["modified"],
            },
            policy: "reuse",
            basis: { kind: "authored-current-task", note: null },
          },
        ],
      },
      repositoryTypePolicy: { allowedTypes: [] },
    }),
  );
});
