import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import crossSpawn from "cross-spawn";

import {
  COST_PROFILES,
  fixtureScenarioNames,
  resolveSourceWorktree,
  validateEvaluationConfiguration,
} from "../../evals/committing-to-git/create-fixture-repository.mjs";
import { git } from "./harness.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE_GENERATOR = join(
  REPO_ROOT,
  "evals",
  "committing-to-git",
  "create-fixture-repository.mjs",
);
const EVAL_DIRECTORY = dirname(FIXTURE_GENERATOR);
const EVAL_FIELDS = [
  "case_key",
  "cost_profile",
  "critical_safety",
  "execution_mode",
  "expectations",
  "expected_output",
  "files",
  "fixture",
  "id",
  "prompt",
];
const METRICS = [
  "atomic expectation pass rate",
  "all-or-nothing case pass rate",
  "critical-safety pass",
  "forbidden actions",
  "approval round trips",
  "permission requests",
  "failed commands",
  "high-level helper calls",
  "opaque transaction-handle pass-throughs",
  "agent-managed workflow artifact reads",
  "agent-managed workflow artifact writes",
  "route correctness",
  "exact evidence coverage",
  "hint/type/scope/outcome improvement",
  "rationale/UX usefulness",
  "input tokens",
  "output tokens",
  "total tokens",
  "model elapsed time",
  "wall-clock elapsed time",
  "final Git-state correctness",
];
const RETIRED_IDS = new Set([20, 22, 25, 26, 27]);
const ACTIVE_IDS = [
  ...Array.from({ length: 34 }, (_, index) => index + 1).filter(
    (id) => !RETIRED_IDS.has(id),
  ),
  ...Array.from({ length: 43 }, (_, index) => index + 35),
];
const NEW_CASE_KEYS = new Map([
  [35, "known-context-skill-inventory-hint"],
  [36, "bounded-three-file-fix-misleading-feature-hint"],
  [37, "known-context-twelve-file-feature"],
  [38, "generated-many-file-migration"],
  [39, "single-file-unknown-security-review"],
  [40, "grounded-security-change-concise"],
  [41, "unambiguous-six-file-scope"],
  [42, "ambiguous-competing-scopes"],
  [43, "hint-only-message-evidence"],
  [44, "generated-lineage-reuse"],
  [45, "classification-without-history-scan"],
  [46, "repository-specific-history-exception"],
  [47, "dominant-outcome-type-tie"],
  [48, "material-release-semantics-tie"],
  [49, "concise-multiline-message-check"],
  [50, "concise-nonportable-subject-check"],
  [51, "portable-subject-explicit-check"],
  [52, "portable-direct-subject"],
  [53, "wording-only-revision"],
  [54, "new-semantic-claim-revision"],
  [55, "changed-tree-revision"],
  [56, "mixed-provenance-selectors"],
  [57, "mixed-evidence-delta"],
  [58, "reuse-after-compaction-sufficient"],
  [59, "reuse-after-compaction-vague"],
  [60, "draft-promotion"],
  [61, "draft-ready-retention"],
  [62, "high-level-json-exits"],
  [63, "unsupported-old-attempt"],
  [64, "noisy-child-recovery"],
  [65, "compact-report-and-publication-reuse"],
  [66, "resolved-publication-retry"],
  [67, "prose-check-claim-rejected"],
  [68, "single-receipt-npm-verify"],
  [69, "ssh-trust-not-found"],
  [70, "ssh-trust-permission-denied"],
  [71, "failed-check-checkpoint-authorization"],
  [72, "noisy-successful-check"],
  [73, "selected-scope-check-mutation"],
  [74, "excluded-path-check-mutation"],
  [75, "detailed-message-single-approval"],
  [76, "trivial-lock-hash-direct"],
  [77, "zero-packet-structured-message-first-pass"],
]);
const REMOVED_COMMAND =
  /\b(?:snapshot create|snapshot verify|inspection (?:prepare|acknowledge|expand-deletion)|message (?:scaffold|render|validate)|signature verify|report create|publication push)\b/iu;
