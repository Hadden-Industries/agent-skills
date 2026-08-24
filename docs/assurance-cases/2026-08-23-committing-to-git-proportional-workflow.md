# Assurance Case: Proportional `committing-to-git` Workflow

Date: 2026-08-24

Status: DETERMINISTIC PASS; MODEL AND HUMAN RELEASE GATES PENDING

Release disposition: HOLD

## 1. Claim and disposition

The proportional `committing-to-git` candidate has fresh deterministic evidence that its high-level transaction interface preserves the intended tree, message, signature, recovery, reporting, and publication safety boundaries while removing ordinary-path artifact ceremony. The candidate is not yet entitled to an unconditional release PASS because no matched post-cutover model matrix and no human installer review have been completed.

The previous assurance case's `Status: PASS` is historical evidence for the pre-cutover design. It is not inherited by this successor. This document gives the successor a HOLD until the two judgment-dependent gates produce real evidence.

| Evidence layer | Fresh successor result | Disposition |
| --- | --- | --- |
| Deterministic implementation and repository gates | Complete; all required local gates passed | PASS |
| Evaluation configuration, fixture generation, and cost contracts | Complete; all active entries and all registered scenarios validated | PASS |
| Matched no-skill/old-skill/new-skill model arms | Not executed | PENDING |
| Human installer readability review | Not executed by a human reviewer | PENDING |

This bounded claim covers drafting, exact-scope preparation, exact-message approval, creation of a new signed ordinary or root commit, exact commit comparison and reporting, bounded recovery, and optional exact-OID non-force publication. It does not cover amending history or completing merge, rebase, cherry-pick, or revert operations.

## 2. Mechanisms that changed

The successor preserves the prior safety goals but changes how an agent reaches them.

| Pre-cutover mechanism | Proportional successor |
| --- | --- |
| Agent-managed attempt allocation and many artifact paths | One helper-owned UUIDv4 transaction and one opaque transaction path |
| Separate low-level snapshot, inspection, message, signature, report, and publication routes | High-level `workflow` phases plus `message check` and `message finalize` |
| Whole-ledger acknowledgement loop | Immutable bounded packets plus one final hash-bound receipt; no per-packet acknowledgement command |
| Always-visible scaffold/render/validate mechanics | Direct subject construction by default; one fixed checked input for multiline or nonportable concise text; structured finalization only on extended |
| File-count-oriented ordinary ceremony | Concise versus extended selection based on evidence sufficiency and semantic uncertainty |
| Rebuilding preparation arguments after interruption | Persisted-input `workflow resume` on the same transaction |
| Re-reviewing a draft before authorized use | Exact unchanged-draft `workflow promote` transition |
| Standalone signature verification and report construction | One journaled `workflow commit` creates, compares, verifies, and reports the exact commit |
| Publication output artifact and retry recipe | Existing-report `workflow publish`, observation-only recovery, explicit no-live-child resolution, and a fresh linked retry only after new authorization |
| Implementation-internal references | Five exception-focused references: inspection, transaction, signature, publication, and message format |
| Git 2.25 runtime floor | Git 2.45+ floor, preflighted before allocation so no-hidden-lazy-fetch is enforceable |

All removed public routes return `UNKNOWN_COMMAND` before Git or output-file effects. Every route that accepts a transaction rejects any old schema version with `UNSUPPORTED_ATTEMPT_VERSION`; there is no compatibility reader, alias, migration switch, or in-place upgrade.

## 3. Fresh deterministic evidence

### 3.1 Verification record

`npm run verify` ran on 2026-08-24 after the Task 11 configuration, fixture, test, and documentation changes.

| Gate | Result |
| --- | --- |
| Prettier check | Passed |
| ESLint with zero warnings | Passed |
| Generated bundle drift check | Passed |
| Canonical `SKILL.md` ASCII gate | Passed |
| Full repository tests | 390 tests; 389 passed; 1 conditional environment skip; 0 failed |
| Canonical skill validation | Passed; 3 canonical skills validated |
| Repository skill lint | Passed |
| Git whitespace/diff check | Passed |

The conditional skip is an environment branch in an unrelated EPUB checker test; it is not a skipped `committing-to-git` safety or cost case.

