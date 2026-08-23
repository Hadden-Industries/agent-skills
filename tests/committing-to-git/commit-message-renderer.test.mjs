// Canonical commit-message scaffolding, ordering, rendering, and path identity.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  ordinalLayout,
  renderCommitMessage as renderStructuredMessage,
  scaffoldContent as scaffoldStructuredContent,
} from "../../src/committing-to-git/message/commitMessageRenderer.js";
import { createRepositoryFixture, runCommitWorkflow } from "./harness.mjs";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

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

test("detailed rendering binary-sorts paths and right-aligns ordinals and nested prose", (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-render-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const ledgerPath = join(fixture.scratch, "ledger.json");
  const outputPath = join(fixture.scratch, "commit-message.txt");
  const units = Array.from({ length: 12 }, (_, index) => {
    const number = 12 - index;

    return changeUnit(
      `F${String(number).padStart(6, "0")}`,
      `src/file-${number}.js`,
    );
  });

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "a".repeat(40),
    changeUnitCount: units.length,
    changeUnits: units,
  });
  writeJson(ledgerPath, {
    schemaVersion: 1,
    indexTreeOid: "a".repeat(40),
    complete: true,
  });
  writeJson(contentPath, {
    subject: {
      type: "feat",
      scope: "parser",
      description: "Prevent parser regressions",
    },
    rationale: [],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: units.map((unit) => ({
      changeUnitId: unit.id,
      reasons: [`Prevent regression for ${unit.destinationPath}`],
    })),
  });

  const result = runCommitWorkflow(
    "message render",
    [
      "--manifest",
      manifestPath,
      "--content",
      contentPath,
      "--ledger",
      ledgerPath,
      "--output",
      outputPath,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const message = readFileSync(outputPath, "utf8");
  const lines = message.split("\n");

  assert.deepEqual(lines.slice(0, 7), [
    "feat(parser): Prevent parser regressions",
    "",
    "File Changes:",
    " 1. `src/file-1.js`",
    "    - Prevent regression for src/file-1.js",
    " 2. `src/file-10.js`",
    "    - Prevent regression for src/file-10.js",
  ]);
  assert.ok(lines.includes("10. `src/file-7.js`"));
  assert.ok(lines.includes("    - Prevent regression for src/file-7.js"));
  assert.equal(message.endsWith("\n"), true);
});

test("legacy copy-detected manifests render only the added destination", (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-legacy-copy-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const ledgerPath = join(fixture.scratch, "ledger.json");
  const outputPath = join(fixture.scratch, "commit-message.txt");
  const sourcePath = "src/source-parser.js";
  const destinationPath = "src/adapted-parser.js";

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "8".repeat(40),
    changeUnitCount: 1,
    changeUnits: [
      {
        id: "F000001",
        kind: "copied",
        sourcePath,
        destinationPath,
        path: null,
        sourcePathBytesBase64: Buffer.from(sourcePath).toString("base64"),
        destinationPathBytesBase64:
          Buffer.from(destinationPath).toString("base64"),
        displayPath: `${sourcePath} -> ${destinationPath}`,
      },
    ],
  });
  writeJson(ledgerPath, {
    schemaVersion: 1,
    indexTreeOid: "8".repeat(40),
    complete: true,
  });
  writeJson(contentPath, {
    subject: {
      type: "feat",
      scope: "parser",
      description: "Add adapted parser support",
    },
    rationale: [],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: [
      {
        changeUnitId: "F000001",
        reasons: [
          "Reuse established parser constraints for the new syntax boundary",
        ],
      },
    ],
  });

  const result = runCommitWorkflow(
    "message render",
    [
      "--manifest",
      manifestPath,
      "--content",
      contentPath,
      "--ledger",
      ledgerPath,
      "--output",
      outputPath,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const message = readFileSync(outputPath, "utf8");

  assert.match(message, /^1\. `src\/adapted-parser\.js`$/mu);
  assert.doesNotMatch(message, /source-parser|copied/u);
});

