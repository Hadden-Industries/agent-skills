// Opt-in consumer benchmark; no elapsed-time assertion belongs in node:test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2]);
const load = (path) =>
  import(pathToFileURL(join(root, "src/committing-to-git", path)));
const ordering = await load("message/changeSelection.js");
const { createScopeSynopsis, createInlineEvidenceCapsule } = await load(
  "inspection/inlineEvidenceCapsule.js",
);
const { canonicalizeEvidencePlan } = await load("inspection/reviewCatalog.js");
const { renderCommitMessage } = await load("message/commitMessageRenderer.js");
const samples = [];
let consumed = 0;

for (const count of [1, 12, 1000]) {
  for (const pattern of ["ordered", "reversed", "shuffled", "ties"]) {
    const units = Array.from({ length: count }, (_, index) => {
      const path = `src/group-${index % 4}/common-prefix/${pattern === "ties" ? "same" : String(index).padStart(6, "0")}.txt`;
      return {
        id: `F${String(index + 1).padStart(6, "0")}`,
        kind: "modified",
        destinationPath: path,
        displayPath: path,
        destinationPathBytesBase64: Buffer.from(path).toString("base64"),
        sourcePath: null,
        sourcePathBytesBase64: null,
        oldMode: "100644",
        newMode: "100644",
        oldOid: "a".repeat(40),
        newOid: "b".repeat(40),
        additions: 1,
        deletions: 1,
        binary: false,
        lineStatistics: "eager",
        renameClassification: null,
      };
    });
    units.sort((a, b) =>
      a.destinationPath < b.destinationPath
        ? -1
        : a.destinationPath > b.destinationPath
          ? 1
          : 0,
    );
    if (pattern === "reversed") units.reverse();
    if (pattern === "shuffled") {
      let seed = 20261005;
      for (let index = units.length - 1; index > 0; index -= 1) {
        seed =
          (Math.imul(seed, 1664525) + 1013904223 + 4294967296) % 4294967296;
        const other = seed % (index + 1);
        [units[index], units[other]] = [units[other], units[index]];
      }
    }
    const manifest = {
      schemaVersion: 2,
      indexTreeOid: "c".repeat(40),
      changeUnitCount: count,
      changeUnits: units,
      statistics: {
        files: count,
        additions: count,
        deletions: count,
        binaryFiles: 0,
      },
      warnings: [],
    };
    const groups = [
      {
        selection: {
          destinationPaths: units
            .map(({ destinationPath }) => destinationPath)
            .filter((path, index, paths) => paths.indexOf(path) === index),
        },
        policy: "reuse",
        basis: { kind: "authored-current-task", note: null },
      },
    ];
    const plan = canonicalizeEvidencePlan({ manifest, groups });
    const evidenceGroups = groups;
    const content = {
      schemaVersion: 3,
      authoringState: "complete",
      evidenceGroups,
      subject: {
        type: "perf",
        scope: null,
        description: "Preserve canonical bytes",
      },
      sharedRationales: [],
      userExperienceChanges: [],
      mode: count < 50 ? "detailed" : "bulk",
      ...(count < 50
        ? { fileNotes: [] }
        : {
            domains: [
              {
                title: "Generated sources",
                selection: { all: true },
                reasons: ["Keep generated sources consistent"],
              },
            ],
          }),
    };
    const operations = {
      sort: () =>
        (ordering.sortChangeUnitsByRawPath
          ? ordering.sortChangeUnitsByRawPath(units)
          : [...units].sort(ordering.compareChangeUnitsByRawPath)
        ).map(({ id }) => id),
      catalog: () => canonicalizeEvidencePlan({ manifest, groups }),
      capsule: () => ({
        synopsis: createScopeSynopsis(manifest),
        capsule: createInlineEvidenceCapsule({ manifest, evidencePlan: plan }),
      }),
      render: () =>
        renderCommitMessage({
          manifest,
          content,
          reviewCatalog: {
            catalogSha256: "d".repeat(64),
            evidencePlanSha256: plan.evidencePlanSha256,
          },
          evidencePlan: plan,
          reviewReceipt: {
            schemaVersion: 1,
            catalogSha256: "d".repeat(64),
            evidencePlanSha256: plan.evidencePlanSha256,
            requiredPacketsReviewed: true,
            additionalPacketIds: [],
          },
          repositoryTypePolicy: { allowedTypes: null },
        }),
    };
    // Duplicate destinations are a sorting stress case, not a valid detailed
    // file inventory. Ordinary tests cover that rejection independently.
    if (pattern === "ties" && count > 1) delete operations.render;
    for (const [operation, invoke] of Object.entries(operations)) {
      const output = JSON.stringify(invoke());
      assert.ok(output.length > 0);
      const outputSha256 = createHash("sha256").update(output).digest("hex");
      const expensive =
        count === 1000 && (operation === "catalog" || operation === "render");
      for (let warmup = 0; warmup < (expensive ? 1 : 5); warmup += 1) invoke();
      const iterations = expensive
        ? 1
        : count === 1
          ? 1000
          : count === 12
            ? 300
            : 20;
      const memoryBefore = process.memoryUsage();
      const start = performance.now();
      for (let index = 0; index < iterations; index += 1) {
        const result = invoke();
        consumed += Array.isArray(result)
          ? result.length
          : typeof result === "string"
            ? result.length
            : Object.keys(result).length;
      }
      const durationMs = (performance.now() - start) / iterations;
      samples.push({
        count,
        pattern,
        operation,
        iterations,
        durationMs,
        outputSha256,
        memoryBefore,
        memoryAfter: process.memoryUsage(),
      });
    }
  }
}
process.stdout.write(
  JSON.stringify({
    root,
    node: process.version,
    execPath: process.execPath,
    platform: process.platform,
    arch: process.arch,
    consumed,
    resourceUsage: process.resourceUsage(),
    samples,
  }) + "\n",
);
