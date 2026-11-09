import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import test from "node:test";
import { regularFileInventory } from "../../scripts/skillDistribution.js";
import {
  canonicalJsonBytes,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
test("runtime inventory matches 57 maintained payload identities, recorded additions and approved runtime maintenance", () => {
  const root = resolve(import.meta.dirname, "../..");
  const baseline = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/runtime-identities.json",
      ),
      "utf8",
    ),
  );
  const actual = regularFileInventory(join(root, "skills"));
  // Keep the migration baseline immutable; bind later maintenance to exact bytes.
  const maintenance = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/issue-12-runtime-changes.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(maintenance.map(({ path }) => path).sort(), [
    "skills/committing-to-git/references/diagnostics.md",
    "skills/committing-to-git/references/publication-routing.md",
    "skills/committing-to-git/scripts/commitWorkflow.mjs",
  ]);
  const performance = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/committing-performance-runtime-change.json",
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    performance.map(({ path }) => path),
    ["skills/committing-to-git/scripts/commitWorkflow.mjs"],
  );
  const recovery = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/issue-20-runtime-changes.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    recovery.baselineRevision,
    "7c928c974798ae0548f3353ce9c0589256b8b7fe",
  );
  assert.deepEqual(recovery.files.map(({ path }) => path).sort(), [
    "skills/committing-to-git/SKILL.md",
    "skills/committing-to-git/references/diagnostics.md",
    "skills/committing-to-git/references/inspection-recovery.md",
    "skills/committing-to-git/references/message-format.md",
    "skills/committing-to-git/references/transaction-recovery.md",
    "skills/committing-to-git/scripts/commitWorkflow.mjs",
  ]);
  const selectionIndexing = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/javascript-selection-index-runtime-change.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    selectionIndexing.baselineRevision,
    "13e9ab1cb5a31ecfbef72c553c141035147e8dc4",
  );
  assert.deepEqual(
    selectionIndexing.files.map(({ path }) => path),
    ["skills/committing-to-git/scripts/commitWorkflow.mjs"],
  );
  const reportRevision = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/publication-report-revision-runtime-change.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    reportRevision.revision,
    "230d70824f8be74bc21e3addf19a4083099ffbeb",
  );
  assert.deepEqual(
    reportRevision.files.map(({ path }) => path),
    ["skills/committing-to-git/scripts/commitWorkflow.mjs"],
  );
  const ephemeralState = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/ephemeral-state-runtime-changes.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    ephemeralState.baselineRevision,
    "a6d9ab992492650f550032ab1565056241c0acae",
  );
  assert.deepEqual(ephemeralState.files.map(({ path }) => path).sort(), [
    "skills/committing-to-git/SKILL.md",
    "skills/committing-to-git/references/diagnostics.md",
    "skills/committing-to-git/scripts/commitWorkflow.mjs",
  ]);
  assert.deepEqual(
    ephemeralState.addedFiles.map(({ path }) => path),
    ["skills/committing-to-git/references/state-storage.md"],
  );
  const memoryPaths = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/memory-paths-runtime-changes.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    memoryPaths.baselineRevision,
    "2d0203eb9d1291805baf8409e52de1712ab8a3bc",
  );
  assert.deepEqual(memoryPaths.files.map(({ path }) => path).sort(), [
    "skills/committing-to-git/SKILL.md",
    "skills/committing-to-git/references/state-storage.md",
    "skills/committing-to-git/scripts/commitWorkflow.mjs",
  ]);
  const memoryPublication = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/memory-publication-runtime-changes.json",
      ),
      "utf8",
    ),
  );
  assert.equal(memoryPublication.schemaVersion, 1);
  assert.equal(
    memoryPublication.baselineRevision,
    "9e1669f46e1d83d97277344a3b8d3bff3c582708",
  );
  assert.deepEqual(memoryPublication.files.map(({ path }) => path).sort(), [
    "skills/committing-to-git/SKILL.md",
    "skills/committing-to-git/references/publication-recovery.md",
    "skills/committing-to-git/references/state-storage.md",
    "skills/committing-to-git/scripts/commitWorkflow.mjs",
  ]);
  const messageDetail = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/message-detail-runtime-change.json",
      ),
      "utf8",
    ),
  );
  assert.equal(
    messageDetail.baselineRevision,
    "2d0203eb9d1291805baf8409e52de1712ab8a3bc",
  );
  assert.deepEqual(
    messageDetail.files.map(({ path }) => path),
    ["skills/committing-to-git/references/message-format.md"],
  );
  const namingAutolinks = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/naming-autolinks-runtime-change.json",
      ),
      "utf8",
    ),
  );
  assert.equal(namingAutolinks.schemaVersion, 1);
  assert.equal(
    namingAutolinks.baselineRevision,
    "9a6d92a64a1beb5628df7215a9e86fae23b6fa85",
  );
  assert.deepEqual(
    namingAutolinks.files.map(({ path }) => path),
    [
      "skills/naming-objects-in-software-engineering/references/source-authorities.md",
    ],
  );
  const pythonPreparation = JSON.parse(
    readFileSync(
      join(
        root,
        "tests/fixtures/evaluation-preservation/python-preparation-runtime-changes.json",
      ),
      "utf8",
    ),
  );
  assert.equal(pythonPreparation.schemaVersion, 1);
  assert.equal(
    pythonPreparation.baselineRevision,
    memoryPublication.baselineRevision,
  );
  assert.equal(
    pythonPreparation.revision,
    "7983c3f5020749acdb7cd184091083ff56cbdc64",
  );
  assert.deepEqual(pythonPreparation.files.map(({ path }) => path).sort(), [
    "skills/naming-objects-in-software-engineering/scripts/check-name.py",
    "skills/reading-epubs/scripts/_repair.py",
    "skills/reading-epubs/scripts/_styles.py",
    "skills/reading-epubs/scripts/_toc.py",
    "skills/reading-epubs/scripts/convert_epub.py",
  ]);
  const approved = JSON.parse(
    readFileSync(
      join(
        root,
        "evidence/migrations/2026-10-03-approved-json-formatting.json",
      ),
      "utf8",
    ),
  ).files;
  const markdownMaintenance = JSON.parse(
    readFileSync(
      join(root, "evidence/migrations/2026-10-10-markdown-formatting.json"),
      "utf8",
    ),
  ).files;
  assert.deepEqual(
    markdownMaintenance.map(({ path }) => path).sort(),
    baseline
      .filter(({ path }) => path.endsWith(".md"))
      .map(({ path }) => path)
      .sort(),
  );
  assert.deepEqual(approved.map(({ path }) => path).sort(), [
    "skills/naming-objects-in-software-engineering/assets/naming-policy.json",
    "skills/reading-epubs/scripts/conversion-result.schema.json",
  ]);
  assert.equal(baseline.length, 57);
  // Added payloads extend the immutable baseline only through an exact record.
  assert.equal(actual.size, 57 + ephemeralState.addedFiles.length);
  for (const added of ephemeralState.addedFiles) {
    const bytes = actual.get(added.path.slice("skills/".length));
    assert.ok(bytes, added.path);
    assert.equal(
      baseline.some(({ path }) => path === added.path),
      false,
      added.path,
    );
    const successor = memoryPaths.files.find(({ path }) => path === added.path);
    if (successor)
      assert.equal(successor.previousSha256, added.sha256, added.path);
    const publicationSuccessor = memoryPublication.files.find(
      ({ path }) => path === added.path,
    );
    if (publicationSuccessor)
      assert.equal(
        publicationSuccessor.previousSha256,
        (successor ?? added).sha256,
        added.path,
      );
    const expected = publicationSuccessor ?? successor ?? added;
    assert.equal(bytes.length, expected.byteLength, added.path);
    assert.equal(sha256Hex(bytes), expected.sha256, added.path);
  }
  const releaseVersion = JSON.parse(
    readFileSync(join(root, "scripts/plugin-releases.json"), "utf8"),
  ).plugins["committing-to-git"].at(-1).version;
  const metadataVersions = new Map([
    ["skills/committing-to-git/SKILL.md", releaseVersion],
    ["skills/defining-concepts/SKILL.md", "0.1.0-dev.1"],
    ["skills/naming-objects-in-software-engineering/SKILL.md", "0.1.0-dev.2"],
  ]);
  for (const file of baseline) {
    const bytes = actual.get(file.path.slice("skills/".length));
    assert.ok(bytes, file.path);
    let comparisonBytes = bytes;
    if (metadataVersions.has(file.path)) {
      // Keep the historical oracle intact: only the exact approved version
      // insertion may be removed, and it must occur once in frontmatter.
      const text = bytes.toString("utf8");
      assert.ok(Buffer.from(text, "utf8").equals(bytes), file.path);
      const boundary = text.indexOf("\n---", 4);
      assert.ok(boundary > 4, file.path);
      const frontmatter = text.slice(0, boundary + 1);
      const line = `  version: "${metadataVersions.get(file.path)}"\n`;
      assert.equal(frontmatter.split(line).length, 2, file.path);
      comparisonBytes = Buffer.from(
        frontmatter.replace(line, "") + text.slice(boundary + 1),
        "utf8",
      );
    }
    if (file.path === "skills/committing-to-git/scripts/commitWorkflow.mjs") {
      // Preserve the historical hash: reverse only the two approved esbuild
      // source-location labels, requiring each relocated label exactly once.
      let text = bytes.toString("utf8");
      assert.ok(Buffer.from(text, "utf8").equals(bytes), file.path);
      for (const label of [
        "// lib/filesystem/stableFile.js\n",
        '  "lib/filesystem/stableFile.js"() {\n',
      ]) {
        assert.equal(text.split(label).length, 2, file.path);
        text = text.replace(
          label,
          label.replace(
            "lib/filesystem/stableFile.js",
            "src/committing-to-git/filesystem/stableFile.js",
          ),
        );
      }
      comparisonBytes = Buffer.from(text, "utf8");
    }
    const formatting = approved.find(({ path }) => path === file.path);
    const change = maintenance.find(({ path }) => path === file.path);
    const laterChange = performance.find(({ path }) => path === file.path);
    const markdownChange = markdownMaintenance.find(
      ({ path }) => path === file.path,
    );
    if (change) {
      assert.equal(change.originalSha256, file.sha256, file.path);
      assert.equal(formatting, undefined, file.path);
    }
    if (laterChange) {
      assert.equal(
        laterChange.previousSha256,
        (change ?? file).sha256,
        file.path,
      );
      assert.equal(formatting, undefined, file.path);
    }
    if (formatting) {
      assert.equal(formatting.originalSha256, file.sha256, file.path);
      assert.equal(
        sha256Hex(canonicalJsonBytes(JSON.parse(bytes))),
        formatting.canonicalValueSha256,
        file.path,
      );
    }
    if (markdownChange) {
      assert.equal(
        markdownChange.previousSha256,
        (laterChange ?? change ?? formatting ?? file).sha256,
        file.path,
      );
    }
    const recoveryChange = recovery.files.find(
      ({ path }) => path === file.path,
    );
    if (recoveryChange) {
      assert.equal(
        recoveryChange.previousSha256,
        (markdownChange ?? laterChange ?? change ?? formatting ?? file).sha256,
        file.path,
      );
    }
    const priorIdentity =
      recoveryChange ??
      markdownChange ??
      laterChange ??
      change ??
      formatting ??
      file;
    const selectionIndexingChange = selectionIndexing.files.find(
      ({ path }) => path === file.path,
    );
    if (selectionIndexingChange) {
      assert.equal(
        selectionIndexingChange.previousSha256,
        priorIdentity.sha256,
        file.path,
      );
    }
    const reportRevisionChange = reportRevision.files.find(
      ({ path }) => path === file.path,
    );
    if (reportRevisionChange) {
      assert.equal(
        reportRevisionChange.previousSha256,
        (selectionIndexingChange ?? priorIdentity).sha256,
        file.path,
      );
    }
    const ephemeralStateChange = ephemeralState.files.find(
      ({ path }) => path === file.path,
    );
    if (ephemeralStateChange) {
      assert.equal(
        ephemeralStateChange.previousSha256,
        (reportRevisionChange ?? selectionIndexingChange ?? priorIdentity)
          .sha256,
        file.path,
      );
    }
    const preDetailIdentity =
      ephemeralStateChange ??
      reportRevisionChange ??
      selectionIndexingChange ??
      priorIdentity;
    const messageDetailChange = messageDetail.files.find(
      ({ path }) => path === file.path,
    );
    if (messageDetailChange)
      assert.equal(
        messageDetailChange.previousSha256,
        preDetailIdentity.sha256,
        file.path,
      );
    const previousIdentity = messageDetailChange ?? preDetailIdentity;
    const memoryPathsChange = memoryPaths.files.find(
      ({ path }) => path === file.path,
    );
    if (memoryPathsChange)
      assert.equal(
        memoryPathsChange.previousSha256,
        previousIdentity.sha256,
        file.path,
      );
    const preAutolinksIdentity = memoryPathsChange ?? previousIdentity;
    const namingAutolinksChange = namingAutolinks.files.find(
      ({ path }) => path === file.path,
    );
    if (namingAutolinksChange)
      assert.equal(
        namingAutolinksChange.previousSha256,
        preAutolinksIdentity.sha256,
        file.path,
      );
    const priorPublicationIdentity =
      namingAutolinksChange ?? preAutolinksIdentity;
    const memoryPublicationChange = memoryPublication.files.find(
      ({ path }) => path === file.path,
    );
    if (memoryPublicationChange)
      assert.equal(
        memoryPublicationChange.previousSha256,
        priorPublicationIdentity.sha256,
        file.path,
      );
    const beforePythonPreparation =
      memoryPublicationChange ?? priorPublicationIdentity;
    const pythonPreparationChange = pythonPreparation.files.find(
      ({ path }) => path === file.path,
    );
    if (pythonPreparationChange)
      assert.equal(
        pythonPreparationChange.previousSha256,
        beforePythonPreparation.sha256,
        file.path,
      );
    const expectedIdentity = pythonPreparationChange ?? beforePythonPreparation;
    assert.equal(
      comparisonBytes.length,
      expectedIdentity.byteLength,
      file.path,
    );
    assert.equal(
      sha256Hex(comparisonBytes),
      expectedIdentity.sha256,
      file.path,
    );
  }
});