The canonical successor skill is 116 lines, 1,498 whitespace-delimited words, and 11,330 bytes. Instruction regressions enforce the 1,500-word and 12-KiB ceilings, the complete ordinary route and hint-as-hypothesis rule near the beginning, the five focused references, and all critical proportional decisions.

### 3.2 Active evaluation inventory

The post-cutover evaluator configuration contains:

- 61 active cases;
- 55 executable cases and 6 policy-only cases;
- 50 cases marked critical safety;
- 83 registered disposable repository scenarios; and
- 23 named cost profiles.

IDs 20, 22, 25, 26, and 27 are absent and remain retired. Surviving IDs keep their original intent, and new identities occupy 35-66. Tests reject unknown entry fields, duplicate IDs or case keys, missing fixtures or profiles, a policy case with a fixture, and any expectation that invokes a removed route.

Every registered fixture was generated independently during the passing suite. Representative Git-state assertions independently verified:

- the known-context `skills-lock.json` selection and two unrelated exclusions;
- staged rename identity without restaging its vanished source;
- literal handling for `-literal[1].txt` beside `-literal1.txt`;
- detailed/bulk boundaries at 49 and 50;
- concise 12- and 240-file grounded scopes;
- one-file unknown security extended versus grounded security concise;
- 1,000 small binary changes without per-file metadata artifacts;
- 1,000 semantic bulk units without authored unit-ID arrays;
- exact 10-MiB generated and 2-MiB single-line content;
- attached, detached, and zero-parent unborn head shapes;
- an old transaction's exact schema-version-0 bytes;
- a real local bare publication remote; and
- all remaining registered scenario builders, including missing objects, configured external drivers, revisions, permission recovery, locks, hooks, cleanup, report detail, nested repositories, and publication recovery.

### 3.3 Claim-to-test traceability

| Claim | Fresh deterministic support |
| --- | --- |
| Exact scope is fixed without fuzzy hint interpretation | Literal selector, unmatched selector, staged-state, partial-hunk, rename-boundary, and scope-preparation tests |
| Drafts do not mutate real repository state | Staged/full/paths isolation tests plus object/index/ref/log assertions |
| Actual full/paths staging installs one journaled exact index | Index identity, pending-journal interruption, resume, split-index, and sparse-index tests |
| Concise eligibility is evidence-based, not file-count-based | Reuse tests at 1, 12, and 1,000 units plus one-file unknown review and over-budget/invalid-encoding route tests |
| Bounded inline evidence is complete or the route becomes extended | Exact serialized boundary, invalid UTF-8, missing object, and scope-synopsis tests |
| Mixed evidence covers every unit once without whole-scope escalation | Selector normalization, non-overlap, complete partition, packet delta, and receipt tests |
| Structured domains and detailed inventory remain deterministic | 9/10/49/50 and four-digit ordinal tests, raw-byte ordering, derived counts, rename-as-one, and 32-KiB selection tests |
| Direct and checked message bytes are exact | Conservative transport predicate, all excluded characters, strict UTF-8/control checks, subject-plus-LF, fixed input ownership, and raw message comparison tests |
| Revision invalidation is proportional and constant-space | Wording/new-claim/tree cases plus 100 successful checked/finalized replacements and interruption recovery |
| One commit transition cannot be replayed blindly | Launch journal, unknown outcome, recovery adoption, no-repeat interruption points, and bounded public JSON tests |
| Commit identity includes complete head, tree, parents, raw message, and signature header | Attached/detached/unborn signed commit tests, SHA-256 OIDs, hook mutation, unsigned-commit block, and comparison tests |
| Trust claims do not exceed backend evidence | SSH/OpenPGP identity parsing, unreadable trust source, advisory override, backend/OID history binding, and retry tests |
| Reports remain bounded and queryable after cleanup | Count/byte compaction, hostile paths, fresh detail query, final-page/cursorless replay, explicit refresh, and lock conflict tests |
| Publication is exact, non-force, report-reusing, and no-repeat | Local bare remote, one JSON result, rejection/transport uncertainty, observation provenance, live-child refusal, and linked retry tests |
| Cleanup is exact and never follows or discovers another attempt | Terminal compaction, path containment, replacement-link refusal, active-lock refusal, and pending/unknown purge tests |
| Public cutover is atomic | Help/public surface tests, removed-route no-effect tests, old-version rejection tests, source/bundle parity, and no old schema reader |

