// Canonical commit-message scaffolding, ordering, rendering, and path identity.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

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
