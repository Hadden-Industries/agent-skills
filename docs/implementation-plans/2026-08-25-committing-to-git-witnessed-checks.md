# Witnessed Checks and SSH Trust Diagnostics Implementation Plan

> **For agentic workers:** Execute this plan sequentially in one primary-agent session. Do not delegate to subagents or run implementation, test, or evaluation steps concurrently. Use `test-driven-development` for every behavior change and `verification-before-completion` before any completion claim. Commit and push only after their separately required authorizations.

**Goal:** Make signature-access failures actionable before commit creation and replace caller-authored check claims with compact helper-witnessed execution receipts bound to the prepared commit transaction.

**Architecture:** Preserve the existing high-level `workflow prepare` and `workflow commit` route. Enrich SSH trust-source preflight with machine-actionable states, and insert an optional `workflow check` command between preparation and exact approval. The helper launches one executable-and-argument vector, journals the child outcome, binds the receipt to the prepared tree and head anchor, and makes `workflow commit` and the post-commit report consume only those transaction-owned receipts.

**Tech Stack:** Node.js 24+ ECMAScript modules, Git 2.45+ read-only plumbing, JSON Schema Draft 2020-12, Node's built-in test runner, `cross-spawn` 7.0.6 as a bundled development dependency, esbuild, ESLint, and Prettier.

**Spec:** This plan implements the design approved in the 2026-08-25 conversation and amends `docs/implementation-plans/2026-08-23-committing-to-git-proportional-workflow.md`. It supersedes that plan's caller-authored check representation and Node-built-ins-only dependency statement. All exact-scope, exact-message, signing, recovery, publication, proportionality, and no-compatibility-cutover constraints remain in force.

## Global Constraints

- Preserve the user-owned `.codex/config.toml` modification and untracked `.claude/` tree.
- Change canonical source under `src/` and `skills/`; rebuild the bundled `skills/committing-to-git/scripts/commitWorkflow.mjs` instead of editing it directly.
- Keep every canonical `skills/**/SKILL.md` ASCII-only.
- Keep the no-check route at `workflow prepare` -> exact approval -> `workflow commit`; checks remain optional and add one helper call per top-level command.
- One check command produces one receipt. Never infer child package-script results from stdout.
- A receipt records helper-observed process facts. It is local execution evidence, not remote or cryptographic attestation against a malicious process with equivalent filesystem access.
- Accept executable and argument tokens after `--`; do not accept a single shell command string.
- Use `cross-spawn` to resolve Windows command shims while retaining argument-vector semantics. Bundle it into the published script so skill users install no runtime dependency.
- Do not serialize environment variables or raw successful output in the ordinary command result or post-commit report.
- Bind every receipt to the transaction path, manifest SHA-256, prepared tree OID, and complete head anchor.
- In the first cutover, the only supported execution context is `current-worktree`. Exact-snapshot, container, and external-environment claims remain unsupported until the helper owns and verifies those environments.
- Before and after execution, compare every selected source/destination path with the prepared tree. A selected-scope drift invalidates the transaction and requires fresh preparation.
- A nonzero child exit creates a durable failed receipt. It does not become an infrastructure failure or disappear from the report.
- A failed receipt requires informed user authorization before commit; one approval may authorize the exact message and the named failure acknowledgement together.
- An interrupted or still-running check is never retried automatically. A later retry must reference the resolved prior attempt.
- Wording-only message revision retains receipts; any tree, scope, manifest, or head-anchor change invalidates them by requiring a new transaction.
- Remove the old `--checks <checks.json>` interface, version-1 checks capsule, external check contexts, and compatibility reader atomically.
- Bump the commit transaction schema to version 2. Old temporary transactions are unsupported and are never migrated.
- Add detailed comments around process launch journaling, output truncation, Windows executable resolution, snapshot binding, and recovery invariants where the reason is not obvious.
- Run `npm run build` after source changes and `npm run verify` before completion.

---

### Task 1: Record the cutover and promote the launcher dependency

**Files:**