test("fifty-file scaffolding switches to a compact bulk-domain template", (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-bulk-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const templatePath = join(fixture.scratch, "commit-message.template.txt");
  const units = Array.from({ length: 50 }, (_, index) =>
    changeUnit(
      `F${String(index + 1).padStart(6, "0")}`,
      `src/file-${index + 1}.js`,
    ),
  );

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "b".repeat(40),
    changeUnitCount: units.length,
    changeUnits: units,
  });

  const result = runCommitWorkflow(
    "message scaffold",
    [
      "--manifest",
      manifestPath,
      "--output",
      contentPath,
      "--template",
      templatePath,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, "bulk");
  assert.equal(JSON.parse(readFileSync(contentPath, "utf8")).mode, "bulk");

  const template = readFileSync(templatePath, "utf8");

  assert.match(template, /File Changes:\n1\. <name a semantic domain>/u);
  assert.doesNotMatch(template, /File Changes \(50 files\):/u);
  assert.doesNotMatch(template, /src\/file-50\.js/u);
});

test("message scaffolding refuses to replace either existing output", (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-collision-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const templatePath = join(fixture.scratch, "commit-message.template.txt");
  const existing = "authored content\n";
  const unit = changeUnit("F000001", "src/file.js");

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "c".repeat(40),
    changeUnitCount: 1,
    changeUnits: [unit],
  });
  writeFileSync(contentPath, existing);

  const result = runCommitWorkflow(
    "message scaffold",
    [
      "--manifest",
      manifestPath,
      "--output",
      contentPath,
      "--template",
      templatePath,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /already exists/u);
  assert.equal(readFileSync(contentPath, "utf8"), existing);
  assert.throws(() => readFileSync(templatePath, "utf8"), /ENOENT/u);
});

test("a detailed scaffold renders for review but cannot be committed unchanged", (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-scaffold-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const templatePath = join(fixture.scratch, "commit-message.template.txt");
  const ledgerPath = join(fixture.scratch, "ledger.json");
  const outputPath = join(fixture.scratch, "commit-message.txt");
  const unit = changeUnit("F000001", "src/file.js");

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "9".repeat(40),
    changeUnitCount: 1,
    changeUnits: [unit],
  });
  writeJson(ledgerPath, {
    schemaVersion: 1,
    indexTreeOid: "9".repeat(40),
    complete: true,
  });

  const scaffold = runCommitWorkflow(
    "message scaffold",
    [
      "--manifest",
      manifestPath,
      "--output",
      contentPath,
      "--template",
      templatePath,
    ],
    fixture.repo,
  );

  assert.equal(scaffold.status, 0, scaffold.stderr);
  assert.match(readFileSync(templatePath, "utf8"), /Explain the outcome/u);

  const render = runCommitWorkflow(
    "message render",
    [
      "--manifest",
      manifestPath,
      "--content",
      contentPath,
      "--ledger",
      ledgerPath,
      "--output",
      outputPath,
    ],
    fixture.repo,
  );

  assert.equal(render.status, 2);
  assert.match(render.stderr, /placeholder/u);
});

