# Convergent Zero-Packet Commit Authoring Implementation Plan

> **For agentic workers:** Execute this plan sequentially in the primary agent session. Do not delegate to subagents or run provider-backed model evaluations. Use `test-driven-development` for every behavior change and `verification-before-completion` before the issue commit. Use the freshly rebuilt canonical `committing-to-git` skill for the commit.

**Goal:** Make a structured commit-message extension with already-complete evidence enter an explicit authoring state, expose its complete input contract, validate independent mistakes together, and reach canonical approval in one authoring pass.

**Architecture:** Separate evidence review from semantic authoring in the persisted transaction state. A shared message-contract module will define the bounded authoring vocabulary, while a focused structural validator will return actionable JSON-Pointer diagnostics before semantic coverage is evaluated. Extension and packet traversal will project the same explicit authoring action instead of requiring callers to infer completion from a null queue.

**Tech Stack:** Node.js 24+ ECMAScript modules, JSON Schema Draft 2020-12, Node's built-in test runner, Git 2.45+, esbuild, ESLint, and Prettier.

**Spec:** [`2026-08-28-zero-packet-structured-message.md`](../committing-to-git/issues/2026-08-28-zero-packet-structured-message.md)

## Global Constraints

- Preserve fixed transaction-local input paths, strict UTF-8, exact snapshot and receipt bindings, bounded JSON results, and canonical helper-owned message rendering.
- Replace the persisted transaction schema atomically with version 4; do not migrate version-3 attempts or retain a compatibility state branch.
- Use `review-pending` only while evidence packets remain and `authoring-pending` only after the current review receipt is complete.
- Return canonical `displayText` before exact approval and never model conversational approval inside the helper.
- Do not add runtime dependencies or modify package, build, lint, formatting, CI, or repository-policy configuration.
- The approved evaluation configuration change is one new ID 77 case; add it but do not run provider-backed evaluations.
- Keep canonical `skills/**/SKILL.md` ASCII-only.
- Preserve the unrelated `skills-lock.json` working-tree change and exclude it from the issue commit.

---

### Task 1: Encode the zero-packet failure as an end-to-end regression

**Files:**

- Modify: `tests/committing-to-git/commit-workflow-cli.test.mjs`
- Modify: `tests/committing-to-git/workflow-e2e.test.mjs`

**Interfaces:**

- Consumes: `workflow prepare`, `workflow extend`, `workflow review-next`, `message finalize`, and `workflow commit`.
- Produces: failing expectations for `authoring-pending`, explicit review completion, a bounded content contract, idempotent empty traversal, first-pass finalization, and exact signed commit creation.

- [ ] **Step 1: Add the exact four-file fixture and extension assertions**

  Prepare four current-task-authored paths with `--evidence reuse --basis authored-current-task`, extend with `semantic-structure-required`, and assert this public shape:

  ```js
  assert.equal(result.phase, "authoring-pending");
  assert.equal(result.status, "authoring-pending");
  assert.equal(result.reviewRequired, false);
  assert.deepEqual(result.reviewProgress, {
    deliveredPacketCount: 0,
    requiredPacketCount: 0,
    complete: true,
    nextCursor: null,
  });
  assert.equal(result.nextAction, "author-content");
  assert.equal(result.contentPath, join(dirname(transactionPath), "content.json"));
  ```

- [ ] **Step 2: Add repeated zero-packet traversal assertions**

  Invoke `workflow review-next` twice without a cursor. Both calls must return exit 0, `packet: null`, the same completed progress and authoring contract, and must leave the receipt, snapshot digest, evidence-plan digest, and tree OID byte-for-byte unchanged.

- [ ] **Step 3: Add first-pass authoring and commit assertions**

  Fill `content.json` once using only fields documented in the returned contract. Assert that one `message finalize` call returns `message-ready`, preserves all supported requested sections and all four file paths, and that one later authorized `workflow commit` creates the exact signed tree and raw message.

- [ ] **Step 4: Run the focused tests and confirm RED**

  Run:

  ```text
  node --test --test-name-pattern="semantic structure|zero-packet|semantic content" tests/committing-to-git/commit-workflow-cli.test.mjs tests/committing-to-git/workflow-e2e.test.mjs
  ```

  Expected: failures show the old `review-pending` phase, absent contract fields, and `REVIEW_PACKETS_EMPTY`.

### Task 2: Introduce the explicit authoring state

**Files:**

- Modify: `src/committing-to-git/transaction/transactionWorkspace.js`
- Modify: `src/committing-to-git/schema/commitTransaction.schema.json`
- Modify: `src/committing-to-git/cli/commitWorkflow.js`
- Modify: `src/committing-to-git/workflow/extendReviewWorkflow.js`
- Modify: `src/committing-to-git/workflow/reviewNextWorkflow.js`
- Modify: `src/committing-to-git/workflow/finalizeMessageWorkflow.js`
- Modify: `src/committing-to-git/workflow/checkMessageWorkflow.js`
- Modify: `src/committing-to-git/workflow/runCheckWorkflow.js`
- Modify: `src/committing-to-git/workflow/promoteDraftWorkflow.js`
- Modify: affected transaction and workflow tests

