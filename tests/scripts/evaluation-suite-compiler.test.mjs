import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  compileSuite,
  portableCaseIdentity,
} from "../../scripts/evaluation/compile-suite.js";
import {
  canonicalJsonBytes,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "suite-compiler-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "src/reading-epubs");
  mkdirSync(join(source, "evals/extensions/v1"), { recursive: true });
  mkdirSync(join(source, "evals/files"));
  mkdirSync(join(root, "skills/reading-epubs"), { recursive: true });
  for (const directory of [source, join(root, "skills/reading-epubs")])
    writeFileSync(
      join(directory, "SKILL.md"),
      "---\nname: reading-epubs\ndescription: Read books\n---\n",
    );
  writeFileSync(
    join(source, "evals/files/book.epub"),
    Buffer.from([0, 255, 10]),
  );
  const portable = {
    skill_name: "reading-epubs",
    evals: [
      {
        id: 9,
        prompt: "Read: [a] # b\nsecond line",
        expected_output: "A separate judgment",
        files: ["evals/files/book.epub"],
        assertions: ["Exact first assertion", "Exact second assertion"],
      },
    ],
  };
  const extension = {
    schemaVersion: 1,
    skill_name: "reading-epubs",
    profile: "portable-v1",
    provenance: {},
    protocol: { cases: {} },
    assurance: {
      suite: {},
      cases: {
        9: {
          portableCaseSha256: portableCaseIdentity(portable.evals[0], source)
            .portableCaseSha256,
          critical_assertion_indexes: [1],
        },
      },
    },
  };
  const save = () => {
    writeFileSync(join(source, "evals/evals.json"), JSON.stringify(portable));
    writeFileSync(
      join(source, "evals/extensions/v1/suite.json"),
      JSON.stringify(extension),
    );
  };
  save();
  return {
    root,
    source,
    portable,
    extension,
    save,
    compile: () =>
      compileSuite({ repositoryRoot: root, skillName: "reading-epubs" }),
  };
}

test("compiler preserves binary inputs, sparse IDs, exact text and zero-based criticality", (t) => {
  const f = fixture(t);
  const result = f.compile();
  assert.equal(result.cases[0].id, 9);
  assert.equal(result.cases[0].prompt, "Read: [a] # b\nsecond line");
  assert.deepEqual(result.cases[0].critical_assertion_indexes, [1]);
  assert.equal(result.cases[0].identity.files[0].byteLength, 3);
  assert.ok(Object.isFrozen(result.cases[0].assertions));
  assert.equal(f.compile().compiledSuiteSha256, result.compiledSuiteSha256);
});

test("compiler rejects stale assertions, duplicate keys, unknown fields and fixture escapes", (t) => {
  const f = fixture(t);
  f.portable.evals[0].assertions.reverse();
  f.save();
  assert.throws(f.compile, /Stale portable case digest/u);
  f.portable.evals[0].assertions.reverse();
  f.save();
  f.extension.extra = true;
  f.save();
  assert.throws(f.compile, /additional properties/u);
  delete f.extension.extra;
  f.portable.evals[0].files = ["evals/files/../outside"];
  f.save();
  assert.throws(f.compile, /Unconfined fixture/u);
  writeFileSync(
    join(f.source, "evals/evals.json"),
    '{"skill_name":"reading-epubs","skill_name":"reading-epubs","evals":[]}',
  );
  assert.throws(f.compile, /unique/u);
});

test("compiler rejects duplicate and orphan IDs and missing runtime files", (t) => {
  const f = fixture(t);
  f.portable.evals.push(structuredClone(f.portable.evals[0]));
  f.save();
  assert.throws(f.compile, /Duplicate case ID/u);
  f.portable.evals.pop();
  f.extension.protocol.cases[12] = { portableCaseSha256: "0".repeat(64) };
  f.save();
  assert.throws(f.compile, /Orphan extension/u);
  delete f.extension.protocol.cases[12];
  f.save();
  rmSync(join(f.root, "skills/reading-epubs/SKILL.md"));
  assert.throws(f.compile, /Stale runtime distribution/u);
});

test("migrated cases retain every independently captured authored field", () => {
  const snapshots = JSON.parse(
    readFileSync(
      join(
        repositoryRoot,
        "tests/fixtures/evaluation-preservation/case-identities.json",
      ),
      "utf8",
    ),
  );
  assert.equal(snapshots.length, 111);
  const suites = new Map();
  for (const snapshot of snapshots) {
    if (!suites.has(snapshot.skill))
      suites.set(
        snapshot.skill,
        compileSuite({ repositoryRoot, skillName: snapshot.skill }),
      );
    const { identity, assertions, critical_assertion_indexes, ...other } =
      suites.get(snapshot.skill).cases.find(({ id }) => id === snapshot.id);
    void identity;
    const original = {
      ...other,
      files: other.files.map((file) =>
        file.replace(/^evals\/files\//u, "fixtures/"),
      ),
      expectations: assertions,
    };
    if (critical_assertion_indexes !== undefined)
      original.critical_expectation_indexes = critical_assertion_indexes;
    assert.equal(
      sha256Hex(canonicalJsonBytes(original)),
      snapshot.originalSha256,
      `${snapshot.skill}/${snapshot.id}`,
    );
  }
});

test("suite policy, comparison schedules and all trigger queries retain baseline identity", () => {
  const snapshots = JSON.parse(
    readFileSync(
      join(
        repositoryRoot,
        "tests/fixtures/evaluation-preservation/suite-identities.json",
      ),
      "utf8",
    ),
  );
  for (const snapshot of snapshots) {
    const { contractVersion, evals, ...metadata } = compileSuite({
      repositoryRoot,
      skillName: snapshot.skill,
    }).definition;
    void contractVersion;
    void evals;
    assert.equal(
      sha256Hex(canonicalJsonBytes(metadata)),
      snapshot.metadataSha256,
      `${snapshot.skill} policy`,
    );
    const triggers = JSON.parse(
      readFileSync(
        join(repositoryRoot, "src", snapshot.skill, "evals/trigger-evals.json"),
        "utf8",
      ),
    );
    assert.equal(
      sha256Hex(canonicalJsonBytes(triggers)),
      snapshot.triggerSha256,
      `${snapshot.skill} triggers`,
    );
  }
});
