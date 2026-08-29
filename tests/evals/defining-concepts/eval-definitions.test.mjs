import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const definitions = JSON.parse(
  readFileSync(path.join(root, "evals", "defining-concepts", "evals.json"), "utf8"),
);
const triggers = JSON.parse(
  readFileSync(
    path.join(root, "evals", "defining-concepts", "trigger-evals.json"),
    "utf8",
  ),
);

const expectedNames = [
  "dataset-distribution-boundary",
  "contact-preference-status-values",
  "document-language-code-representation",
  "identity-verification-outcome-process",
  "service-availability-status-defects",
  "invoice-issue-date-neighbors",
  "electric-charge-polysemy",
  "false-source-attribution",
  "unqualified-definition-fallback",
  "clarified-retention-threshold",
  "cross-scheme-concept-mapping",
  "competency-question-formalization",
  "partial-multilingual-equivalence",
  "community-governed-concept",
  "machine-readable-concept-entry",
  "compact-definition-economy",
];
const allowedRenderers = new Set([
  "definition-answer",
  "revision-audit",
  "concept-package",
]);
const allowedProfiles = new Set([
  "terminology-core",
  "data-definitions",
  "epistemic-governance",
  "formal-ontology",
  "knowledge-organization-systems",
  "multilingual-terminology",
]);

test("behavioral manifest declares the approved 16-case three-arm protocol", () => {
  assert.equal(definitions.schema_version, 2);
  assert.equal(definitions.skill_name, "defining-concepts");
  assert.deepEqual(definitions.evals.map(({ id }) => id), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.deepEqual(definitions.evals.map(({ name }) => name), expectedNames);
  assert.deepEqual(definitions.campaigns.calibration, {
    case_ids: [1, 3, 8, 9, 10, 11, 12, 13, 14, 15],
    arms: ["no-skill", "current-skill", "candidate-skill"],
    repetitions: 1,
  });
  for (const evaluationCase of definitions.evals) {
    assert.ok(allowedRenderers.has(evaluationCase.renderer));
    assert.ok(evaluationCase.profiles.includes("terminology-core"));
    assert.ok(evaluationCase.profiles.every((profile) => allowedProfiles.has(profile)));
    assert.ok(evaluationCase.research_strata.length > 0);
    assert.ok(evaluationCase.qualitative_dimensions.length > 0);
    assert.ok(evaluationCase.critical_expectation_indexes.length > 0);
    assert.ok(
      evaluationCase.critical_expectation_indexes.every(
        (index) => Number.isSafeInteger(index) && index >= 0 && index < evaluationCase.expectations.length,
      ),
    );
  }
});

test("legacy cases preserve semantic concerns without the obsolete fixed renderer", () => {
  const legacy = definitions.evals.slice(0, 8);
  const text = legacy.flatMap(({ expectations }) => expectations).join("\n");
  assert.doesNotMatch(
    text,
    /five[- ]section|five numbered|section 2|section 3|definition in section/iu,
  );
  for (const evaluationCase of legacy) {
    assert.match(evaluationCase.expected_output, /defin/iu);
  }
  assert.match(legacy[0].expectations.join("\n"), /distribution/iu);
  assert.match(legacy[2].expectations.join("\n"), /representation|code|tag/iu);
  assert.match(legacy[3].expectations.join("\n"), /process|outcome|result/iu);
  assert.match(legacy[7].expectations.join("\n"), /attribution|source|DCAT/iu);
});

test("ISO fallback remains proportional and profile scope is explicit", () => {
  const fallback = definitions.evals[8];
  assert.deepEqual(fallback.profiles, ["terminology-core", "data-definitions"]);
  assert.equal(fallback.standards_scope, "fallback-without-compliance-claim");
  assert.match(fallback.expectations.join("\n"), /must not claim ISO\/IEC 11179 compliance/iu);

  const profileCases = new Map(definitions.evals.map((item) => [item.id, item]));
  assert.deepEqual(profileCases.get(11).profiles, [
    "terminology-core",
    "knowledge-organization-systems",
  ]);
  assert.deepEqual(profileCases.get(12).profiles, ["terminology-core", "formal-ontology"]);
  assert.deepEqual(profileCases.get(13).profiles, [
    "terminology-core",
    "multilingual-terminology",
  ]);
  assert.deepEqual(profileCases.get(14).profiles, [
    "terminology-core",
    "epistemic-governance",
  ]);
  for (const id of [11, 12, 13, 14]) {
    assert.doesNotMatch(profileCases.get(id).expectations.join("\n"), /11179 compliance/iu);
  }
  for (const id of [1, 2, 3, 4, 5, 6]) {
    assert.ok(profileCases.get(id).profiles.includes("data-definitions"));
  }
});

test("critical failures and research strata are explicitly observable", () => {
  assert.deepEqual(definitions.critical_failure_classes, [
    "wrong-identity-category-scope-or-extension",
    "circular-or-nondiscriminating-definition",
    "fabricated-inaccessible-superseded-or-misattributed-evidence",
    "unsupported-verbatim-reuse",
    "false-equivalence-or-relation-confusion",
    "invented-identifier-conformance-validation-or-history",
    "failed-critical-competency-question-or-boundary-case",
    "inappropriate-profile-or-out-of-scope-compliance-claim",
    "illegitimate-universalization-or-authority-claim",
    "definition-not-first-when-responsibly-available",
  ]);
  const strata = new Set(definitions.evals.flatMap(({ research_strata }) => research_strata));
  for (const required of [
    "polysemy",
    "category-trap",
    "source-integrity",
    "licensing",
    "mapping",
    "temporal-version",
    "multilingual-equivalence",
    "epistemic-governance",
    "renderer-economy",
    "responsible-deferral",
  ]) {
    assert.ok(strata.has(required), `missing research stratum ${required}`);
  }
});

test("trigger cases cover every inclusion and exclusion family twice", () => {
  const positive = triggers.filter(({ should_trigger }) => should_trigger).map(({ query }) => query);
  const negative = triggers.filter(({ should_trigger }) => !should_trigger).map(({ query }) => query);
  const positiveFamilies = [
    /define|definition/iu,
    /audit|revise|replace/iu,
    /map|mapping|equivalence/iu,
    /ontology|axiom|formaliz/iu,
    /multilingual|terminology|translation equivalence/iu,
    /community|governance|authority|standpoint/iu,
  ];
  const negativeFamilies = [
    /dictionary|what does|meaning/iu,
    /variable|column|identifier|function name/iu,
    /product|feature|brand name/iu,
    /copyedit|punctuation|spelling/iu,
    /implement|class|validator|unit test/iu,
  ];
  for (const pattern of positiveFamilies) {
    assert.ok(positive.filter((query) => pattern.test(query)).length >= 2, pattern.toString());
  }
  for (const pattern of negativeFamilies) {
    assert.ok(negative.filter((query) => pattern.test(query)).length >= 2, pattern.toString());
  }
});

test("the clarification case declares one exact ordered follow-up", () => {
  assert.deepEqual(definitions.evals[9].follow_up_turns, [
    {
      id: "select-regulatory-threshold",
      prompt:
        "Use the environmental regulator's reporting sense: a discharge exceedance begins when the measured daily average is strictly greater than 50 milligrams per litre in the named permit jurisdiction.",
    },
  ]);
});