**Interfaces:**

- Produces transaction schema version 4.
- Produces phase/status `authoring-pending` when `review.receipt.requiredPacketsReviewed === true` and no canonical message exists.
- Preserves `review-pending` for incomplete packet traversal and `evidence-required` deltas.

- [ ] **Step 1: Add version-4 and phase-transition tests**

  Assert that version 3 returns `UNSUPPORTED_ATTEMPT_VERSION`, allocation writes version 4, and these transitions are valid:

  ```text
  evidence-ready -> authoring-pending
  evidence-ready -> review-pending
  review-pending -> authoring-pending
  authoring-pending -> review-pending
  authoring-pending -> message-ready
  ```

  The reverse authoring-to-review transition is permitted only for a newly materialized evidence delta. Assert that `authoring-pending -> commit-pending` is rejected: checked or finalized canonical `message-ready` bytes are mandatory before a commit transition.

- [ ] **Step 2: Run the transaction tests and confirm RED**

  Run:

  ```text
  node --test tests/committing-to-git/transaction-workspace.test.mjs tests/committing-to-git/artifact-schemas.test.mjs
  ```

- [ ] **Step 3: Implement the atomic state cutover**

  Add `authoring-pending` to the runtime and JSON Schema phase/status/state combinations, bump allocation and preflight to version 4, and update every workflow gate that legitimately operates after complete review. Do not leave a version-3 reader or phase alias.

- [ ] **Step 4: Make review completion drive the phase**

  Zero-packet extension creates the existing verified empty receipt and advances directly to `authoring-pending`. The final nonempty packet atomically stores its verified receipt and advances to `authoring-pending`. Evidence deltas return to `review-pending` and transition back only after their final packet.

- [ ] **Step 5: Run focused state and workflow tests and confirm GREEN**

  Run the commands from Steps 2 and Task 1 Step 4. Expected: all selected tests pass.

### Task 3: Expose one bounded authoring contract

**Files:**

- Create: `src/committing-to-git/message/semanticContentContract.js`
- Modify: `src/committing-to-git/workflow/extendReviewWorkflow.js`
- Modify: `src/committing-to-git/workflow/reviewNextWorkflow.js`
- Modify: `tests/committing-to-git/commit-workflow-cli.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`

**Interfaces:**

- Produces: `semanticContentContract(mode) -> SemanticContentContractV1`.
- Produces common authoring fields: `reviewRequired`, `reviewProgress`, `nextAction`, `contentPath`, and `contentContract`.

- [ ] **Step 1: Write contract parity tests**

  Assert the contract identifies schema version 3 content, completion value `complete`, immutable `schemaVersion`/`evidenceGroups`/`mode`, exact subject keys, `reasons`, detailed and bulk entry keys, supported sections, and semantic selector keys including `destinationPaths`. Assert it explicitly contrasts scope-file `includePaths` with semantic `destinationPaths`.

- [ ] **Step 2: Run the focused tests and confirm RED**

  Run:

  ```text
  node --test tests/committing-to-git/commit-workflow-cli.test.mjs tests/committing-to-git/artifact-schemas.test.mjs
  ```

- [ ] **Step 3: Implement the single source of contract truth**

  Export frozen arrays and a freshly cloned bounded result so callers cannot mutate module state. Include separate examples for detailed file notes and bulk domains, and describe selectors as semantic membership rather than Git scope input.

- [ ] **Step 4: Project the same authoring result from extension and traversal**

  Use one shared result builder so zero-packet extension, final packet delivery, and idempotent empty traversal cannot disagree. Keep `packet: null` explicit on empty traversal.

- [ ] **Step 5: Assert serialized result budgets**

  Run boundary tests through the real JSON serializers and assert every authoring result remains below the existing 80 KiB command-result ceiling.

### Task 4: Aggregate structural diagnostics before semantic validation

**Files:**

- Create: `src/committing-to-git/message/semanticContentValidation.js`
- Modify: `src/committing-to-git/workflow/finalizeMessageWorkflow.js`
- Modify: `tests/committing-to-git/workflow-e2e.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`

**Interfaces:**

- Produces: `validateCompleteSemanticContent(value) -> { valid, diagnostics }`.
- Each diagnostic has `pointer`, `code`, `message`, and only applicable `expectedType`, `allowedValues`, `allowedFields`, `missingFields`, or `unknownFields`.
- The public summary has `count`, `samples`, `truncated`, and `sha256` and returns every diagnostic when the complete set fits the fixed sample ceiling.

- [ ] **Step 1: Add one multiply malformed worksheet test**

  Submit a content object containing `authoringState: "ready"`, a string subject, `notes` in a file-note entry, and `includePaths` in a semantic selector. Assert one `INVALID_MESSAGE_CONTENT` result contains actionable diagnostics for all four independent errors and identifies `destinationPaths` as the semantic field.