test("bulk rendering summarizes one thousand changes without narrating paths", (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-thousand-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const ledgerPath = join(fixture.scratch, "ledger.json");
  const outputPath = join(fixture.scratch, "commit-message.txt");
  const units = Array.from({ length: 1_000 }, (_, index) =>
    changeUnit(
      `F${String(index + 1).padStart(6, "0")}`,
      `src/generated/file-${String(index + 1).padStart(4, "0")}.js`,
    ),
  );
  const domains = Array.from({ length: 4 }, (_, domainIndex) => {
    const start = domainIndex * 250;

    return {
      title: `Generated domain ${domainIndex + 1}`,
      changeUnitIds: units.slice(start, start + 250).map(({ id }) => id),
      reasons: [`Keep generated domain ${domainIndex + 1} synchronized`],
    };
  });

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "c".repeat(40),
    changeUnitCount: units.length,
    changeUnits: units,
  });
  writeJson(ledgerPath, {
    schemaVersion: 1,
    indexTreeOid: "c".repeat(40),
    complete: true,
  });
  writeJson(contentPath, {
    subject: {
      type: "build",
      scope: "generated",
      description: "Keep generated sources synchronized",
    },
    rationale: ["Avoid hand-maintained drift across generated artifacts"],
    userExperienceChanges: [],
    mode: "bulk",
    domains,
  });

  const result = runCommitWorkflow(
    "message render",
    [
      "--manifest",
      manifestPath,
      "--content",
      contentPath,
      "--ledger",
      ledgerPath,
      "--output",
      outputPath,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);

  const message = readFileSync(outputPath, "utf8");
  const domainLines = message
    .split("\n")
    .filter((line) => /^\d+\. Generated domain \d+ \(250 files\)$/u.test(line));

  assert.equal(domainLines.length, 4);
  assert.doesNotMatch(message, /src\/generated\/file-/u);
  assert.ok(message.length < 1_000);
});

test("rendering rejects unsafe or noncanonical subject fields", async (t) => {
  const cases = [
    {
      name: "lowercase description",
      subject: {
        type: "fix",
        scope: null,
        description: "prevent ambiguous subjects",
      },
      expected: /capital/u,
    },
    {
      name: "newline in description",
      subject: {
        type: "fix",
        scope: null,
        description: "Prevent ambiguity\nInjected subject",
      },
      expected: /control|newline/u,
    },
    {
      name: "subject syntax in scope",
      subject: {
        type: "fix",
        scope: "parser)\nInjected",
        description: "Prevent ambiguous scopes",
      },
      expected: /scope/u,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, (subtest) => {
      const fixture = createRepositoryFixture(
        subtest,
        "commit-message-subject-",
      );
      const manifestPath = join(fixture.scratch, "snapshot.json");
      const contentPath = join(fixture.scratch, "content.json");
      const ledgerPath = join(fixture.scratch, "ledger.json");
      const outputPath = join(fixture.scratch, "commit-message.txt");
      const unit = changeUnit("F000001", "src/file.js");

      writeJson(manifestPath, {
        schemaVersion: 1,
        indexTreeOid: "f".repeat(40),
        changeUnitCount: 1,
        changeUnits: [unit],
      });
      writeJson(ledgerPath, {
        schemaVersion: 1,
        indexTreeOid: "f".repeat(40),
        complete: true,
      });
      writeJson(contentPath, {
        subject: testCase.subject,
        rationale: [],
        userExperienceChanges: [],
        mode: "detailed",
        changeEntries: [
          {
            changeUnitId: unit.id,
            reasons: ["Keep the subject contract deterministic"],
          },
        ],
      });

      const result = runCommitWorkflow(
        "message render",
        [
          "--manifest",
          manifestPath,
          "--content",
          contentPath,
          "--ledger",
          ledgerPath,
          "--output",
          outputPath,
        ],
        fixture.repo,
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, testCase.expected);
    });
  }
});

test("less-than comparisons in narrative text are not mistaken for placeholders", (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-comparison-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const ledgerPath = join(fixture.scratch, "ledger.json");
  const outputPath = join(fixture.scratch, "commit-message.txt");
  const unit = changeUnit("F000001", "package.json");

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "1".repeat(40),
    changeUnitCount: 1,
    changeUnits: [unit],
  });
  writeJson(ledgerPath, {
    schemaVersion: 1,
    indexTreeOid: "1".repeat(40),
    complete: true,
  });
  writeJson(contentPath, {
    subject: {
      type: "build",
      scope: "node",
      description: "Require the supported Node release",
    },
    rationale: ["Prevent execution with Node <24"],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: [
      {
        changeUnitId: unit.id,
        reasons: ["Keep runtime diagnostics aligned with Node <24"],
      },
    ],
  });

  const result = runCommitWorkflow(
    "message render",
    [
      "--manifest",
      manifestPath,
      "--content",
      contentPath,
      "--ledger",
      ledgerPath,
      "--output",
      outputPath,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(outputPath, "utf8"), /Node <24/u);
});

