import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMessagePath,
  resolveSelection,
  resolveSemanticCoverage,
  selectMessagePresentation,
} from "../../src/committing-to-git/message/changeSelection.js";

function unit(index, overrides = {}) {
  const ordinal = String(index).padStart(6, "0");
  const destinationPath = `src/parser/file-${ordinal}.js`;

  return {
    id: `F${ordinal}`,
    kind: "modified",
    sourcePath: null,
    destinationPath,
    sourcePathBytesBase64: null,
    destinationPathBytesBase64: Buffer.from(destinationPath).toString("base64"),
    ...overrides,
  };
}

function renamed(index, sourcePath, destinationPath) {
  return unit(index, {
    kind: "renamed",
    sourcePath,
    destinationPath,
    sourcePathBytesBase64: Buffer.from(sourcePath).toString("base64"),
    destinationPathBytesBase64: Buffer.from(destinationPath).toString("base64"),
  });
}

function manifestFixture(changeUnits) {
  return {
    schemaVersion: 2,
    indexTreeOid: "a".repeat(40),
    changeUnitCount: changeUnits.length,
    changeUnits,
  };
}

function evidence(selection = { all: true }) {
  return {
    selection,
    policy: "reuse",
    basis: { kind: "authored-current-task", note: null },
  };
}

test("selectors union exact IDs, paths, prefixes, and kinds without duplicates", () => {
  const units = [
    unit(1),
    unit(2, {
      kind: "added",
      destinationPath: "docs/guide.md",
      destinationPathBytesBase64:
        Buffer.from("docs/guide.md").toString("base64"),
    }),
    renamed(3, "legacy/input.js", "src/parser/input.js"),
    unit(4, {
      kind: "deleted",
      destinationPath: "legacy/removed.js",
      destinationPathBytesBase64:
        Buffer.from("legacy/removed.js").toString("base64"),
    }),
  ];
  const manifest = manifestFixture(units);
  const selected = resolveSelection(manifest, {
    ids: ["F000001"],
    destinationPaths: ["docs/guide.md"],
    destinationPathPrefixes: ["src/parser/"],
    sourcePaths: ["legacy/input.js"],
    sourcePathPrefixes: ["legacy/"],
    kinds: ["deleted"],
  });

  assert.deepEqual(
    selected.map(({ id }) => id),
    ["F000001", "F000002", "F000003", "F000004"],
  );
});

test("all and remaining are exclusive and remaining uses prior assignments", () => {
  const manifest = manifestFixture([unit(1), unit(2), unit(3)]);

  assert.deepEqual(
    resolveSelection(manifest, { all: true }).map(({ id }) => id),
    ["F000001", "F000002", "F000003"],
  );
  assert.deepEqual(
    resolveSelection(
      manifest,
      { remaining: true },
      {
        assignedIds: new Set(["F000001", "F000003"]),
      },
    ).map(({ id }) => id),
    ["F000002"],
  );
  assert.throws(
    () => resolveSelection(manifest, { all: true, ids: ["F000001"] }),
    /exclusive/u,
  );
  assert.throws(
    () => resolveSelection(manifest, { remaining: true, kinds: ["added"] }),
    /exclusive/u,
  );
});

test("every selector value must match and generic path selectors are rejected", () => {
  const manifest = manifestFixture([unit(1)]);

  for (const selection of [
    { ids: ["F999999"] },
    { destinationPaths: ["src/missing.js"] },
    { destinationPathPrefixes: ["tests/"] },
    { sourcePaths: ["src/parser/file-000001.js"] },
    { sourcePathPrefixes: ["src/"] },
    { kinds: ["added"] },
  ]) {
    assert.throws(
      () => resolveSelection(manifest, selection),
      /matched no change units/u,
    );
  }

  assert.throws(
    () => resolveSelection(manifest, { path: "src/parser/file-000001.js" }),
    /unknown.*path/iu,
  );
  assert.throws(
    () => resolveSelection(manifest, { pathPrefix: "src/parser/" }),
    /unknown.*pathPrefix/iu,
  );
  assert.throws(
    () => resolveSelection(manifest, { destinationPathPrefixes: ["src"] }),
    /end.*\//iu,
  );
});