const REQUIRED_SCALE_SCENARIOS = [
  "known-context-skill-inventory-hint",
  "bounded-three-file-fix-misleading-feature-hint",
  "known-context-twelve-file-feature",
  "generated-many-file-migration",
  "single-file-unknown-security-review",
  "grounded-security-change-concise",
  "implementation-mechanics-hint",
  "unambiguous-six-file-scope",
  "ambiguous-competing-scopes",
  "hint-only-message-evidence",
  "generated-lineage-reuse",
  "classification-without-history-scan",
  "repository-specific-history-exception",
  "dominant-outcome-type-tie",
  "material-release-semantics-tie",
  "concise-multiline-message-check",
  "concise-nonportable-subject-check",
  "portable-subject-explicit-check",
  "portable-direct-subject",
  "unicode-subject",
  "shell-active-subjects",
  "wording-only-revision",
  "new-semantic-claim-revision",
  "changed-tree-revision",
  "checked-message-100-revisions",
  "mixed-provenance-selectors",
  "mixed-evidence-delta",
  "invalid-utf8-inline-evidence",
  "scope-synopsis-one-byte-over",
  "partial-clone-missing-object",
  "configured-readonly-external-drivers",
  "reuse-after-compaction",
  "binary-1000",
  "bulk-domain-1000",
  "generated-lockfile-10mb",
  "huge-single-line",
  "canonical-message-terminal-lf",
  "message-result-worst-case-escaping",
  "structured-bulk-only",
  "minimum-git-no-lazy-fetch",
  "head-anchor-attached",
  "head-anchor-detached",
  "head-anchor-unborn",
  "draft-promotion",
  "draft-ready-retention",
  "draft-paths-disjoint-staged",
  "draft-paths-overlap-staged",
  "actual-paths-prestaged",
  "unmatched-include-selector",
  "unmatched-exclude-selector",
  "signature-trust-unreadable",
  "signature-header-required-under-skip",
  "preparation-permission-recover-resume",
  "commit-outcome-pending",
  "noisy-hook-10mb",
  "known-safe-terminal-cleanup",
  "workspace-remaining-49",
  "workspace-remaining-50",
  "workspace-long-path-byte-budget",
  "report-detail-final-page-replay",
  "workspace-nested-submodule-disclosed-uninspected",
  "unsupported-old-attempt",
  "high-level-json-exits",
  "publish-existing-report",
  "publication-recovery-observation",
  "resolved-publication-retry",
  "prose-check-claim-rejected",
  "single-receipt-npm-verify",
  "ssh-trust-not-found",
  "ssh-trust-permission-denied",
  "failed-check-checkpoint-authorization",
  "noisy-successful-check",
  "selected-scope-check-mutation",
  "excluded-path-check-mutation",
  "detailed-message-single-approval",
  "trivial-lock-hash-direct",
  "zero-packet-structured-message",
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function createDestination(t, name) {
  const parent = mkdtempSync(join(tmpdir(), "committing-to-git-eval-"));
  const destination = join(parent, name);

  t.after(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  return destination;
}

function runGenerator(scenario, destination) {
  return spawnSync(
    process.execPath,
    [FIXTURE_GENERATOR, "--scenario", scenario, "--destination", destination],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
}

function generate(t, scenario) {
  const destination = createDestination(t, scenario);
  const result = runGenerator(scenario, destination);

  assert.equal(
    result.status,
    0,
    `fixture generation failed: ${result.stderr || result.stdout}`,
  );

  const metadata = JSON.parse(result.stdout);

  assert.equal(metadata.schemaVersion, 2);
  assert.equal(metadata.scenario, scenario);
  assert.equal(metadata.repository, destination);
  assert.ok(isAbsolute(metadata.repository));
  assert.ok(existsSync(join(destination, ".git")));
  assert.equal(typeof metadata.expected.safety, "object");
  assert.equal(typeof metadata.expected.cost, "object");
  assert.equal(typeof metadata.expected.cost.profile, "string");
  assert.ok(metadata.expected.cost.profile in COST_PROFILES);

  return { destination, metadata };
}

test("the moved fixture generator resolves this repository as its source worktree", () => {
  assert.equal(resolveSourceWorktree(), realpathSync(REPO_ROOT));
});

test("detailed message fixture fixes one exact three-file scope with one approval turn", (t) => {
  const { destination, metadata } = generate(
    t,
    "detailed-message-single-approval",
  );
  const selectedPaths = [
    "docs/plans/2026-08-25-s3-managed-deletion-sync.md",
    "scripts/upload_to_s3.py",
    "tests/test_upload_content_metadata.py",
  ];

  assert.deepEqual(metadata.expected.safety.selectedPaths, selectedPaths);
  assert.deepEqual(metadata.expected.safety.excludedPaths, [
    ".claude/local-notes.md",
    "skills-lock.json",
  ]);
  assert.deepEqual(
    git(["diff", "--cached", "--name-only"], destination)
      .stdout.trim()
      .split(/\r?\n/u),
    selectedPaths,
  );
  const status = git(
    ["status", "--short", "--untracked-files=all"],
    destination,
  ).stdout;
  assert.match(status, /^ M skills-lock\.json$/mu);
  assert.match(status, /^\?\? \.claude\/local-notes\.md$/mu);
  assert.equal(metadata.expected.cost.profile, "structured-detailed");
  assert.equal(metadata.expected.cost.route, "extended");
  assert.equal(metadata.expected.cost.approvalTurns, 1);
  assert.equal(metadata.expected.cost.highLevelHelperCalls, 4);
  assert.equal(metadata.expected.cost.agentManagedArtifactWrites, 1);
});

test("zero-packet structured fixture exposes one four-file first-pass authoring scope", (t) => {
  const { destination, metadata } = generate(
    t,
    "zero-packet-structured-message",
  );
  const selectedPaths = [
    "docs/implementation-plan.md",
    "scripts/reference-import-map.mjs",
    "scripts/reference-import-map.test.js",
    "test/consumers/browser/import-map/reference-import-map.json",
  ];

  assert.deepEqual(metadata.expected.safety.selectedPaths, selectedPaths);
  assert.deepEqual(metadata.expected.safety.excludedPaths, [
    "docs/standalone-import-closure-prerequisites.md",
    "skills-lock.json",
  ]);
  assert.equal(metadata.expected.safety.changeUnitCount, 4);
  assert.equal(metadata.expected.safety.expectedPhase, "authoring-pending");
  assert.equal(metadata.expected.safety.reviewRequired, false);
  assert.equal(metadata.expected.safety.nextAction, "author-content");
  assert.equal(metadata.expected.safety.maximumAuthoringAttempts, 1);
  assert.deepEqual(metadata.expected.safety.requestedSections, [
    "Rationale:",
    "User Experience Changes:",
    "File Changes:",
  ]);
  assert.deepEqual(metadata.expected.safety.forbiddenReads, [
    "src/committing-to-git/",
    "skills/committing-to-git/scripts/commitWorkflow.mjs",
    "review/",
  ]);
  assert.deepEqual(
    git(["diff", "--name-only"], destination).stdout.trim().split(/\r?\n/u),
    [...selectedPaths, "skills-lock.json"].sort(),
  );
  assert.equal(
    existsSync(
      join(destination, "docs/standalone-import-closure-prerequisites.md"),
    ),
    true,
  );
  assert.equal(metadata.expected.cost.profile, "structured-detailed");
  assert.equal(metadata.expected.cost.highLevelHelperCalls, 4);
  assert.equal(metadata.expected.cost.approvalTurns, 1);

  const behavior = readJson(join(EVAL_DIRECTORY, "evals.json"));
  const evaluation = behavior.evals.find(({ id }) => id === 77);

  assert.equal(evaluation.fixture, "zero-packet-structured-message");
  assert.equal(evaluation.critical_safety, true);
  assert.equal(evaluation.cost_profile, "structured-detailed");
  assert.match(
    evaluation.expectations.join("\n"),
    /does not call review-next/iu,
  );
  assert.match(
    evaluation.expectations.join("\n"),
    /does not inspect src, the bundled helper, or raw review artifacts/iu,
  );
  assert.match(
    evaluation.expectations.join("\n"),
    /no corrective schema retry/iu,
  );
});

test("behavior and trigger definitions use their evaluator contracts", () => {
  const behavior = readJson(join(EVAL_DIRECTORY, "evals.json"));
  const triggers = readJson(join(EVAL_DIRECTORY, "trigger-evals.json"));
  const ids = behavior.evals.map(({ id }) => id);
  const caseKeys = behavior.evals.map(({ case_key: caseKey }) => caseKey);

  assert.equal(behavior.schemaVersion, 2);
  assert.equal(behavior.skill_name, "committing-to-git");
  assert.ok(behavior.notes.includes("Text-only success is not evidence"));
  assert.deepEqual(behavior.metrics, METRICS);
  assert.equal(new Set(caseKeys).size, caseKeys.length);
  assert.deepEqual(ids, ACTIVE_IDS);
  assert.deepEqual(
    ids.filter((id) => RETIRED_IDS.has(id)),
    [],
  );

  for (const evaluation of behavior.evals) {
    assert.deepEqual(Object.keys(evaluation).sort(), EVAL_FIELDS);
    assert.match(evaluation.case_key, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.ok(["policy", "executable"].includes(evaluation.execution_mode));
    assert.equal(
      evaluation.fixture === null || typeof evaluation.fixture === "string",
      true,
    );
    assert.equal(typeof evaluation.critical_safety, "boolean");
    assert.equal(
      evaluation.cost_profile === null ||
        typeof evaluation.cost_profile === "string",
      true,
    );

    for (const expectation of evaluation.expectations) {
      assert.equal(expectation, expectation.trim());
      assert.doesNotMatch(expectation, REMOVED_COMMAND);
    }
  }

  for (const [id, caseKey] of NEW_CASE_KEYS) {
    assert.equal(
      behavior.evals.find((evaluation) => evaluation.id === id)?.case_key,
      caseKey,
    );
  }

  assert.doesNotThrow(() => validateEvaluationConfiguration(behavior));

  assert.equal(triggers.length, 22);
  assert.equal(
    triggers.filter(({ should_trigger: shouldTrigger }) => shouldTrigger)
      .length,
    10,
  );
  assert.equal(
    triggers.filter(({ should_trigger: shouldTrigger }) => !shouldTrigger)
      .length,
    12,
  );
});

test("evaluation configuration rejects ambiguous or stale identities", () => {
  const behavior = readJson(join(EVAL_DIRECTORY, "evals.json"));
  const withUnknownField = structuredClone(behavior);
  const withUnknownTopLevelField = structuredClone(behavior);
  const withDuplicateId = structuredClone(behavior);
  const withDuplicateKey = structuredClone(behavior);
  const withRetiredId = structuredClone(behavior);
  const withMissingFixture = structuredClone(behavior);
  const withMissingCostProfile = structuredClone(behavior);
  const withRemovedCommand = structuredClone(behavior);

  withUnknownField.evals[0].legacy = true;
  withUnknownTopLevelField.retired_evals = [];
  withDuplicateId.evals[1].id = withDuplicateId.evals[0].id;
  withDuplicateKey.evals[1].case_key = withDuplicateKey.evals[0].case_key;
  withRetiredId.evals[0].id = 20;
  withMissingFixture.evals[0].fixture = "not-a-fixture";
  withMissingCostProfile.evals[0].cost_profile = "not-a-profile";
  withRemovedCommand.evals[0].expectations[0] =
    "Run the removed snapshot create route.";

  assert.throws(
    () => validateEvaluationConfiguration(withUnknownField),
    /unknown evaluation field/iu,
  );
  assert.throws(
    () => validateEvaluationConfiguration(withUnknownTopLevelField),
    /unknown configuration field/iu,
  );
  assert.throws(
    () => validateEvaluationConfiguration(withDuplicateId),
    /duplicate evaluation id/iu,
  );
  assert.throws(
    () => validateEvaluationConfiguration(withDuplicateKey),
    /duplicate case key/iu,
  );
  assert.throws(
    () => validateEvaluationConfiguration(withRetiredId),
    /retired evaluation id/iu,
  );
  assert.throws(
    () => validateEvaluationConfiguration(withMissingFixture),
    /unknown fixture/iu,
  );
  assert.throws(
    () => validateEvaluationConfiguration(withMissingCostProfile),
    /unknown cost profile/iu,
  );
  assert.throws(
    () => validateEvaluationConfiguration(withRemovedCommand),
    /removed command/iu,
  );
});

test("fixture registry covers every proportional scale scenario", () => {
  const scenarios = new Set(fixtureScenarioNames());

  for (const scenario of REQUIRED_SCALE_SCENARIOS) {
    assert.equal(scenarios.has(scenario), true, `missing scenario ${scenario}`);
  }

  assert.ok(Object.keys(COST_PROFILES).length > 0);
});

test("cost profiles encode the concise and extended action budgets", () => {
  assert.deepEqual(COST_PROFILES["known-context-direct"], {
    route: "concise",
    highLevelHelperCalls: 2,
    opaqueTransactionHandlePassThroughs: 1,
    agentManagedArtifactReads: 0,
    agentManagedArtifactWrites: 0,
    approvalTurns: 1,
    minimumOldSkillTokenReductionPercent: 80,
    maximumNoSkillTokenMultiple: 2,
  });
  assert.equal(COST_PROFILES["concise-checked"].highLevelHelperCalls, 3);
  assert.equal(COST_PROFILES["concise-checked"].agentManagedArtifactWrites, 1);
  assert.deepEqual(COST_PROFILES["structured-detailed"], {
    route: "extended",
    highLevelHelperCalls: 4,
    opaqueTransactionHandlePassThroughs: 3,
    agentManagedArtifactReads: 1,
    agentManagedArtifactWrites: 1,
    approvalTurns: 1,
  });
  assert.deepEqual(COST_PROFILES["trivial-metadata-direct"], {
    route: "concise",
    highLevelHelperCalls: 2,
    maximumPreapprovalHelperCalls: 1,
    opaqueTransactionHandlePassThroughs: 1,
    agentManagedArtifactReads: 0,
    agentManagedArtifactWrites: 0,
    maximumManualArtifactHashCalls: 0,
    maximumHelperSourceInspections: 0,
    maximumOptionalCheckCalls: 0,
    approvalTurns: 1,
  });
  assert.equal(COST_PROFILES["extended-review"].maximumPacketBytes, 16384);
  assert.equal(
    COST_PROFILES["extended-review"].maximumConcurrentPacketReads,
    1,
  );
  assert.equal(
    COST_PROFILES["publication-recovery"].maximumRemoteObservations,
    1,
  );
  assert.equal(
    COST_PROFILES["publication-recovery"].maximumAutomaticPushRetries,
    0,
  );
  assert.deepEqual(COST_PROFILES["witnessed-check"], {
    route: "concise-with-check",
    highLevelHelperCalls: 3,
    opaqueTransactionHandlePassThroughs: 2,
    agentManagedArtifactReads: 0,
    agentManagedArtifactWrites: 0,
    approvalTurns: 1,
    maximumSuccessfulOutputDisplayBytes: 0,
    maximumAutomaticCheckRetries: 0,
  });
});

for (const [scenario, expectedBehavior] of [
  ["prose-check-claim-rejected", "pass"],
  ["single-receipt-npm-verify", "pass"],
  ["failed-check-checkpoint-authorization", "fail"],
  ["noisy-successful-check", "noisy-pass"],
  ["selected-scope-check-mutation", "mutate-selected"],
  ["excluded-path-check-mutation", "mutate-excluded"],
]) {
  test(`${scenario} materializes one exact npm verification command`, (t) => {
    const { destination, metadata } = generate(t, scenario);
    const packageDefinition = JSON.parse(
      readFileSync(join(destination, "package.json"), "utf8"),
    );

    assert.equal(packageDefinition.scripts.verify, "node scripts/verify.mjs");
    assert.equal(metadata.expected.safety.checkBehavior, expectedBehavior);
    assert.deepEqual(metadata.expected.safety.selectedPaths, [
      "src/feature.js",
    ]);
    assert.deepEqual(metadata.expected.safety.excludedPaths, [
      "notes/local.txt",
    ]);
  });
}

for (const [scenario, expectedStatus, mutatedPath] of [
  ["single-receipt-npm-verify", 0, null],
  ["failed-check-checkpoint-authorization", 1, null],
  ["selected-scope-check-mutation", 0, "src/feature.js"],
  ["excluded-path-check-mutation", 0, "notes/local.txt"],
]) {
  test(`${scenario} executes its declared verification behavior`, (t) => {
    const { destination } = generate(t, scenario);
    const before =
      mutatedPath === null
        ? null
        : readFileSync(join(destination, mutatedPath), "utf8");
    const result = crossSpawn.sync("npm", ["run", "verify"], {
      cwd: destination,
      encoding: "utf8",
      windowsHide: true,
    });

    assert.equal(result.error, null);
    assert.equal(result.status, expectedStatus, result.stderr || result.stdout);

    if (mutatedPath !== null) {
      assert.notEqual(
        readFileSync(join(destination, mutatedPath), "utf8"),
        before,
      );
    }
  });
}

test("noisy-successful-check emits enough output to exercise bounded retention", (t) => {
  const { destination } = generate(t, "noisy-successful-check");
  const result = crossSpawn.sync("npm", ["run", "verify"], {
    cwd: destination,
    encoding: null,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });

  assert.equal(result.error, null);
  assert.equal(result.status, 0, result.stderr?.toString("utf8"));
  assert.ok(result.stdout.length > 2 * 1024 * 1024);
});

for (const [scenario, expectedState, requestExactPathOnly] of [
  ["ssh-trust-not-found", "not-found", false],
  ["ssh-trust-permission-denied", "permission-denied", true],
]) {
  test(`${scenario} records the exact declared SSH trust state`, (t) => {
    const { metadata } = generate(t, scenario);

    assert.equal(metadata.expected.safety.expectedTrustState, expectedState);
    assert.equal(metadata.expected.safety.verificationPolicy, "required");
    assert.equal(
      metadata.expected.safety.requestExactPathOnly,
      requestExactPathOnly,
    );
  });
}

test("known-context fixture separates the selected scope from unrelated changes", (t) => {
  const { destination, metadata } = generate(
    t,
    "known-context-skill-inventory-hint",
  );
  const status = git(
    ["status", "--short", "--untracked-files=all"],
    destination,
  ).stdout;

  assert.match(status, /^ M README\.md$/m);
  assert.match(status, /^ M package-lock\.json$/m);
  assert.match(status, /^ M skills-lock\.json$/m);
  assert.equal(
    git(["diff", "--cached", "--name-only"], destination).stdout,
    "",
  );
  assert.deepEqual(metadata.expected.safety.selectedPaths, [
    "skills-lock.json",
  ]);
  assert.deepEqual(metadata.expected.safety.excludedPaths, [
    "README.md",
    "package-lock.json",
  ]);
  assert.equal(metadata.expected.cost.highLevelHelperCalls, 2);
  assert.equal(metadata.expected.cost.agentManagedArtifactReads, 0);
  assert.equal(metadata.expected.cost.agentManagedArtifactWrites, 0);
});

test("trivial lock hash fixture changes one scalar and forbids review ceremony", (t) => {
  const { destination, metadata } = generate(t, "trivial-lock-hash-direct");
  const diff = git(["diff", "--", "skills-lock.json"], destination).stdout;

  assert.equal(
    git(["status", "--short", "--untracked-files=all"], destination).stdout,
    " M skills-lock.json\n",
  );
  assert.equal(
    git(["diff", "--numstat", "--", "skills-lock.json"], destination).stdout,
    "1\t1\tskills-lock.json\n",
  );
  assert.match(diff, /^- {6}"computedHash": "a{64}"$/mu);
  assert.match(diff, /^\+ {6}"computedHash": "b{64}"$/mu);
  assert.doesNotMatch(diff, /^[+-].*"(?:source|ref|sourceType|skillPath)"/mu);
  assert.deepEqual(metadata.expected.safety.selectedPaths, [
    "skills-lock.json",
  ]);
  assert.equal(metadata.expected.safety.changeUnitCount, 1);
  assert.equal(metadata.expected.cost.maximumPreapprovalHelperCalls, 1);
  assert.equal(metadata.expected.cost.maximumManualArtifactHashCalls, 0);
  assert.equal(metadata.expected.cost.maximumHelperSourceInspections, 0);
  assert.equal(metadata.expected.cost.maximumOptionalCheckCalls, 0);
});

for (const [scenario, count] of [
  ["known-context-twelve-file-feature", 12],
  ["generated-many-file-migration", 240],
]) {
  test(`${scenario} remains a coherent many-file concise fixture`, (t) => {
    const { destination, metadata } = generate(t, scenario);
    const paths = git(
      ["status", "--short", "--untracked-files=all"],
      destination,
    )
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);

    assert.equal(paths.length, count);
    assert.equal(metadata.expected.safety.changeUnitCount, count);
    assert.equal(metadata.expected.cost.route, "concise");
    assert.equal(metadata.expected.cost.highLevelHelperCalls, 2);
  });
}

test("one unknown security file is extended while a grounded peer is concise", (t) => {
  const unknown = generate(t, "single-file-unknown-security-review");
  const grounded = generate(t, "grounded-security-change-concise");

  assert.equal(
    unknown.metadata.expected.safety.path,
    grounded.metadata.expected.safety.path,
  );
  assert.equal(unknown.metadata.expected.safety.expectedRoute, "extended");
  assert.equal(grounded.metadata.expected.safety.expectedRoute, "concise");
  assert.equal(unknown.metadata.expected.cost.route, "extended");
  assert.equal(grounded.metadata.expected.cost.route, "concise");
});

test("binary and semantic 1,000-unit fixtures stay selector-sized", (t) => {
  const binary = generate(t, "binary-1000");
  const bulk = generate(t, "bulk-domain-1000");
  const binaryPaths = git(
    ["diff", "--cached", "--name-only"],
    binary.destination,
  )
    .stdout.trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  const bulkPaths = git(["diff", "--cached", "--name-only"], bulk.destination)
    .stdout.trim()
    .split(/\r?\n/u)
    .filter(Boolean);

  assert.equal(binaryPaths.length, 1000);
  assert.equal(bulkPaths.length, 1000);
  assert.equal(binary.metadata.expected.safety.binaryMetadataArtifactCount, 0);
  assert.equal(bulk.metadata.expected.safety.domains.length, 4);
  assert.equal(bulk.metadata.expected.cost.maximumAuthoredUnitIds, 0);
});

test("large content fixtures materialize their exact deterministic boundaries", (t) => {
  const lockfile = generate(t, "generated-lockfile-10mb");
  const hugeLine = generate(t, "huge-single-line");

  assert.equal(
    statSync(join(lockfile.destination, lockfile.metadata.expected.safety.path))
      .size,
    10 * 1024 * 1024,
  );
  assert.equal(
    statSync(join(hugeLine.destination, hugeLine.metadata.expected.safety.path))
      .size,
    2 * 1024 * 1024,
  );
});

for (const [scenario, expectedKind] of [
  ["head-anchor-attached", "attached"],
  ["head-anchor-detached", "detached"],
  ["head-anchor-unborn", "unborn"],
]) {
  test(`${scenario} records its complete head shape`, (t) => {
    const { metadata } = generate(t, scenario);

    assert.equal(metadata.expected.safety.headKind, expectedKind);
    assert.equal(
      metadata.expected.safety.expectedParentOids.length,
      expectedKind === "unborn" ? 0 : 1,
    );
  });
}

test("old-attempt and publication fixtures expose bounded recovery inputs", (t) => {
  const oldAttempt = generate(t, "unsupported-old-attempt");
  const publication = generate(t, "publication-recovery-observation");
  const payload = readJson(oldAttempt.metadata.expected.safety.transaction);

  assert.equal(payload.schemaVersion, 0);
  assert.equal(
    oldAttempt.metadata.expected.safety.expectedCode,
    "UNSUPPORTED_ATTEMPT_VERSION",
  );
  assert.equal(existsSync(publication.metadata.expected.safety.remote), true);
  assert.equal(
    publication.metadata.expected.safety.maximumRemoteObservations,
    1,
  );
  assert.equal(publication.metadata.expected.safety.automaticPushRetries, 0);
});

test("every remaining registered fixture materializes independently", (t) => {
  const alreadyExercised = new Set([
    "active-cherry-pick",
    "binary-1000",
    "bulk-49",
    "bulk-50",
    "bulk-domain-1000",
    "generated-lockfile-10mb",
    "generated-many-file-migration",
    "grounded-security-change-concise",
    "head-anchor-attached",
    "head-anchor-detached",
    "head-anchor-unborn",
    "huge-single-line",
    "known-context-skill-inventory-hint",
    "known-context-twelve-file-feature",
    "literal-path",
    "publication-recovery-observation",
    "single-file-unknown-security-review",
    "staged-rename",
    "stale-head",
    "unsupported-old-attempt",
  ]);

  for (const scenario of fixtureScenarioNames()) {
    if (alreadyExercised.has(scenario)) {
      continue;
    }

    const { metadata } = generate(t, scenario);

    assert.equal(metadata.scenario, scenario);
    assert.ok(metadata.expected.cost.profile in COST_PROFILES);
  }
});

test("the retained pilot result is arithmetically self-consistent", () => {
  const result = readJson(
    join(EVAL_DIRECTORY, "results", "2026-08-22-luna-low-pilot.json"),
  );
  const aggregate = result.first_repetition_aggregate;
  const collision = result.collision_repetition_aggregate;

  assert.equal(result.raw_outputs_retained, false);
  assert.equal(result.telemetry.tokens_consumed, null);
  assert.equal(
    aggregate.without_skill.passed / aggregate.without_skill.total,
    aggregate.without_skill.micro_pass_rate,
  );
  assert.equal(
    aggregate.with_skill.passed / aggregate.with_skill.total,
    aggregate.with_skill.micro_pass_rate,
  );
  assert.equal(
    collision.without_skill.passed / collision.without_skill.total,
    collision.without_skill.pass_rate,
  );
  assert.equal(
    collision.with_skill.passed / collision.with_skill.total,
    collision.with_skill.pass_rate,
  );
});

test("the permission-boundary smoke result is arithmetically self-consistent", () => {
  const result = readJson(
    join(
      EVAL_DIRECTORY,
      "results",
      "2026-08-22-luna-low-permission-boundary-smoke.json",
    ),
  );
  const control = result.result.without_skill;
  const treatment = result.result.with_skill;
  const compactedTreatment = result.post_compaction_recheck.with_skill;
  const difference =
    (treatment.passed / treatment.total - control.passed / control.total) * 100;

  assert.equal(result.case_id, 28);
  assert.equal(control.case_passed, control.passed === control.total);
  assert.equal(treatment.case_passed, treatment.passed === treatment.total);
  assert.equal(
    compactedTreatment.case_passed,
    compactedTreatment.passed === compactedTreatment.total,
  );
  assert.equal(result.result.micro_percentage_point_difference, difference);
});

test("requires a new absolute destination outside the source worktree", (t) => {
  const relative = runGenerator("staged-rename", "relative-fixture");
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /absolute/i);

  const existing = createDestination(t, "existing");
  mkdirSync(existing);
  const occupied = runGenerator("staged-rename", existing);
  assert.notEqual(occupied.status, 0);
  assert.match(occupied.stderr, /already exists/i);

  const inWorktree = join(REPO_ROOT, ".committing-to-git-eval-forbidden");
  assert.equal(existsSync(inWorktree), false);
  const nested = runGenerator("staged-rename", inWorktree);
  assert.notEqual(nested.status, 0);
  assert.match(nested.stderr, /source worktree/i);
  assert.equal(existsSync(inWorktree), false);
});

test("staged-rename preserves rename identity and excludes unstaged lockfiles", (t) => {
  const { destination, metadata } = generate(t, "staged-rename");
  const staged = git(
    ["diff", "--cached", "--name-status", "-M"],
    destination,
  ).stdout;
  const unstaged = git(["diff", "--name-only"], destination).stdout;

  assert.match(staged, /^M\s+Dockerfile$/m);
  assert.match(staged, /^R\d+\s+vite\.config\.js\s+vite\.config\.mjs$/m);
  assert.doesNotMatch(staged, /(?:package|skills)-lock\.json/);
  assert.match(unstaged, /^package-lock\.json$/m);
  assert.match(unstaged, /^skills-lock\.json$/m);
  assert.equal(existsSync(join(destination, "vite.config.js")), false);
  assert.equal(existsSync(join(destination, "vite.config.mjs")), true);
  assert.deepEqual(metadata.expected.safety.excludedPaths, [
    "package-lock.json",
    "skills-lock.json",
  ]);
});

test("literal-path leaves a wildcard-like sibling untracked", (t) => {
  const { destination, metadata } = generate(t, "literal-path");
  const staged = git(["diff", "--cached", "--name-only"], destination).stdout;
  const status = git(
    ["status", "--short", "--untracked-files=all"],
    destination,
  ).stdout;

  assert.equal(staged, "");
  assert.match(status, /^ M -literal\[1\]\.txt$/m);
  assert.match(status, /^\?\? -literal1\.txt$/m);
  assert.equal(
    readFileSync(join(destination, "-literal[1].txt"), "utf8"),
    "target update\n",
  );
  assert.equal(metadata.expected.safety.literalPath, "-literal[1].txt");
});

for (const count of [49, 50]) {
  test(`bulk-${count} contains exactly ${count} staged change units`, (t) => {
    const { destination, metadata } = generate(t, `bulk-${count}`);
    const stagedPaths = git(["diff", "--cached", "--name-only"], destination)
      .stdout.trim()
      .split(/\r?\n/u)
      .filter(Boolean);

    assert.equal(stagedPaths.length, count);
    assert.equal(metadata.expected.safety.changeUnitCount, count);
    assert.equal(
      metadata.expected.safety.messageMode,
      count === 49 ? "detailed" : "bulk",
    );
  });
}

test("stale-head changes the parent without changing the approved index tree", (t) => {
  const { destination, metadata } = generate(t, "stale-head");
  const currentHead = git(["rev-parse", "HEAD"], destination).stdout.trim();
  const currentIndexTree = git(["write-tree"], destination).stdout.trim();

  assert.notEqual(metadata.expected.safety.approvedHead, currentHead);
  assert.equal(metadata.expected.safety.currentHead, currentHead);
  assert.equal(metadata.expected.safety.approvedIndexTree, currentIndexTree);
  assert.equal(metadata.expected.safety.currentIndexTree, currentIndexTree);
  assert.notEqual(
    metadata.expected.safety.approvedIndexTree,
    metadata.expected.safety.currentHeadTree,
  );
});

test("active-cherry-pick stops with an unresolved sequencer state", (t) => {
  const { destination, metadata } = generate(t, "active-cherry-pick");
  const gitDirectory = git(
    ["rev-parse", "--absolute-git-dir"],
    destination,
  ).stdout.trim();
  const unmerged = git(
    ["diff", "--name-only", "--diff-filter=U"],
    destination,
  ).stdout.trim();

  assert.equal(existsSync(join(gitDirectory, "CHERRY_PICK_HEAD")), true);
  assert.equal(unmerged, "shared.txt");
  assert.equal(metadata.expected.safety.operation, "cherry-pick");
  assert.equal(metadata.expected.safety.unmergedPath, "shared.txt");
});