- [ ] **Step 2: Run the test and confirm only the first problem is currently returned**

  Run:

  ```text
  node --test --test-name-pattern="aggregate|malformed semantic" tests/committing-to-git/workflow-e2e.test.mjs
  ```

- [ ] **Step 3: Implement bounded structural accumulation**

  Traverse only bounded `content.json`; escape JSON Pointer tokens per RFC 6901, collect independent shape/type/member errors, hash the canonical complete diagnostic stream, and retain a bounded ordered sample. Do not run selector coverage or evidence semantics until structural validation succeeds.

- [ ] **Step 4: Preserve semantic errors as a later stage**

  After structural success, retain the existing exact evidence-plan binding, selector matching, overlap, exhaustive partition, rationale, mode, and canonical rendering checks.

- [ ] **Step 5: Run focused validation, rendering, and end-to-end tests**

  Run:

  ```text
  node --test tests/committing-to-git/change-selection.test.mjs tests/committing-to-git/commit-message-renderer.test.mjs tests/committing-to-git/artifact-schemas.test.mjs tests/committing-to-git/workflow-e2e.test.mjs
  ```

### Task 5: Align the installed skill, issue record, and future eval

**Files:**

- Modify: `skills/committing-to-git/SKILL.md`
- Modify: `skills/committing-to-git/references/message-format.md`
- Modify: `evals/committing-to-git/evals.json`
- Modify: `evals/committing-to-git/create-fixture-repository.mjs`
- Modify: `tests/committing-to-git/eval-fixtures.test.mjs`
- Modify: `docs/committing-to-git/issues/2026-08-28-zero-packet-structured-message.md`

**Interfaces:**

- Adds approved evaluation ID 77, case key `zero-packet-structured-message-first-pass`, executable fixture `zero-packet-structured-message`, critical safety true, cost profile `structured-detailed`.
- Does not execute the evaluation.

- [ ] **Step 1: Add deterministic eval-definition and fixture tests**

  Assert ID/key uniqueness, exact fixture materialization, and the expectations that source/bundle inspection and corrective schema retries are forbidden.

- [ ] **Step 2: Run the eval fixture tests and confirm RED**

  Run:

  ```text
  node --test tests/committing-to-git/eval-fixtures.test.mjs
  ```

- [ ] **Step 3: Add the approved evaluation and fixture**

  Append only ID 77 with the approved metadata. Create four deterministic paths corresponding to plan, generator, generator test, and generated consumer output. Do not invoke any model runner.

- [ ] **Step 4: Update agent guidance**

  Direct agents to follow `nextAction`, consume the returned versioned contract, preserve helper-owned bindings, call `review-next` only when `reviewRequired` is true, and wait for canonical `message-ready` bytes before approval. State supported sections explicitly so unsupported requested sections are resolved before approval.

- [ ] **Step 5: Resolve the issue record**

  Correct repository-relative links and append the implemented state, contract, diagnostics, focused verification, and explicitly unrun provider-evaluation status.

- [ ] **Step 6: Run focused skill and fixture tests**

  Run:

  ```text
  node --test tests/committing-to-git/eval-fixtures.test.mjs tests/committing-to-git/commit-workflow-cli.test.mjs tests/committing-to-git/workflow-e2e.test.mjs
  ```

### Task 6: Build, verify, review, and commit Issue 1

**Files:**

- Regenerate: `skills/committing-to-git/scripts/commitWorkflow.mjs`
- Review: every Issue 1 source, test, skill, evaluation, plan, and issue-record change

- [ ] **Step 1: Run the repository build**

  Run:

  ```text
  npm run build
  ```

  Expected: source bundles successfully as ESM and canonical skill ASCII validation passes.

- [ ] **Step 2: Run complete deterministic verification**

  Run:

  ```text
  npm run verify
  ```

  Expected: build check, lint, deterministic Node tests, skill validation/lint, and diff check all pass. This command must not run a provider-backed model evaluation.

- [ ] **Step 3: Inspect the complete bounded diff and status**

  Confirm the Issue 1 scope contains only its plan, issue record, source, schema, tests, approved evaluation definition/fixture, canonical skill text, and rebuilt bundle. Confirm `skills-lock.json` remains unstaged.

- [ ] **Step 4: Reload the canonical skill and prepare a detailed issue commit**

  Read `skills/committing-to-git/SKILL.md` completely, then use `skills/committing-to-git/scripts/commitWorkflow.mjs`. The canonical message must explain the state-machine correction, first-pass contract, aggregate diagnostics, agent-facing behavior, and every changed file or truthful counted domain.

- [ ] **Step 5: Present canonical bytes for exact approval and commit once authorized**

  Use one signed commit. Do not push. Verify the full OID, raw message, tree, signature result, and remaining workspace state before beginning Issue 2.

## Plan Self-Review

- Spec coverage: every required design property and acceptance criterion is assigned to Tasks 1-6; provider-backed evaluation execution is deliberately excluded by the user.
- Placeholder scan: no deferred implementation placeholder remains.
- Type consistency: `authoring-pending`, `author-content`, `contentContract`, and diagnostic property names are identical across state, result, test, and skill tasks.