test("source selectors apply only to true renames, never inferred copies", () => {
  const sourcePath = "src/shared.js";
  const addition = unit(1, {
    kind: "added",
    sourcePath,
    sourcePathBytesBase64: Buffer.from(sourcePath).toString("base64"),
    destinationPath: "src/copied-looking.js",
    destinationPathBytesBase64: Buffer.from("src/copied-looking.js").toString(
      "base64",
    ),
  });
  const rename = renamed(2, sourcePath, "src/renamed.js");
  const manifest = manifestFixture([addition, rename]);

  assert.deepEqual(
    resolveSelection(manifest, { sourcePaths: [sourcePath] }).map(
      ({ id }) => id,
    ),
    ["F000002"],
  );
});

test("path matching preserves Unicode normalization and non-UTF-8 identity", () => {
  const composed = "src/caf\u00e9.js";
  const decomposed = "src/cafe\u0301.js";
  const invalidBytes = Buffer.from([
    0x73, 0x72, 0x63, 0x2f, 0xff, 0x2e, 0x6a, 0x73,
  ]);
  const manifest = manifestFixture([
    unit(1, {
      destinationPath: composed,
      destinationPathBytesBase64: Buffer.from(composed).toString("base64"),
    }),
    unit(2, {
      destinationPath: decomposed,
      destinationPathBytesBase64: Buffer.from(decomposed).toString("base64"),
    }),
    unit(3, {
      destinationPath: "src/invalid.js",
      destinationPathBytesBase64: invalidBytes.toString("base64"),
    }),
  ]);

  assert.deepEqual(
    resolveSelection(manifest, { destinationPaths: [composed] }).map(
      ({ id }) => id,
    ),
    ["F000001"],
  );
  assert.deepEqual(
    resolveSelection(manifest, { destinationPaths: [decomposed] }).map(
      ({ id }) => id,
    ),
    ["F000002"],
  );
  assert.deepEqual(
    resolveSelection(manifest, { ids: ["F000003"] }).map(({ id }) => id),
    ["F000003"],
  );
  assert.throws(
    () =>
      resolveSelection(manifest, {
        destinationPaths: ["src/invalid.js"],
      }),
    /matched no change units/u,
  );
});

test("evidence groups and bulk domains partition exactly once", () => {
  const units = [unit(1), unit(2), unit(3)];
  const manifest = manifestFixture(units);
  const content = {
    evidenceGroups: [
      evidence({ ids: ["F000001"] }),
      evidence({ remaining: true }),
    ],
    sharedRationales: [],
    fileNotes: [],
    mode: "bulk",
    domains: [
      {
        title: "Parser core",
        selection: { destinationPathPrefixes: ["src/parser/"] },
        reasons: ["Keep parser behavior aligned"],
      },
    ],
  };
  const coverage = resolveSemanticCoverage(manifest, content);

  assert.deepEqual(coverage.coveredIds, new Set(units.map(({ id }) => id)));
  assert.equal(coverage.domains[0].units.length, 3);

  assert.throws(
    () =>
      resolveSemanticCoverage(manifest, {
        ...content,
        evidenceGroups: [
          evidence({ all: true }),
          evidence({ ids: ["F000001"] }),
        ],
      }),
    /overlap.*F000001/iu,
  );
  assert.throws(
    () =>
      resolveSemanticCoverage(manifest, {
        ...content,
        evidenceGroups: [evidence({ ids: ["F000001"] })],
      }),
    /omitted|exhaustive/iu,
  );
  assert.throws(
    () =>
      resolveSemanticCoverage(manifest, {
        ...content,
        domains: [
          {
            title: "First",
            selection: { all: true },
            reasons: ["Cover all files"],
          },
          {
            title: "Second",
            selection: { ids: ["F000001"] },
            reasons: ["Overlap one file"],
          },
        ],
      }),
    /domain.*overlap.*F000001/iu,
  );
});

test("a rename cannot place its source and destination in different counted domains", () => {
  const manifest = manifestFixture([
    renamed(1, "legacy/parser.js", "src/parser/parser.js"),
  ]);

  assert.throws(
    () =>
      resolveSemanticCoverage(manifest, {
        evidenceGroups: [evidence()],
        sharedRationales: [],
        fileNotes: [],
        mode: "bulk",
        domains: [
          {
            title: "Legacy",
            selection: { sourcePathPrefixes: ["legacy/"] },
            reasons: ["Retire legacy path"],
          },
          {
            title: "Maintained",
            selection: { destinationPathPrefixes: ["src/parser/"] },
            reasons: ["Use maintained path"],
          },
        ],
      }),
    /domain.*overlap.*F000001/iu,
  );
});