## 4. Deterministic cost evidence

The frozen pre-cutover known-context characterization is pinned to commit `76baa9b25e0afeaa2c62c4cf7042976444edc15e`. It records nine helper calls, 42 helper-internal Git processes, 4,428 stdout bytes, ten agent-managed artifact reads, three artifact writes, and one approval turn.

The successor contract for the same coherent transport-safe case is:

- one `workflow prepare` call;
- one exact-message approval turn;
- one `workflow commit` call;
- one opaque transaction-handle pass-through; and
- zero agent-managed workflow artifact reads or writes.

That is a deterministic helper-call reduction from 9 to 2, or 77.8%, and a 100% reduction in agent-managed workflow artifact reads and writes. The one required approval turn is preserved. Permanent executable tests establish the same two-call route for coherent 1-, 12-, and 1,000-unit scopes, so the cost does not grow merely with file count.

The checked concise profile adds exactly one preapproval `message check` call and one transient write to fixed transaction-local `message-input.txt`; it creates no semantic worksheet, packet receipt, arbitrary path, or second UUID. Extended profiles permit only sequential bounded packet reads and materialize only newly required evidence deltas.

These are action-count and deterministic state measurements. They do not establish model token, model-time, or wall-clock improvements. In particular:

- no fresh input/output/total token distribution exists;
- the required median 50% treatment-token reduction versus the old-skill arm is unmeasured;
- the known-context 80%-versus-old-skill and at-most-2x-no-skill token gates are unmeasured;
- model elapsed-time variance is unmeasured; and
- the old fixture's 42 internal Git processes has not been used as a claim about a matched model run.

Those missing facts are release-gate evidence, not values to infer from skill length or deterministic helper calls.

## 5. Model evaluation status

No post-cutover model arm was executed for this assurance case. Therefore:

- there is no weakest-production-model five-repetition matrix;
- there is no stronger-model calibration;
- there is no randomized arm order or recorded seed;
- there are no new no-skill, exact-old-commit, or treatment outputs;
- there are no post-cutover token, tool-call, timing, route, approval, permission, or final-Git-state distributions; and
- no versioned result JSON was added under `evals/committing-to-git/results/`.

The existing `2026-08-22-*.json` files are genuine historical runs for the prior design. They remain useful for provenance and prompt-family history but cannot establish successor safety, quality, efficiency, or trigger performance.

The matched matrix was not attempted because this session had neither an in-repository sequential model runner nor the plan-required provider/model/content-specific authorization for transmitting newly authored post-cutover skill, reference, bundle, prompt, and fixture content. General implementation and configuration approval is intentionally not treated as external-content authorization.

Before this gate can pass, an authorized primary-agent run must execute one arm/repetition at a time with fresh fixtures, pin the old-skill arm to `76baa9b25e0afeaa2c62c4cf7042976444edc15e`, record exact model versions and telemetry, blind grading labels, retain failures, and cover at least the repeated families listed in the evaluator README.

## 6. Human readability status

No human installer review was conducted. A language model checking its own instructions is not a substitute.

Deterministic structure evidence is favorable: the ordinary prepare/approve/commit path and hint correction rule appear at the start; one mode/scope table, one evidence table, one revision table, and one exit table organize the main file; and exceptional mechanics route to five one-level references. Tests assert the size and required decisions. This supports reviewability but does not prove that a fresh human can answer the installer questionnaire consistently.

The human gate remains pending until a reviewer receives only the deployable skill directory and records answers about scope, evidence lineage, transport, revisions, authorization, recovery, signatures, reporting, publication, and Git 2.45. Any inconsistent answer is a documentation defect and must be resolved before changing this document to PASS.

## 7. Prior claims retained and narrowed

The following prior assurance goals remain supported, with terminology updated for the successor:

- drafting is distinct from staging, committing, and pushing;
- exact scope, head anchor, tree, message bytes, parent array, signature header, verification policy, and publication target are separately bound;
- hostile paths, renames, additions, binary changes, modes, symlinks, and gitlinks retain exact mechanical identities;
- current task evidence may be reused only with specific lineage, while unknown content requires bounded review;
- exact message approval survives neither changed bytes nor a changed tree without the appropriate new gate;
- signing, cryptographic validity, and trusted identity remain separate claims;
- hooks and external processes can create known mismatches or unknown outcomes that are preserved rather than automatically repaired;
- publication remains an explicit exact-OID, full-ref, non-force operation with separate authorization; and
- missing historical transaction evidence cannot be reconstructed from current workspace state.

Several earlier formulations are deliberately not retained:

- acknowledgement is no longer presented as proof that an agent read evidence;
- a mandatory body or `File Changes:` section is no longer part of every valid message;
- file count no longer determines concise eligibility;
- similar content never creates copy provenance;
- a failed reversible phase does not automatically require a fresh attempt when its durable state proves safe resume; and
- a recovery-time matching remote observation is not called a witnessed successful push.

## 8. Residual judgment and systems limits

These limits remain explicit even after deterministic PASS:

- No artifact protocol can prove that a model mentally read or understood content.
- Selective message evidence is not a code-review claim.
- Agent judgment still decides whether task context truly explains a change, whether a semantic domain is coherent, whether revised wording changes a claim, and which type best describes the dominant outcome.
- Deterministic validation cannot prove that a type, scope, description, rationale, UX statement, or domain title is semantically wise.
- Structured bulk selectors prove membership and counts, not semantic quality.
- Invalid-UTF-8 evidence can be hash-bound and displayed losslessly but may require a domain-specific tool or user explanation for meaning.
- Superseded checked-message bodies are intentionally not retained as an archive; reconstructing old wording creates a new revision.
- Temporary object databases consume disk and cannot eliminate every Git implementation side effect.
- Disabling lazy fetch may stop on missing promisor evidence until a separately authorized fetch occurs.
- Git 2.45+ is an intentional compatibility cost of enforcing the no-hidden-lazy-fetch boundary.
- Git rename similarity is heuristic even under bounded candidate work.
- Hooks and external processes prevent a Git command and arbitrary surrounding behavior from becoming one atomic system transaction.
- A crash after launch intent can remain unknown while the ref is unchanged; clearing it may require actual process termination or host restart plus explicit user confirmation.
- Complete retained failure logs may contain sensitive hook, Git, signing, or credential-helper text; bounded presentation does not redact the stored evidence.
- No global attempt discovery means an unreachable active UUID directory may remain until exact-handle cleanup or normal operating-system temporary cleanup.
- SSH trusted identity still depends on access to the configured trust source.
- A remote can move after observation; journals preserve provenance but cannot create server-side transaction history.
- A compact report's later detail query is a fresh timestamped observation and may differ from report-time workspace state.
- Persisted-input resume helps only when durable evidence proves a reversible continuation; it cannot make an ambiguous index, commit, or publication safe to replay.
- Cost budgets are product requirements tied to current runners and must be recalibrated with published evidence rather than silently weakened.

## 9. Release gates and next evidence

| Gate | Required result | Current result |
| --- | --- | --- |
| Deterministic safety and repository verification | No failure | PASS |
| Public surface and old-version cutover | No executable old route or reader | PASS |
| Fixture/config/cost harness | Exact schema, all builders executable, strict references | PASS |
| Critical-safety model cases | No regression in weakest-model matched matrix | NOT RUN |
| Model route and semantic quality | Correct hint/type/scope/outcome and useful rationale/UX | NOT RUN |
| Model efficiency | Required median tool/token reductions and known-context limits | NOT RUN |
| Stronger-model calibration | One matched calibration arm | NOT RUN |
| Human installer review | Consistent answers from deployable content alone | NOT RUN |

The candidate must remain on HOLD until the pending model and human evidence is collected or the release authority explicitly changes the acceptance policy. Any later PASS must cite versioned real result artifacts, model variance, the human review record, and any defects found and corrected.

No implementation commit was pushed during this work. The complete local stack should be published, if separately authorized, through one final remote ref update. A post-publication rollback must be a coherent forward restoration commit rather than a force rewrite or mixed old/new deployment.