test("detailed rendering rejects duplicate change-unit assignments", (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-duplicate-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const ledgerPath = join(fixture.scratch, "ledger.json");
  const outputPath = join(fixture.scratch, "commit-message.txt");
  const units = [
    changeUnit("F000001", "src/first.js"),
    changeUnit("F000002", "src/second.js"),
  ];

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "d".repeat(40),
    changeUnitCount: units.length,
    changeUnits: units,
  });
  writeJson(ledgerPath, {
    schemaVersion: 1,
    indexTreeOid: "d".repeat(40),
    complete: true,
  });
  writeJson(contentPath, {
    subject: {
      type: "fix",
      scope: null,
      description: "Prevent duplicate coverage",
    },
    rationale: [],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: [
      { changeUnitId: "F000001", reasons: ["Preserve first behavior"] },
      { changeUnitId: "F000001", reasons: ["Duplicate first behavior"] },
      { changeUnitId: "F000002", reasons: ["Preserve second behavior"] },
    ],
  });

  const result = runCommitWorkflow(
    "message render",
    [
      "--manifest",
      manifestPath,
      "--content",
      contentPath,
      "--ledger",
      ledgerPath,
      "--output",
      outputPath,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /exactly once/u);
});

test("renderer uses reversible byte escapes for a non-UTF-8 Git path", (t) => {
  const fixture = createRepositoryFixture(t, "commit-message-bytes-");
  const manifestPath = join(fixture.scratch, "snapshot.json");
  const contentPath = join(fixture.scratch, "content.json");
  const ledgerPath = join(fixture.scratch, "ledger.json");
  const outputPath = join(fixture.scratch, "commit-message.txt");
  const rawPath = Buffer.from([0x62, 0x61, 0x64, 0xff, 0x2e, 0x74, 0x78, 0x74]);
  const unit = {
    ...changeUnit("F000001", "bad�.txt"),
    destinationPathBytesBase64: rawPath.toString("base64"),
  };

  writeJson(manifestPath, {
    schemaVersion: 1,
    indexTreeOid: "e".repeat(40),
    changeUnitCount: 1,
    changeUnits: [unit],
  });
  writeJson(ledgerPath, {
    schemaVersion: 1,
    indexTreeOid: "e".repeat(40),
    complete: true,
  });
  writeJson(contentPath, {
    subject: {
      type: "fix",
      scope: null,
      description: "Preserve path identity",
    },
    rationale: [],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: [
      { changeUnitId: "F000001", reasons: ["Keep path reporting reversible"] },
    ],
  });

  const result = runCommitWorkflow(
    "message render",
    [
      "--manifest",
      manifestPath,
      "--content",
      contentPath,
      "--ledger",
      ledgerPath,
      "--output",
      outputPath,
    ],
    fixture.repo,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(outputPath, "utf8"), /^1\. "bad\\xff\.txt"$/mu);
  assert.doesNotMatch(readFileSync(outputPath, "utf8"), /�/u);
});

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