- Create: `docs/implementation-plans/2026-08-25-committing-to-git-witnessed-checks.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces: direct development dependency `cross-spawn: ^7.0.6` for source bundling.
- Preserves: the already locked `node_modules/cross-spawn` 7.0.6 package and its existing transitive graph.

- [ ] Add `cross-spawn` to the root `devDependencies` in both package manifests.
- [ ] Run `npm install --ignore-scripts` only if the lockfile cannot be updated by the two direct-dependency records already present; do not otherwise rewrite the dependency graph.
- [ ] Run `npm run format:check` and confirm the two manifests remain canonical.

### Task 2: Classify SSH trust-source capability before mutation

**Files:**

- Modify: `tests/committing-to-git/signature-policy.test.mjs`
- Modify: `tests/committing-to-git/transaction-recovery.test.mjs`
- Modify: `src/committing-to-git/signature/signaturePreflight.js`
- Modify: `src/committing-to-git/workflow/prepareWorkflow.js`
- Modify: `src/committing-to-git/transaction/transactionWorkspace.js`
- Modify: `src/committing-to-git/schema/commitTransaction.schema.json`

**Interfaces:**

- `inspectSignatureRequirements(root, options)` returns SSH `trustSource.state` as one of `readable`, `not-configured`, `not-found`, `permission-denied`, `invalid-file-type`, or `probe-error`.
- A non-readable state records `errorCode` when the operating system supplied one; it never records file contents.
- `preflightVerificationPolicy()` returns a structured `SIGNATURE_TRUST_ACCESS_REQUIRED` error whose action is `request-read-capability`, `repair-configuration`, or `choose-verification-policy`.

- [ ] Add table-driven tests whose hand-derived expectations distinguish missing configuration, missing path, denied access, invalid file type, unexpected probe error, and readable input.
- [ ] Run the focused tests and confirm the current boolean-only implementation fails those expectations.
- [ ] Replace `accessSync()` with a direct read probe that follows the same configured filesystem path Git will use, closes its descriptor, and retains safe error categories.
- [ ] Map `EACCES` and `EPERM` to `permission-denied`, `ENOENT` and `ENOTDIR` to `not-found`, non-files to `invalid-file-type`, and other failures to `probe-error`.
- [ ] Update preparation diagnostics so only `permission-denied` requests exact-path read capability; missing or invalid configuration offers repair or a user-selected policy override without guessing another path.
- [ ] Update transaction validation and schema for the richer preflight record.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Define transaction-owned check attempts and receipts

**Files:**

- Create: `src/committing-to-git/checks/checkReceipt.js`
- Modify: `tests/committing-to-git/transaction-workspace.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`
- Modify: `src/committing-to-git/transaction/transactionWorkspace.js`
- Modify: `src/committing-to-git/schema/commitTransaction.schema.json`

**Interfaces:**

```js
validateCheckAttempt(attempt);
summarizeCheckReceipts(checkAttempts);
```

The transaction gains an append-only `checkAttempts` array. Each attempt contains:

```js
{
  receiptId: "C000001",
  retryOf: null,
  label: "Repository verification",
  command: { executable: "npm", arguments: ["run", "verify"] },
  context: {
    kind: "current-worktree",
    repositoryRelativeWorkingDirectory: "."
  },
  subject: {
    manifestSha256,
    headAnchor,
    preparedTreeOid
  },
  launchState: "launching",
  childIdentity: null,
  startedAt,
  completion: null,
  workspace: { before: null, after: null },
  output: null,
  resolution: null
}
```

- [ ] Add failing validation tests for exact keys, deterministic receipt IDs, duplicate IDs, forward retry links, invalid command tokens, unsupported contexts, inconsistent launch/completion states, and subject-anchor mismatch.
- [ ] Add a failing test proving a version-1 transaction is rejected as unsupported after the atomic cutover.
- [ ] Run the focused tests and confirm the new contract is red.
- [ ] Bump transaction schema and allocation to version 2, add `checkAttempts: []`, and make CLI version preflight accept only version 2.
- [ ] Implement exact validation and append-only retry-link rules with comments explaining why a caller cannot supply an outcome separately from a journaled attempt.
- [ ] Update JSON Schema to match runtime validation exactly.
- [ ] Run the focused tests and confirm they pass.

### Task 4: Compare the current selected scope with the prepared tree

**Files:**

- Modify: `tests/committing-to-git/commit-snapshot.test.mjs`
- Modify: `src/committing-to-git/git/gitRepository.js`
- Create: `src/committing-to-git/checks/checkWorkspace.js`

**Interfaces:**

```js
selectedWorktreeMatchesPreparedTree({ root, manifest });
```

It returns `{ matches, pathCount, observedAt }` and uses every unique source and destination path from `manifest.changeUnits` with Git literal-path semantics.

- [ ] Add failing tests for modified, added, deleted, renamed, hostile-looking literal paths, empty change units, and unrelated excluded changes.
- [ ] Run the focused tests and confirm the selected-scope comparison does not yet exist.
- [ ] Add a read-only `git diff --quiet --no-renames --ignore-submodules=none <tree> -- <literal paths...>` operation through the closed Git argument allowlist.
- [ ] Derive path membership only from the validated snapshot manifest; never accept caller-authored comparison paths.
- [ ] Confirm selected changes fail matching while unrelated excluded changes do not.
- [ ] Run the focused tests and confirm they pass.

### Task 5: Run and journal one cross-platform check command

**Files:**

- Create: `tests/committing-to-git/check-workflow.test.mjs`
- Create: `src/committing-to-git/checks/checkOutputCapture.js`
- Create: `src/committing-to-git/workflow/runCheckWorkflow.js`
- Modify: `src/committing-to-git/cli/commitWorkflow.js`

**Interfaces:**

```text
commitWorkflow.mjs workflow check --transaction <transaction.json>
  [--label <neutral-label>]
  [--retry-after-attempt <C000001>]
  [--working-directory <repository-relative-path>]
  [--format <json|text>]
  -- <executable> [argument ...]