test("shared rationales may overlap and file notes remain nonexclusive", () => {
  const manifest = manifestFixture([unit(1), unit(2)]);
  const coverage = resolveSemanticCoverage(manifest, {
    evidenceGroups: [evidence()],
    sharedRationales: [
      {
        selection: { all: true },
        reasons: ["Keep the parser contract stable"],
      },
      {
        selection: { ids: ["F000001"] },
        reasons: ["Preserve the fast path"],
      },
    ],
    fileNotes: [
      {
        selection: { ids: ["F000001"] },
        reasons: ["Retain the old diagnostic code"],
      },
      {
        selection: { all: true },
        reasons: ["Maintain file-specific migration notes"],
      },
    ],
    mode: "detailed",
  });

  assert.equal(coverage.sharedRationales.length, 2);
  assert.equal(coverage.sharedRationales[0].units.length, 2);
  assert.equal(coverage.sharedRationales[1].units.length, 1);
  assert.equal(coverage.fileNotes.length, 2);
});

test("reuse basis policy is strict and final remaining is positional", () => {
  const manifest = manifestFixture([unit(1), unit(2)]);
  const base = {
    sharedRationales: [],
    fileNotes: [],
    mode: "detailed",
  };

  for (const kind of ["user-grounded", "unknown-preexisting"]) {
    assert.throws(
      () =>
        resolveSemanticCoverage(manifest, {
          ...base,
          evidenceGroups: [
            {
              selection: { all: true },
              policy: "reuse",
              basis: { kind, note: null },
            },
          ],
        }),
      /reuse evidence requires/iu,
    );
  }

  assert.throws(
    () =>
      resolveSemanticCoverage(manifest, {
        ...base,
        evidenceGroups: [
          evidence({ remaining: true }),
          evidence({ ids: ["F000001"] }),
        ],
      }),
    /remaining.*final/iu,
  );
});

test("one all-selector covers a thousand-file domain without an ID array", () => {
  const units = Array.from({ length: 1_000 }, (_, index) => unit(index + 1));
  const manifest = manifestFixture(units);
  const content = {
    evidenceGroups: [evidence()],
    sharedRationales: [],
    userExperienceChanges: [],
    fileNotes: [],
    mode: "bulk",
    domains: [
      {
        title: "Parser migration",
        selection: { all: true },
        reasons: ["Keep generated parser artifacts synchronized"],
      },
    ],
  };
  const coverage = resolveSemanticCoverage(manifest, content);

  assert.equal(coverage.coveredIds.size, 1_000);
  assert.ok(Buffer.byteLength(JSON.stringify(content)) < 8 * 1024);
});

test("message presentation changes at semantic and byte boundaries", () => {
  assert.equal(
    selectMessagePresentation({
      changeUnitCount: 49,
      projectedDetailedBytes: 32_768,
    }),
    "detailed",
  );
  assert.equal(
    selectMessagePresentation({
      changeUnitCount: 50,
      projectedDetailedBytes: 1,
    }),
    "bulk",
  );
  assert.equal(
    selectMessagePresentation({
      changeUnitCount: 1,
      projectedDetailedBytes: 32_767,
    }),
    "detailed",
  );
  assert.equal(
    selectMessagePresentation({
      changeUnitCount: 1,
      projectedDetailedBytes: 32_769,
    }),
    "bulk",
  );
});

test("message paths are reversible without normalization or replacement text", () => {
  assert.equal(formatMessagePath(Buffer.from("src/file.js")), "`src/file.js`");

  for (const bytes of [
    Buffer.from("src/line\nbreak.js"),
    Buffer.from("src/back`tick.js"),
    Buffer.from("src/zero\u200bwidth.js"),
    Buffer.from([0x73, 0x72, 0x63, 0x2f, 0xff]),
  ]) {
    const rendered = formatMessagePath(bytes);

    assert.equal(rendered, `\`path-bytes-base64:${bytes.toString("base64")}\``);
    assert.doesNotMatch(rendered, /\ufffd/u);
  }
});