const CATALOG_SHA256 = "c".repeat(64);
const PLAN_SHA256 = "d".repeat(64);

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
  return renderStructuredMessage({
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
      9,
      9,
      {
        titlePrefix: "  9. ",
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
      99,
      99,
      {
        titlePrefix: "  99. ",
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
      999,
      999,
      {
        titlePrefix: "  999. ",
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

test("structured detailed rendering shares rationale and emits notes only for exceptions", () => {
  const manifest = structuredManifest(10);
  const content = detailedContent({
    sharedRationales: [
      {
        selection: { all: true },
        reasons: ["Keep parser behavior consistent across dispatch paths"],
      },
    ],
    fileNotes: [
      {
        selection: { ids: ["F000001"] },
        reasons: ["Preserve the legacy diagnostic code for callers"],
      },
    ],
  });
  const rendered = renderStructured(manifest, content);

  assert.match(rendered.displayText, /^refactor\(parser\):/u);
  assert.match(rendered.displayText, /Rationale:\n {2}- Keep parser behavior/u);
  assert.match(
    rendered.displayText,
    /File Changes:\n {3}1\. `src\/domain\/file-0001\.js`/u,
  );
  assert.match(rendered.displayText, / {6}- Preserve the legacy diagnostic/u);
  assert.doesNotMatch(rendered.displayText, /File Changes \(10 files\):/u);
  assert.equal(rendered.displayText.endsWith("\n"), true);
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

test("bulk counts are derived with singular, plural, rename-as-one, and additions unchanged", () => {
  const rename = {
    ...changeUnit("F000001", "src/new.js"),
    kind: "renamed",
    sourcePath: "legacy/old.js",
    sourcePathBytesBase64: Buffer.from("legacy/old.js").toString("base64"),
  };
  const addition = {
    ...changeUnit("F000002", "src/copied-looking.js"),
    kind: "added",
    sourcePath: "legacy/old.js",
    sourcePathBytesBase64: Buffer.from("legacy/old.js").toString("base64"),
  };
  const manifest = structuredManifest(2, { changeUnits: [rename, addition] });
  const content = bulkContent({
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
  });
  const rendered = renderStructured(manifest, content);

  assert.match(rendered.displayText, /1\. Rename migration \(1 file\)/u);
  assert.match(rendered.displayText, /2\. New adapter \(1 file\)/u);
  assert.equal(rendered.coverage.domains[0].units.length, 1);
  assert.equal(rendered.coverage.domains[1].units.length, 1);
});

test("narrative wrapping targets 72 scalars and preserves authored Unicode", () => {
  const rationale =
    "Preserve caf\u00e9 parser behavior while consolidating repeated dispatch logic for every supported token family";
  const rendered = renderStructured(
    structuredManifest(1),
    detailedContent({
      sharedRationales: [{ selection: { all: true }, reasons: [rationale] }],
    }),
  );
  const rationaleLines = rendered.displayText
    .split("\n")
    .filter((line) => line.startsWith("  - ") || line.startsWith("    "));

  assert.ok(rationaleLines.every((line) => [...line].length <= 72));
  assert.match(rendered.displayText, /caf\u00e9/u);
  assert.doesNotMatch(rendered.displayText, /cafe\u0301/u);
});

test("indivisible overflow warnings are compacted to sixteen samples and one digest", () => {
  const longReasons = Array.from(
    { length: 20 },
    (_, index) => `token-${index}-${"x".repeat(80)}`,
  );
  const rendered = renderStructured(
    structuredManifest(1),
    detailedContent({
      sharedRationales: [{ selection: { all: true }, reasons: longReasons }],
    }),
  );

  assert.equal(rendered.presentationWarnings.count, 20);
  assert.equal(rendered.presentationWarnings.samples.length, 16);
  assert.match(rendered.presentationWarnings.sha256, /^[0-9a-f]{64}$/u);
});

test("structured paths use direct Unicode and base64 fallbacks without replacement text", () => {
  const unicodePath = "src/caf\u00e9.js";
  const invalid = Buffer.from([0x73, 0x72, 0x63, 0x2f, 0xff]);
  const manifest = structuredManifest(2, {
    changeUnits: [
      changeUnit("F000001", unicodePath),
      {
        ...changeUnit("F000002", "src/invalid"),
        destinationPathBytesBase64: invalid.toString("base64"),
      },
    ],
  });
  const rendered = renderStructured(manifest, detailedContent());

  assert.match(rendered.displayText, /`src\/caf\u00e9\.js`/u);
  assert.match(
    rendered.displayText,
    new RegExp(`path-bytes-base64:${invalid.toString("base64")}`, "u"),
  );
  assert.doesNotMatch(rendered.displayText, /�/u);
});

test("a thousand-file scaffold and bulk render remain selector-sized", () => {
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
  const scaffold = scaffoldStructuredContent(manifest, catalog, evidencePlan);

  assert.equal(scaffold.schemaVersion, 2);
  assert.equal(scaffold.authoringState, "draft");
  assert.equal(scaffold.subject, null);
  assert.equal(scaffold.recommendedMode, "bulk");
  assert.equal(scaffold.review.requiredPacketsReviewed, true);
  assert.ok(Buffer.byteLength(JSON.stringify(scaffold)) < 8 * 1024);

  const rendered = renderStructured(manifest, bulkContent());

  assert.match(
    rendered.displayText,
    /Generated parser sources \(1000 files\)/u,
  );
  assert.ok(Buffer.byteLength(rendered.displayText) < 1_000);
  assert.equal(rendered.validation.files.setMatches, true);
  assert.equal(rendered.validation.files.listedCount, 1_000);
  assert.equal(rendered.validation.sections.fileChanges.entryCount, 1);
});

test("an evidence-driven scaffold stays draft and reports focused missing decisions", () => {
  const manifest = structuredManifest(1);
  const evidencePlan = {
    evidencePlanSha256: PLAN_SHA256,
    groups: evidenceGroups(),
  };
  const catalog = {
    catalogSha256: CATALOG_SHA256,
    evidencePlanSha256: PLAN_SHA256,
    requiredSynopsisPacketIds: ["S000001"],
    exactInventoryPacketIds: [],
    fullPatchPacketIds: [],
  };
  const scaffold = scaffoldStructuredContent(manifest, catalog, evidencePlan);

  assert.equal(scaffold.review.requiredPacketsReviewed, false);
  assert.throws(
    () =>
      renderStructuredMessage({
        manifest,
        content: scaffold,
        reviewCatalog: catalog,
        evidencePlan,
      }),
    (error) => {
      assert.equal(error.code, "MISSING_SEMANTIC_DECISIONS");
      assert.deepEqual(error.details.missing, ["subject", "review receipt"]);
      return true;
    },
  );
});

test("forty-nine unusually long paths recommend selector-sized bulk content", () => {
  const changeUnits = Array.from({ length: 49 }, (_, index) => {
    const path = `src/${String(index).padStart(2, "0")}-${"x".repeat(800)}.js`;

    return changeUnit(`F${String(index + 1).padStart(6, "0")}`, path);
  });
  const manifest = structuredManifest(49, { changeUnits });
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
  const scaffold = scaffoldStructuredContent(manifest, catalog, evidencePlan);

  assert.equal(scaffold.recommendedMode, "bulk");
  assert.ok(Buffer.byteLength(JSON.stringify(scaffold)) < 8 * 1024);
});

test("evidence-plan binding ignores object-key and selector-value presentation order", () => {
  const manifest = structuredManifest(2);
  const contentGroups = [
    {
      selection: {
        kinds: ["modified"],
        ids: ["F000002", "F000001"],
      },
      policy: "reuse",
      basis: { note: null, kind: "authored-current-task" },
    },
  ];
  const planGroups = [
    {
      selection: {
        ids: ["F000001", "F000002"],
        kinds: ["modified"],
      },
      policy: "reuse",
      basis: { kind: "authored-current-task", note: null },
    },
  ];
  const content = detailedContent({ evidenceGroups: contentGroups });

  assert.doesNotThrow(() =>
    renderStructuredMessage({
      manifest,
      content,
      reviewCatalog: {
        catalogSha256: CATALOG_SHA256,
        evidencePlanSha256: PLAN_SHA256,
      },
      evidencePlan: {
        evidencePlanSha256: PLAN_SHA256,
        groups: planGroups,
      },
      repositoryTypePolicy: { allowedTypes: [] },
    }),
  );
});