```

- [ ] Add failing integration tests for exit zero, nonzero exit, synchronous launch failure, asynchronous launch failure, signal termination, literal metacharacter arguments, Windows command-shim resolution, duplicate/retry rules, and unsupported arbitrary shell strings.
- [ ] Add failing tests for the before/after selected-scope checks, including a command that mutates one selected file.
- [ ] Add failing output tests proving success stays concise, failure exposes at most a 16 KiB head plus 16 KiB tail, byte counts and SHA-256 cover complete streams, and retained artifacts stay within the fixed storage ceiling.
- [ ] Run each focused test and record the expected missing-command or missing-module failure.
- [ ] Implement argument parsing around the `--` terminator, with bounded nonempty strings and no NUL bytes.
- [ ] Append `launching` before process creation, update to `running` with child identity, and durably record terminal completion before returning.
- [ ] Launch through `cross-spawn` without caller-selected shell mode.
- [ ] Compute complete stream hashes and counts while retaining bounded head/tail bytes only. Successful ordinary output contains no raw child output; failed results include only the bounded diagnostic.
- [ ] Derive outcomes as `passed`, `failed`, `launch-error`, `signaled`, or `unknown`; never accept them from CLI input.
- [ ] Record before/after selected-scope facts. If either comparison fails, return `CHECK_SCOPE_DRIFT`, terminalize the transaction as a safe no-commit stop, and require fresh preparation.
- [ ] A completed failed check remains a valid receipt and leaves the transaction active for informed authorization.
- [ ] Run the focused tests and confirm they pass.

### Task 6: Recover interrupted checks without automatic replay

**Files:**

- Modify: `tests/committing-to-git/transaction-recovery.test.mjs`
- Modify: `src/committing-to-git/workflow/recoverTransactionWorkflow.js`
- Modify: `src/committing-to-git/workflow/runCheckWorkflow.js`

**Interfaces:**

- Existing `workflow recover --resolution confirmed-no-live-child` may resolve the newest `launching` or `running` check attempt as `unknown-resolved` without manufacturing a result.
- A replacement `workflow check` requires `--retry-after-attempt <receipt-id>` and accepts only the newest explicitly resolved unknown attempt.

- [ ] Add failing tests for a crash before spawn, a recorded running child, recovery without confirmation, confirmed no-live-child resolution, retry without a link, and a correctly linked retry.
- [ ] Run the focused tests and confirm recovery currently ignores check attempts.
- [ ] Extend recovery with a check-attempt branch while preserving the existing commit and publication recovery precedence.
- [ ] Make `workflow commit` reject unresolved `launching` or `running` check attempts.
- [ ] Ensure recovery never launches or kills the check command.
- [ ] Run the focused tests and confirm they pass.

### Task 7: Consume receipts during commit and reporting

**Files:**

- Modify: `tests/committing-to-git/transaction-recovery.test.mjs`
- Modify: `tests/committing-to-git/commit-report.test.mjs`
- Modify: `tests/committing-to-git/commit-workflow-cli.test.mjs`
- Modify: `tests/committing-to-git/report-artifact-contract.test.mjs`
- Modify: `src/committing-to-git/workflow/createCommitWorkflow.js`
- Modify: `src/committing-to-git/report/commitReport.js`
- Modify: `src/committing-to-git/schema/postCommitReport.schema.json`

**Interfaces:**

```text
workflow commit ... [--acknowledge-failed-check <C000001> ...]
```

- [ ] Add failing tests proving `--checks` is rejected, arbitrary checks JSON is unread, and commit consumes only the transaction's completed matching receipts.
- [ ] Add failing tests for failed-check blocking, exact receipt acknowledgement, stale/unknown acknowledgement rejection, unresolved-check blocking, wording-only message revision reuse, and tree-bound invalidation.
- [ ] Add report tests for one command/one result, exact argv rendering, duration/exit/context display, failed-check authorization, and the empty wording `No helper-witnessed check evidence is attached to this transaction.`
- [ ] Run the focused tests and confirm the caller-authored interface still violates them.
- [ ] Delete `readChecksArtifact()`, `MAXIMUM_CHECKS_INPUT_BYTES`, `checksPath`, and the commit-journal checks capsule.
- [ ] Validate failed acknowledgements against exactly the active failed receipt IDs before commit journaling.
- [ ] Build report check entries only from terminal transaction attempts whose subject matches the transaction anchors.
- [ ] Keep launch errors, unknown attempts, and invalidated attempts visible as workflow attempts but never render them as passed checks.
- [ ] Update report JSON Schema and bounded-size tests.
- [ ] Run the focused tests and confirm they pass.

### Task 8: Add bounded check-detail access and cleanup

**Files:**

- Modify: `tests/committing-to-git/check-workflow.test.mjs`
- Modify: `tests/committing-to-git/transaction-recovery.test.mjs`
- Create: `src/committing-to-git/workflow/checkDetailWorkflow.js`
- Modify: `src/committing-to-git/cli/commitWorkflow.js`
- Modify: `src/committing-to-git/transaction/transactionWorkspace.js`

**Interfaces:**

```text
workflow check-detail --transaction <transaction.json>
  --receipt <C000001> --stream <stdout|stderr>
  --segment <head|tail> [--offset <bytes>] [--format <json|text>]
```

- [ ] Add failing tests for bounded pages, cursor progression, hostile receipt IDs, replaced paths, unavailable compacted logs, and exact transaction containment.
- [ ] Run the focused tests and confirm the route is absent.
- [ ] Implement bounded local detail reads from helper-owned artifacts only; never accept arbitrary paths.
- [ ] Extend compaction so check logs are removed with `process-logs` after successful commit/report unless retention was requested, while receipt facts remain in transaction/report.
- [ ] Confirm a failed or active transaction retains its bounded evidence for diagnosis.
- [ ] Run the focused tests and confirm they pass.

### Task 9: Teach the skill the concise witnessed-check branch

**Files:**

- Modify: `skills/committing-to-git/SKILL.md`
- Create: `skills/committing-to-git/references/check-evidence.md`
- Modify: `skills/committing-to-git/references/signature-recovery.md`
- Modify: `README.md` only if its public workflow summary currently promises caller-authored or absent check reporting.

**Interfaces:**

- `SKILL.md` contains one short pointer: checks appear in the report only when run through `workflow check` after preparation and before exact approval.
- `check-evidence.md` owns command syntax, one-command/one-receipt semantics, context limitations, failure authorization, drift, recovery, and detail access.
- `signature-recovery.md` owns the structured trust-state action table.

- [ ] Use the supplied incident as the failing behavioral case: an agent attempted to synthesize six passes, then claimed no checks ran.
- [ ] Write the positive recipe and focused reference without narrating the historical incident.
- [ ] Keep the main skill below its enforced 1,500-word and 12-KiB budgets by replacing stale material rather than raising those limits.
- [ ] Confirm all canonical skill Markdown remains ASCII-only.
- [ ] Run skill lint/validation and inspect the rendered `--help` text.

### Task 10: Add behavioral evaluation cases and assurance evidence

**Files:**

- Modify after exact configuration approval: `evals/committing-to-git/evals.json`
- Modify: `evals/committing-to-git/README.md`
- Create or modify: the current `docs/assurance-cases/` successor for this cutover.

**Interfaces:**

New evaluation IDs are append-only and cover:

1. Refusal to reconstruct successful checks from conversation prose.
2. One `npm run verify` command reported as one receipt.
3. Protected SSH trust source before commit.
4. Missing SSH trust path distinguished from permission denial.
5. Failed check followed by informed checkpoint authorization.
6. Noisy output consumed through bounded summaries/details.
7. Selected-scope mutation invalidating the transaction.
8. Excluded-file mutation retaining a truthful current-worktree context.

- [ ] Present the exact new IDs, prompts, expectations, assertions, and transmitted files before editing `evals.json` if prior approval is not sufficiently exact.
- [ ] Add deterministic fixture checks before any external model run.
- [ ] Run treatment and baseline arms sequentially on the weakest available model; do not use subagents.
- [ ] Record accuracy, false-claim count, helper calls, displayed bytes, and tokens where the provider reports them.
- [ ] Update the assurance case with improvements and residual limits; do not inherit prior PASS status without fresh evidence.

### Task 11: Rebuild and verify the complete cutover

**Files:**

- Regenerate: `skills/committing-to-git/scripts/commitWorkflow.mjs`
- Review: every changed file in the final Git diff.

- [ ] Run focused committing-to-git tests.
- [ ] Run `npm run build` and confirm the bundle contains the new public routes and no `--checks` reader.
- [ ] Run `npm run verify` once after the final source/test/document state.
- [ ] Run `git diff --check HEAD` and inspect `git diff --stat HEAD` before reading the complete diff in bounded file groups.
- [ ] Confirm `.codex/config.toml` and `.claude/` remain untouched and excluded from any proposed scope.
- [ ] Confirm no external checks JSON, legacy schema reader, alternate trust-store lookup, shell-string launcher, or automatic unknown-check retry remains.
- [ ] Report exact verification evidence, residual evaluation status, and every intentionally uncommitted user-owned path. Do not commit or push without separate authorization.

## Acceptance Criteria

1. Required SSH verification stops before transaction allocation and reports a distinct actionable state for missing configuration, missing path, denied access, invalid file type, or unexpected probe error.
2. Only permission denial requests read access to the exact configured trust source; no path substitution or configuration edit occurs automatically.
3. The no-check happy path gains no helper calls or artifact reads.
4. A check result can enter the commit report only when the helper launched the displayed argv and recorded its process outcome.
5. The public CLI accepts no caller-authored `passed`/`failed` status, external checks path, shell command string, or unsupported execution-context claim.
6. `npm run verify` works through the same argv interface on Windows and POSIX after bundling.
7. Every receipt is bound to the prepared manifest, tree, head anchor, and current selected-scope comparison before and after execution.
8. One command produces one receipt; no stdout parsing invents child checks.
9. Failed checks remain visible and can be committed only after exact informed acknowledgement.
10. Unknown checks are never retried automatically and require explicit no-live-child recovery plus a linked retry.
11. Successful output and reports remain bounded; noisy details are local, bounded, and opt-in.
12. The report says no helper-witnessed evidence is attached when no receipt exists, rather than claiming no checks ran elsewhere.
13. Temporary check logs are retained while active/failed and removed only after successful local commit/report compaction unless retention was requested.
14. Transaction schema version 2 is the only accepted version; no compatibility reader or migration survives.
15. Canonical `SKILL.md` remains ASCII-only and within its existing size budgets.
16. Source, schemas, tests, bundled output, skill instructions, README where applicable, evals, and assurance claims agree on the same behavior.
17. `npm run verify` passes, and fresh behavioral evidence records any evals that cannot run locally rather than overstating them.

## Residual Limits

- A local receipt proves what this helper observed under the current user account; it is not a remotely signed attestation and cannot defeat a malicious peer process with equivalent filesystem access.
- Exit zero establishes that the exact displayed command succeeded. It does not prove that a package script contained every intended subcheck or that a test framework did not internally skip work.
- Current-worktree checks may observe excluded workspace changes. The receipt identifies that context and selected-scope stability but does not claim an exact isolated commit environment.
- A process can outlive a crashed helper. The workflow deliberately blocks rather than guessing and needs explicit confirmation before a linked retry.
- SSH trusted-identity verification still requires Git's configured allowed-signers source. Cryptographic integrity without that source is not reported as trusted identity verification.
