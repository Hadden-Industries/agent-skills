# Proportional `committing-to-git` Workflow Implementation Plan

> **For agentic workers:** Execute this plan sequentially in one primary-agent session. Do not delegate to subagents, run task steps or evaluation arms concurrently, or begin a later task before the current task's tests, review, verification, and commit boundary are complete. Invoke one shell command, model run, or review action at a time. Use `test-driven-development` for every behavior change and `verification-before-completion` before each task commit. Use the repository's `committing-to-git` skill for each commit; do not substitute ad hoc `git commit -m` commands.

**Goal:** Preserve exact-scope, exact-message, signing, recovery, and publication safety while making the agent's work proportional to the information needed for a useful commit transaction.

**Architecture:** Replace the agent-operated collection of low-level commands and mutable acknowledgement ledgers with a small transaction coordinator over the existing Git domain modules. A concise guided route will stage an exact coherent scope, return sufficient evidence inline, and let the agent improve the user's strong but non-binding semantic hint; portable subject-only text passes directly at commit, while multiline or shell-unsafe text receives one exact preapproval check. Unresolved semantic uncertainty, an explicit full-review request, or required evidence/semantic structure that cannot fit the bounded inline contract activates immutable review packets, a hash-bound receipt, and the extended worksheet/finalizer route; file count or a hard-coded sensitive-path label alone never selects the expensive path.

**Tech Stack:** Node.js 24+ ECMAScript modules, Git 2.45+ plumbing and porcelain commands, JSON Schema Draft 2020-12, Node's built-in test runner, esbuild, ESLint, and Prettier. Git 2.45 is the minimum because that release introduced the `--no-lazy-fetch`/`GIT_NO_LAZY_FETCH` contract this plan relies on to make read-only partial-clone inspection network-free; silently accepting an older Git would make that safety claim false. Use Node built-ins only; the runtime design requires no new dependency or runtime configuration. Task 11 separately migrates the existing maintainer evaluation configuration after exact approval.

**Spec:** This plan is an efficiency amendment to `docs/implementation-plans/2026-08-21-committing-to-git-workflow-redesign.md` and `docs/assurance-cases/2026-08-22-committing-to-git-skill.md`. Where this plan explicitly changes inspection, transaction, message-authoring, reporting, or recovery behavior, it supersedes the earlier plan. All safety invariants listed below remain mandatory.

## Global Constraints

- Preserve explicit commit authorization, exact rendered-message approval, and separate push authorization.
- Execute Tasks 1 through 11 strictly in order with no subagents, concurrent task steps, parallel shell actions, or parallel model/evaluation runs. A task begins only after the preceding task reaches its verified local commit boundary.
- Add detailed comments where transaction invariants, crash recovery, cross-platform filesystem behavior, Git plumbing choices, security boundaries, or non-obvious cost constraints would otherwise be unclear. Comments explain why the logic exists and which invariant it protects; self-evident syntax and straightforward control flow remain uncommented.
- Preserve the user's selected commit scope; scale is never a reason to shrink or split it.
- Preserve unrelated staged, unstaged, untracked, conflicted, ignored, and submodule state.
- Every actual commit must still use `git commit -S`; a verification override never permits an unsigned retry.
- Bind approval to repository root, complete attached/detached/unborn head anchor, exact index tree, rendered message bytes, and clear operation state immediately before commit creation.
- Compare the created commit's parent shape, tree, and message with the approved transaction before any push.
- Target publication by full commit object ID and full `refs/heads/...` destination without force.
- Do not claim that an agent read content merely because it supplied an artifact ID or hash. Mechanical checks may establish artifact identity and coverage, not cognition.
- Do not claim that similarity proves copy or rename provenance. Exact tree facts remain authoritative.
- Do not edit `.agents/skills/` or other installed mirrors. Change canonical source under `skills/` and `src/`, then rebuild the published bundle.
- Keep every canonical `skills/**/SKILL.md` ASCII-only and run `npm run verify` before completion.
- Treat each task commit as a completion boundary: after its focused tests and before drafting/staging that commit, run `npm run verify` once. Do not rerun it without intervening source/test changes merely to satisfy ceremony.
- For every task that changes `src/committing-to-git/`, run `npm run build` after focused tests and include the regenerated `skills/committing-to-git/scripts/commitWorkflow.mjs` in that same task commit before `npm run verify`. Local intermediate commits may temporarily retain old routes as implementation scaffolding, but source/bundle drift is never committed and no intermediate commit is pushed to public `main`.
- Do not add or change repository configuration without exact approval for the named file, fields, and behavioral effect. If implementation demonstrates that an unplanned configuration change is indispensable, stop and request that approval before editing it.
- The only anticipated configuration change is `evals/committing-to-git/evals.json` in Task 11. Before editing it, present the exact retained, rewritten, retired, and new case definitions plus metric fields and obtain explicit approval for that file change; approval of this plan alone is not configuration approval.
- Treat Git 2.45+ as one atomic runtime requirement after cutover. Capability-check the no-lazy-fetch contract before attempt allocation and return a pre-mutation `UNSUPPORTED_GIT_VERSION` result on older/vendor builds that do not support it; do not keep a weaker compatibility branch that can perform an implicit fetch.

## Pre-Execution Documentation Boundary

This reviewed plan is part of the implementation record, but it is not itself an implementation task. Before Task 1 begins, inspect the exact plan-only diff and use the repository's `committing-to-git` workflow to propose a documentation-only commit containing this file. Create that commit only after explicit authorization. Do not fold an untracked plan opportunistically into Task 1's test baseline, and do not stage `.claude/` or any other unrelated workspace state with it.

---

## Plan Status and Decision Boundary

All seven requested grilling rounds and the final logic-consistency review were accepted by the user on 2026-08-23. The decisions below are settled constraints, not implementation suggestions. The design frontier is closed, but implementation still requires a later explicit instruction; approval to amend or commit this plan is not authorization to execute Task 1.

The accepted Round 1 decisions are:

1. Unknown/pre-existing text defaults to complete patch coverage, with a provenance-based exception for grounded generated/derived content; current-task work may use proportional `reuse` or `message` evidence.
2. At 50+ change units, the agent reads a bounded scope synopsis rather than an exhaustive path recital; the exact machine manifest remains complete and queryable.
3. Bulk synopsis presentation is provisionally bounded at 24 groups, three samples per group/category, and two 16 KiB packets, subject to benchmarked adjustment rather than silent relaxation.
4. Literal exact-path/path-prefix inclusions and exclusions replace mechanically authored large path lists; no glob language or implicit pathspec magic is introduced.
5. Actual explicit-path scope fails early when any change is already staged, including a selected path with partial staged state; the workflow never automatically stashes, unstages, rewrites, or reconstructs user index state. An intentionally prepared index is committed through `staged` scope instead.
6. Eager line-stat input is provisionally capped at 64 MiB; larger statistics may remain explicitly deferred unless later selected evidence computes them.
7. Exact rename pairing is unique-object-and-mode only, and heuristic similarity is provisionally capped at 40,000 candidate pairs.
8. A shared rationale may cover multiple detailed numbered paths; nested file notes are reserved for distinct file-specific consequences.
9. One journaled helper command performs the entire approved post-message commit, verification, comparison, report, and safe-compaction transition.
10. Successful transactions retain a compact recovery capsule and remove bulky helper-owned evidence by default, with explicit retention and idempotent cleanup recovery.
11. An exact-match draft may be promoted without repeated review or byte-identical message approval; commit authorization remains mandatory.
12. Conventional Commit types use a lowercase token grammar rather than a hard-coded allowlist; the helper does not execute or guess arbitrary repository lint configuration.
13. The final cutover retains no low-level compatibility routes or old schema readers; the deployable main skill targets 1,500 words/12 KiB and no happy-path reference load.
14. Safety remains absolute and the new workflow must also reduce median treatment tool calls and reported tokens by at least 50% against the old-skill baseline.

Round 2 was accepted on 2026-08-23 with one explicit override: the user rejected every post-cutover compatibility gate. This is an intentional atomic replacement, not a gradual migration: confidence comes from the deterministic, model, and human gates in this plan, while Git history remains the recovery source. The resulting decisions are:

1. Mixed-provenance transactions partition the exact manifest into selector-based `reuse`, `message`, and `review` evidence groups; an explicit full-review request overrides all groups.
2. `reuse` follows specific task-lineage evidence through sufficiently detailed system compaction summaries, plans, test records, or handoffs; vague lineage escalates rather than relying on model identity.
3. Every unmatched include or exclude selector is a pre-mutation error; diagnostics may suggest bounded nearby paths but never autocorrect.
4. A path-scoped draft may coexist with disjoint staged work, but overlap is rejected and promotion remains blocked until actual-path preconditions hold.
5. Detailed shared-rationale groups may overlap; Round 4's adaptive-depth decision removes any requirement to invent a rationale for every unit. When a file/domain inventory is rendered, counted bulk domains remain an exact partition.
6. High-level exit classes distinguish terminal success, safe pre-mutation stop, artifact/usage failure, a definitely created but blocked commit, and unknown mutation outcome.
7. Routine post-commit workspace reporting is scope-aware and explicitly discloses compact untracked directories and uninspected nested submodule worktrees.
8. No compatibility or deprecation window survives the cutover. Old temporary attempts are unsupported, and Git history is the recovery source.
9. Breaking markers and structured trailers remain outside this proportionality plan because repository history supplies no current requirement. The skill evaluates already-loaded mandatory message policy before actual preparation and stops before staging when that policy cannot be represented; later helper validation is defense in depth rather than the pre-staging gate.
10. Every high-level command emits one bounded JSON document on stdout, with exact human display text as data; diagnostics and streamed child output use stderr, and `--format text` is an optional human view over the same persisted result.

Round 3 was accepted in full on 2026-08-23. The resulting decisions are:

1. `message finalize` is a convergent transition: a refined evidence plan either carries forward already covered packet hashes or materializes only the missing delta, returns `evidence-required` with exit `1`, and finalizes after that delta is read and receipted.
2. Implementation remains a stack of focused local commits, but none is pushed before the exact final cutover state passes deterministic, model, and human evaluation; one remote ref update publishes the complete stack atomically to users.
3. Post-publication rollback is a reviewed forward commit that restores the complete prior deployable skill/source/bundle/contracts as one unit, retains superseded historical evidence, and never force-rewrites or leaves a hybrid interface.
4. When a message includes a file/domain presentation, bulk form begins at 50 change units or whenever canonical detailed output would exceed 32 KiB. The helper may request shorter prose or broader truthful domains but must never propose reducing the selected commit scope.
5. Potentially noisy commit/push child output is streamed into a complete hashed attempt-local log while stderr displays at most the first and final 16 KiB around one suppression notice. Failure/recovery retains the log; successful compaction removes it unless retention was requested.
6. Any terminal transaction with `recoveryRequired: false` compacts bulky helper-owned artifacts even when no commit was created. Optional exact-transaction purge verifies containment and state, while the helper never scans the temporary root or recreates ownership/handover machinery.

Round 4 was accepted in full on 2026-08-23 after rejecting the proposed one-change-unit fast path. The resulting decisions are:

1. Concise-flow eligibility depends on semantic coherence, provenance, and unresolved uncertainty, never on file count. A known generated migration spanning many files may qualify; one unfamiliar file may require extended review.
2. The user's wording is a strong semantic hint, not exact canonical text. The agent uses it as a hypothesis, inspects enough evidence to verify or refine it, and chooses the applicable type, scope, outcome-focused subject, rationale, and user-experience assessment.
3. A known-context concise transaction uses one `workflow prepare` command, one exact-message approval round trip, and one `workflow commit` command. It has no packet reads, acknowledgements, worksheet, separate render/finalize/validate command, or report reread.
4. A bounded-inspection concise transaction receives the required synopsis and patch evidence inline from preparation. It requests only named missing evidence; a separate acknowledgement action is never evidence of reading.
5. Message depth is adaptive. A subject-only message is valid when it completely communicates the useful intent; rationale, user-experience, detailed files, or counted domains appear only when they add information a future reader cannot obtain mechanically from the diff.
6. The concise route passes a transport-safe approved subject directly to `workflow commit`; every other concise message is checked and recorded exactly once before approval. The extended worksheet/finalizer route remains available only when evidence or semantic structure genuinely exceeds the concise route's bounded evidence contract.
7. The evaluation matrix must include coherent functional units across multiple file counts, misleading or incomplete hints, and one-file changes that correctly escalate. Proportionality is graded against semantic uncertainty rather than a one-file proxy.

Round 5 was accepted in full on 2026-08-23. The resulting decisions are:

1. When current-task lineage identifies exactly one coherent scope, the agent may transactionally stage it without a separate preliminary scope-approval turn and present it during exact commit approval. Multiple materially plausible scopes require clarification before staging; the semantic hint is never a fuzzy path selector.
2. A user hint alone establishes direction but not file contents. It selects bounded `message` inspection by default; `reuse` additionally requires specific current-task authorship, prior reading, generator output, or another surviving evidence lineage.
3. Transport-safe subject-only concise messages retain the two-helper-call path and are validated fail-closed inside `workflow commit`. Multiline messages and valid subjects outside the conservative direct-transport set use one lightweight preapproval `message check` that validates, records, and returns the exact bytes without introducing a worksheet, renderer, or review receipt.
4. Commit classification uses already-loaded repository policy first and a concise semantic Conventional Commit guide second. The workflow never performs a routine history scan merely to choose `feat`, `fix`, `build`, or `chore`; history is inspected only when a material repository-specific convention remains unresolved.

Round 6 was accepted in full on 2026-08-23. The resulting decisions are:

1. Direct `--message` transport is limited to a conservative portable ASCII subject character set. Unicode, shell-active punctuation, or other nonportable text uses the exact-file `message check` route even when subject-only; the skill decides before shell interpolation and the helper repeats the restriction as defense in depth.
2. When several types are defensible, the agent chooses the most specific type for the dominant outcome without routinely asking or listing alternatives. It asks/discloses only when the alternatives imply materially different release or user semantics.
3. No filename, directory, or domain label automatically forces extended review. Current-task sensitive work may remain concise when grounded; explicit review requests and unresolved semantic/special-Git uncertainty still escalate.
4. Wording-only message revisions reuse evidence; new semantic claims reuse the tree but request only missing evidence; any scope/tree change creates a fresh preparation and approval anchor.

Round 7 was accepted in full on 2026-08-23, with the user's Q4 correction replacing the initial eager draft-compaction recommendation. The resulting decisions are:

1. `message check` accepts every structurally valid canonical message file, including a transport-safe one-line subject. The skill defaults such subjects to direct transport for proportionality, but the helper does not reject valid checked input merely because a cheaper route exists.
2. Checked-message input uses the fixed `message-input.txt` path inside the existing UUIDv4 transaction directory. No second temporary directory, UUID, arbitrary external path, or ownership handover is introduced; successful checking records the canonical bytes before removing the transient input, while failure leaves it for correction.
3. The helper enforces exact tree, message-byte, validation, and explicit evidence-plan facts. The skill classifies whether prose is wording-only or a new semantic claim; deterministic code does not guess meaning with keyword or similarity heuristics.
4. A conversationally ready draft remains active and retains reusable transaction artifacts. `draft-ready` is a skill-level predicate over a draft transaction in persisted `evidence-ready` or `message-ready`, not a separate journal phase the helper could infer from a conversational presentation. Automatic compaction waits for a known fully recorded local commit or another explicit safe terminal disposition; pushing is not required, and an independently performed manual commit may leave an explicit-cleanup/operating-system-cleanup orphan.
5. A precommit transaction retains only its latest valid canonical message, validation, hash, and monotonic revision number whether the message came from concise checking or extended finalization. Failed candidates preserve that current revision; successful candidates replace it atomically rather than accumulating historical message bodies.

The accepted architecture has thirty-three intentionally visible product decisions:

1. A commit-message workflow always proves exact scope through an exhaustive machine manifest, but at 50+ units its mandatory human view is a bounded synopsis rather than an exhaustive path recital.
2. Complete patch reading remains mandatory for unknown or pre-existing text changes, explicit review requests, partial-hunk ambiguity, and other high-uncertainty cases; known current-task changes may reuse current-context evidence and inspect only unexplained units.
3. Per-file reasons become optional when one shared rationale truthfully covers those files; when a file inventory adds value, numbered detailed paths remain visible through 49 change units only while the canonical/result byte budgets fit.
4. Literal include/prefix selectors plus exclusions may express a coherent path scope; the helper expands and proves the exact result, while crossing rename boundaries fail closed.
5. The helper, rather than the agent, performs the post-approval snapshot check, signed commit, exact-OID capture, signature verification, and report generation as one journaled transition.
6. Verification defaults to `required`, but an explicit user override at any point is recorded and obeyed without argument; signing remains mandatory.
7. Optional presentation work is bounded provisionally at 40,000 rename candidate pairs, 64 MiB of eager line-stat input, and a two-packet bulk synopsis with 24 groups/three samples per group.
8. Every draft scope receives an exact attempt-local tree identity and can be promoted only after exact head-anchor/tree/scope equality.
9. Successful transactions retain a compact recovery capsule but discard bulky review packets and temporary object/index data unless retention was explicitly requested.
10. The final cutover removes low-level CLI routes, old schema readers, and dead adapters in the same reviewed change; no deployed dual workflow remains.
11. Mixed evidence refinement is convergent: only newly required packets are materialized and read, while unchanged hash-bound coverage survives catalog revisions.
12. An included file/domain presentation is bounded by both semantic scale and bytes: 50 units or a projected detailed message above 32 KiB selects counted bulk domains without changing scope; the concise route may omit that entire mechanical section when it adds no durable information.
13. Child-process diagnostics and known-safe terminal artifacts are bounded automatically, with complete failure logs and a compact recovery capsule retained only where useful.
14. Reviewable local history and atomic public availability coexist: the complete evaluated commit stack becomes public in one ref update, and any architectural rollback moves history forward as one coherent restoration.
15. The concise guided route uses the user's hint as evidence to improve rather than transcribe, and reaches approval without review artifacts whenever current-task knowledge or one bounded inline inspection supports a coherent exact scope and message.
16. Unambiguous current-task scope may be staged and shown in the normal approval proposal; ambiguous competing scopes stop before staging, and no semantic hint is ever interpreted as a Git path pattern.
17. User-grounded direction alone selects bounded `message` evidence. Zero-patch `reuse` is reserved for a specific authored, read, generated, or surviving task-lineage basis.
18. Transport-safe subject-only concise messages use prepare/approve/commit; multiline or nonportable concise messages add exactly one preapproval exact-text check, not the extended semantic workflow.
19. Type/scope selection follows explicit loaded repository policy and a compact semantic decision guide without a mandatory recent-history scan.
20. Portable subject-only text may use direct argv transport; every other message is recorded through the exact-file check before approval, preventing shell interpretation from becoming part of message semantics.
21. Type ties resolve to the most specific dominant outcome unless the alternatives carry materially different release/user meaning.
22. Evidence uncertainty, not a hard-coded sensitive-path list, selects extended review; special Git facts remain mandatory evidence.
23. Message revision cost follows what changed: prose, semantic claims, and tree scope have progressively stronger but narrowly bounded invalidation rules.
24. File-based checking remains a permissive exact-message facility; the skill and eval gates choose the cheaper direct route by default instead of making the helper reject otherwise valid input.
25. Checked-message input is one deterministic transaction-local file with helper-owned cleanup, eliminating external-path ownership and shared-temp collision questions.
26. Semantic revision classification remains an agent judgment tested behaviorally; deterministic transitions enforce the declared consequences without pretending to understand prose.
27. An active draft retains reusable evidence until a local commit or explicit safe terminal state, after which compaction is independent of publication.
28. Precommit canonical-message storage is constant-space across concise-check and extended-finalizer revisions: one current valid body/validation/hash plus a monotonic counter, never an unbounded message archive.
29. Git 2.45+ is the atomic runtime floor because no-hidden-lazy-fetch behavior is a safety contract; an unsupported runtime stops before transaction allocation instead of taking a weaker compatibility path.
30. Draft preparation defers signer-trust preflight, but promotion completes it before any real-object/index mutation so a draft cannot bypass the first-attempt capability policy.
31. Verification policy controls identity verification, not signed creation: every created commit must contain the signed-commit header before the workflow calls it signed or permits publication, including under `skipped` policy.
32. On-demand report detail removes O(F) page state only after durably retaining one bounded replayable final response, closing the cleanup-before-output crash boundary without keeping a historical inventory.
33. Publication distinguishes a witnessed successful push from a recovery-time matching observation; an unknown attempt is never retried automatically and receives a fresh linked attempt only after explicit no-live-child resolution plus separate push authorization.

## Executive Finding

The current skill has strong safety invariants, but several mechanisms prove only that the agent followed a mechanical ceremony. In the worst cases, their cost is superlinear in the number of artifacts even though the user ultimately needs five facts: what tree was selected, why it changed, which exact message was approved, which commit was created, and whether verification/publication succeeded.

The repository already contains quantitative evidence that this is material rather than theoretical:

- The Gemini 3.5 Flash Low treatment averaged 65,456 reported tokens versus 12,868 without the skill, about 5.1 times as many, and 15.77 seconds versus 5.66 seconds, about 2.8 times as long. The treatment was substantially safer, but the evaluation rubric allows an arbitrarily expensive run once safety passes.
- A real 59-change-unit transaction originally produced 76 required patch chunks, largely to re-read 13,474 historical deletion lines. The deletion-aware amendment fixed only that shape of waste.
- A later three-artifact read requested 46,389 bytes in one tool response, exceeded the display allowance, and forced individual rereads. The atomic-read amendment fixed truncation but doubled down on a read-then-acknowledge loop for every artifact.
- The known-context `skills-lock.json` commit observed immediately before this audit required manual attempt allocation, a scope file, two overview reads, two artifact reads, two acknowledgement commands, scaffolding, a separate render, a separate validation, a separate message read, a separate precommit verification, direct commit, OID lookup, signature verification, checks-file creation, report generation, and report reading. Its useful semantic result was a short inventory-refresh message grounded by the user's direction and the update command. The inaccessible trust source added a failed verification, configuration lookup, and second verification.
- A representative 1,000-unit ledger is about 312,379 bytes. Because every acknowledgement currently emits and rewrites the entire ledger, 1,000 binary metadata units imply at least 2,000 read/acknowledge tool actions and roughly 312,379,000 bytes of acknowledgement JSON, before considering inventory pages. The test suite itself can mark every unit reviewed without opening the artifacts, demonstrating that this cost does not prove reading.

The implementation should therefore apply one rule to every state transition:

> Keep a step only if it establishes a new user-relevant fact, protects an irreversible boundary, or produces an artifact consumed by a later boundary. Otherwise remove it, combine it with its consumer, or move it into deterministic code.

"Concise" in this plan means low unresolved semantic uncertainty, not few files. A strong user hint plus current-task or bounded inline evidence can support a coherent multi-file message; a single unknown file can still require the extended path. The skill is expected to improve the hint by checking type, scope, purpose, rationale, and user-facing effect rather than copying it literally.

## Authoritative Basis

- Git documents the index as the content used by `git commit`, and `git write-tree` as the operation that creates a tree object from that index. The exact tree remains the right approval anchor: <https://git-scm.com/docs/git-commit> and <https://git-scm.com/docs/git-write-tree>.
- Git's machine-readable `--raw`, `--numstat`, `--summary`, and `-z` formats provide complete path, status, object, mode, and line-stat facts without requiring a full textual patch: <https://git-scm.com/docs/git-diff> and <https://git-scm.com/docs/diff-format>.
- Git documents the exhaustive portion of similarity rename detection as O(N^2). Running it repeatedly over large add/delete sets is therefore not a free presentation choice: <https://git-scm.com/docs/git-diff>.
- Git documents that exhaustive untracked enumeration can make `git status` very slow in large worktrees. Scope-aware status detail is preferable to `--untracked-files=all` on every phase: <https://git-scm.com/docs/git-status>.
- Git exposes `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, and `GIT_ALTERNATE_OBJECT_DIRECTORIES`, which allow a draft index and its new objects to live outside the real repository while reading existing objects as alternates: <https://git-scm.com/docs/git-fsck> and <https://git-scm.com/book/en/v2/Git-Internals-Environment-Variables>.
- Git 2.45 introduced `git --no-lazy-fetch` and documents it as equivalent to `GIT_NO_LAZY_FETCH=1`; the prior 2.25 floor cannot support this plan's no-hidden-fetch invariant: <https://github.com/git/git/blob/master/Documentation/RelNotes/2.45.0.adoc> and <https://git-scm.com/docs/git/2.45.0>.
- Current Agent Skills guidance says every loaded token competes with the task and recommends concise instructions, progressive disclosure, and scripts that solve deterministic work rather than handing it back to the model: <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices> and <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview>.
- Conventional Commits makes both scope and body optional; a complete outcome-focused subject is therefore a valid canonical message when additional sections add no durable information: <https://www.conventionalcommits.org/en/v1.0.0/>.

Current-repository evidence is directly anchored as follows (line numbers describe the pre-implementation source audited for this plan):

| Claim | Evidence anchor |
| --- | --- |
| Acknowledgement rewrites the whole ledger; the e2e loop never opens artifacts | `src/committing-to-git/inspection/changeInspection.js:307`, `:316`, `:327`; `tests/committing-to-git/workflow-e2e.test.mjs:52-68` |
| Git output is buffered up to 1 GiB before packet splitting | `src/committing-to-git/git/gitRepository.js:27-33`; `src/committing-to-git/inspection/changeInspection.js:85`, `:122`, `:263` |
| The 1,000-file bulk test generates four 250-ID arrays in code | `tests/committing-to-git/commit-message-renderer.test.mjs:316-327`; `src/committing-to-git/schema/commitMessageContent.schema.json:59-62` |
| Similarity and line-stat work occurs in snapshot, inspection, and report paths | `src/committing-to-git/snapshot/commitSnapshot.js:163-183`; `src/committing-to-git/command/inspectionCommand.js:71-76`; `src/committing-to-git/report/commitReport.js:276-279` |
| Routine reporting exhaustively enumerates untracked paths and renders 49 entries before its bulk count | `src/committing-to-git/report/commitReport.js:348`, `:489-505` |
| The public happy path exposes separate scaffold/render/validate/verify/report commands | `skills/committing-to-git/SKILL.md:150-172`, `:216`, `:249`, `:271` |
| Staged drafts can call real-index `write-tree`; full/path drafts use a temporary index but the real object store | `src/committing-to-git/command/snapshotCommand.js:143-162`, `:209-223` |
| Trust classification matches `allowed signers` but not the observed `allowed keys file` phrase | `src/committing-to-git/signature/commitSignature.js:94-102` |

## Cost Model

Measure six independent costs. A change that improves one while making another unbounded is not a successful optimization.

| Symbol | Cost | Current source | Required target |
| --- | --- | --- | --- |
| `T` | Agent-visible tool actions | One command/read/edit per low-level transition; two actions per inspection unit | Known-context transport-safe subject flow is one prepare plus one post-approval commit; multiline or nonportable text adds one exact check; other cost tracks only evidence actually needed |
| `C` | Context bytes/tokens | Main skill plus up to five references on an ordinary actual commit | Concise flow requires only `SKILL.md` plus one bounded preparation result; references load only after a named exceptional branch |
| `O` | Helper/process output | Full ledger emitted after every acknowledgement | Every routine command emits O(1) summary output; no growing artifact is echoed repeatedly |
| `M` | Peak helper memory | Entire patch, inventory, or deleted blob buffered before splitting | O(packet size + parser state), independent of total patch size |
| `G` | Git subprocess and algorithmic work | Repeated status, diff, rename detection, report reconstruction | Reuse recorded facts and cap similarity work by an explicit comparison budget |
| `D` | Temporary disk retention | Full patches, alternate indexes, manifests, reports retained indefinitely | Compact capsule retained; bulky reproducible evidence removed after a successful terminal transition unless requested |

### Required asymptotic properties

- Let `F` be change units, `P` bounded review packets, `D` semantic domains, and `E` explicit exceptions.
- Let `U` be unresolved semantic questions after applying the user's hint and reusable current-task evidence. Concise-flow work must be O(U + D + E), not selected by `F`.
- When `U = 0`, agent-visible workflow actions are O(1): prepare, approve, and commit for a transport-safe subject; multiline or nonportable text adds one exact check. A coherent many-file scope does not lose concise eligibility merely because `F` is large.
- Agent reads must be O(P), not O(2P), because a separate acknowledgement command adds no reading evidence.
- For a coherent bulk change, mandatory agent-visible scope context must be O(D + E), not O(F); the exact O(F) manifest remains machine-readable and queryable.
- Routine helper output must be O(1) per command, not O(P) per acknowledgement and O(P^2) over a transaction.
- Bulk semantic input must be O(D + E), not O(F), so a 1,000-file domain never requires a 1,000-ID worksheet.
- Detailed semantic input may be O(E) when shared rationale covers the other files; numbered path rendering may remain O(F) because the user explicitly values that output below 50 units.
- Peak patch and deleted-blob memory must be O(16 KiB) plus small parser state, not O(total bytes).
- Similarity rename work must be bounded by a named maximum candidate-pair budget; exact same-object pairing remains O(F).
- A recoverable failure in a derived phase restarts that phase, not snapshot creation and human review.

## Current Workflow Audit

### P0: Costs that can become superlinear or operationally impossible

#### COST-01: Per-artifact acknowledgements are not evidence of reading

`acknowledgeInspection()` rereads one artifact hash, changes one status, rewrites the complete ledger, and prints the complete ledger. The e2e test acknowledges units in a loop without reading their contents. The mechanism therefore establishes file integrity plus an agent assertion, not cognition, while imposing two agent actions per unit and O(P^2) cumulative ledger I/O/output.

**Disposition:** Replace mutable per-unit status with an immutable review catalog and one final receipt bound to the catalog digest. The receipt asserts that all catalog-required packets were read and lists only optional additional packet IDs; it never repeats a long mandatory-ID set. At finalization, verify the current hashes, catalog digest, and mandatory coverage. State honestly that this is a hash-bound attestation, not proof of cognition.

#### COST-02: Exact machine scope is turned into an exhaustive human reading exercise

The exact manifest must account for every path, but the current protocol makes the agent read every inventory entry even when the approved presentation is a 50+-file domain summary. For a coherent 1,000-file migration, this turns a useful exact machine invariant into O(F) context and packet-reading work that neither proves intent nor appears in the final message.

**Disposition:** Keep the exact per-change-unit manifest as the machine authorization anchor. Make the mandatory agent-facing evidence a bounded scope synopsis: exact paths below 50 only when the complete result budget fits, and counted path-prefix/kind groups plus deterministic anomalies otherwise. Preserve an on-demand exact inventory for queries, explicit full-review requests, and any group the agent cannot explain. Finalization verifies aggregate counts and manifest selectors against the exact manifest; it does not pretend the agent read an undisplayed path list.

#### COST-03: Exhaustive patch capture conflates message drafting with code review

The current workflow materializes and requires every non-deletion patch byte even when the agent authored the changes in the current task, the user's request already supplies the reason, or the file is a generated lockfile. The exact tree and complete path inventory are necessary; every textual byte is not always necessary to write a grounded commit message.

**Disposition:** Introduce `message`, `review`, and `reuse` inspection policies. Always require the exact machine manifest and a complete bounded scope synopsis. Require full patch packets for explicit review requests, pre-existing or unknown changes, partial-hunk ambiguity, and unresolved consequential changes. Permit known current-task or mechanically derived changes to rely on task context plus exact scope facts, with selective inventory/patch materialization for unexplained units. Never call selective evidence a full review.

#### COST-04: Full patch and deletion bodies are buffered in memory

`runGit()` uses `spawnSync` with a 1 GiB buffer; inspection captures the whole patch before `splitPatch()`, builds the whole inventory string before splitting, and reads a whole deleted blob before splitting. Very large changes can exhaust memory or hit the 1 GiB ceiling even though the output artifacts are nominally bounded.

**Disposition:** Add a streaming Git boundary and incremental packet writer. Hash, count, and split stdout while it arrives. Stream inventory records and `cat-file` blob output. Tests must demonstrate bounded writes without constructing a giant in-memory buffer.

#### COST-05: Bulk output is compact, but bulk authorship is still O(F)

Bulk `content.json` requires every change-unit ID in exactly one domain. The 1,000-file renderer test hides this agent cost by generating four arrays of 250 IDs programmatically. The executable eval fixtures stop at 50 files, so no model has been required to build the 1,000-ID worksheet it is said to support.

**Disposition:** Add deterministic selectors (`all`, exact IDs, exact UTF-8 paths, slash-terminated path prefixes, kinds, and a final `remaining` selector). The helper expands selectors, rejects unmatched fields and omissions, enforces non-overlap for evidence/bulk partitions, permits intentional overlap for detailed shared rationale, and generates counts. Exact IDs remain the escape hatch for non-UTF-8 or irregular cases.

#### COST-06: Similarity rename detection can be O(N^2) and is repeated

Snapshot normalization, inspection patch generation, and post-commit statistics each request 50% similarity rename detection with a limit of 1,000. A large add/delete migration can therefore pay the expensive comparison multiple times merely to improve display labels. Similarity still does not establish provenance.

**Disposition:** First pair exact same-object deletes/adds in linear time. Run similarity detection only when `addedCandidates * deletedCandidates` is within a named, benchmarked comparison budget. Record when the budget disables similarity. Reuse manifest classification for report statistics whenever the actual tree matches.

#### COST-07: Eager line statistics can require a full content diff before one is needed

Snapshot creation runs `--numstat` for every text change even under `reuse` policy. A single huge generated file can therefore make Git compare megabytes or gigabytes merely to print an insertion/deletion count. The raw object/mode/path records and exact tree already establish commit scope; line counts are presentation data.

**Disposition:** Build the exact manifest from raw records first and query object sizes in a bounded batch. Compute eager line statistics only while the total eligible old/new blob bytes remain under a named, benchmarked input budget. Mark larger units `deferred`, obtain counts incrementally when a selected patch is streamed, and let compact reports state that line totals were not computed when no later evidence step needed them. Never read a huge blob solely to replace `deferred` with a decorative count.

### P1: Constant-factor costs that dominate ordinary commits

#### COST-08: The normal instruction path is too large

The main skill is 2,670 words and 19,959 bytes. A restricted-host actual commit normally also loads transaction artifacts, execution permissions, message format, and signature verification, for about 5,648 words and 40,585 bytes before repository evidence. The main file contains 64 hard directives; the four ordinary references add 83 more. Progressive disclosure is present structurally but not behaviorally because several references are mandatory on the happy path.

**Disposition:** Put the happy-path decision table, authorization gates, and three high-level commands in `SKILL.md`. Move deterministic mechanics into code. Load references only after an actual exception: ambiguous inspection, failed transaction recovery, unavailable signature trust, or publication failure/later recovery.

#### COST-09: Attempt and scope preparation are manual deterministic work

The agent must generate a UUID, create the directory, create `scope.json`, preserve a growing set of filenames, and repeat long absolute paths in every command. This is exactly the kind of deterministic work a bundled script should own.

**Disposition:** `workflow prepare` exclusively allocates a directory named `committing-to-git-UUID_V4` beneath the system temporary directory, derives all artifact paths, and accepts repeated literal exact-path/path-prefix inclusions plus exclusions. This makes "these domains except these user-owned files" proportional to the exceptions instead of the included file count. Retain `--scope-file` only for large, byte-hostile, or non-UTF-8 selector sets. The state file is an internal transaction journal, not ownership, discovery, or handover machinery.

#### COST-10: Inventory overview, ledger, inventory page, and metadata repeat facts

The agent reads `inventory.md`, `ledger.json`, one or more inventory pages, patch chunks, and per-binary/per-submodule metadata. Binary metadata repeats path and unavailable line counts already present in the manifest/inventory. A 1,000-binary snapshot creates approximately 1,000 redundant metadata artifacts.

**Disposition:** Emit one immutable catalog plus bounded human review packets. Scope packets contain all path, kind, mode, object, and line-stat facts. Do not create per-binary or per-submodule review files unless a separate content inspection was explicitly requested.

#### COST-11: Scaffold, render, validate, and read are four phases for one result

The scaffold creates an invalid template the agent is never instructed to read. Rendering already owns canonical structure, while validation rerenders and compares the output just written. The agent then performs another read to obtain the message.

**Disposition:** The concise route creates no semantic worksheet: preparation returns sufficient evidence inline, a transport-safe subject is validated/recorded inside `workflow commit`, and multiline or nonportable text receives one preapproval `message check` that records the exact bytes. When unresolved evidence or semantic structure requires the extended route, `workflow prepare` creates one worksheet and `message finalize` validates coverage, renders canonically, records validation, and returns the exact message in one structured output. Remove the old standalone validator and its live-scope parsing path at the atomic cutover.

#### COST-12: Per-file rationale is mandatory even when it repeats shared information

Detailed mode requires at least one reason for every file even when one rationale covers a generated cohort. This encourages repetition or invented micro-rationales, contrary to the stated goal of recording information absent from the diff.

**Disposition:** Make truthfulness mandatory but message depth adaptive. A concise subject may stand alone when it captures all durable intent. When a body adds value, a shared rationale selector may cover many units and file-specific notes are reserved for exceptions or genuinely distinct consequences. Extended detailed mode keeps the numbered path inventory for 1-49 units; concise mode is never forced to add a mechanical inventory merely because the exact scope contains several files.

#### COST-13: Post-approval work is split across avoidably many commands

Snapshot verification, `git commit`, OID lookup, signature verification, empty checks-file creation, report creation, and report reading are separate agent actions. The split allows ordering mistakes and repeats repository scans without adding authorization boundaries.

**Disposition:** After exact-message approval, one journaled `workflow commit` transition verifies the snapshot, invokes signed commit creation, records the full OID, verifies under the selected policy, compares the commit, emits the final report, and retains recovery state. An optional checks file is accepted only when checks exist; absence means an empty checks list.

#### COST-14: Signature trust failures are discovered after a doomed verification

The helper's unreadable-trust regex recognizes "allowed signers file" but not Git for Windows' observed "allowed keys file", so the current real run misclassified a recognized good SSH signature plus unreadable trust source as `failed`. It then required a configuration lookup and elevated rerun.

**Disposition:** Preflight the signing backend and configured SSH trust path during preparation, report the exact origin/path and current readability, and use that information to request the required capability on the first post-approval command. Classify the observed `allowed keys file` form and add fixture-driven variants. A final nonzero verifier result remains authoritative; preflight only prevents predictable access failure.

#### COST-15: Derived-artifact collisions restart the entire transaction

An occupied inspection directory or scaffold target forces a new UUID, new snapshot, new inspection, and often new approval even though these artifacts are deterministic derivatives of the unchanged manifest. Create-only behavior is necessary around network publication and helpful for the scope anchor, but overbroad elsewhere.

**Disposition:** Keep the snapshot and irreversible journals create-only. Write derived inspection, scaffold, verification-retry, and report artifacts atomically and idempotently under phase-specific revision names where recovery needs historical phase identity. Checked canonical message/validation state is the explicit constant-space exception: replace one current valid slot atomically and retain only its monotonic revision counter/hash, not historical bodies. Retry only the failed derived phase when the manifest and transaction state still match.

#### COST-16: Drafts can write repository metadata and cannot be promoted

Draft staged scope may lock the real index through `write-tree`; draft full/paths writes blobs and trees into the real object database. A later commit repeats snapshot creation, inspection, authoring, and approval even when the intended tree is unchanged.

**Disposition:** For every draft scope, copy or construct an attempt-local index and use an attempt-local object database that reads the real object database through alternates. Set `GIT_OPTIONAL_LOCKS=0` for every read-only draft Git child and run `write-tree` only against that copied/temporary index, so staged drafts receive the same exact tree identity without locking or writing real index/object/ref/log metadata. Add `workflow promote` that recreates the actual index tree, proves it equals the drafted tree and complete head anchor, and reuses review/message artifacts; commit authorization remains required, and any mismatch starts a fresh actual review.

#### COST-17: Status and reporting enumerate more workspace state than the scope needs

The skill mandates `--untracked-files=all` before every transaction, and the report repeats a full all-untracked scan. Git documents this as potentially slow. For explicit path scope, unrelated nested untracked contents are not needed to establish the selected tree.

**Disposition:** Use scope-aware status. Enumerate all untracked paths only for `full` scope or explicit full workspace reporting. For `paths` and `staged`, detect the presence of unrelated state and render exact entries below the display threshold, but permit directory-level compact records for large untracked trees. Ignore recursive submodule worktree dirtiness on the routine top-level scan; exact gitlink changes remain in the manifest, while a disclosed on-demand report performs deeper submodule inspection only when requested.

#### COST-18: Successful and safely abandoned attempts leak bulky temporary evidence indefinitely

The helper never removes attempts. Large patches, process logs, and alternate object stores remain in the system temp directory after a created Git commit permanently records the tree or after a no-commit transaction becomes safely terminal.

**Disposition:** Whenever a transaction is terminal with no pending/unknown mutation, retain only the compact state/tree/message/result capsule appropriate to its disposition and any failed/recovery log still needed. Remove helper-owned packet/delta, temporary-index, preparation-index, alternate-object, and successful-log directories after exact UUID containment/link validation. Explicit retention preserves requested evidence. An optional exact purge can delete only the named safe transaction; it never scans for attempts or introduces ownership/handover state.

#### COST-19: File count and message ceremony are poor proxies for semantic work

The first proportional redesign still budgeted five agent actions for an "ordinary one-file" transaction: prepare, packet read, worksheet edit, finalization, and commit. That would leave the observed `skills-lock.json` failure mode fundamentally intact, and it would exclude coherent multi-file functionality even when the user supplied strong direction and the agent already understood the work. It also treated the user's hint as canonical wording or scope instead of evidence to improve.

**Disposition:** Route by unresolved semantic uncertainty. `reuse` transactions return a compact staged synopsis and can proceed directly to message construction; bounded `message` evidence is returned inline when it fits the named allowance. In both cases the agent evaluates the hint against the evidence and improves the type/scope/description plus optional rationale/UX. A transport-safe subject is approved directly and passed byte-identically to `workflow commit`; multiline or nonportable text is checked/recorded once before approval. Only `review`, mixed uncertainty that cannot fit inline, or genuinely complex semantic presentation activates packet queues, a worksheet, and `message finalize`. No route threshold is expressed as a maximum file count.

### P2: Smaller ambiguities and maintenance multipliers

- `renderWorkspace()` currently lists the first 49 paths and then adds a compact "N paths" line when a group has 50 or more. The intended policy was compact mode at 50, not 49 detailed entries plus a summary. Add the missing boundary test and render only the compact form at 50+.
- `signature-verification.md` tells the agent to rerun after gaining trust-file access, while transaction lifecycle prose says `verification.json` is replaceable only after a policy change. Define one versioned verification history for repeated attempts against the same commit.
- CLI flag parsers silently accept unknown and duplicate flags. Reject both before Git or filesystem effects so typos fail cheaply.
- `activeGitOperations()` starts one Git process per marker and repeats that scan. Resolve Git paths in one preflight operation and reuse the result within a transaction phase.
- The legacy live-scope validator occupies roughly half of `commitMessageValidator.js` and is unrelated to the canonical manifest path. Delete it, its CLI route, and its dedicated tests at the atomic cutover after moving any still-relevant pure message checks into the shared exact-message validator used by `message check`, direct subject commit, and the extended finalizer.
- The report reconstructs commit statistics with two diffs even after it proves the actual tree equals the manifest. Reuse manifest statistics on a match and compute actual statistics only for a mismatch.
- The report derives the branch label from current `HEAD`, which can move after commit creation. Record the complete head anchor in the commit journal, report its symbolic target when present, and label detached creation explicitly rather than consulting later checkout state.
- No Git subprocess has a timeout. Add bounded timeouts only to read-only verification/status operations; do not impose a short generic timeout on user hooks or the commit itself. Journaled recovery handles an interrupted commit command.

## Approaches Considered

### Option A: Patch the current protocol

Make acknowledgement output compact, batch acknowledgements, remove duplicate metadata artifacts, and fix signature/report boundary bugs without changing the low-level workflow.

**Advantages:** Smallest code diff; least migration risk; preserves every current assertion.

**Disadvantages:** Still forces exhaustive patch reading, manual UUID/scope/check artifacts, repeated renderer/validator/report commands, O(F) bulk worksheets, and instruction-heavy orchestration. It improves the coefficient but not the model.

### Option B: Transaction coordinator plus proportional evidence (recommended)

Keep the exact-tree transaction core, but let the helper own deterministic state and let inspection depth track uncertainty. Use a concise guided route with inline evidence whenever the user hint plus grounded evidence is sufficient: a transport-safe subject is direct commit input, while multiline or nonportable text is checked once before approval. Use immutable review packets, one receipt, selector-based semantic coverage, and a combined message finalizer only for the extended route. Both converge on the same journaled commit transition and compact post-commit state.

**Advantages:** Preserves the high-value safety invariants; removes both superlinear paths and ordinary constant ceremony; lets the skill improve rather than merely transcribe a user hint; gives weak models fewer opportunities to misorder commands; supports honest distinctions between scope verification, message evidence, and full review.

**Disadvantages:** Requires schema migrations and a new high-level CLI; the inspection-policy decision remains agent judgment; the commit helper becomes a more powerful executable and therefore needs strong tests and an explicit authorization boundary.

### Option C: Return to a mostly native Git workflow

Use `git status`, selected `git diff` commands, direct staging, direct signed commit, and a concise instruction-only skill.

**Advantages:** Lowest implementation and context cost; familiar to experienced Git users.

**Disadvantages:** Loses deterministic message rendering, exact-snapshot artifacts, special-path guarantees, journaled recovery, hook mismatch reporting, and exact publication evidence. It would regress the incidents that motivated this skill.

**Decision:** Implement Option B. Use Option A changes only when they are safe intermediate commits on the way to Option B; do not stop at Option A and call the proportionality problem solved.

## Target User Workflow

### Draft-only request

1. Treat the user's wording as a strong semantic hint, not exact text or a path expression. Apply already-loaded repository message policy before preparation; if mandatory trailers or structure cannot be represented, explain the conflict and stop without invoking Git. When current-task lineage identifies one coherent exact scope, run one `workflow prepare --mode draft` command with the best grounded uniform `--evidence reuse|message|review --basis KIND` choice. When provenance is already mixed, supply one validated initial evidence-plan file rather than knowingly mislabeling the whole scope. When two materially different scopes are plausible, ask before preparation. The helper creates an isolated exact tree without changing the real index/object database and returns `route: "concise"` with a bounded inline evidence capsule whenever the hint plus current evidence is sufficient.
2. On the concise route, use the hint and capsule to choose the accurate type, scope, outcome-focused description, optional rationale, and optional user-experience assessment. Present a transport-safe subject-only draft directly by default. For multiline text, nonportable text, an explicit request for checked-file transport, or a revision already using that route, write the exact message to the fixed transaction-local `message-input.txt`, run one `message check --transaction ...`, and present its byte-identical `displayText`; do not create another temporary directory, a semantic worksheet, or a renderer merely to show it. If a counted bulk `File Changes:` inventory is genuinely useful, use `workflow extend --reason semantic-structure-required` and the structured finalizer; it carries forward the concise evidence and creates no packet reread merely for formatting.
3. When preparation returns `route: "extended"`, or when the inline capsule exposes a named unresolved uncertainty, use the returned packet queue/extended-route entry point. Read only required evidence, edit the single semantic worksheet/receipt, and run `message finalize`; a later evidence refinement materializes only its missing delta.
4. Invite revisions without asking for commit authorization. Transport-safe subject-only concise revisions remain conversational; checked concise revisions rerun only `message check`; extended revisions rerun only the finalizer. Apply the revision invalidation rules below rather than repeating unchanged evidence automatically.
5. If the user later requests a commit of a byte-identical concise draft, pass the exact approved transport-safe subject payload directly or reuse the recorded checked message during promotion/commit. The canonical encoding of every approved message ends in exactly one LF; a changed scope or any other message byte is presented again.
6. Treat a conversationally ready draft as active, not terminal. Mechanically it remains a draft transaction in `evidence-ready` when its direct subject exists only in the conversation or `message-ready` when checked/finalized bytes are recorded. Retain its transaction artifacts while revision or promotion remains possible; do not trade that cheap reuse for eager reconstruction merely to reclaim temporary storage before a commit or explicit terminal disposition.

### Concise guided actual commit

1. Interpret the user's wording as a semantic hypothesis. Resolve the exact intended scope from the request, current task, status, relationships, and exclusions. Apply already-loaded repository message policy before staging: unsupported mandatory structure stops here, and a supported explicit type allowlist is passed to preparation for deterministic validation. When current-task lineage identifies one coherent set, stage it through preparation and show it during normal approval; when two materially different sets are plausible, ask before staging. Never use the hint as a fuzzy path selector.
2. Run one `workflow prepare --mode actual` command with `staged`, `full`, or `paths`. A hint without additional content lineage selects `message --basis user-grounded`; use `reuse` only with a specific `authored-current-task`, `read-current-task`, `generated-derived`, or sufficiently specific `task-lineage` basis. If the scope has mixed known provenance before preparation, pass one compact selector-based initial evidence plan instead of an inaccurate all-scope policy. Preparation owns UUID allocation, exact staging, snapshot creation, signature preflight, and a bounded result. `reuse` returns a compact exact/bulk synopsis; `message` also returns the complete required patch inline when it fits the named evidence budget. The result selects `route: "concise"` only when no required evidence remains external.
3. Compare the hint with the evidence. Choose the applicable Conventional Commit type and scope, describe the outcome rather than mechanical edits, and include rationale, user experience, files, or counted domains only when they add durable information. If evidence materially contradicts the hint, disclose the correction with the proposal. A counted bulk inventory is structured data: if it is useful, invoke `workflow extend --reason semantic-structure-required`, edit fixed `content.json`, and finalize without rereading the already sufficient concise evidence; otherwise omit the mechanical inventory and stay concise.
4. For a transport-safe subject-only result, present the exact staged scope synopsis, exact subject, exclusions, the protocol-mandated single terminal LF, and any material hint correction directly for approval by default. For multiline/nonportable concise text, an explicit checked-file request, or a revision already using that route, place only the exact canonical message ending in one LF in the transaction's fixed `message-input.txt`, run `message check --transaction ...`, and present its byte-identical `displayText` with the same scope/exclusion facts. Those concise paths create no packet receipt, semantic worksheet, renderer, or extended finalizer; a deliberately structured bulk inventory follows the separate zero-reread transition in the prior step.
5. After approval, run one `workflow commit` command. An unchecked concise transaction may supply the exact approved subject payload through `--message` only when it passes the direct-transport predicate; the helper deterministically encodes that payload as `subject + LF` before hashing and records no other rewrite. A checked concise or extended transaction supplies no message input and uses its recorded bytes. The helper performs or rechecks exact validation before any Git mutation, rechecks the approved tree, creates the signed commit, verifies and compares it under the current user-selected policy, compacts safe temporary state, and returns the report directly.
6. Do not push unless separately authorized.

### Extended actual commit

1. Select this route when the user requested full review, any evidence group is unknown/pre-existing, required message evidence cannot fit the bounded inline capsule, a special/anomalous change remains unexplained, or the chosen optional counted-domain presentation requires structured validation. File count by itself is never an evidence reason; semantic-structure-only entry carries concise evidence forward with zero new packet requirements.
2. Follow the bounded initial review-packet queue without opening the full machine catalog for navigation. Refine mixed evidence groups when necessary, materialize exact-inventory or patch packets only for unresolved selections, and edit the single semantic worksheet/receipt.
3. Run `message finalize`. If it returns `evidence-required`, read only the bounded delta queue, update the receipt, and rerun it. Present exact `displayText` for approval only from `message-ready`.
4. After approval, run the same one-command `workflow commit`; it consumes the finalized exact message rather than direct message input and performs the same snapshot, signed-commit, verification, comparison, report, and compaction transition.
5. Do not push unless separately authorized.

### Revision invalidation

Classify a requested revision before doing more work. The helper can enforce tree and recorded-message state, while the skill owns the semantic classification and evaluation coverage:

Every byte change to the proposed message requires a new exact-message approval, even when all scope and evidence anchors survive. Evidence reuse never implies approval reuse.

1. A wording, type, scope-label, or phrasing correction that preserves the same scope and material meaning reuses the prepared tree and all evidence. Recheck only the exact message when its transport route requires `message check`; otherwise present the corrected direct subject.
2. A new rationale, user-experience claim, risk statement, or other material interpretation with the same scope reuses the prepared tree and existing evidence, but the agent must identify support for the new claim. If current inline or receipted evidence is insufficient, request only the missing evidence through `workflow extend` or an extended-route delta; do not restage or reread unchanged coverage.
3. Any staged-tree or scope change invalidates the preparation and approval anchor. Create a fresh preparation, derive fresh evidence for the new tree, and present the new scope and exact message for approval. Never treat a changed tree as a message-only revision.

### Authorized publication

1. Run `workflow publish` against the recorded transaction, remote, and full destination ref.
2. The helper validates the successful matching report and active verification policy before it invokes Git.
3. It journals the network attempt, updates the existing report with publication facts without recomputing the commit, and returns the exact final report in `displayText`.

### Exceptional recovery

- Load a recovery reference only when a high-level prepare/resume, message, promote, commit/verify, report-detail, cleanup, or publication command returns an exceptional phase/status.
- Observe through `workflow recover`, then use `workflow resume` only when the result explicitly marks a reversible preparation continuation allowed. Never reconstruct scope/policy inputs or restart snapshot/inspection merely because a deterministic derivative failed.
- Never retry a pending commit or push automatically. Observe the exact recorded parent/ref and classify the outcome first.

## Transaction State Machine

`mode`, `phase`, mutation journals, and terminal disposition are separate facts. Do not overload a conversational label such as `draft-ready` into a persisted phase. The canonical transaction phases are:

| Phase | Meaning | Permitted next high-level action |
| --- | --- | --- |
| `allocated` | The UUID workspace and initial transaction record exist; no snapshot is complete | Continue the in-flight preparation, use recovery plus `workflow resume` only when a durable reversible continuation exists, or classify/clean a safe allocation failure |
| `snapshot-created` | Exact repository/head/scope/tree facts are durable; evidence routing is not yet durable | Complete the in-flight preparation or use `workflow resume` after observation classifies a derived failure as safely resumable |
| `evidence-ready` | Concise synopsis/evidence is complete and no canonical message is recorded | Present/revise a direct subject, run fixed-file `message check`, extend a named uncertainty, promote an unchanged draft, commit an approved direct subject, or explicitly abandon |
| `review-pending` | Extended catalog/queue/content state exists and current required evidence is not yet finalized | Read the current queue, edit the fixed worksheet/receipt, rerun `message finalize`, supersede the current evidence plan, or explicitly abandon |
| `message-ready` | Exactly one canonical message body/validation/hash/revision is durable | Present/revise the message through its existing route, promote an unchanged draft, commit without another message input, or explicitly abandon |
| `commit-pending` | The flushed commit journal exists and commit outcome or postcommit completion is unresolved | `workflow recover` only; never invoke commit creation again |
| `reported` | A definite local commit OID, exact comparison, applicable verification disposition, and local report are durable | Retry verification/report recovery for the same OID when named, publish if separately authorized and allowed, clean compactable state, or retain evidence |
| `publication-pending` | A flushed publication journal has an unknown remote outcome | Read-only `workflow recover`; only after it records the explicit no-live-child resolution may a separately authorized `workflow publish --retry-after-attempt` create one fresh linked attempt |
| `published` | The desired full commit OID is durably recorded as present at the exact destination, either from a witnessed completed push or a later matching remote observation; provenance distinguishes those facts | Idempotent cleanup/report display only |
| `stopped` | A known no-commit/no-publication stop is terminal for this transaction, including drift, hook rejection with the baseline head observation unchanged, or a safely rejected preparation | Idempotent cleanup, exact purge, or start a fresh transaction; never resume mutation from stale approval |
| `abandoned` | The user/skill explicitly abandoned an active precommit transaction | Idempotent exact purge only |
| `superseded` | A fresh transaction replaced this precommit scope/tree/message anchor | Idempotent cleanup or exact purge only |

Promotion changes `mode` from `draft` to `actual` while preserving either `evidence-ready` or `message-ready`; it is not a new evidence phase. A conversationally ready direct-subject draft is `mode: "draft", phase: "evidence-ready"`. A checked/finalized draft is `mode: "draft", phase: "message-ready"`.

Use these transaction-wide result statuses:

- `prepared`, `review-pending`, `message-ready`, `evidence-required`, and `promoted` for successful precommit transitions;
- `reported` and `published` for successful local/remote outcomes;
- `commit-blocked` when a definite commit exists but comparison, required verification, or report completion blocks publication;
- `outcome-unknown` only with `commit-pending` or `publication-pending`;
- `recovered`, `cleaned`, `stopped`, or `invalid` for the corresponding recovery, cleanup, safe-stop, or usage/artifact result.

Specific machine-readable error codes such as `UNMATCHED_SCOPE_SELECTOR`, `MESSAGE_REQUIRES_CHECKED_FILE`, or `PROMOTION_BLOCKED_STAGED_STATE` accompany `status`; they do not become ad hoc phases. `terminalDisposition` is `null` while active and one of `no-commit-stopped`, `local-commit-recorded`, `published`, `abandoned`, or `superseded` when the facts needed for safe compaction are durable. A blocked commit has `terminalDisposition: "local-commit-recorded"` only after the exact created OID and comparison are known; unresolved verification/report records remain retained according to their recovery need.

`recoverTransactionWorkflow({ transactionPath, resolution = null })` is the only public recovery dispatcher. It first recovers any pending canonical-message replacement, then branches without repository/ref/network mutation to index-installation observation, commit observation, verification/report continuation for an already known OID, or publication observation. It may durably record those observations. The only resolution token is `confirmed-no-live-child`: Task 7 defines its commit use and Task 8 extends the same phase-checked assertion to a pending publication child. Unknown or inapplicable tokens fail without state change. Recovery never discovers another transaction and never converts an unknown outcome into an automatic retry.

`workflow resume` is narrower than recovery: it is the explicit mutation-capable continuation for a reversible precommit preparation whose observation result set `resumeAllowed: true`. It consumes only persisted inputs and cannot change scope, evidence, policy, or approval facts. No commit or publication journal is resumable through it.

## High-Level Output and Exit Contract

In the default `--format json` mode, every high-level command emits exactly one bounded JSON document on stdout. Git hooks, signing interaction, warnings, and incremental child-process output go to stderr and are never buffered into or interleaved with the JSON. `--format text` is a common option on every high-level command and emits one human rendering derived from the same persisted result; it does not run different Git logic.

Every result includes `schemaVersion`, symbolic `status`, `phase`, `terminalDisposition`, `transaction`, `route`, `commitState`, `publicationState`, `publicationAllowed`, `recoveryRequired`, and the relevant exact hashes/OIDs/counts. `route` is `concise`, `extended`, or `null` before evidence routing. `transaction` is the one absolute opaque transaction handle after allocation and `null` when input fails before a transaction exists. The ordinary concise path necessarily passes that handle between commands, but the agent never reads or edits the transaction artifact. `commitState` is `absent`, `present`, or `unknown`; `publicationState` is `not-requested`, `rejected`, `succeeded`, `observed-matching`, or `unknown`. `succeeded` means the helper witnessed a completed successful push, while `observed-matching` means recovery later saw the intended OID at the destination and cannot prove which actor put it there. These explicit enums prevent an exit-`4` result or a matching observation from lying through a false boolean. Concise `workflow prepare` includes its bounded evidence capsule directly; `message check`, `message finalize`, `workflow commit`, `workflow verify`, and `workflow publish` include `displayText` containing the exact canonical message or human report that the agent presents without rereading an artifact. The agent treats stdout as data: it parses the JSON, branches on `status` plus the exit class, and presents `displayText` rather than echoing raw JSON or rereading a report file.

A canonical message is at most 32 KiB before JSON encoding and contains no Unicode control character other than LF and no Unicode format character (including BOM, bidi controls, and zero-width formatting). `message check` and `message finalize` serialize their complete result first and enforce `MAXIMUM_MESSAGE_RESULT_BYTES = 80 * 1024`; this bound covers worst-case JSON escaping of a 32-KiB valid message plus the validated bounded transaction path and fixed envelope. Tests measure `Buffer.byteLength(JSON.stringify(result))` rather than adding an assumed 4-KiB envelope. The 32-KiB concise preparation budget likewise includes its complete serialized JSON result. Task 8 defines a separate serialized report-result budget and byte-triggered path compaction. Noisy child output never enters stdout.

Use these process exit classes consistently across commands:

| Exit | Meaning | Mutation/retry rule |
| ---: | --- | --- |
| `0` | Requested terminal state achieved and current policy permits the next authorized phase | Continue only if the user authorized that next phase |
| `1` | The requested terminal state was not reached, but no new commit/push was observed: evidence delta, drift, state conflict, or hook rejection; hooks may still have changed local files/index | Follow the symbolic status; read only a named evidence delta, or reinspect state before a retry |
| `2` | Usage, schema, artifact, or helper failure before any mutation is known to have occurred | Fix the input/implementation; do not infer Git state from this code alone |
| `3` | A commit definitely exists, but mismatch, required verification, or post-commit processing blocks publication | Never rerun commit; use `workflow verify`, cleanup, report recovery, or user-directed rollback |
| `4` | Commit or publication outcome is unknown | Never repeat the mutation; run `workflow recover` to observe first |

The symbolic result is authoritative within each class. Tests inject every failure boundary and assert that exit `3`/`4` paths cannot call commit or push again.

### Child-process diagnostic budget

For potentially noisy `git commit`, verification, hook, and publication children, stream complete stdout/stderr bytes into an attempt-local log while reserving high-level stdout for the result JSON. Mirror no more than the first 16 KiB to the helper's stderr; after that emit one suppression marker. If the child fails or leaves recovery pending, emit no more than the final 16 KiB after termination and return the log's exact path, byte count, and SHA-256 in the JSON. Do not duplicate overlapping head/tail bytes when the complete log is below 32 KiB. Controlling-terminal and pinentry interaction remains direct.

Delete a successful child log during normal compaction unless retention was requested. Retain a failed or recovery-required log until the exact transaction is resolved or explicitly cleaned. Log display limits protect the agent context; the complete hashed log preserves diagnostics.

## Evidence Policy

### Evidence layers

| Layer | Always required? | Establishes | Does not establish |
| --- | --- | --- | --- |
| Exact manifest | Yes, machine-verified | Every path/change unit, kind, modes/OIDs where applicable, exact tree binding | That the agent read every individual path |
| Scope synopsis | Yes, agent-read | Exact paths below the detail threshold; otherwise counted groups, deterministic anomalies, manifest digest, and deferred-stat disclosures | Every individual bulk path or the meaning of every changed line |
| Exact inventory packets | On demand or under full review | Individual paths for the selected manifest groups | Meaning of changed content |
| User hint | When supplied | Strong direction about intended outcome, domain, motivation, or user effect | Exact canonical wording, exact path scope, correct Conventional Commit classification, or proof that the implementation matches the hint |
| Task-context evidence | When selected and truthful | The reason already supplied by the user, issue, warning, plan, or current agent work | Independent content review |
| Selected patch packets | When a unit's meaning is otherwise unclear | Exact textual changes for those units | Unseen binary contents or runtime correctness |
| Full-review packets | For unknown/pre-existing text, partial hunks, explicit review, or selected consequential changes whose effects remain unclear | Complete non-deletion textual patch coverage; whole-file deletions follow the explicit deletion rule | Semantic correctness by itself |
| Checks | When actually run | The named check result in its stated environment | A result for another tree/environment |

### Default selection rules

- Treat the user's hint as a hypothesis. Resolve paths independently, compare the claimed intent with the exact scope and available content, select the most accurate type/scope/description, and disclose a material correction in the approval proposal. Harmless wording refinement needs no separate warning.
- A prompt-level hint by itself selects `message`, not `reuse`: it grounds purpose but does not establish file contents. `reuse` additionally requires a specific `authored-current-task`, `read-current-task`, `generated-derived`, or surviving task-lineage record that explains the selected domain. A generator command plus its observed output is sufficient generated lineage; a filename or user assertion alone is not.
- Partition mixed-provenance manifests into selector-based evidence groups. Every change unit belongs to exactly one group assigned `reuse`, `message`, or `review`; this partition is O(domains + exceptions), never a per-file policy list. When that mixed provenance is already known, pass the plan during initial preparation so the helper does not first materialize an inaccurate or overbroad all-scope policy. An explicit user request for complete review replaces the partition with one all-scope `review` requirement.
- Use `reuse` only when specific surviving task-lineage evidence establishes the relevant scope/domain and reason and the new scope synopsis contains no unexplained group or anomaly. A sufficiently detailed system compaction summary, implementation plan, check record, or explicit handoff may preserve that evidence; model identity, a vague "changes were made" summary, or unsupported memory may not.
- Use `message` for changes with grounded intent that need bounded content inspection to improve or confirm the message. Return the complete required evidence inline when it fits the concise allowance; materialize extended inventory/patch packets only for unresolved groups, surprising statistics, mixed responsibilities, or consequential deletions that exceed it.
- Use `review` for pre-existing or unknown text changes, user requests that include review/audit language, partial-hunk commits, sensitive interfaces whose consequences are unclear, or any unit the agent cannot truthfully explain from current evidence. It requires complete non-deletion patch coverage; a full-file deletion still follows the deletion-specific rule below so review does not mechanically reread every removed line.
- Do not maintain a sensitive-path or sensitive-domain denylist. Authentication, authorization, security, migrations, deployment, lockfiles, generated files, and submodules follow the same provenance/uncertainty rules. Their special Git or generator facts are always surfaced, but a grounded current-task change does not become extended merely because of its label.
- Treat a generated file, lockfile, binary, or gitlink as mechanically covered by its scope facts only when the generator/source change, command output, user context, or repository convention establishes its role. A filename alone is not provenance.
- Keep the current deletion rule: exact path/object/mode/stat facts are mandatory; old content is expanded only when meaning or risk depends on it.
- If selective evidence remains insufficient, inspect more. If exact content still does not establish the reason, ask the user rather than inventing one.

Each evidence group records a structured `basis` with an enum (`authored-current-task`, `read-current-task`, `task-lineage`, `user-grounded`, `generated-derived`, or `unknown-preexisting`) plus an optional concise grounded note of at most 512 UTF-8 bytes. Uniform preparation requires the enum through `--basis`; it does not require a free-form note merely to avoid an artifact on the happy path. A mixed initial plan or extended worksheet may include notes when they help later review. The helper rejects `reuse` with `user-grounded` or `unknown-preexisting`; only authored/read/generated/specific surviving lineage may claim zero-patch reuse. It validates selection coverage and policy consequences, not the truth of a note or the agent's claimed lineage. Overlapping evidence groups are invalid; escalation changes the affected group policy or splits the selector partition.

### Hint interpretation and Conventional Commit classification

Use already-loaded repository instructions or explicit user policy first. Otherwise apply this semantic guide; do not ask the user to classify work the skill can classify from evidence:

| Type | Choose when the dominant outcome is |
| --- | --- |
| `feat` | A new externally meaningful capability or supported behavior |
| `fix` | Correction of unintended behavior, a warning, regression, or broken contract |
| `perf` | A measured or intended efficiency improvement without a different feature contract |
| `refactor` | Internal restructuring with no intended behavior change |
| `docs` | Documentation-only behavior for readers |
| `test` | Test, fixture, or evaluation coverage without production behavior change |
| `build` | Build, packaging, dependency, generated installation inventory, or development-toolchain behavior |
| `ci` | Continuous-integration or delivery automation |
| `chore` | Maintenance that is not more accurately described by another applicable type |

Repository-defined lowercase types remain valid. Choose the smallest stable semantic scope that helps retrieval; do not use a filename merely because it is available. Describe the outcome or reason in the subject, not the mechanical edit. A material correction from the user's hint includes a changed type with different semantic meaning (`feat` to `fix`), a different affected domain, a contradicted user-visible outcome, or evidence that the selected scope contains a responsibility absent from the hint; disclose it before approval. Capitalization or wording improvements that preserve meaning need no discrepancy notice.

When two types appear plausible, choose the most specific type for the dominant committed outcome: `build` over `chore` for build/dependency/install state, `test` when only test/eval behavior changes, and `fix` when the resulting commit corrects externally meaningful broken behavior even if build/tests implement it. Do not list alternatives or ask merely about `build` versus `chore`. Ask or explicitly flag the choice only when the alternatives imply materially different release/user semantics, such as `feat` versus `fix`, behavior-preserving `refactor` versus user-visible `fix`, or an unrepresented breaking change.

Do not inspect recent history routinely. If loaded policy is absent and a genuinely material repository-specific convention remains unresolved, a bounded `git log -n 20 --no-merges --format=%s` inspection is permitted and its additional action is recorded as a classification exception. History is evidence of convention, not authority; hooks remain authoritative for enforced syntax.

## Cost Budgets and Acceptance Gates

Safety gates run first and remain absolute. A run that violates scope, authorization, signing, or exact-commit invariants fails regardless of speed. A safe run also fails the proportionality acceptance gate when it exceeds the following budgets without an exceptional branch recorded in the transaction.

### Known-context transport-safe subject concise commit

- File count is not an eligibility input. The exact scope may contain one file or a coherent many-file functional unit.
- Exactly one `workflow prepare` helper call occurs before approval and one `workflow commit` helper call occurs after approval.
- Preparation returns one opaque transaction path that the agent passes unchanged to commit. There is no agent read/edit of that transaction or any packet, manifest, worksheet, message, verification, or report artifact; no acknowledgement; no message-finalization command; no standalone renderer/validator; no OID lookup; no verification command; and no report reread.
- The preparation result contains the exact staged tree identity and a compact scope synopsis; the observed single-lockfile fixture stays below 4 KiB and every concise result stays within the general bounded-result contract.
- Exactly one user message-approval round trip occurs unless the user already supplied and explicitly approved byte-identical canonical text.
- The proposed subject passes `canUseDirectSubjectTransport()` before the agent constructs the commit command; a helper-side repeat check remains fail-closed defense in depth.
- No failed permission probe occurs when the host declares `.git` or signer-trust access restrictions.
- No happy-path reference beyond `SKILL.md` is required.

### Concise commit with multiline or nonportable text

- After preparation and evidence interpretation, one `message check` validates, records, and returns the byte-identical canonical message before approval.
- The only agent-authored artifact is the exact fixed `<transaction-directory>/message-input.txt` sibling of `transaction.json`; it is the content being approved and committed, not a worksheet, template, receipt, or description of another artifact. It uses the already allocated UUID transaction and never creates or accepts another temporary location.
- `message check` performs no Git/index mutation, reuses the prepared manifest, and returns a bounded `message-ready` result. Revisions replace only the checked message revision and never repeat staging or evidence acquisition.
- After approval, `workflow commit` consumes the recorded checked bytes with no message argument. The expected happy path is prepare, check, approve, commit.
- A valid one-line subject uses this route when it falls outside the conservative direct-transport predicate, when the user explicitly requests checked-file transport, or when an existing checked transaction is being revised. The helper accepts it in every case; the skill and evaluation budget, not an input rejection, preserve direct transport as the ordinary cheaper default. A multiline message is not routed to extended merely because it has a body. Extended routing remains an evidence decision.
- A checked revision follows the three-level invalidation policy: wording-only changes reuse evidence, new semantic claims acquire only missing support, and a scope/tree change requires fresh preparation.
- Across any number of successful revisions, retain exactly one current canonical message/validation/hash plus `messageRevision`; a failed candidate leaves that state and the editable input intact.

### Bounded-inspection concise commit

- Preparation may return the complete evidence needed to evaluate the user's hint inline, capped at 32 KiB including synopsis and patch text.
- The agent may inspect that one result and author the exact message without a packet queue, receipt, worksheet, or finalizer.
- When required evidence cannot fit, preparation selects `route: "extended"`; it never truncates evidence and falsely labels the route concise.
- If the agent discovers a new named uncertainty after preparation, `workflow extend` reuses the exact snapshot and creates only the required extended evidence state. It never restages or restarts the transaction.

### Extended-review commit

- Packet reads, one semantic worksheet, and `message finalize` are permitted only for evidence or semantic structure that could not be supported by the concise route.
- Every additional packet maps to a named unresolved selection; there is no per-packet acknowledgement command and unchanged coverage is never reread.
- File count alone never selects this route.

### Large-scope behavior

- A coherent 1,000-binary snapshot creates a bounded scope synopsis and zero per-file binary metadata packets; its exact machine manifest remains available on demand.
- A 1,000-file single-domain worksheet stays below 8 KiB and contains no generated 1,000-ID array.
- Cumulative acknowledgement output is zero because there are no per-packet acknowledgement commands.
- Peak patch/deletion streaming buffer remains at or below 16 KiB plus one bounded record.
- The canonical message remains at or below 32 KiB; projected detailed output above that threshold switches to bulk without changing scope.
- A mixed-plan escalation emits only a bounded navigation queue plus newly required packets and never rematerializes unchanged evidence.
- Agent-visible child-process diagnostics stay at or below 32 KiB plus fixed markers/result metadata, while a complete hashed failure log remains available on demand.
- Similarity detection never exceeds the named candidate-pair budget.
- Eager line-stat calculation never exceeds the named eligible-blob input budget.
- At 50 or more remaining workspace paths, the text report emits a compact count and no 49-path prefix.
- Every terminal non-recovery transaction compacts bulky packets, temporary indexes/objects, and successful child logs even when no commit was created.

### Model/evaluation behavior

- Every existing critical safety case remains all-or-nothing passing on the weakest supported model arm.
- The known-context `skills-lock.json` scenario has a median of exactly two helper calls, one opaque transaction-path pass-through, zero agent-managed workflow artifact reads/writes, at least an 80% reported-token reduction from the old-skill arm, and no more than twice the no-skill arm's median reported tokens. Safety and message-quality gates remain independent.
- Median with-skill tool calls on executable happy paths fall by at least 50% from the current skill baseline.
- Median with-skill reported tokens fall by at least 50% from the current treatment baseline, while no critical safety case regresses.
- Report the no-skill control, old-skill baseline, and new-skill treatment separately; do not use an unsafe short control as the sole efficiency target.
- Any threshold miss is reported as a failed acceptance criterion, not hidden behind a safety-first aggregate.

## Target File Structure

### New maintained source

- `src/committing-to-git/transaction/transactionWorkspace.js` - UUIDv4 allocation, derived paths, atomic state transitions, phase journaling, and safe compaction.
- `src/committing-to-git/transaction/indexInstallation.js` - journaled prepared-index installation and observation-only interrupted-state recovery.
- `src/committing-to-git/transaction/transactionRecovery.js` - commit/publish pending-outcome classification without automatic retry.
- `src/committing-to-git/git/gitProcessTranscript.js` - complete hashed child logs with bounded head/tail diagnostic mirroring.
- `src/committing-to-git/workflow/prepareWorkflow.js` - high-level draft/actual preparation orchestration.
- `src/committing-to-git/workflow/resumePreparationWorkflow.js` - exact persisted continuation after observation proves a reversible preparation interruption safe to resume.
- `src/committing-to-git/workflow/extendReviewWorkflow.js` - snapshot-preserving transition from concise evidence into the extended packet/worksheet route when a named uncertainty remains.
- `src/committing-to-git/workflow/checkMessageWorkflow.js` - preapproval exact-text validation, constant-space revision, and transaction-local input cleanup for concise messages without semantic scaffolding.
- `src/committing-to-git/workflow/finalizeMessageWorkflow.js` - receipt validation, semantic coverage, canonical render, and structured approval output.
- `src/committing-to-git/workflow/createCommitWorkflow.js` - precommit verification, signed commit, exact-OID capture, signature policy, comparison, and report.
- `src/committing-to-git/workflow/recoverTransactionWorkflow.js` - sole public observation/recovery dispatcher across canonical-message, index, commit, verification/report, and publication journals.
- `src/committing-to-git/workflow/publishWorkflow.js` - gated exact publication and final report update.
- `src/committing-to-git/workflow/reportDetailWorkflow.js` - bounded, cursor-bound fresh workspace observation without exposing internal page artifacts.
- `src/committing-to-git/workflow/promoteDraftWorkflow.js` - draft-to-actual recreation, signature preflight, exact anchor/tree comparison, and journaled index installation without repeated evidence work.
- `src/committing-to-git/inspection/reviewCatalog.js` - immutable packet catalog and one final receipt.
- `src/committing-to-git/inspection/inlineEvidenceCapsule.js` - bounded synopsis/patch evidence returned directly by concise preparation.
- `src/committing-to-git/inspection/streamingPacketWriter.js` - bounded streaming inventory, patch, and deleted-blob packets.
- `src/committing-to-git/message/changeSelection.js` - deterministic selector expansion and exact coverage checks.
- `src/committing-to-git/message/approvedMessage.js` - exact-text structural validation for direct concise messages before commit mutation.
- `src/committing-to-git/message/canonicalMessageState.js` - shared journaled fixed-slot replacement/recovery for the one current message body, validation, hash, source, and revision consumed by checking, finalization, and commit creation.
- `src/committing-to-git/signature/signaturePreflight.js` - backend/trust-source discovery and first-attempt permission planning.
- `src/committing-to-git/schema/commitTransaction.schema.json` - compact journal/capsule contract.
- `src/committing-to-git/schema/commitScope.schema.json` - canonical literal path/prefix selection contract, including raw-byte exact-path fallbacks.
- `src/committing-to-git/schema/reviewCatalog.schema.json` - immutable packet catalog contract.
- `src/committing-to-git/schema/reviewEvidencePlan.schema.json` - selector-partitioned provenance/evidence-depth contract.
- `src/committing-to-git/schema/reviewPacketQueue.schema.json` - bounded linked navigation for initial and newly required packet evidence.
- `src/committing-to-git/schema/reviewReceipt.schema.json` - hash-bound attestation contract.
- `src/committing-to-git/schema/inlineEvidenceCapsule.schema.json` - concise-route evidence and truncation/fallback contract.

### Modified maintained source

- `src/committing-to-git/cli/commitWorkflow.js` - expose only `workflow prepare`, exceptional `workflow resume`/`workflow extend`, concise `message check`, extended `message finalize`, `workflow promote`, `workflow commit`, `workflow verify`, `workflow recover`, `workflow cleanup`, `workflow report-detail`, and `workflow publish` after the atomic cutover.
- `src/committing-to-git/git/gitRepository.js` - strict flags, streaming child-process support, consolidated preflight, command telemetry hooks, and operation-specific timeout support.
- `src/committing-to-git/snapshot/commitSnapshot.js` - exact-object rename pairing, bounded similarity policy, draft object-store metadata, and reusable facts.
- `src/committing-to-git/inspection/changeInspection.js` - delegate to streaming packets and remove mutable per-unit review state.
- `src/committing-to-git/message/commitMessageRenderer.js` - selector-based coverage, shared rationales, optional file notes, and canonical output.
- `src/committing-to-git/message/commitMessageValidator.js` - validate direct concise approved text or finalized v2 content/receipt against the same subject/section grammar after the cutover.
- `src/committing-to-git/signature/commitSignature.js` - robust unavailable-trust classification and verification-attempt history.
- `src/committing-to-git/report/commitReport.js` - reuse matching manifest facts, count/byte compact boundaries, complete head-anchor identity, scope-aware workspace state, bounded detail paging, and report augmentation after push.
- Existing command modules under `src/committing-to-git/command/` - extract reusable domain functions during implementation, then delete command-only adapters that are unreachable from the final high-level CLI.
- Existing JSON schemas - replace changed contracts with the new canonical versions; do not ship old-attempt readers or schema unions.

### Tests and evaluation artifacts

- Create `tests/committing-to-git/workflow-cost-contract.test.mjs`.
- Create `tests/committing-to-git/transaction-workspace.test.mjs`.
- Create `tests/committing-to-git/index-installation.test.mjs`.
- Create `tests/committing-to-git/transaction-recovery.test.mjs`.
- Create `tests/committing-to-git/git-process-transcript.test.mjs`.
- Create `tests/committing-to-git/review-catalog.test.mjs`.
- Create `tests/committing-to-git/change-selection.test.mjs`.
- Create `tests/committing-to-git/approved-message.test.mjs`.
- Create `tests/committing-to-git/canonical-message-state.test.mjs`.
- Create `tests/committing-to-git/draft-isolation.test.mjs`.
- Modify the existing snapshot, inspection, renderer, validator, signature, report, publication, schema, CLI, and end-to-end test files listed by their current domain.
- Extend `evals/committing-to-git/create-fixture-repository.mjs`, `evals/committing-to-git/evals.json`, and `evals/committing-to-git/README.md`.
- Add versioned results only after real matched runs; never fabricate result files during implementation.

### Public skill and documentation

- Modify `skills/committing-to-git/SKILL.md`.
- Create the three exact exceptional references and modify/delete the five exact existing references listed in Task 10; do not leave aliases or alternate routing.
- Rebuild `skills/committing-to-git/scripts/commitWorkflow.mjs` from maintained source.
- Update `README.md` for the new public high-level command discovery and maintainer-eval location.
- Create `docs/assurance-cases/2026-08-23-committing-to-git-proportional-workflow.md` as the successor that explicitly supersedes the prior assurance case's efficiency conclusions without rewriting historical evidence.

---

## Task 1: Establish Executable Safety and Cost Baselines

**Files:**

- Create: `tests/committing-to-git/workflow-cost-contract.test.mjs`
- Create: `tests/committing-to-git/fixtures/pre-cutover-workflow-cost.json`
- Modify: `tests/committing-to-git/harness.mjs`
- Modify: `tests/committing-to-git/workflow-e2e.test.mjs`
- Modify: `tests/committing-to-git/change-inspection.test.mjs`
- Modify: `evals/committing-to-git/README.md`

**Interfaces:**

- Produce `runRecordedWorkflow(command, args, cwd, options)` returning `{ result, invocation }` without changing existing `runCommitWorkflow()` callers.
- Produce `summarizeWorkflowCost(invocations)` returning `{ helperCalls, gitProcesses, stdoutBytes, stderrBytes, durationMs }`; model-transcript and explicit fixture operations separately record `agentArtifactReads`, `agentArtifactWrites`, `approvalTurns`, the one opaque transaction-path pass-through, and the selected `concise|extended` route.
- Freeze the pre-cutover measurement as data with `schemaVersion`, exact source commit OID, scenario ID, ordered phase names, cost counters, and safety facts. Final tests read this fixture; they never invoke a route Task 10 removes.
- Define named cost budgets in test code, not hidden numeric literals in production.

- [ ] **Step 1: Write the failing recorder contract**

In `workflow-cost-contract.test.mjs`, invoke a harmless existing high-level help/error command through a not-yet-defined `runRecordedWorkflow()` and assert the returned invocation contains exit status, exact stdout/stderr byte counts, nonnegative duration, and zero Git processes when no Trace2 file was requested.

Run: `node --test tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: FAIL because `runRecordedWorkflow()` is not exported.

- [ ] **Step 2: Add the recorder around the existing test harness**

Add the following shape to `tests/committing-to-git/harness.mjs`:

```js
export function runRecordedWorkflow(command, args, cwd, options = {}) {
  const startedAt = performance.now();
  const result = runCommitWorkflow(command, args, cwd, options);

  return {
    result,
    invocation: {
      command,
      args: [...args],
      status: result.status,
      gitProcesses: countTrace2Processes(options.trace2File),
      stdoutBytes: Buffer.byteLength(result.stdout ?? ""),
      stderrBytes: Buffer.byteLength(result.stderr ?? ""),
      durationMs: performance.now() - startedAt,
    },
  };
}

export function summarizeWorkflowCost(invocations) {
  return invocations.reduce(
    (summary, invocation) => ({
      helperCalls: summary.helperCalls + 1,
      gitProcesses: summary.gitProcesses + invocation.gitProcesses,
      stdoutBytes: summary.stdoutBytes + invocation.stdoutBytes,
      stderrBytes: summary.stderrBytes + invocation.stderrBytes,
      durationMs: summary.durationMs + invocation.durationMs,
    }),
    {
      helperCalls: 0,
      gitProcesses: 0,
      stdoutBytes: 0,
      stderrBytes: 0,
      durationMs: 0,
    },
  );
}
```

Keep Git process counting opt-in through `GIT_TRACE2_EVENT` so production code does not collect telemetry.
Implement `countTrace2Processes(trace2File)` in the test harness; return zero when tracing was not requested, and count only child processes whose class is Git rather than every Trace2 event.

- [ ] **Step 3: Run the recorder contract**

Run: `node --test tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: PASS.

- [ ] **Step 4: Execute the pre-cutover known-context inventory scenario once**

Build a fixture whose normal update command changes only `skills-lock.json`, with two unrelated working-tree paths deliberately excluded. Supply the strong hint `Add new agent skills, update existing skill`, then record the current snapshot, inspection, per-unit acknowledgements, scaffold, render, validate, signature-skip, and report commands. Assert the observed baseline by named phase rather than freezing machine-specific duration. This is a semantic/provenance fixture, not the definition of concise eligibility.

```js
test("current known-context inventory workflow exposes its cost baseline", (t) => {
  const result = runCurrentSkillInventoryWorkflow(t, {
    hint: "Add new agent skills, update existing skill",
  });

  assert.ok(result.cost.helperCalls >= 8);
  assert.ok(result.cost.agentArtifactReads >= 1);
  assert.ok(result.cost.agentArtifactWrites >= 1);
  assert.ok(result.cost.stdoutBytes > 0);
  assert.equal(result.safety.treeMatches, true);
  assert.equal(result.safety.messageMatches, true);
});
```

Run it against the exact pre-implementation source commit before any command route changes. Confirm tree/message safety independently of cost before accepting the measurement.

- [ ] **Step 5: Freeze the measured baseline as a provenance-bound fixture**

Write `pre-cutover-workflow-cost.json` from the observed counters, then inspect it as ordinary authored data before committing it. Its exact shape is:

```json
{
  "schemaVersion": 1,
  "sourceCommitOid": "full pre-cutover object ID",
  "scenario": "known-context-skill-inventory-hint",
  "orderedPhases": ["snapshot create", "inspection prepare"],
  "cost": {
    "helperCalls": 8,
    "gitProcesses": 0,
    "stdoutBytes": 1,
    "stderrBytes": 0,
    "agentArtifactReads": 1,
    "agentArtifactWrites": 1,
    "approvalTurns": 1
  },
  "safety": {
    "treeMatches": true,
    "messageMatches": true,
    "signedCreationRequired": true,
    "pushAttempted": false
  }
}
```

The illustrative numbers above are schema examples, not values to copy. Persist only facts produced by the real run. Duration may be recorded as descriptive evidence but is not a deterministic assertion.

- [ ] **Step 6: Write the permanent frozen-baseline test**

Read the fixture, validate every required field, require a full 40- or 64-hex source OID, assert the named safety facts, and assert that the old workflow crossed the measured minimum ceremony boundary. Do not execute old command names from this permanent test.

Construct 1,000 representative old-ledger records in memory and record the current whole-ledger acknowledgement response size as a separate characterization assertion. This assertion describes the old asymptotic behavior; it does not commit a disabled future contract. Task 4 will add its own failing constant-output test immediately before implementation.

- [ ] **Step 7: Run the frozen-baseline tests after simulating removed commands**

In the test fixture only, make `runCommitWorkflow()` return `UNKNOWN_COMMAND` for an old route after the frozen data is loaded. Assert the baseline test still passes because its evidence is data, not a live dependency on the removed interface.

Run: `node --test tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: PASS with zero skipped/TODO tests.

- [ ] **Step 8: Document the deterministic baseline**

Update `evals/committing-to-git/README.md` to distinguish the provenance-bound deterministic baseline from real model-run result files. State that Task 11 will migrate the behavior-case configuration once, after exact approval, and will execute the old-skill arm from the recorded pre-cutover commit rather than keeping removed commands alive.

- [ ] **Step 9: Verify the characterization layer**

Run: `node --test tests/committing-to-git/workflow-cost-contract.test.mjs tests/committing-to-git/workflow-e2e.test.mjs tests/committing-to-git/change-inspection.test.mjs`

Expected: PASS with no skipped/TODO contract and no evaluation-configuration change.

- [ ] **Step 10: Commit the baseline task**

Commit only the test fixture, harness/tests, and evaluation README for this task using the repository's `committing-to-git` workflow. Do not include or modify `evals/committing-to-git/evals.json`.

Proposed subject: `test(committing-to-git): Baseline workflow cost`

## Task 2: Add a Helper-Owned Transaction Workspace and Strict High-Level CLI

**Files:**

- Create: `src/committing-to-git/transaction/transactionWorkspace.js`
- Create: `src/committing-to-git/transaction/indexInstallation.js`
- Create: `src/committing-to-git/workflow/prepareWorkflow.js`
- Create: `src/committing-to-git/workflow/resumePreparationWorkflow.js`
- Create: `src/committing-to-git/schema/commitTransaction.schema.json`
- Create: `src/committing-to-git/schema/commitScope.schema.json`
- Create: `tests/committing-to-git/transaction-workspace.test.mjs`
- Create: `tests/committing-to-git/index-installation.test.mjs`
- Modify: `src/committing-to-git/cli/commitWorkflow.js`
- Modify: `src/committing-to-git/command/snapshotCommand.js`
- Modify: `src/committing-to-git/git/gitRepository.js`
- Modify: `tests/committing-to-git/commit-workflow-cli.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`

**Interfaces:**

Use named input/handle bounds:

```js
export const MAXIMUM_TRANSACTION_PATH_BYTES = 2 * 1024;
export const MAXIMUM_INITIAL_JSON_INPUT_BYTES = 8 * 1024 * 1024;
export const MAXIMUM_BASIS_NOTE_BYTES = 512;
```

Reject a repository temporary root whose resulting absolute `transaction.json` path exceeds the handle bound before creating the attempt. The 2-KiB UTF-8 limit leaves measured worst-case JSON-escaping headroom inside the 80-KiB message-result contract; do not rely on a typical short temp path. Apply the 8-MiB bound to initial external scope/evidence-plan JSON before parsing. These are product budgets with direct boundary tests, not claims about every platform's theoretical path limit.

- `createTransactionWorkspace({ repositoryRoot, temporaryRoot = tmpdir() }) -> TransactionWorkspace`
- `readTransaction(transactionPath) -> CommitTransaction`
- `getMessageInputPath(transactionPath) -> string`
- `getEvidencePlanInputPath(transactionPath) -> string`
- `getMessageContentPath(transactionPath) -> string`
- `advanceTransaction(transactionPath, expectedPhase, nextState) -> CommitTransaction`
- `compactTransaction(transactionPath, { retainReviewArtifacts, retainProcessLogs }) -> CommitTransaction`
- `installPreparedIndex({ root, transactionPath, originalIndexIdentity, preparedIndexPath, preparedIndexIdentity }) -> IndexInstallationResult`
- `recoverIndexInstallation({ root, transactionPath }) -> IndexInstallationRecovery`
- `resumePreparationWorkflow({ transactionPath }) -> PreparationResult`
- CLI: `workflow prepare --mode actual|draft --scope staged|full|paths (--evidence reuse|message|review --basis authored-current-task|read-current-task|task-lineage|user-grounded|generated-derived|unknown-preexisting | --evidence-plan FILE) [--allowed-type TYPE ...] [--path PATH ...] [--path-prefix PREFIX/ ...] [--exclude-path PATH ...] [--exclude-path-prefix PREFIX/ ...] [--scope-file FILE] [--verification required|advisory|skipped] [--format json|text]`
- CLI: `workflow resume --transaction TRANSACTION_JSON [--format json|text]`

`--evidence-plan` is an alternative to the uniform `--evidence`/`--basis` inputs, not an addition to them. It exists only on initial preparation, before a transaction handle is available. Open the caller-supplied plan exactly once with non-following semantics, verify from the opened handle that it is a bounded regular file, reject invalid UTF-8 or schema-invalid bytes, and retain no ownership of the external path. After allocation, write the validated canonical plan into the fixed transaction-local `evidence-plan-input.json`; every later extension derives that fixed path and accepts no arbitrary evidence-plan argument. Uniform preparation records `basis.note: null`; an optional note of at most 512 UTF-8 bytes exists only inside validated plan/worksheet JSON, where free-form prose cannot become a shell argument. A note is descriptive provenance rather than a helper-verifiable truth claim.

`--allowed-type` is repeatable and records an already-loaded repository type policy. Its values must pass the lowercase Conventional Commit type-token grammar, be unique, contain at most 32 ASCII characters each, and number no more than 64. Absence means no explicit allowlist was supplied; it never causes a repository-policy search. Unsupported mandatory structure must already have stopped the agent before this command, while the helper rejects incompatible supplied policy as defense in depth.

Scope-file shape:

```json
{
  "schemaVersion": 2,
  "includePaths": ["Dockerfile"],
  "includePathPrefixes": ["src/parser/"],
  "excludePaths": ["src/parser/generated.lock"],
  "excludePathPrefixes": [],
  "includePathBytesBase64": [],
  "excludePathBytesBase64": []
}
```

Base64 selectors are exact paths only. Prefixes are UTF-8, slash-separated, and slash-terminated. All matches use repository-relative raw bytes and component boundaries; they never use shell globs or Git pathspec magic.

Like the initial evidence plan, `--scope-file` is a one-time external preparation input: open it once with non-following semantics, verify from that handle that it is a bounded regular file, decode/validate from the same handle, retain the normalized selector bytes in the transaction, and never reread, delete, or claim ownership of the caller's path. Hold validated bytes only until allocation succeeds; later recovery/resume consumes persisted normalized scope, not the external file.

The initial transaction schema must contain:

```json
{
  "schemaVersion": 1,
  "phase": "allocated",
  "repositoryRoot": "C:/absolute/repository",
  "attemptDirectory": "C:/absolute/temp/committing-to-git-123e4567-e89b-42d3-a456-426614174000",
  "mode": null,
  "status": null,
  "terminalDisposition": null,
  "scope": null,
  "headAnchor": null,
  "repositoryTypePolicy": {
    "allowedTypes": null
  },
  "initialEvidencePlan": null,
  "route": null,
  "verificationPolicy": "required",
  "signaturePreflight": null,
  "snapshot": null,
  "inlineEvidence": null,
  "review": null,
  "message": null,
  "commit": null,
  "verification": null,
  "report": null,
  "publicationAttempts": []
}
```

After snapshot creation, `headAnchor` has this canonical shape:

```json
{
  "headKind": "attached",
  "targetRef": "refs/heads/main",
  "expectedParentOids": [
    "0123456789abcdef0123456789abcdef01234567"
  ]
}
```

`headKind` is `unborn`, `attached`, or `detached`. `expectedParentOids` is empty only for an unborn branch and contains exactly one full opaque OID otherwise because this skill refuses active merge/rebase/cherry-pick/revert operations. `targetRef` is a full symbolic branch ref for unborn or attached `HEAD` and `null` for detached `HEAD`. Commit, recovery, report, and promotion code consume this one shape rather than inventing singular parent/ref fields. The schema enumerates every phase, status family, and `terminalDisposition` defined by the transaction state machine and rejects unknown members.

- [ ] **Step 1: Write allocation and path-containment tests**

Cover:

- CSPRNG UUIDv4 naming with the exact `committing-to-git-` prefix;
- one direct non-recursive creation attempt;
- owner-only directory/file modes where the platform supports POSIX permissions, with Windows ACL behavior documented rather than falsely asserted from mode bits;
- `EEXIST` retry with a new UUID and stop on every other error;
- no precheck, registry, ownership, heartbeat, or handover file;
- the 2-KiB transaction-handle boundary and one-byte-over rejection before directory creation;
- every derived artifact path resolving inside the exact attempt directory, including fixed `message-input.txt`, `evidence-plan-input.json`, and `content.json` paths without allocating another directory or UUID;
- schema-valid `unborn`, `attached`, and `detached` head anchors, every canonical phase/status/disposition combination, and rejection of impossible combinations; and
- rejection of a transaction whose recorded repository or attempt path has been replaced.

```js
test("transaction workspace owns one UUIDv4 attempt without discovery machinery", () => {
  const workspace = createTransactionWorkspace({
    repositoryRoot: fixture.repo,
    temporaryRoot: fixture.scratch,
  });

  assert.match(
    basename(workspace.attemptDirectory),
    /^committing-to-git-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.deepEqual(readdirSync(workspace.attemptDirectory), ["transaction.json"]);
});
```

Run: `node --test tests/committing-to-git/transaction-workspace.test.mjs`

Expected: FAIL because the transaction module does not exist.

- [ ] **Step 2: Implement exclusive allocation and atomic state transitions**

Use `randomUUID()`, one exclusive non-recursive `mkdirSync(attemptDirectory, { mode: 0o700 })`, and owner-only `0o600` write-to-new-temp-plus-rename inside the same attempt directory where POSIX modes apply. Flush the candidate file before replacement and the containing directory afterward where supported. On Windows, rely on the user's protected temp directory plus containment/reparse checks, document that POSIX mode bits do not establish an ACL guarantee, and use a bounded retry only for the documented sharing/antivirus rename errors; never delete the current valid transaction first to make replacement succeed. A failed replacement leaves the prior state authoritative and a contained cleanup candidate. `advanceTransaction()` must compare the persisted phase before replacing state and must reject skipped or repeated irreversible transitions.

Do not create a global "latest attempt" pointer. The CLI returns the absolute `transaction.json` path once; subsequent commands accept that one path.

Define an index identity as either `{ "state": "absent" }` or `{ "state": "file", "byteCount": N, "sha256": "...", "fileIdentity": { ... } }`. Capture a file identity by opening with non-following semantics, checking regular-file status, hashing bytes from that handle, and proving the before/after handle/path identity stayed stable; platform file-ID fields strengthen race detection but never replace the byte hash. This makes an initially absent index, a byte-identical replacement, and a third state explicit.

For actual `full`/`paths` staging, build the intended index in the attempt directory from a stable copy of the real index, preserving repository index extensions/flags through Git rather than synthesizing entries. Validate the exact scope, manifest, evidence plan, head anchor, and supplied repository type policy before installing the real index. Before installation, persist and flush a journal containing the original real-index identity, prepared-index identity/tree, complete `headAnchor`, and `status: "pending"`. Acquire the normal real-index lock once, recheck the original identity, install the exact prepared bytes atomically, then record `status: "installed"`. Never reconstruct, unstage, or restore the user's index automatically.

If interruption leaves the journal pending, observe before retry: current real-index identity equal to the original means `not-installed`; equality with the prepared identity means `matching-index-observed` and preparation may continue; any third identity means `ambiguous` and stops. A stale/live `index.lock` fails before installation. Actual `staged` scope performs a stable-read check but no install. Return exit `1` with `recoveryRequired: true` for an interrupted/ambiguous install, never exit `4`, because index state is locally observable and no commit or remote mutation occurred.

After `workflow recover` classifies a reversible preparation interruption as `not-installed` or `matching-index-observed`, it returns `resumeAllowed: true`; only `workflow resume --transaction ...` may continue that exact persisted preparation. Resume accepts no scope, evidence, type-policy, or verification overrides, repeats current head/index/operation preconditions, and continues from the last durable phase without recreating the snapshot. It never resumes `stopped`, `abandoned`, `superseded`, `commit-pending`, or `publication-pending` transactions and never replays commit or push. This explicit route closes the recovery loop without asking the agent to reconstruct the original command.

- [ ] **Step 3: Refactor low-level snapshot command code into callable functions**

Move parsing-free functions out of `snapshotCommand.js` into the snapshot domain so the high-level workflow never invokes its own CLI recursively. The old command adapter may remain only as local scaffolding until Task 10 deletes the low-level route:

```js
export function createSnapshot({ root, mode, scope, scopePaths, outputPath }) {
  // Existing exact staging and manifest behavior.
}
```

Do not change snapshot semantics in this step. This step only lets `workflow prepare` call the implementation without launching the bundled CLI recursively.

- [ ] **Step 4: Add strict high-level argument and policy parsing**

Reject unknown flags, duplicate singleton flags, a missing/unknown uniform evidence policy or basis, simultaneous uniform evidence and `--evidence-plan`, any removed `--basis-note` argument, duplicate or invalid `--allowed-type` values, selector flags outside path scope, simultaneous inline selectors and `--scope-file`, missing inclusion data, empty strings, non-slash-terminated prefixes, duplicate byte-identical selectors, and an exclusion not contained by at least one inclusion before allocating an attempt or invoking Git. Securely open and validate an initial mixed evidence plan exactly once as specified above. Then perform read-only candidate discovery and, still before attempt allocation or staging, reject every include or exclude selector that matches no current change. Diagnostics may show at most five raw-byte-ordered changed paths sharing the longest path-component prefix, but must never fuzzy-match or autocorrect the selector. Each sample uses the same bounded safe prefix/suffix/raw-byte-length/hash convention as later report paths, so a hostile long/non-UTF-8 name cannot overflow or inject into a pre-allocation error. The four selector flags are repeatable. Exact paths never implicitly mean directories; prefixes are explicit. No glob, negation, locale normalization, or implicit pathspec magic is accepted. Exclusion wins only after passing the containment check, and the normalized selector set is recorded in the manifest.

Before repository discovery, reject inherited redirection variables that would make the apparent workspace and mutated Git storage disagree: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_QUARANTINE_PATH`, and `GIT_NAMESPACE`. Return `UNSUPPORTED_GIT_STORAGE_OVERRIDE` naming only the variable, not its possibly sensitive value. Do not silently clear an intentional user environment and then act on a different repository. Helper-created draft/preparation children receive their controlled overrides only after this preflight and only for the documented operation.

For `--mode actual --scope paths`, reject any pre-existing staged change before attempt allocation or staging, including a selected path that is only partly staged. Return the exact staged change-unit count plus a bounded synopsis and require the user/agent to resolve it; never stash, unstage, restore, or reconstruct the index. For `--mode draft --scope paths`, apply the disjoint/overlap rule in Task 3 instead. Default verification to `required`; record an explicit user override without arguing against it. Draft preparation records the intended later policy but performs no signature work.

Before implementing the high-level shell, add failure-injection tests before lock acquisition, after the pending journal, after index replacement, and before installed-state persistence. Assert absent/file/byte-identical/third index identity classifications, no automatic rollback, no duplicate install after `matching-index-observed`, and preservation of split/sparse/index flags in supported fixtures. Add policy-order tests proving that unsupported message structure, invalid allowed types, malformed evidence input, unmatched selectors, and every inherited Git storage-redirection variable fail before attempt allocation or real-index installation without echoing sensitive values.

- [ ] **Step 5: Implement the initial `workflow prepare` shell**

It must:

1. Resolve repository root and validate all no-Git inputs, including the secure one-open read of an optional initial evidence plan.
2. Perform bounded read-only candidate discovery and reject unmatched scope selectors.
3. Allocate the transaction and persist the fixed canonical evidence-plan input when present.
4. Record normalized scope paths, supplied type policy, verification policy, and the complete head anchor internally.
5. Build the snapshot/prepared index without installing it into the real index.
6. Validate the exact manifest-bound evidence partition and every remaining pre-mutation invariant.
7. Install the prepared real index only for applicable actual scope, then advance to `snapshot-created`.
8. Return the uniform bounded result envelope containing `status`, `phase`, `terminalDisposition: null`, `transaction`, `route: null`, `commitState: "absent"`, `publicationState: "not-requested"`, `publicationAllowed: false`, `recoveryRequired`, `mode`, bounded `scope`, `initialEvidencePlanSha256`, `headAnchor`, `indexTreeOid`, and `changeUnitCount`. The result's `scope` contains only scope kind, selector count/kind totals, canonical selector digest, and bounded samples; it never embeds the full external selector file or expanded O(F) path list. The transaction/manifest retain the exhaustive normalized facts. Task 4 replaces `route: null` with the final concise/extended evidence decision before the public cutover.

For path scope, expand inclusions and exclusions through the temporary/preparation index, then prove every resulting change unit matches an inclusion and no resulting endpoint selected for commit matches an exclusion. Add fixtures for a directory inclusion with two exclusions, unmatched inclusion, unmatched exclusion/typo, deleted excluded paths, rename endpoints crossing an exclusion boundary, hostile path bytes through `--scope-file`, actual scope with a pre-existing staged change, draft scope with disjoint staged work, and draft scope overlapping staged work. A rename crossing the boundary is an ambiguity error unless both endpoints are included or both are excluded. Copy detection is not part of scope semantics; source selectors, when later used for semantic grouping, apply only to manifest units Git classifies as renames.

The later tasks add review packets and content scaffolding to the same command and teach `workflow resume` to finish only missing deterministic evidence derivatives from the persisted `snapshot-created` anchor.

- [ ] **Step 6: Consolidate operation-marker lookup**

Resolve the Git directory and marker paths once per preflight. Add a Trace2-backed test that an ordinary preflight does not spawn one `rev-parse --git-path` process per marker.

- [ ] **Step 7: Run focused tests**

Run: `node --test tests/committing-to-git/transaction-workspace.test.mjs tests/committing-to-git/index-installation.test.mjs tests/committing-to-git/commit-workflow-cli.test.mjs tests/committing-to-git/commit-snapshot.test.mjs tests/committing-to-git/artifact-schemas.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit the transaction-workspace task**

Proposed subject: `refactor(committing-to-git): Centralize transaction setup`

## Task 3: Bound Snapshot Cost and Make Draft Snapshots Repository-Read-Only

**Files:**

- Create: `tests/committing-to-git/draft-isolation.test.mjs`
- Modify: `src/committing-to-git/git/gitRepository.js`
- Modify: `src/committing-to-git/snapshot/commitSnapshot.js`
- Modify: `src/committing-to-git/command/snapshotCommand.js`
- Modify: `src/committing-to-git/workflow/prepareWorkflow.js`
- Modify: `src/committing-to-git/schema/commitSnapshot.schema.json`
- Modify: `tests/committing-to-git/commit-snapshot.test.mjs`
- Modify: `tests/committing-to-git/change-inspection.test.mjs`

**Interfaces:**

- `assertReadOnlyGitCapabilities() -> { gitVersion, noLazyFetch: true }` performs a side-effect-free capability probe and rejects before transaction allocation when the installed Git cannot enforce no-lazy-fetch behavior.
- `runReadOnlyGit(root, operation, args, options) -> GitResult` always injects `GIT_OPTIONAL_LOCKS=0` and `GIT_NO_LAZY_FETCH=1`; `operation` is a closed internal enum whose operation-specific argument builder rejects mutation-capable subcommands/options. Callers cannot assert safety with a free-form `readOnly: true` boolean.
- `createDraftObjectEnvironment({ root, attemptDirectory }) -> { env, indexPath, objectDirectory, alternates }`
- `selectRenamePolicy({ addedCandidates, deletedCandidates, maximumCandidatePairs }) -> { mode, candidatePairs }`
- `pairExactObjectRenames(changeUnits) -> changeUnits`
- `selectLineStatisticsPolicy({ eligibleBlobBytes, maximumEagerBytes }) -> { mode, eligibleBlobBytes }`
- Snapshot `diffPolicy` records rename and line-stat policies, their named budgets, measured inputs, and whether either optional presentation calculation was deferred.

Use a named initial budget:

```js
export const MAXIMUM_SIMILARITY_CANDIDATE_PAIRS = 40_000;
export const MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES = 64 * 1024 * 1024;
```

These are provisional product budgets, not universal Git constants. Benchmark them on supported CI/developer platforms and change them only with test/evaluation evidence.

- [ ] **Step 1: Write failing draft-isolation and head-shape integration tests**

Record the real index bytes plus the recursive object/ref/log/lock metadata fingerprint, run draft staged, full, and paths, and assert all three leave real repository metadata byte-for-byte unchanged while the attempt-local object directory gains any tree/blob objects needed for the draft. Trace every draft Git child that touches the real repository and assert `GIT_OPTIONAL_LOCKS=0`; a read-only draft must not create an index lock, opportunistic maintenance lock, reflog entry, ref update, or object beneath the real object directory. Add representative actual-preflight, inspection, verification, recovery-observation, and report calls through `runReadOnlyGit()` and assert the same optional-lock environment without weakening separately classified mutation commands.

Before those repository fixtures, add a capability boundary proving that Git 2.45+ accepts the no-lazy-fetch probe and a controlled older/unsupported launcher returns `UNSUPPORTED_GIT_VERSION` before repository discovery, attempt allocation, network access, or mutation. Do not parse a vendor version string as the sole proof; execute a harmless `git --no-lazy-fetch --version`-equivalent capability probe and retain the observed version only for diagnostics.

Add a path-draft fixture with disjoint unrelated staged work and another with a selected path that is partially staged. The disjoint draft succeeds and records the unrelated real-index digest/summary; the overlapping draft fails before attempt mutation with `DRAFT_SCOPE_OVERLAPS_STAGED`.

Add attached-branch, detached-`HEAD`, and unborn-branch fixtures. Assert the exact `headAnchor` shape: one expected parent plus a full target ref when attached, one expected parent plus `targetRef: null` when detached, and zero expected parents plus the unborn symbolic target ref when unborn. Reject active multi-parent operations before snapshot creation rather than encoding them as an ordinary head anchor.

```js
test("draft full writes its index and new objects only inside the attempt", (t) => {
  const before = repositoryMetadataFingerprint(fixture.repo);
  const result = prepareDraftFull(fixture);
  const after = repositoryMetadataFingerprint(fixture.repo);

  assert.deepEqual(after.indexBytes, before.indexBytes);
  assert.deepEqual(after.objectPaths, before.objectPaths);
  assert.ok(result.transaction.snapshot.indexTreeOid);
  assert.ok(result.transaction.snapshot.temporaryObjectDirectory);
});
```

Run: `node --test tests/committing-to-git/draft-isolation.test.mjs`

Expected: FAIL because drafts currently write objects to the real repository.

- [ ] **Step 2: Implement attempt-local index/object storage for every draft scope**

Create `ATTEMPT_DIRECTORY/draft-objects` and set:

```js
{
  GIT_INDEX_FILE: join(attemptDirectory, "draft-index"),
  GIT_OBJECT_DIRECTORY: join(attemptDirectory, "draft-objects"),
  GIT_ALTERNATE_OBJECT_DIRECTORIES: formatGitAlternatePaths(realObjectDirectories),
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_LAZY_FETCH: "1",
}
```

Resolve the primary/common object directory through Git rather than assuming `REPOSITORY_ROOT/.git/objects`. Preserve any pre-existing alternates and use `;` on Windows and `:` elsewhere with Git's C-style quoting for separator-containing paths. Route every read-only Git process in preparation, inspection, verification, recovery observation, and reporting through `runReadOnlyGit()` so Git cannot take optional maintenance/index locks or trigger a partial-clone lazy fetch merely because the repository is readable. Centralize closed argument builders for status/diff/cat-file/config/ref/object observation and reject an operation/argument mismatch before spawning; do not let a caller label arbitrary argv read-only. Machine-readable and patch diff builders force `--no-ext-diff`, `--no-textconv`, no pager/color, and the task-specific rename policy so configured external diff/textconv drivers cannot execute or redefine reviewed bytes. Repository status/object observation disables configured filesystem-monitor hooks for that child (`-c core.fsmonitor=false`) and relies on direct filesystem/index facts instead. A missing promisor object is recorded by full OID as `required-object-unavailable` and selects the extended exception path; the workflow does not silently make a network request or write fetched objects. Any later exact fetch is a separately authorized repository/network action outside the commit helper. Afterward, recheck the head/index/tree anchor: if unchanged, resume only the missing evidence derivative; if changed, start a fresh preparation. Mutation-capable commands (`read-tree`/`update-index` against a prepared index, real-index installation, `write-tree` when it writes real objects, commit, and push) remain explicitly classified and never inherit a misleading read-only label.

Run the capability probe once per helper process before the first repository command and cache only that positive in-process result. Never fall back to setting an environment variable an older Git ignores: failure means the transaction does not begin.

Add negative wrapper tests for `commit`, `push`, `fetch`, `update-ref`, mutation-capable `update-index`/`read-tree`, aliases, external `git-*` commands, and a read-only subcommand paired with a mutating or output-file option. Add configured `diff.external`, textconv, pager/color, and filesystem-monitor sentinels and prove none executes on read-only preparation/inspection/report paths. The allowlist is based on exact invoked semantics, not merely the first argv token.

- [ ] **Step 3: Make staged drafts read-only**

For draft staged scope, copy the real index to the attempt-local index after a stable-read check, then invoke `write-tree` with both `GIT_INDEX_FILE` and the attempt-local object environment. Re-read the real index identity after the copy and abort cheaply if it changed. Record the exact draft tree OID plus the source index digest. This prevents the observed real-index lock attempt while giving every draft the same tree-level approval anchor.

Do not weaken actual staged scope; actual commits still anchor the real staged index tree. Tests that formerly prohibited every staged-draft `write-tree` call must instead prohibit `write-tree` against the real index or real object directory.

For draft path scope, compare selected source/destination paths and prefixes against staged change endpoints. Permit disjoint staged work because the attempt-local draft cannot alter it; record its digest and compact summary as an explicit promotion blocker. Reject any overlap, including partial staging of one selected path. Promotion to actual path scope remains unavailable while any real staged change exists, exactly as settled for actual transactions.

- [ ] **Step 4: Add linear exact-object rename pairing without copy inference**

Run the initial raw comparison with renames and copies disabled. Pair a deleted and added path only when a full-object-ID-and-mode bucket contains exactly one of each. Leave one-to-many, many-to-one, and many-to-many identical-object buckets as adds/deletes and mark them `exact-rename-ambiguous`; ordinal ordering must never invent provenance. Do not create a `copy-classified` kind: a source path exists only on a uniquely paired or Git-classified rename, while apparent copies remain additions because content identity does not establish provenance.

- [ ] **Step 5: Cap similarity detection**

If `addedCandidates * deletedCandidates <= MAXIMUM_SIMILARITY_CANDIDATE_PAIRS`, rerun the normalized comparison with rename-only similarity detection and copies disabled. Otherwise retain exact pairs plus adds/deletes and add a manifest warning that similarity presentation was skipped. Scope/tree correctness must not depend on the label.

Compare the pair budget without an overflowing JavaScript multiplication (for example, divide the limit before comparing). Add boundary tests at 40,000 and 40,001 candidate pairs plus values near `Number.MAX_SAFE_INTEGER`, without creating that many files, by testing `selectRenamePolicy()` directly.

- [ ] **Step 6: Defer disproportionate line statistics**

Build exact change units from `--raw -z` first. Query old/new object type and size through one `git cat-file --batch-check` stream. Run a single `--numstat` pass only when the sum of eligible old/new blob bytes is at or below `MAXIMUM_EAGER_LINE_STAT_INPUT_BYTES`; otherwise mark line statistics `deferred` per unit. A later selected patch stream may populate that unit's counts without triggering an unrelated full-scope pass.

Accumulate and compare object sizes with `BigInt` or a saturating threshold calculation so an oversized/corrupt decimal size cannot wrap or lose precision and accidentally enable the eager pass. Serialize values above JSON's safe integer range as canonical decimal strings. Add direct budget-boundary, beyond-safe-integer, malformed-size, and integration tests for a large generated text file. The exact tree, path, kind, object IDs, and modes must remain available when counts are deferred.

- [ ] **Step 7: Stop repeating similarity and line-stat work**

Inspection must consume manifest classification and use `--no-renames` when selecting path patches. Reports must consume manifest kinds and available statistics when the commit tree matches. A matching report may disclose deferred totals but must not launch a decorative full diff. Only a mismatch report may compute actual classifications again.

- [ ] **Step 8: Verify draft and snapshot behavior**

Run: `node --test tests/committing-to-git/draft-isolation.test.mjs tests/committing-to-git/commit-snapshot.test.mjs tests/committing-to-git/change-inspection.test.mjs`

Expected: PASS, including hostile-path, staged-rename, special-change, attached/detached/unborn head anchors, draft-metadata-isolation with optional locks disabled, rename-ambiguity, no-copy-inference, and line-stat-budget checks.

- [ ] **Step 9: Commit the bounded-snapshot task**

Proposed subject: `perf(committing-to-git): Bound snapshot preparation cost`

## Task 4: Replace Mutable Acknowledgements with Streaming Review Packets

**Files:**

- Create: `src/committing-to-git/inspection/inlineEvidenceCapsule.js`
- Create: `src/committing-to-git/inspection/reviewCatalog.js`
- Create: `src/committing-to-git/inspection/streamingPacketWriter.js`
- Create: `src/committing-to-git/workflow/extendReviewWorkflow.js`
- Create: `src/committing-to-git/schema/inlineEvidenceCapsule.schema.json`
- Create: `src/committing-to-git/schema/reviewCatalog.schema.json`
- Create: `src/committing-to-git/schema/reviewEvidencePlan.schema.json`
- Create: `src/committing-to-git/schema/reviewPacketQueue.schema.json`
- Create: `src/committing-to-git/schema/reviewReceipt.schema.json`
- Create: `tests/committing-to-git/review-catalog.test.mjs`
- Modify: `src/committing-to-git/schema/commitTransaction.schema.json`
- Modify: `src/committing-to-git/git/gitRepository.js`
- Modify: `src/committing-to-git/inspection/changeInspection.js`
- Modify: `src/committing-to-git/cli/commitWorkflow.js`
- Modify: `src/committing-to-git/command/inspectionCommand.js`
- Modify: `src/committing-to-git/workflow/prepareWorkflow.js`
- Modify: `tests/committing-to-git/change-inspection.test.mjs`
- Modify: `tests/committing-to-git/commit-workflow-cli.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`
- Modify: `tests/committing-to-git/workflow-cost-contract.test.mjs`

**Interfaces:**

- `streamGit(operation, args, options) -> Promise<GitStreamResult>` with bounded callbacks; read-only operations reuse the closed Task 3 operation/argv validation and alone may receive the optional read timeout, while mutation children use their separately journaled launchers.
- `createInlineEvidenceCapsule({ manifest, evidencePlan, maximumResultBytes = MAXIMUM_CONCISE_RESULT_BYTES }) -> { route, capsule, extendedReason }`
- `canonicalizeEvidencePlan({ manifest, groups }) -> ReviewEvidencePlan`
- `createReviewCatalog({ manifest, outputDirectory, evidencePlan }) -> ReviewCatalog`
- `reviseReviewCatalog({ manifest, priorCatalog, evidencePlan }) -> { catalog, evidenceDelta }`
- `writeReviewPacketQueue({ catalog, packetIds, queueKind, outputDirectory, maximumPageBytes = 16 * 1024 }) -> ReviewPacketQueue`
- `materializeInventoryPackets({ manifest, catalog, selection }) -> ReviewCatalog`
- `materializePatchPackets({ manifest, catalog, selection }) -> ReviewCatalog`
- `materializeDeletionPackets({ manifest, catalog, changeUnitId }) -> ReviewCatalog`
- `verifyReviewReceipt({ catalogPath, receipt }) -> ReviewCoverage`
- `extendReviewWorkflow({ transactionPath, reason }) -> ExtendedReviewResult`
- CLI: `workflow extend --transaction TRANSACTION_JSON --reason evidence-uncertainty|semantic-structure-required [--format json|text]`

Use one exported result budget:

```js
export const MAXIMUM_CONCISE_RESULT_BYTES = 32 * 1024;
```

Concise capsule shape:

```json
{
  "schemaVersion": 1,
  "manifestSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "evidencePlanSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "changeUnitCount": 12,
  "scopeSynopsis": "12 change units across one coherent parser domain; no unexplained anomalies",
  "evidence": [
    {
      "policy": "message",
      "selectionSummary": "src/parser/ (12 change units)",
      "basisKind": "user-grounded",
      "basisNote": "The user identified the warning this parser change prevents",
      "patchText": "diff --git ...",
      "patchComplete": true
    }
  ],
  "unresolved": [],
  "byteCount": 8192
}
```

`byteCount` measures the complete default JSON result after embedding the capsule, not merely patch text. `route: "concise"` is valid only when that complete result is no more than 32 KiB, every `message` group's required patch is present without truncation, and every embedded text field is strict valid UTF-8. Never decode arbitrary bytes with replacement characters and then claim `patchComplete: true`; required evidence containing invalid UTF-8 selects the extended route with `extendedReason: "invalid-evidence-encoding"` and preserves exact byte/hash facts in the packet catalog. A `reuse` group needs no patch when its basis and synopsis expose no unexplained anomaly. `review`, an over-budget required patch or synopsis, invalid inline encoding, or any unresolved mandatory inventory fact selects `route: "extended"` and returns a bounded queue summary instead of a partial capsule. The helper decides only deterministic coverage, encoding, and size; the agent remains responsible for whether the supplied basis is truthful and whether the evidence supports the message.

Evidence-plan shape:

```json
{
  "schemaVersion": 1,
  "manifestSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "groups": [
    {
      "selection": { "all": true },
      "policy": "message",
      "basis": {
        "kind": "user-grounded",
        "note": "The user identified the warning this change prevents"
      }
    }
  ],
  "evidencePlanSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
}
```

The canonicalizer resolves the selectors against the exact manifest, requires a non-overlapping exhaustive partition, rejects every selector field that matches no unit, preserves authored group order, assigns catalog-local `E...` IDs, and hashes the canonical selector/policy/basis representation with the digest member omitted. A uniform `workflow prepare` constructs one all-scope group from `--evidence` and `--basis` with a null note. When mixed provenance is known before preparation, the initial one-open evidence-plan input supplies the partition immediately. A later named uncertainty uses `--reason evidence-uncertainty` and is expressed only through fixed transaction-local `evidence-plan-input.json`; `workflow extend` derives that path, consumes it after durable success, preserves it after failure, and accepts no caller-selected plan path. A request to include counted bulk domains despite already sufficient concise evidence uses `--reason semantic-structure-required`, forbids a new plan input, and carries forward the current evidence-plan/capsule identities without rereading them.

Catalog shape:

```json
{
  "schemaVersion": 1,
  "indexTreeOid": "0123456789abcdef0123456789abcdef01234567",
  "manifestSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "evidencePlanSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "evidenceGroups": [
    {
      "id": "E000001",
      "policy": "message",
      "changeUnitRanges": [
        { "first": "F000001", "last": "F001000" }
      ],
      "changeUnitCount": 1000
    }
  ],
  "packets": [
    {
      "id": "S000001",
      "kind": "scope-synopsis",
      "artifact": "packets/S000001.md",
      "byteCount": 8120,
      "lineCount": 96,
      "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "changeUnitRanges": [
        { "first": "F000001", "last": "F001000" }
      ],
      "changeUnitCount": 1000
    }
  ],
  "requiredSynopsisPacketIds": ["S000001"],
  "exactInventoryPacketIds": [],
  "fullPatchPacketIds": [],
  "catalogSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
}
```

Receipt shape, stored as the `review` member of `content.json` and validated through `reviewReceipt.schema.json`:

```json
{
  "schemaVersion": 1,
  "catalogSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "evidencePlanSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "requiredPacketsReviewed": true,
  "additionalPacketIds": []
}
```

Define `catalogSha256` as SHA-256 over the canonical catalog payload with the `catalogSha256` member omitted. `changeUnitRanges` use inclusive manifest ordinal ranges; they compress machine coverage but do not imply that every covered path was displayed. The finalizer expands and verifies them against the manifest. The receipt does not repeat evidence-group IDs: matching catalog and evidence-plan digests already bind that partition, and another authored list would be redundant ceremony.

Every nonempty extended-route initial required packet set and later evidence delta receives an immutable review-packet queue. The queue summary contains its kind (`initial` or `delta`), relevant catalog digests, required packet count, and first page path/digest. Each page is at most 16 KiB, lists raw-byte-ordered packet paths with expected hashes, and contains the next page path/digest or `null`. `workflow prepare` returns only the initial summary/first page when it selects `route: "extended"`; evidence-uncertainty extension produces the same state from an unchanged concise snapshot. A semantic-structure-only extension carries forward the already displayed capsule as covered evidence, creates the structured worksheet/catalog with zero required new packets, and returns no empty/dummy queue. Neither command makes the agent read the O(P) machine catalog for navigation. A delta queue never repeats packets already covered by the prior receipt. Following queue pages is deliberate evidence reading, not acknowledgement. A plan revision that requires no new packet produces no delta queue and carries forward prior hash coverage in the same finalization call. Packet records distinguish exact raw-byte identity from human rendering: valid UTF-8 text may render directly, while invalid UTF-8 evidence records byte offsets, byte length, and digest and uses a lossless escaped/hex view rather than replacement decoding.

An unresolved delta is not reviewed coverage. If the worksheet changes again before its receipt is updated, derive the next requirements from the most recent valid receipt, reuse already materialized packet bytes by exact identity where useful, mark the obsolete queue revision superseded, and return only the currently required delta. Never require the agent to read a queue for a plan it abandoned.

Do not implement catalog revision as a full copy of every unchanged packet descriptor. Store one immutable base packet index, content-addressed packet bytes, and compact revision records containing prior/base digests, canonical evidence-plan/requirement ranges, newly added packet descriptors, and carried-forward covered hashes. Atomically point the transaction at one current revision. Once a newer revision/receipt is durable and no unresolved queue references its predecessor, compact superseded revision metadata/queues while retaining shared packet bytes still referenced by the current catalog. A 100-revision test over 1,000 unchanged packets must remain O(P + R + new-packet deltas), not O(P * R), and finalization must not walk abandoned queue pages.

- [ ] **Step 1: Write failing route-selection and concise-capsule tests**

Cover first:

- known-context `reuse` fixtures with 1, 12, and 1,000 coherent change units select `route: "concise"` without creating packet, receipt, or worksheet artifacts;
- a `message` fixture whose complete synopsis/patch result fits 32 KiB returns that evidence inline with `patchComplete: true`;
- exact 32-KiB and one-byte-over result boundaries select concise and extended respectively, with no truncated patch labeled complete;
- a required patch that is not valid UTF-8 selects extended with `invalid-evidence-encoding`, preserves exact bytes/hash through the extended catalog, and never exposes replacement-decoded text as complete;
- an unusually long bulk synopsis that alone exceeds the concise budget selects extended with `scope-synopsis-over-budget` even when all evidence groups are otherwise reusable;
- one unknown pre-existing text file and an explicit review request select extended regardless of file count;
- evidence-uncertainty `workflow extend` reuses the exact transaction/snapshot/tree, securely consumes its fixed plan, and creates only the missing extended review state without staging or running snapshot preparation again;
- semantic-structure-only `workflow extend` reuses the same plan/capsule, creates the structured worksheet with zero new packets/queue reads, and rejects a stray evidence-plan input;
- 1,000 coherent binary changes produce a bounded synopsis, an on-demand exact manifest, and no binary metadata packets.

For every concise fixture, assert one opaque transaction handle, zero agent-managed workflow artifact reads/writes, and an embedded bounded capsule. For every extended fixture, assert one of the closed deterministic reasons: `review-policy`, `required-evidence-over-budget`, `scope-synopsis-over-budget`, `invalid-evidence-encoding`, `required-object-unavailable`, `unresolved-anomaly`, or `semantic-structure-required`. No result may imply that file count caused the route.

Add the failing assertions directly to the active Task 1 constant-output contract and run them once to observe the intended failure before implementation. Do not disable, skip, or temporarily mark the target behavior as TODO.

Run: `node --test tests/committing-to-git/review-catalog.test.mjs tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: FAIL because the catalog and receipt interfaces do not exist.

- [ ] **Step 2: Write failing catalog, queue, and receipt tests**

Split catalog/receipt behavior into focused tests for immutable identity, selector partitioning, queue pagination, evidence-plan revision/delta reuse, deletion expansion, and final receipt coverage. Cover:

- packet hashes and the catalog digest detect modification;
- one embedded final receipt covers the catalog's mandatory packet set without copying that set or the evidence-group ID set into authored content;
- a mixed 1,000-unit manifest assigns coherent selector groups to `reuse`, `message`, and `review` without per-file policy IDs while covering every unit exactly once;
- `user-grounded` and `unknown-preexisting` bases are rejected under `reuse`, while authored/read/generated/specific `task-lineage` bases are accepted and remain subject to anomaly escalation;
- refining one mixed group from `message` to `review` materializes only that group's missing patches, creates 16 KiB-or-smaller queue pages, and carries every unchanged covered hash forward;
- downgrading or repartitioning without additional evidence creates no queue and needs no repeated synopsis read;
- revising a plan while a prior delta remains unread supersedes that queue without treating it as reviewed or requiring it to be read;
- 100 plan revisions over 1,000 unchanged packet descriptors use one base index plus compact revisions/deltas and never copy the full packet array per revision;
- missing required synopsis packets and unknown packet IDs fail finalization;
- no command rewrites the catalog per reviewed packet or emits the full catalog after review; and
- cumulative helper envelope output for 1,000 packets stays below 8 KiB, excluding packet contents the agent deliberately reads.

Run each focused file after adding its first failing case so one giant failure batch cannot hide which contract is absent.

Run: `node --test tests/committing-to-git/review-catalog.test.mjs`

Expected: FAIL on the first unimplemented catalog/queue/receipt interface.

- [ ] **Step 3: Convert the CLI shell to one awaited asynchronous dispatcher**

Before adding streaming Git, make the CLI entry point await one promise-returning high-level dispatcher. Thread an `AbortSignal` only into explicitly timeout-bounded read-only operations; an abort must close child streams, wait for termination, and return one uniform result rather than allowing an unhandled rejection or a second stdout write. Centralize `--format json|text` parsing for every high-level command. Tests cover awaited success, synchronous validation failure, rejected async work, read-only cancellation, stderr diagnostics, and exactly one JSON or text output value.

- [ ] **Step 4: Implement streaming child-process output**

Use `spawn()` rather than `spawnSync()` for patch/blob streams. The writer must:

- update SHA-256 incrementally;
- count total bytes and newlines;
- preserve UTF-8 boundaries where possible;
- cap the complete packet, including repeated context metadata, at 200 lines and 16 KiB;
- mark a continued long line with byte offsets;
- include a bounded reversible current change-unit/path identity and a bounded hunk-context prefix/suffix/length/hash at the start of every continuation packet; never repeat an unbounded path or hunk header inside every chunk; and
- atomically publish each packet only after its final hash/counts are known.

Decode directly rendered text only with a fatal UTF-8 decoder. If exact evidence is not valid UTF-8, preserve/hash the raw bytes and create a bounded lossless escaped/hex presentation with explicit byte ranges; never substitute U+FFFD and call the packet complete.

Keep `runGit()` for bounded machine-readable output. Do not convert every Git call to streaming unnecessarily.

- [ ] **Step 5: Generate an exact machine manifest and bounded human synopsis without duplicate metadata**

The existing snapshot manifest remains exhaustive. For fewer than 50 change units, the required synopsis lists every path and contains:

- change-unit ID;
- add/modify/delete/rename/special kind;
- destination path and rename source when applicable;
- additions/deletions or binary unavailable marker;
- old/new modes and full object IDs for deletions, gitlinks, binaries, type changes, and mode changes; and
- whether similarity detection and line statistics were exact, bounded, deferred, ambiguous, or skipped.

At 50 or more units, the required synopsis instead contains counted path-prefix groups, kind/type totals, total known bytes/statistics, deferred-stat counts, deterministic anomalies, and the manifest digest. Do not print a 49-path prefix. The exact inventory remains queryable through `materializeInventoryPackets()` and becomes required only for explicitly selected groups, a flagged anomaly that cannot be explained from the synopsis/current context, or `review` policy. A synopsis group must be computed from an exact manifest selector and its displayed count must be re-expanded during finalization.

Make bulk synopsis construction deterministic and bounded:

1. Build a raw-byte-ordered path-component trie over destination paths, with rename sources and non-UTF-8 IDs recorded as separate structural facts.
2. Start at the repository-relative root and repeatedly split the largest splittable group, using raw-byte order for ties, until 24 displayed groups exist or no useful split remains.
3. For each group, show counts by add/modify/delete/rename/special kind and no more than three representative paths. Root-level files form a named `(repository root)` group rather than 1,000 rows.
4. Show separate counted anomaly categories for non-UTF-8 paths, type/mode changes, gitlinks, ambiguous/skipped rename classification, deferred statistics, and objects above the eager-analysis budget. Show no more than three examples per category; selecting a category materializes its exact inventory.
5. Cap an extended-route bulk synopsis at two 16 KiB packets. For an inline concise candidate, budget from the complete serialized result outward: after accounting for the fixed envelope, transaction handle, evidence metadata, and required anomaly facts, deterministically reduce optional samples and merge only presentation groups until the whole result fits. Never assume that a 32-KiB synopsis fits inside a 32-KiB result. If unusually long path names would exceed the remaining budget, render a safe prefix/suffix, byte length, and path-byte hash; if mandatory facts still cannot fit, select `scope-synopsis-over-budget` rather than truncate them. Require an exact-inventory packet only when that item must be investigated.

Treat 24 groups, three samples, and 32 KiB total as provisional usability budgets covered by boundary tests and the grilling decision. They constrain presentation, never manifest completeness or the user's selected commit scope.

This replaces `inventory.md`, inventory-page ledger records, and per-binary/per-submodule metadata files. It also prevents the bulk display policy from being defeated by a mandatory hidden O(F) reading exercise.

- [ ] **Step 6: Select concise or extended evidence without a file-count proxy**

Build the scope synopsis in memory/streaming form and evaluate the evidence plan before creating review artifacts:

- For `reuse`, embed the bounded synopsis and grounded basis directly when no unexplained anomaly requires content. Do not materialize a patch merely to fill the available budget.
- For `message`, stream the complete required patch into a bounded candidate result. Select concise only when the final JSON result, including escaping/metadata, is no more than 32 KiB, every required byte is present, and embedded text is strict valid UTF-8. Never infer fit from raw patch bytes alone.
- For `review`, select extended immediately and stream every required non-deletion text patch to immutable packets.
- For mixed policies, select concise only when every group is `reuse` or completely inline `message`; one `review` or over-budget group selects extended while preserving compact selector partitioning.
- A 50+-unit `reuse` transaction remains eligible for concise routing through the bounded bulk synopsis. A one-unit unknown/review transaction remains extended.

On concise success, persist the capsule digest and exact evidence-plan/manifest digests in the transaction, advance to `evidence-ready`, and return the capsule in the same `workflow prepare` result. Create no catalog, queue, receipt, worksheet, or packet directory.

On extended selection, create only the catalog, required packets, and initial queue, record the deterministic `extendedReason`, advance to `review-pending`, and return its bounded first-page summary. Do not emit a partially useful inline patch that the agent could mistake for complete evidence.

Implement `workflow extend` as two explicit branches against the unchanged repository/head/tree transaction anchor. `evidence-uncertainty` securely consumes the selector-based plan from fixed `evidence-plan-input.json`, creates only the missing catalog/queue evidence against the same manifest, persists the canonical plan/digest before removing the transient input, and preserves that input on validation/state failure. `semantic-structure-required` rejects a plan input, binds the existing concise capsule as covered evidence, creates no evidence queue, and moves only into the structured worksheet route. Neither branch may restage, recreate the snapshot, or retain the concise route label. Task 5 adds the worksheet.

For a later extended evidence-plan revision, compare semantic packet requirements by exact packet content identity. Reuse immutable packet files and hashes, materialize only the set difference, write a bounded linked queue for that difference, and record the prior/new catalog relation. Never regenerate all packets merely because selector groups were split or reordered.

- [ ] **Step 7: Implement one immutable receipt for the extended route**

`verifyReviewReceipt()` must be unreachable on a concise transaction. On the extended route it requires `requiredPacketsReviewed: true`, exact catalog and evidence-plan digests, recomputes every required/additional packet hash, rejects unknown additional IDs, requires complete non-deletion text-patch coverage for every `review` group, applies the explicit metadata-first rule to whole-file deletions, and returns compact coverage. It must not modify packet or catalog files. A catalog/evidence-plan revision invalidates only coverage newly required by that revision; unchanged packet hashes already covered by the prior receipt carry forward deterministically, while newly required packets must be read and bound before finalization.

The updated receipt binds the new catalog/evidence-plan digests and asserts the entire new mandatory set only after the agent follows every page in the returned delta queue. No per-page or per-packet acknowledgement command exists.

State in code comments and public instructions that this validates identity and declared coverage, not mental reading.

- [ ] **Step 8: Preserve exact deletion expansion on the new catalog**

Stream the recorded old blob into `D...` packets, append a new immutable catalog revision referencing the prior digest, and require those packet IDs only when expansion was deliberately requested. Do not reopen unrelated synopsis or inventory packets.

- [ ] **Step 9: Fence the obsolete acknowledgement route from new code**

Do not spend implementation effort optimizing or translating the old mutable ledger. Assert that no high-level workflow module imports or invokes `inspection acknowledge`, and mark its command-only implementation for deletion in Task 10. It may exist only in unpushed local intermediate commits while the new end-to-end path is still under construction.

- [ ] **Step 10: Verify inspection behavior**

Run: `node --test tests/committing-to-git/review-catalog.test.mjs tests/committing-to-git/change-inspection.test.mjs tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: PASS. Known-context and bounded-inline fixtures create no review artifacts; extended fixtures replace the prior 312 MB acknowledgement-output model with one compact receipt verification.

- [ ] **Step 11: Commit the review-packet task**

Proposed subject: `perf(committing-to-git): Make review evidence proportional`

## Task 5: Make Semantic Authorship Scale with Reasons, Not File Count

**Files:**

- Create: `src/committing-to-git/message/changeSelection.js`
- Create: `src/committing-to-git/message/approvedMessage.js`
- Create: `tests/committing-to-git/change-selection.test.mjs`
- Create: `tests/committing-to-git/approved-message.test.mjs`
- Modify: `src/committing-to-git/schema/commitMessageContent.schema.json`
- Modify: `src/committing-to-git/message/commitMessageRenderer.js`
- Modify: `src/committing-to-git/message/commitMessageValidator.js`
- Modify: `src/committing-to-git/command/messageCommand.js`
- Modify: `tests/committing-to-git/commit-message-renderer.test.mjs`
- Modify: `tests/committing-to-git/commit-message-snapshot-validation.test.mjs`
- Modify: `tests/committing-to-git/commit-message-validator.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`

**Interfaces:**

- `resolveSelection(manifest, selection, { assignedIds }) -> ChangeUnit[]`
- `resolveSemanticCoverage(manifest, content) -> { coveredIds, domains, fileNotes }`
- `formatMessagePath(rawPathBytes) -> string`
- `selectMessagePresentation({ changeUnitCount, projectedDetailedBytes, maximumBytes = 32 * 1024 }) -> "detailed"|"bulk"`
- `validateApprovedMessage({ manifest, route, bytes, repositoryTypePolicy, messageSource }) -> ApprovedMessageValidation`
- `canUseDirectSubjectTransport(subject) -> boolean`
- `scaffoldContent(manifest, reviewCatalog, evidencePlan) -> CommitMessageContentV2` for extended transactions only.

Use one exported presentation budget:

```js
export const MAXIMUM_CANONICAL_MESSAGE_BYTES = 32 * 1024;
export const MAXIMUM_SUBJECT_SCALARS = 72;
export const MAXIMUM_BODY_LINE_SCALARS = 72;
export const MAXIMUM_PRESENTATION_WARNING_SAMPLES = 16;
export const DIRECT_SUBJECT_TRANSPORT_PATTERN =
  /^[A-Za-z0-9 ():,._/+-]+$/u;
```

Selection schema:

```json
{
  "all": false,
  "ids": [],
  "destinationPaths": [],
  "destinationPathPrefixes": ["src/parser/"],
  "sourcePaths": [],
  "sourcePathPrefixes": [],
  "kinds": [],
  "remaining": false
}
```

Rules:

- `all: true` and `remaining: true` are each exclusive of every other selector field.
- Nonempty `ids`, destination/source paths, destination/source prefixes, and `kinds` are unioned within one selection.
- Prefixes are UTF-8, slash-separated, and must end in `/`; matching is byte-prefix matching on a path-component boundary.
- Destination selectors apply to every unit's destination path. Source selectors apply only to rename units with a recorded source path. Additions that happen to match an existing blob are not inferred copies and have no source selector. The generic words `path` and `pathPrefix` are not accepted because their rename semantics are ambiguous.
- Non-UTF-8 paths are selectable by change-unit ID.
- A unit matching multiple fields inside one selection is included once. Every nonempty selector field must match at least one unit; stale exact paths, prefixes, IDs, or kinds are errors rather than silently empty intent.
- `remaining: true` is permitted only on the final domain/rationale group.
- Evidence groups and counted bulk domains must each partition all units exactly once; overlap is an error, not first-match behavior.
- Detailed shared-rationale groups are optional, may select any nonempty subset, and may overlap when a cross-cutting reason truthfully applies to several selections. Evidence coverage and exact scope remain exhaustive; rationale prose does not need a ceremonial entry for every unit.
- Optional detailed file notes are nonexclusive and may add only distinct file-specific consequences.

Direct concise-message rules:

- The exact UTF-8 bytes are canonical; validation never rewrites, rewraps, trims, normalizes, or adds sections after approval.
- Every canonical message ends in exactly one LF (`0x0A`). Reject absent terminal LF, multiple terminal LFs, CRLF/CR, NUL, every Unicode control except LF, and every Unicode format character before approval rather than normalizing or displaying invisible bytes the user did not see.
- Direct `--message` is a subject payload, not canonical message bytes. It is eligible only when it has no newline, is at most 72 Unicode scalar values, passes the Conventional Commit grammar, and every character matches `DIRECT_SUBJECT_TRANSPORT_PATTERN`. This excludes Unicode, quotes/apostrophes, backslash, dollar, backtick, percent, exclamation, ampersand, pipe, semicolon, redirection/control characters, and every other shell-sensitive or nonportable byte. The helper's sole deterministic encoding is `Buffer.from(subject + "\n", "utf8")`.
- A valid subject that fails only the transport rule remains valid canonical text but must use `message check` from the exact transaction-local file. The skill decides before constructing a shell command; `workflow commit` repeating the direct-transport rejection is defense in depth, not the primary injection boundary.
- `canUseDirectSubjectTransport()` governs only whether raw direct argv transport is safe and proportional. It does not make a transport-safe subject invalid when supplied through `message check`; explicit user preference and checked-route revisions remain legitimate file-based uses.
- A valid Conventional Commit subject is mandatory. Type follows `^[a-z][a-z0-9-]*$`; optional scope follows the existing nonempty, single-line, no-parenthesis/control grammar. Preserve the established subject policy everywhere else: the description begins with an uppercase Unicode cased letter, is nonempty, has no terminal ASCII period, targets about 50 Unicode scalar values when practical, and never makes the complete subject exceed 72 Unicode scalar values. Do not count UTF-16 code units. The helper enforces byte/grammar/capitalization/period/scalar-count rules; the agent assesses imperative voice and whether the description explains the outcome or reason rather than mechanical edits.
- `Rationale:`, `User Experience Changes:`, and `File Changes:` are optional. If present, they use that order, contain no empty/pseudo-placeholder entries, and must add truthful information rather than satisfy a schema slot.
- A subject-only message is valid for any concise transaction size. File count never forces a body.
- Checked concise text may include `File Changes:` only in detailed form for fewer than 50 change units and only when the complete exact numbered path inventory fits 32 KiB. The parser validates exact manifest coverage and deterministic raw-byte order. Counted bulk domains are not accepted from free-form direct/checked text because domain titles and counts alone cannot prove selector membership; to include a bulk inventory, invoke `workflow extend --reason semantic-structure-required` on the unchanged snapshot and use structured finalization without rereading evidence. Omitting `File Changes:` keeps a coherent 50+-unit transaction concise.
- The complete approved message remains at or below 32 KiB. A larger message must be made more semantically compact; the helper never suggests changing the selected scope.
- The helper validates syntax, exact detailed-path coverage when supplied, structured domain coverage in the extended finalizer, and policy compatibility. The agent remains responsible for whether optional prose is useful and grounded.

Structured rendering wraps rationale, UX, domain-reason, and file-note prose at whitespace so the complete rendered line, including its derived indentation/list marker, targets at most 72 Unicode scalar values. Continuation lines align with the first prose character. Never split or truncate an indivisible token, formatted path identity, subject, or domain label. Exact checked input is never rewrapped: reject a line above 72 when a legal whitespace break could have kept it within budget, but accept an unavoidable indivisible-token overflow without claiming that semantic review passed or requiring another helper phase. Return presentation warnings as `{ count, samples, sha256 }`, where the digest covers every canonical `(lineNumber, scalarLength, reason)` tuple and `samples` contains at most the first 16 tuples in line order. This prevents a valid 32-KiB message with many long indivisible tokens from defeating the 80-KiB result budget. The 32-KiB canonical limit remains authoritative.

Detailed and bulk structured rendering uses one deterministic ordinal layout. Set the ordinal field width to the decimal digit count of the final item count, indent the list by two spaces, right-align each ordinal within that field, and align every nested description dash with the first character of the corresponding path/domain title. This formula works unchanged for one- through four-digit lists; do not add a second indentation rule at 10, 100, or 1,000. `File Changes:` never repeats the total in its heading. A bulk domain title ends in `(<N> file)` or `(<N> files)`, where `N` is the exact number of manifest change units in that domain: an add, modify, delete, type/mode change, gitlink, or rename each counts once, and a rename may display both endpoints in that one entry. Apparent copies remain additions. Domain counts must sum to the manifest change-unit count.

`formatMessagePath()` is reversible and normalization-free. Render a strict-valid UTF-8 path directly inside backticks only when it contains no Unicode control/format character and no backtick; otherwise render the raw bytes as the ASCII token `` `path-bytes-base64:<base64>` ``. A rename renders one entry containing the independently formatted source and destination joined by the literal ASCII arrow ` -> `. The validator maps either representation back to exact manifest bytes, so newline/backtick/invalid-UTF-8 paths cannot break section syntax or become replacement text. If these exact representations make a detailed message exceed budget, use structured bulk or omit the optional inventory; never truncate a path identity.

- [ ] **Step 1: Write selector tests**

Cover exact IDs, exact source/destination paths, source/destination prefixes, kinds, `all`, final `remaining`, within-selection union/deduplication, between-group overlap, omission, hostile names, Unicode normalization variants, non-UTF-8 ID fallback, rename endpoints in different domains, and raw-byte ordering. For evidence groups, require an exact non-overlapping partition and policy/basis validation. For detailed shared rationales, permit an empty set or truthful overlapping nonempty selections without requiring full rationale coverage; for counted bulk domains, retain exact partitioning. Include a 1,000-unit single-domain case whose authored content serializes below 8 KiB. Add presentation boundaries for 49/50 units and 32,767/32,768/32,769 canonical UTF-8 bytes, including fewer than 50 unusually long paths.

In `approved-message.test.mjs`, cover subject-only concise messages over 1, 12, and 1,000 change units; optional rationale and user-experience sections; an exact detailed file inventory; rejection of free-form counted bulk domains with the structured-finalizer remedy; invalid section order; empty ceremonial sections; a missing/duplicate/wrong path when `File Changes:` is supplied; exact canonical byte preservation; and rejection of direct text on an extended transaction. Add absent/exactly-one/multiple terminal-LF cases; Unicode controls/formats (including C0/C1, BOM, bidi, and zero-width), CRLF/CR, NUL, and invalid-UTF-8 rejection; the exact direct-transport character boundary; 72/73-Unicode-scalar limits including astral code points; capitalized description and terminal-period boundaries; every excluded shell-active character; ordinary Unicode; safe punctuation; valid-but-file-routed subjects; and a transport-safe subject that remains valid through file checking. Assert that no test expects a body solely because file count is greater than one.

In renderer tests, cover right alignment, two-space base indentation, and nested-description alignment at 1/9/10/99/100/999/1,000 entries; singular/plural domain counts; rename-as-one-unit; additions with matching blobs remaining additions; no total in the heading; exact partition sums; 72-scalar narrative wrapping/continuation indentation; deterministic rejection of avoidably overlong checked prose; accepted/disclosed indivisible-token overflow; count/sample/digest compaction over more than 16 warnings; direct Unicode without normalization; and reversible base64 fallback for newline, backtick, control, and invalid-UTF-8 path bytes. Test four-digit layout through the pure ordinal formatter independently of final canonical-message acceptance; the 32-KiB limit may correctly reject a synthetic 1,000-entry rendering. Bulk input remains O(domains + exceptions), never one authored ID per file.

```js
test("one all-selector covers a thousand-file domain without an ID array", () => {
  const manifest = manifestFixture({ changeUnitCount: 1_000 });
  const content = bulkContentFixture({ selection: { all: true } });
  const coverage = resolveSemanticCoverage(manifest, content);

  assert.equal(coverage.coveredIds.size, 1_000);
  assert.ok(Buffer.byteLength(JSON.stringify(content)) < 8 * 1024);
});
```

Run: `node --test tests/committing-to-git/change-selection.test.mjs tests/committing-to-git/approved-message.test.mjs`

Expected: FAIL because selectors and direct approved-message validation do not exist.

- [ ] **Step 2: Implement selector resolution as a pure module**

Keep it free of Git and filesystem access. Return exact field-specific errors naming overlapping, unknown, or uncovered IDs. Do not add glob syntax; exact paths and slash-terminated prefixes are sufficient and avoid another quoting/matching language.

- [ ] **Step 3: Introduce extended semantic content schema version 2**

Model the extended-route worksheet lifecycle explicitly. A concise transaction never creates or validates this schema until `workflow extend` changes its persisted route. An evidence-driven extended scaffold has `authoringState: "draft"`, `subject: null`, exact catalog/evidence-plan digests, `requiredPacketsReviewed: false`, the current evidence groups, empty semantic arrays, and a helper-selected `recommendedMode`. A semantic-structure-only transition instead derives a carry-forward receipt with `requiredPacketsReviewed: true` over an empty new-packet set bound to the already displayed capsule/plan digests; it must not ask the agent to toggle a review boolean for evidence already supplied inline. Select `bulk` immediately at 50 units or when the exact detailed path inventory alone makes a 32 KiB canonical message impossible; otherwise recommend `detailed`. The schema accepts either scaffold as a valid authoring artifact but the finalizer rejects it with focused missing-decision errors. The agent changes the state to `complete` only after supplying the subject and required semantic coverage; evidence-driven routes also require the applicable reviewed receipt. The finalizer derives catalog-local evidence-group IDs; the worksheet and receipt do not require the agent to copy them. Never insert a fill-in prompt or invented pseudo-rationale merely to make a draft look complete.

Detailed content:

```json
{
  "schemaVersion": 2,
  "authoringState": "complete",
  "review": {
    "schemaVersion": 1,
    "catalogSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "evidencePlanSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "requiredPacketsReviewed": true,
    "additionalPacketIds": []
  },
  "evidenceGroups": [
    {
      "selection": { "all": true },
      "policy": "review",
      "basis": {
        "kind": "unknown-preexisting",
        "note": "The user requested a complete review of pre-existing Vite loader changes"
      }
    }
  ],
  "subject": {
    "type": "fix",
    "scope": "vite",
    "description": "Prevent native config loader warnings"
  },
  "sharedRationales": [
    {
      "selection": { "all": true },
      "reasons": [
        "Keep local and container startup free of Vite's native-loader compatibility warning"
      ]
    }
  ],
  "userExperienceChanges": [],
  "mode": "detailed",
  "fileNotes": []
}
```

Bulk content:

```json
{
  "schemaVersion": 2,
  "authoringState": "complete",
  "review": {
    "schemaVersion": 1,
    "catalogSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "evidencePlanSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    "requiredPacketsReviewed": true,
    "additionalPacketIds": []
  },
  "evidenceGroups": [
    {
      "selection": { "all": true },
      "policy": "message",
      "basis": {
        "kind": "user-grounded",
        "note": "The requested migration retires the superseded parser implementation"
      }
    }
  ],
  "subject": {
    "type": "refactor",
    "scope": "parser",
    "description": "Retire the superseded parser pipeline"
  },
  "sharedRationales": [],
  "userExperienceChanges": [],
  "mode": "bulk",
  "domains": [
    {
      "title": "Legacy parser retirement",
      "selection": { "destinationPathPrefixes": ["src/owl2vowl/js/"] },
      "reasons": ["Remove the superseded implementation after migration to the maintained parser path"]
    },
    {
      "title": "Migration evidence",
      "selection": { "remaining": true },
      "reasons": ["Keep migration records and governance checks aligned with the completed retirement"]
    }
  ]
}
```

- [ ] **Step 4: Validate adaptive concise text and render extended content without repetition**

Implement `validateApprovedMessage()` first as a pure exact-byte boundary. It decodes UTF-8 fatally, parses without normalization, requires exactly one terminal LF, validates the subject and optional section grammar above, resolves any supplied detailed path inventory against the recorded manifest, enforces the 32 KiB limit, and returns the SHA-256 over the original bytes. `messageSource: "approved-subject"` additionally proves that the caller supplied only a transport-safe subject payload and that the helper derived these bytes as `subject + LF`; `messageSource: "checked-file"` accepts any otherwise valid concise form but rejects free-form counted bulk domains with `STRUCTURED_BULK_FINALIZATION_REQUIRED`. It must not infer a route from the prose: the transaction's evidence route is authoritative. Subject-only, contextual, and detailed are concise presentation depths; bulk is a structured extended presentation depth, not an evidence policy.

For extended detailed mode:

- render shared reasons under `Rationale:`;
- permit no rationale section when there is no non-deducible reason to record; otherwise require every authored selector to match, permit truthful overlap, preserve authored rationale order, and deduplicate byte-identical rendered reasons;
- render every numbered path in `File Changes:` using the right-aligned dynamic ordinal width and two-space base indentation defined above;
- render nested bullets only for `fileNotes` that add a distinct file-specific consequence; and
- reject a file note that merely duplicates a shared reason byte-for-byte.

For extended bulk mode, compute membership/counts from selectors, require domains to partition every change unit exactly once, render each title with its derived singular/plural file count, and use the same dynamic ordinal alignment. Cross-cutting reasons render in the overall `Rationale:` section rather than altering domain counts. Do not trust an agent-authored count or accept a bulk rendering that cannot be traced back to structured selectors.

Render to bytes before committing the derived extended message artifact, append exactly one terminal LF as part of that single deterministic render, and validate those same bytes. Require bulk mode at 50 units when a file/domain presentation is included and reject any canonical result above `MAXIMUM_CANONICAL_MESSAGE_BYTES` with `MESSAGE_DISPLAY_BUDGET_EXCEEDED`, the measured byte count, and a focused remedy: select bulk when detailed, or shorten prose/combine truthful domains when already bulk. Never suggest excluding files, splitting the user-selected chunk, truncating paths in the approved message, or silently rewriting authored semantics.

The `review` member is mandatory in v2 content and references the current immutable catalog revision. Editing semantic selections or rationale does not require repeating review; materializing new required evidence produces a new catalog digest and therefore requires an updated receipt. Conditional schema tests must prove that draft artifacts cannot reach rendering and complete artifacts cannot retain null/empty required decisions.

- [ ] **Step 5: Relax the type whitelist without relaxing syntax**

Conventional Commits permits types beyond the current eight. Change `subject.type` to a lowercase token matching `^[a-z][a-z0-9-]*$` and keep the existing eight as recommended scaffold choices. Preserve the existing capitalization, no-terminal-period, approximately-50-scalar target, and 72-scalar hard limit for the complete subject; never switch between UTF-16 code units, grapheme clusters, and Unicode scalar values in different validators. The helper must not scan for, execute, or guess arbitrary commit-lint configuration. When already-loaded repository instructions explicitly provide an allowed set, the agent follows it and passes that set during preparation for deterministic validation. Otherwise Git hooks remain the repository's authoritative enforcement. This avoids aborting an otherwise valid transaction solely because a repository requires `chore`, `style`, or another conventional type.

Do not add arbitrary footer/trailer rendering in this task. Add a clear `UNSUPPORTED_REPOSITORY_MESSAGE_POLICY` error only when already-loaded repository policy requires structure the renderer cannot represent; stop before staging and track trailer support separately only if the repository corpus demonstrates a real need.

- [ ] **Step 6: Make version 2 the sole high-level message contract**

Do not add v1 unions or revision readers to the high-level renderer/finalizer. Existing old command code may remain isolated and unchanged in local intermediate commits solely to keep the implementation sequence reviewable, but Task 10 removes it before publication. A pre-cutover temporary attempt presented to the new CLI receives a stable `UNSUPPORTED_ATTEMPT_VERSION` error that instructs the agent to create a fresh transaction; it is never migrated or mutated in place.

- [ ] **Step 7: Verify renderer and validator behavior**

Run: `node --test tests/committing-to-git/change-selection.test.mjs tests/committing-to-git/approved-message.test.mjs tests/committing-to-git/commit-message-renderer.test.mjs tests/committing-to-git/commit-message-snapshot-validation.test.mjs tests/committing-to-git/commit-message-validator.test.mjs tests/committing-to-git/artifact-schemas.test.mjs`

Expected: PASS, including 1/9/10/49/50/99/100/999/1,000 formatting boundaries, exact terminal-LF/control-byte rules, structured-only bulk-domain validation, and explicit rejection of old attempt/message schemas by the high-level route.

- [ ] **Step 8: Commit the semantic-scaling task**

Proposed subject: `feat(committing-to-git): Scale rationale by intent`

## Task 6: Bypass Message Ceremony When Evidence Is Concise and Finalize Extended Messages Once

**Files:**

- Create: `src/committing-to-git/workflow/checkMessageWorkflow.js`
- Create: `src/committing-to-git/workflow/finalizeMessageWorkflow.js`
- Create: `src/committing-to-git/message/canonicalMessageState.js`
- Create: `tests/committing-to-git/canonical-message-state.test.mjs`
- Modify: `src/committing-to-git/workflow/prepareWorkflow.js`
- Modify: `src/committing-to-git/cli/commitWorkflow.js`
- Modify: `src/committing-to-git/command/messageCommand.js`
- Modify: `src/committing-to-git/message/commitMessageValidator.js`
- Modify: `src/committing-to-git/schema/commitMessageValidation.schema.json`
- Modify: `src/committing-to-git/schema/commitTransaction.schema.json`
- Modify: `tests/committing-to-git/commit-workflow-cli.test.mjs`
- Modify: `tests/committing-to-git/workflow-e2e.test.mjs`
- Modify: `tests/committing-to-git/workflow-cost-contract.test.mjs`
- Modify: `tests/committing-to-git/approved-message.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`

**Interfaces:**

- `checkMessageWorkflow({ transactionPath }) -> CheckedMessageResult`
- `finalizeMessageWorkflow({ transactionPath }) -> FinalizedMessageResult`
- `replaceCanonicalMessage({ transactionPath, bytes, validation, source }) -> CanonicalMessageState`
- `readCanonicalMessage(transactionPath) -> CanonicalMessageState`
- `recoverCanonicalMessageReplacement(transactionPath) -> CanonicalMessageState`
- CLI: `message check --transaction TRANSACTION_JSON [--format json|text]`
- CLI: `message finalize --transaction TRANSACTION_JSON [--format json|text]`

`message check` accepts a concise transaction and the exact fixed `<transaction-directory>/message-input.txt` without semantic scaffolding or an arbitrary path argument. `message finalize` accepts only `route: "extended"` and derives the exact fixed `<transaction-directory>/content.json`; it accepts no caller-controlled content path. A transport-safe subject-only concise transaction proceeds from `evidence-ready` to the exact approval proposal without another helper command by default; Task 7 lets `workflow commit` validate and persist that approved subject before mutation. Multiline/nonportable text uses `message check`, while an explicit user preference or an already checked revision may validly send a transport-safe subject through the same exact-file route.

Checked concise result shape:

```json
{
  "schemaVersion": 1,
  "status": "message-ready",
  "phase": "message-ready",
  "terminalDisposition": null,
  "route": "concise",
  "transaction": "C:/.../transaction.json",
  "commitState": "absent",
  "publicationState": "not-requested",
  "publicationAllowed": false,
  "recoveryRequired": false,
  "messageSource": "checked-file",
  "messageRevision": 1,
  "messageSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "presentationWarnings": {
    "count": 0,
    "samples": [],
    "sha256": null
  },
  "displayText": "fix(vite): Prevent native config loader warnings\n\nRationale:\n  - Keep startup free of the native-loader warning\n"
}
```

Result shape:

```json
{
  "schemaVersion": 1,
  "status": "message-ready",
  "phase": "message-ready",
  "terminalDisposition": null,
  "route": "extended",
  "transaction": "C:/.../transaction.json",
  "commitState": "absent",
  "publicationState": "not-requested",
  "publicationAllowed": false,
  "recoveryRequired": false,
  "canonical": true,
  "presentationWarnings": {
    "count": 0,
    "samples": [],
    "sha256": null
  },
  "messageSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "displayText": "fix(vite): Prevent native config loader warnings\n\nRationale:\n  - Keep startup free of Vite's native-loader compatibility warning\n\nFile Changes:\n  1. `Dockerfile`\n     - Keep container builds aligned with the ESM configuration\n  2. `vite.config.mjs`\n     - Load the configuration natively without CommonJS path handling\n"
}
```

Mixed-plan convergence shape (exit `1`):

```json
{
  "schemaVersion": 1,
  "status": "evidence-required",
  "phase": "review-pending",
  "terminalDisposition": null,
  "transaction": "C:/.../transaction.json",
  "commitState": "absent",
  "publicationState": "not-requested",
  "publicationAllowed": false,
  "recoveryRequired": false,
  "canonical": false,
  "evidenceDelta": {
    "newlyRequiredPacketCount": 3,
    "firstQueuePage": "C:/.../review/delta-r2/Q000001.json",
    "firstQueuePageSha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
  },
  "displayText": null
}
```

- [ ] **Step 1: Write failing concise and extended preapproval action-budget tests**

Exercise a known-context coherent fixture through `workflow prepare`. Assert its result is `route: "concise"`, contains all agent-visible evidence inline, and requires no helper/artifact action before a subject-only exact message proposal:

```js
assert.deepEqual(result.agentVisiblePhases, [
  "workflow prepare",
]);
assert.equal(result.agentArtifactReads, 0);
assert.equal(result.agentArtifactWrites, 0);
```

Exercise a second concise fixture whose useful message contains a rationale and UX section. Assert the only additional preapproval actions are writing the exact canonical message and running `message check`:

```js
assert.deepEqual(result.agentVisiblePhases, [
  "workflow prepare",
  "write exact message-input.txt",
  "message check",
]);
assert.equal(result.semanticWorksheetWrites, 0);
assert.equal(result.reviewReceiptWrites, 0);
```

Run: `node --test tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: FAIL until preparation exposes the complete concise evidence contract, `message check` exists, and the cost harness distinguishes transport-safe direct subjects from multiline or nonportable checked text.

Add an extended transcript with one packet read, one worksheet edit, and one `message finalize`, and a second extended transcript in which one evidence selector changes from `message` to `review`. Its first finalization returns one delta queue, the agent reads only newly required packets and updates the receipt, and its second finalization succeeds. Assert that the synopsis and every unchanged packet are read once, not once per revision.

- [ ] **Step 2: Create a semantic worksheet only on the extended route**

Remove `commit-message.template.txt` from the high-level workflow. A concise preparation creates neither that template nor `content.json`. Extended preparation and `workflow extend` each record one schema-valid `authoringState: "draft"` `content.json` plus the review catalog in the transaction; the worksheet contains no invented placeholder prose. No final public route accepts a template target.

- [ ] **Step 3: Implement exact file-based message checking**

`checkMessageWorkflow()` must:

1. Require a concise `evidence-ready` transaction, or a precommit concise `message-ready` transaction being revised, with the same repository/head-anchor/tree facts recorded at preparation.
2. Derive `message-input.txt` as a fixed sibling of the recorded `transaction.json`; accept no caller-controlled message path. Apply the transaction workspace's containment and link/reparse checks, open that file once with non-following semantics, verify through `fstat` that the opened handle is a regular file, capture the opened object identity, and read the contents only from that handle. Decode UTF-8 fatally; reject absent/multiple terminal LF, CRLF/CR, NUL, every prohibited Unicode control/format character, or more than `MAXIMUM_CANONICAL_MESSAGE_BYTES`. Never reopen the path to validate content.
3. Call `validateApprovedMessage()` against the recorded manifest and repository type policy without normalization or rewriting. Accept every structurally valid canonical concise message, including a transport-safe one-line subject supplied as canonical `subject + LF`; route proportionality is a skill/evaluation contract, not a reason for the helper to reject valid bytes. Reject a free-form counted bulk inventory with `STRUCTURED_BULK_FINALIZATION_REQUIRED`, because only the structured finalizer can prove domain membership.
4. Call `replaceCanonicalMessage()` with those exact bytes and validation, record `messageSource: "checked-file"`, increment `messageRevision`, and advance to or remain at `message-ready`. Keep no prior successful message body or validation revision after the replacement is durable.
5. Remove the transient `message-input.txt` only after the canonical bytes, validation, hash, revision counter, and transaction transition are durable. Close the original handle, perform one fresh non-following identity check, and unlink only when the current directory entry is the same object opened earlier. If the path vanished, treat cleanup as already complete. If it was replaced, became a link/reparse point, cannot be identified safely on the platform, or cannot be removed, leave the current entry untouched and return a bounded cleanup warning; terminal cleanup may retry only after revalidating the fixed helper-owned path. A validation/state failure leaves the input unchanged for correction and leaves the prior valid revision intact.
6. Return the exact bytes in bounded `displayText` for approval. Perform no Git command, index mutation, evidence materialization, worksheet operation, or review attestation.

Tests must cover exact byte/hash preservation, exactly one accepted terminal LF, accepted valid portable and nonportable one-line subjects, rejected absent/multiple LF, CRLF/CR/NUL/C0/C1/invalid UTF-8 without rewriting, the 32-KiB message boundary, and the complete `MAXIMUM_MESSAGE_RESULT_BYTES = 80 * 1024` serialized-JSON boundary using worst-case legal JSON escaping and a maximum validated transaction path. Also cover invalid section order/path coverage, structured-bulk rejection, missing input, directory/symlink/reparse input, replacement of the input path after its handle is opened, same-object versus replacement identity at cleanup, conservative cleanup when identity is unavailable, rejection of the removed `--message-file` option, successful input removal, cleanup-warning behavior, failure preserving the input and prior valid revision, revision before commit, rejection after commit, and proof that the recorded message is the only message later consumed. Run 100 successful revisions and assert that only one canonical body/validation exists, `messageRevision` is 100, and storage does not grow with revision count. A failed check returns exit `2` without changing that counter.

- [ ] **Step 4: Implement the extended finalizer**

In one process:

1. Require `route: "extended"`, derive fixed `content.json`, and securely read it once using the same containment, non-following, regular-file, bounded-size, fatal-UTF-8, and opened-handle rules as message input. Then load and validate the transaction, manifest/draft identity, catalog, the receipt embedded at `content.review`, and an artifact whose `authoringState` is `complete`. Reject a concise transaction with `FINALIZER_REQUIRES_EXTENDED_TRANSACTION` and no state change; this must not imply that checked concise input is invalid.
2. Canonicalize the worksheet evidence groups. If their plan differs, derive an immutable catalog revision and compare its exact required packet identities with prior covered hashes.
3. If new evidence is required, materialize only that set difference, atomically write bounded linked delta-queue pages, advance to `review-pending`, and return `evidence-required` with exit `1`. Write no message/validation artifact.
4. If the revision requires no new packet, validate the prior receipt and record a derived carry-forward receipt bound to the new plan/catalog without asking the agent to reread unchanged evidence.
5. Otherwise verify the updated receipt and every newly required packet after the agent follows the delta queue.
6. Resolve semantic selectors exactly once.
7. Render the canonical message in memory with exactly one terminal LF, enforce the 32 KiB presentation budget, and run deterministic structural checks against those same bytes. The agent's semantic review is an approval responsibility, not a helper-produced `manualReviewRequired: false` claim.
8. Persist normalized finalized content/receipt, then call the same `replaceCanonicalMessage()` boundary with the rendered exact bytes, validation, and `messageSource: "finalized-extended"`.
9. Record the message SHA-256 and advance to `message-ready`.
10. Return one result whose complete serialized JSON is at most `MAXIMUM_MESSAGE_RESULT_BYTES`, containing the exact message in `displayText` and the validation summary. Measure the serialized result directly under worst-case valid escaping and path length.

Do not write a message and then reread it merely to validate equality with itself. The fixed worksheet remains transaction-owned for later structured revision until terminal compaction; finalization accepts no external content path and performs no path-based second content read.

Permit `review-pending -> review-pending` only when a newly authored evidence plan supersedes the unresolved delta, and `review-pending -> message-ready` only after the current delta is receipted or deterministic carry-forward proves no delta remains. Catalog/queue revisions are derived and reversible; commit phases remain strictly forward-only.

- [ ] **Step 5: Make revisions phase-local**

Allow a concise `message-ready` transaction to rerun `message check` after the agent writes changed exact bytes to the same fixed transaction-local input, and allow an extended `message-ready` transaction to rerun the finalizer after `content.json` changes. Increment `messageRevision`, atomically replace the one current message/validation, retain no successful historical message bodies, and retain the same snapshot plus every reusable immutable packet. The skill classifies the revision before invoking either route:

- Wording/classification changes with the same material meaning and tree retain all evidence.
- New rationale, user-experience, risk, or other semantic claims retain the tree but must be supported by existing evidence or acquire only the missing delta through `workflow extend`/extended review.
- Any scope/tree change is rejected as a message revision and requires a fresh `workflow prepare` plus fresh approval anchor.

The helper enforces tree identity, exact bytes, declared evidence coverage, and postcommit immutability; the skill instructions and model evals enforce semantic-claim classification because deterministic code cannot infer whether two prose claims mean the same thing. Do not add keyword lists, edit-distance thresholds, embeddings, or another heuristic semantic classifier. Reject every revision after commit creation.

`canonicalMessageState.js` owns the multi-file crash boundary for both concise checking and extended finalization. It uses only fixed `message/current`, `message/candidate`, and `message/previous` slots plus one `message-replacement.pending.json` journal beneath the transaction; it never names storage by revision number. Write and flush the complete candidate body/validation/hash/source first, then flush the pending journal with the prior/new hashes and revision, install the candidate, advance the transaction reference, and remove the fixed previous/candidate/journal remnants. Interruption recovery validates those hashes and deterministically completes or restores the last valid current slot before another message/commit operation. At steady state retain one body; during replacement/recovery retain at most current plus one candidate/previous body, so disk is O(maximum canonical message bytes), not O(revision count).

In `canonical-message-state.test.mjs`, inject interruption before/after candidate flush, journal flush, current-to-previous move, candidate-to-current move, transaction-state advance, and remnant cleanup on Windows-compatible filesystem semantics. Assert that recovery exposes exactly one internally consistent body/validation/hash/source/revision, never advances twice, never loses the last valid revision on a failed candidate, and leaves no revision-suffixed archive. Run the same replacement API from checked-concise and finalized-extended fixtures.

- [ ] **Step 6: Keep both validation paths independent of the old live-scope validator**

Move every still-relevant pure subject/line/section check into shared pure validation used by `message check`, direct subject validation inside `workflow commit`, and the v2 finalizer, and prove all receive scope only from the recorded manifest. `message check` combines exact validation with persistence of the canonical approval bytes; do not expose `message validate-legacy` or a validate-only low-level command. Task 10 deletes the old live-workspace parser and its tests before the final cutover.

For every terminal validation failure, return the uniform JSON envelope and exit `2`; do not print a second prose error to stdout. `evidence-required` is a safe nonterminal exit `1`, not a validation failure. Tests parse stdout as exactly one JSON value in success, convergence, and failure cases; enforce the common 80-KiB serialized message-result budget; and verify that `--format text` renders the persisted `displayText` without taking a different validation path.

- [ ] **Step 7: Verify message checking and finalization**

Run: `node --test tests/committing-to-git/approved-message.test.mjs tests/committing-to-git/canonical-message-state.test.mjs tests/committing-to-git/artifact-schemas.test.mjs tests/committing-to-git/commit-workflow-cli.test.mjs tests/committing-to-git/commit-message-renderer.test.mjs tests/committing-to-git/commit-message-snapshot-validation.test.mjs tests/committing-to-git/workflow-e2e.test.mjs tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit the message-boundary task**

Proposed subject: `perf(committing-to-git): Bypass concise message ceremony`

## Task 7: Journal Commit Creation, Preflight Signature Trust, and Emit the Final Report

**Files:**

- Create: `src/committing-to-git/workflow/createCommitWorkflow.js`
- Create: `src/committing-to-git/workflow/recoverTransactionWorkflow.js`
- Create: `src/committing-to-git/transaction/transactionRecovery.js`
- Create: `src/committing-to-git/signature/signaturePreflight.js`
- Create: `src/committing-to-git/git/gitProcessTranscript.js`
- Create: `tests/committing-to-git/transaction-recovery.test.mjs`
- Create: `tests/committing-to-git/git-process-transcript.test.mjs`
- Modify: `src/committing-to-git/transaction/transactionWorkspace.js`
- Modify: `src/committing-to-git/workflow/prepareWorkflow.js`
- Modify: `src/committing-to-git/cli/commitWorkflow.js`
- Modify: `src/committing-to-git/command/postCommitCommand.js`
- Modify: `src/committing-to-git/command/snapshotVerificationCommand.js`
- Modify: `src/committing-to-git/signature/commitSignature.js`
- Modify: `src/committing-to-git/report/commitReport.js`
- Modify: `src/committing-to-git/schema/signatureVerification.schema.json`
- Modify: `src/committing-to-git/schema/commitTransaction.schema.json`
- Modify: `src/committing-to-git/schema/postCommitReport.schema.json`
- Modify: `tests/committing-to-git/signature-policy.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`
- Modify: `tests/committing-to-git/commit-report.test.mjs`
- Modify: `tests/committing-to-git/workflow-e2e.test.mjs`
- Modify: `tests/committing-to-git/workflow-cost-contract.test.mjs`

**Interfaces:**

- `inspectSignatureRequirements(root) -> SignaturePreflight`
- `createCommitWorkflow({ transactionPath, approvedSubject, checksPath, retainReviewArtifacts, retainProcessLogs, verificationPolicyOverride }) -> CommitWorkflowResult`
- `retrySignatureVerificationWorkflow({ transactionPath, verificationPolicyOverride }) -> CommitWorkflowResult`
- `recoverTransactionWorkflow({ transactionPath, resolution = null }) -> RecoveryResult`
- `recoverCommitOutcome({ transactionPath }) -> RecoveryResult`
- `captureGitProcessTranscript({ transactionPath, operation, child, diagnosticBudget }) -> GitProcessTranscript`
- `compactTerminalTransaction({ transactionPath, retainReviewArtifacts, retainProcessLogs }) -> CleanupResult`
- `purgeTransaction({ transactionPath }) -> CleanupResult`
- CLI: `workflow commit --transaction TRANSACTION_JSON [--message SUBJECT] [--verification required|advisory|skipped] [--checks CHECKS_JSON] [--retain-review-artifacts] [--retain-process-logs] [--format json|text]`
- CLI: `workflow verify --transaction TRANSACTION_JSON [--verification required|advisory|skipped] [--format json|text]`
- CLI: `workflow recover --transaction TRANSACTION_JSON [--resolution confirmed-no-live-child] [--format json|text]`
- CLI: `workflow cleanup --transaction TRANSACTION_JSON [--purge] [--format json|text]`

The normal commit command uses the policy recorded at preparation. `--message` is accepted only for a concise `evidence-ready` transaction whose exact subject passes `canUseDirectSubjectTransport()`. A checked concise or extended `message-ready` transaction must use its recorded message and reject the flag. Multiline text and valid one-line subjects outside the direct-transport set must already have passed `message check`. `--verification` is an exceptional override accepted only when the agent can cite an explicit user direction; the helper records the transition but must never insist that the user retain `required`.

Signature preflight shape:

```json
{
  "backend": "ssh",
  "trustSource": {
    "configured": true,
    "origin": "file:C:/Users/example/.gitconfig",
    "path": "G:/keys/allowed_signers",
    "readable": false
  }
}
```

Commit journal shape while Git may be running:

```json
{
  "status": "pending",
  "launchState": "not-started",
  "childIdentity": null,
  "headAnchor": {
    "headKind": "attached",
    "targetRef": "refs/heads/main",
    "expectedParentOids": [
      "0123456789abcdef0123456789abcdef01234567"
    ]
  },
  "expectedTreeOid": "89abcdef0123456789abcdef0123456789abcdef",
  "messageSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  "startedAt": "2026-08-23T12:00:00.000Z"
}
```

`launchState` is `not-started`, `launching`, `running`, or `completed`. The helper flushes `not-started` only while control flow is still guaranteed not to have called `spawn()`, then flushes `launching` immediately before that call. When available, `running` records PID plus a platform process-start identity so PID reuse cannot establish liveness. `completed` records exit/signal and the transcript completion digest. A crash in `launching` or `running` with no durable completion is an unknown outcome even while the ref still equals the baseline: the child may still be signing or executing a hook. Ref equality proves no commit only with durable `not-started` or captured completed rejection/failure plus a stable ref observation.

`--resolution confirmed-no-live-child` is an exceptional user-directed assertion, not an automatic heuristic. The skill may use it only after the user explicitly confirms that the relevant Git/signing/hook process was terminated or the host restarted. The helper rejects it if a reuse-resistant recorded child identity is still live, an index lock/process fact contradicts it, or the ref observation is unstable; otherwise it records the assertion and observation provenance before classifying baseline state as no commit. It never treats elapsed time, a missing PID alone, or the agent's guess as equivalent confirmation.

Treat Git object IDs as opaque full-length values selected by the repository object format; tests must cover both 40-hex SHA-1 and 64-hex SHA-256 repositories where installed Git supports them.

- [ ] **Step 1: Write failing signature-preflight regressions**

Cover:

- SSH with a readable allowed-signers path;
- SSH with an unreadable path;
- the observed Git for Windows output `Unable to open allowed keys file ... Permission denied`;
- existing `allowed signers file` variants;
- a missing file;
- OpenPGP without an SSH trust path; and
- skipped policy performing no verifier invocation.

The observed message must classify as `unavailable` with `trust-store-unreadable`, never generic `failed`.

Also retain backend-specific verified identity semantics. Independently of verification policy, parse the raw created commit object and require a signed-commit header (`gpgsig` or the object-format-appropriate equivalent) before describing the commit as signed; `skipped` means identity verification was skipped, not that `git commit -S` or signature-object presence became optional. An SSH success records the verified allowed-signers principal and SSH key fingerprint reported for the exact commit. An OpenPGP success records the signer identity plus the primary-key fingerprint as the stable identity, and separately records a signing-subkey fingerprint when Git/GPG exposes one; never substitute a short key ID for the primary fingerprint. Fixtures must reject a verifier result for another commit even when its signer identity matches, and must block publication if a controlled signer produces a commit without the required signature header.

- [ ] **Step 2: Implement preflight during preparation**

Use `git config --show-origin --path --get gpg.ssh.allowedSignersFile` for SSH when the recorded policy is not `skipped`, preserve the exact configured source, and test readability without copying or modifying it. For actual preparation, run this read-only preflight after repository/config discovery but before transaction allocation, object creation, or real-index installation. Record the result in the transaction only after allocation. Under `required`, return a compact capability request instead of staging when broader read access is needed. Under an explicitly selected `advisory` policy, the user may either grant access or proceed with the preflighted `unavailable` disposition; the later commit records that fact without launching a known-doomed verifier. `skipped` neither reads the trust source nor invokes the verifier. A draft records the selected verification policy but deliberately defers signer-trust preflight until Task 9 promotion, because draft preparation performs no commit-capable mutation. The public skill asks for the known capability before the first actual preparation/promotion/commit attempt when the host already declares the path inaccessible; it does not perform a known-doomed sandboxed verification first. If access is declined or unavailable, report the policy consequence and honor any explicit user change to `advisory` or `skipped` without argument. Do not fabricate an alternate allowed-signers file or bypass the configured trust source merely to avoid file access.

Preflight is advisory evidence about accessibility. `git verify-commit --raw` remains the final verifier.

- [ ] **Step 3: Write focused transcript-budget tests**

Cover the 16 KiB head and tail boundaries, binary output, a 10 MiB stream, non-overlapping head/tail rendering, complete sequence/channel/hash/byte preservation, success-versus-failure retention, and exactly one suppression marker. Assert that the child streams are drained incrementally into the transcript while only the bounded head/tail is mirrored to stderr; the helper must not first forward the entire output and then try to summarize it.

Run: `node --test tests/committing-to-git/git-process-transcript.test.mjs`

Expected: FAIL because the bounded transcript implementation does not exist.

- [ ] **Step 4: Write message-source, head-shape, and commit-journal failure tests**

Inject failure:

- before snapshot verification;
- after the pending journal but before Git starts;
- after durable `launching` but before child identity persistence;
- after Git updates `HEAD` but before the helper records the OID;
- after OID recording but before verification;
- during verification;
- during report writing; and
- after report writing but before review-artifact compaction.

Assert that no recovery path invokes `git commit` twice. Also assert the uniform result/exit contract at every boundary: validation/helper failure before the pending journal exits `2`; durable `not-started` or captured hook rejection with a stable baseline observation exits `1`; a recorded matching commit blocked by required verification, comparison, or reporting exits `3`; `launching`/`running` without durable completion or another indeterminate child/ref outcome exits `4`; and a complete policy-permitted report exits `0`. Every nonzero stdout remains one bounded JSON document, while injected hook/signing output appears only on stderr.

Add message-source boundaries before all mutation injections: direct transport-safe concise subject payload; each direct-transport character exclusion; Unicode; missing/direct multiline input; direct input on an already checked concise or extended transaction; checked multiline and checked nonportable one-line bytes; changed subject bytes after proposal; invalid Conventional Commit syntax; and an over-budget subject. Direct subject validation must repeat `canUseDirectSubjectTransport()`, derive exactly `subject + LF`, record/hash/copy those canonical bytes before the pending Git journal, and return stable `MESSAGE_REQUIRES_CHECKED_FILE` before mutation when direct transport is ineligible. `message check` owns message-file race tests in Task 6. Any message validation/source mismatch creates no commit, changes no index entry, and returns exit `2`.

Run attached, detached, and unborn journal cases. The zero-parent unborn commit must match an empty `expectedParentOids` array and create the recorded target ref; attached and detached commits must match exactly one parent, while detached observation uses `HEAD` because `targetRef` is null. Compare the raw commit-object message bytes and require exactly the canonical bytes, including their one terminal LF; never compare `%B` output after trimming or newline normalization.

Add resolution tests proving that baseline ref plus `launching` is exit `4`; a still-live or PID-reused child, contradictory lock, unstable ref, or absent explicit user basis rejects `confirmed-no-live-child`; and an explicit confirmed termination/restart plus stable baseline can produce a recorded no-commit stop without invoking Git commit.

Add launcher-boundary tests for a synchronous exception before the process API can create a child, an asynchronous child `error` event before an OS process identity is available, and a normal spawn followed by lost completion persistence. Record a known non-launch only when the injected launcher contract proves no child could exist; otherwise retain `launching`/unknown. Never infer “spawn failed” solely from a missing PID.

```js
test("recovery adopts a matching recorded child instead of committing twice", (t) => {
  const transaction = interruptedAfterRefUpdateFixture(t);
  const recovery = recoverCommitOutcome({ transactionPath: transaction.path });

  assert.equal(recovery.status, "matching-commit-observed");
  assert.equal(recovery.gitCommitInvocations, 0);
  assert.equal(recovery.commit.treeMatches, true);
  assert.equal(recovery.commit.messageMatches, true);
});
```

- [ ] **Step 5: Implement complete capture with bounded diagnostic mirroring**

Create the transcript log exclusively inside the validated attempt directory with owner-only mode where the platform supports it. Drain both child channels incrementally into a compact binary-framed record that preserves sequence, source channel, exact bytes, total count, and SHA-256 without buffering the whole output. Across the complete high-level command, mirror at most the first 16 KiB to stderr, emit one suppression marker, and on non-success or recovery mirror at most a non-overlapping final 16 KiB tail after termination. Record the log facts in the transaction/result. Keep controlling-terminal and pinentry interaction direct; transcript handling must never manufacture responses, copy environment variables, or turn an interactive signer into a timed operation.

- [ ] **Step 6: Implement one post-approval commit transition**

The helper must:

1. Branch on the persisted route and message state. For concise `evidence-ready`, require one direct subject payload that passes `canUseDirectSubjectTransport()`, derive exactly `subject + LF`, run `validateApprovedMessage()` against the recorded manifest and type policy, persist those exact canonical bytes through `replaceCanonicalMessage()` with `messageSource: "approved-subject"`, and advance to `message-ready`. For checked concise or finalized extended `message-ready`, require no direct input and load the one existing canonical state through `readCanonicalMessage()` after resolving any fixed-slot pending replacement.
2. Run the existing read-only repository/head/tree/operation verification against the complete approved `headAnchor`, exact tree, and newly recorded or finalized message.
3. Write and flush the pending commit journal with `launchState: "not-started"`; after every remaining non-launch operation succeeds, flush `launchState: "launching"` immediately before invoking the process launcher.
4. Invoke `git commit --cleanup=verbatim -S -F RECORDED_MESSAGE_PATH` without path arguments and without bypassing hooks. Persist a reuse-resistant child identity when spawn succeeds and a completed exit/signal/transcript record when it ends. If the launcher throws synchronously under a tested contract that guarantees no child was created, durably record a completed non-launch failure; an asynchronous error or any boundary that cannot provide that guarantee remains an unknown launched outcome.
5. Resolve and immediately persist the full created OID.
6. Observe `targetRef` for unborn/attached anchors or `HEAD` for detached anchors; compare the created commit's exact parent array, tree, raw message bytes, and signed-commit-header presence, then record hook-produced differences without normalization.
7. Run signature verification under the selected policy.
8. Collect and render the report.
9. Advance to `reported` even when the commit exists but a mismatch or required verification blocks publication.
10. Return one result JSON within Task 8's serialized report budget with the exact human report in `displayText`, `terminalDisposition`, and the complete known mutation state.

Authorization remains an agent/user gate: the helper must document that direct text is the byte-identical message the agent displayed and the user approved. It must not invent a `--yes` flag that pretends to prove approval. Validation may reject supplied bytes, but it must never improve, canonicalize, or silently replace them after approval.

Launch the commit with `spawn()`, inherited stdin, and piped child stdout/stderr that `captureGitProcessTranscript()` drains incrementally so signing agents, pinentry, and hooks can interact without filling a `spawnSync` buffer. Only the bounded diagnostic mirror reaches the parent's stderr; reserve stdout for the final result contract. Do not apply a generic short timeout to this irreversible command. Persist the pending journal before launch. Inject the process launcher in tests and assert the stdin/streaming/no-timeout contract without requiring a real prompt.

- [ ] **Step 7: Default missing checks to an empty list**

If `--checks` is absent, use `{ "schemaVersion": 1, "checks": [] }` in memory and record it in the compact transaction capsule. When supplied, treat the caller's file as a bounded read-only input, not a helper-owned artifact: cap it at `MAXIMUM_CHECKS_INPUT_BYTES = 1024 * 1024`, open once with non-following semantics, verify the opened handle is regular, decode/validate from that same handle, and persist its canonical checks/digest before the commit journal. Never reread, remove, or claim ownership of the external path. A checks-input failure is exit `2` before any commit mutation.

- [ ] **Step 8: Record verification history for the same commit**

Replace ambiguous overwrite rules with:

```json
{
  "schemaVersion": 2,
  "commitOid": "fedcba9876543210fedcba9876543210fedcba98",
  "initialPolicy": "required",
  "finalPolicy": "required",
  "attempts": [
    {
      "status": "unavailable",
      "reason": "trust-store-unreadable",
      "backend": "ssh",
      "identity": null,
      "timestamp": "2026-08-23T12:01:00.000Z"
    },
    {
      "status": "verified",
      "reason": null,
      "backend": "ssh",
      "identity": {
        "principal": "maksym@example.com",
        "keyFingerprint": "SHA256:example"
      },
      "timestamp": "2026-08-23T12:02:00.000Z"
    }
  ],
  "effectiveAttempt": 1,
  "blocksPush": false
}
```

A policy override appends an attempt/policy transition for the same OID. It never recreates the commit.

`workflow verify` is the exceptional route after a trust-access failure or user policy change. It may verify or reclassify only the already recorded OID, then update the existing report and push gate; it must never invoke commit creation or repeat commit statistics. A successful retry returns exit `0`; an unavailable required verifier leaves the known commit blocked with exit `3`, not an invitation to commit again. The schema uses a backend-discriminated identity: SSH retains principal plus full SSH fingerprint, while OpenPGP retains signer identity, full primary-key fingerprint, and an optional distinct signing-subkey fingerprint.

- [ ] **Step 9: Implement the public recovery dispatcher and safe commit observation**

`recoverTransactionWorkflow()` is the sole public recovery entry point. It validates the exact transaction handle, recovers a pending canonical-message fixed-slot replacement first, then dispatches by the persisted journal/phase to index-installation observation, commit observation, verification/report continuation for an already known OID, or (after Task 8) publication observation. It may update helper-owned journal state after observation, but it performs no repository/ref mutation, no commit creation, no push, no temporary-root discovery, and no replay of an irreversible command.

For a pending journal:

- derive the observation point from `headAnchor`: the full target ref for unborn/attached state and `HEAD` for detached state;
- read the observation point before and after inspecting any candidate OID; if it changes during recovery, return `outcome-unknown` and record both observations rather than classifying a moving ref;
- if `launchState` is durably `not-started`, or `completed` records a non-creating exit and the unborn ref remains absent/attached-or-detached ref remains at its sole expected parent across the stable observation, classify `not-created`, advance to a no-commit `stopped` disposition, and do not retry automatically;
- if `launchState` is `launching` or `running` without durable completion and the observation remains at baseline, return `outcome-unknown`; ref equality alone does not prove that a signer/hook child is absent, and cleanup/purge/recommit remain forbidden unless a later recovery receives the explicit `confirmed-no-live-child` resolution and all contradictory machine checks are absent;
- if the current tip has exactly the recorded parent array (zero for unborn, one for attached/detached), exact tree, and byte-identical raw commit message including its terminal LF, record `matching-commit-observed` and continue verification/reporting while disclosing that journal recovery observed rather than witnessed the ref update;
- if another commit or ref state exists, classify `ambiguous` and stop;
- never reset, amend, delete, or replace a commit.

- [ ] **Step 10: Test and implement known-safe compaction and exact purge**

First write focused cleanup tests for known-safe terminal compaction, explicit pre-commit abandonment, Windows-style lock retry, UUID/root containment, link/reparse replacement rejection, pending/unknown mutation rejection, same-object-only deletion, and proof that no temporary-root enumeration occurs.

Model terminal disposition explicitly. A successful matching report, completed publication, safely rejected preparation after allocation, superseded draft, resolved drift stop, or explicitly abandoned transaction may compact only when no commit/publication journal is pending or unknown and `recoveryRequired` is false. Validate each deletion target by resolving and lstat-checking it beneath the exact UUID attempt directory. Remove only packet/delta directories, draft/preparation indexes, attempt-local objects, a leftover fixed `message-input.txt`, and successful child logs. Preserve the compact transaction capsule, the one current canonical message/validation/hash, snapshot/tree facts needed to explain the disposition, final verification/report/publication facts when present, and failed/recovery logs until resolution. Respect explicit review/log retention.

Do not compact merely because a draft message was presented or approved. An active transaction with `mode: "draft"` and phase `evidence-ready`, `review-pending`, or `message-ready` retains its exact evidence, temporary objects/indexes, and checked-message state so later revisions and promotion do not pay reconstruction or rereview cost. Automatic compaction normally begins after the local commit transition has a known outcome, exact head-anchor/parent-array/tree/raw-message comparison is recorded, the applicable verification disposition and local report are recorded, no recovery is pending, and the user did not request retention. Push authorization or publication is not required. A known created commit whose signature/report recovery remains unresolved retains the recovery-specific records until resolution even when unrelated bulky review data is safe to compact.

If the user independently copies the proposed message and commits outside this workflow, the helper has no journaled terminal transition and does not discover or infer one globally. That transaction may remain in the operating-system temporary directory until the user explicitly abandons/cleans that exact transaction or normal operating-system cleanup removes it. This bounded orphan risk is preferable to deleting active evidence early or reintroducing a global transaction registry.

A Windows file lock or antivirus race during compaction is a report warning, not a failed commit transition and never a reason to rerun Git. `workflow cleanup --transaction TRANSACTION_JSON` is an idempotent later retry over only the same validated helper-owned targets.

`workflow cleanup --purge` may remove the entire exact attempt directory only after revalidating the recorded repository/UUID path, temporary-root containment, no link/reparse replacement, and no pending/unknown mutation. A previously terminal transaction remains terminal; for an active pre-commit draft/preparation, the explicitly targeted purge operation itself records `abandoned` in the in-memory final capsule before deletion and is permitted only when the skill has an explicit abandonment/supersession basis. It never discovers attempts, scans the temporary root, follows links, purges a transaction merely because of age, or creates a sidecar/handover artifact. Capture the former absolute path and final capsule digest in memory, delete validated children before the directory itself, and return completed/failed targets directly in the bounded stdout result. Ordinary compaction may also remove consumed evidence-plan input and structured worksheet state once the current canonical message and all recovery facts are durable; same-object/reparse checks apply to every fixed input.

- [ ] **Step 11: Verify commit/signature/report behavior**

Run: `node --test tests/committing-to-git/signature-policy.test.mjs tests/committing-to-git/artifact-schemas.test.mjs tests/committing-to-git/transaction-recovery.test.mjs tests/committing-to-git/git-process-transcript.test.mjs tests/committing-to-git/commit-report.test.mjs tests/committing-to-git/workflow-e2e.test.mjs tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: PASS, with known-context concise fixtures of 1, 12, and 1,000 coherent units each represented by one post-approval high-level command and no preapproval finalizer; attached, detached, and zero-parent unborn recovery; byte-exact one-LF commit-message comparison; every injected boundary classified as exit `0` through `4` without duplicate commit creation; preserved SSH/OpenPGP identity facts; a complete hashed 10 MiB hook-output fixture producing no more than 32 KiB of agent-visible diagnostics; and known-safe terminal cleanup/purge confined to the exact UUID transaction.

- [ ] **Step 12: Commit the journaled-commit task**

Proposed subject: `feat(committing-to-git): Journal signed commit creation`

## Task 8: Make Reporting and Publication Compact and Non-Repetitive

**Files:**

- Create: `src/committing-to-git/workflow/publishWorkflow.js`
- Create: `src/committing-to-git/workflow/reportDetailWorkflow.js`
- Modify: `src/committing-to-git/transaction/transactionRecovery.js`
- Modify: `src/committing-to-git/transaction/transactionWorkspace.js`
- Modify: `src/committing-to-git/git/gitProcessTranscript.js`
- Modify: `src/committing-to-git/cli/commitWorkflow.js`
- Modify: `src/committing-to-git/command/publicationCommand.js`
- Modify: `src/committing-to-git/report/commitReport.js`
- Modify: `src/committing-to-git/schema/publicationResult.schema.json`
- Modify: `src/committing-to-git/schema/postCommitReport.schema.json`
- Modify: `src/committing-to-git/schema/commitTransaction.schema.json`
- Modify: `tests/committing-to-git/publication.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`
- Modify: `tests/committing-to-git/commit-report.test.mjs`
- Modify: `tests/committing-to-git/report-artifact-contract.test.mjs`
- Modify: `tests/committing-to-git/workflow-cost-contract.test.mjs`

**Interfaces:**

- `collectWorkspaceSummary(root, { scope, detailLimit = 49, enumerateAllUntracked = false }) -> WorkspaceSummary`
- `augmentReportWithPublication(report, publication) -> PostCommitReport`
- `readWorkspaceDetailPage({ transactionPath, cursor = null, refresh = false }) -> WorkspaceDetailResult`
- `reportDetailWorkflow({ transactionPath, cursor = null, refresh = false }) -> WorkspaceDetailResult`
- `publishWorkflow({ transactionPath, remote, destination, retryAfterAttempt = null }) -> PublishWorkflowResult`
- CLI: `workflow report-detail --transaction TRANSACTION_JSON [--cursor CURSOR | --refresh] [--format json|text]`
- CLI: `workflow publish --transaction TRANSACTION_JSON --remote REMOTE_NAME --destination refs/heads/BRANCH_NAME [--retry-after-attempt ATTEMPT_ID] [--format json|text]`

Use one exported serialized result budget:

```js
export const MAXIMUM_REPORT_RESULT_BYTES = 80 * 1024;
```

This budget covers the complete `JSON.stringify(result)` output, including `displayText`, transaction path, publication facts, and JSON escaping. It is separate from the 32-KiB canonical-message/evidence budgets. Human text and JSON projections are derived from one persisted report model and must both fit; exceeding the bound selects compact rendering rather than truncating a JSON document or omitting mutation state.

The persisted report model and its human rendering use this fixed information hierarchy:

1. **Outcome:** `Created signed commit`, `Created commit; signing/comparison invariant failed`, `Created commit; publication blocked`, `Commit not created`, or `Commit outcome unknown`. Use “signed” only when mandatory `git commit -S` creation and signed-commit-header presence are both recorded; this still does not imply trusted identity verification. Unknown outcome never receives a fabricated OID or success heading.
2. **Commit identity:** full OID in structured data; a collision-resistant abbreviated display OID, exact approved subject, and attached target ref or explicit detached-`HEAD` label in text.
3. **Exact comparison:** expected/actual parent array, tree, raw message-byte match, and signed-commit-header-presence booleans plus any hook-produced mismatch. Omit repetitive prose when all match, but never omit the structured facts.
4. **Change summary:** manifest-derived change-unit/kind totals and known insertion/deletion totals, with explicit binary/deferred-stat qualifiers. Do not repeat every file, rationale, or implementation component already mechanically available from the commit/message.
5. **Checks:** only checks actually supplied/run, with status and environment label; an empty list renders compactly or not at all.
6. **Signature:** selected policy, verified/unavailable/failed/skipped status, backend, exact-commit binding, trusted identity/fingerprint when verified, and trust-source reason when unavailable. Never collapse “good cryptographic signature but unreadable trust source” into verified identity.
7. **Remaining workspace:** exact paths only within count/byte budgets; otherwise honest compact directories/counts, scope relationship, conflict state, and nested-submodule disclosure. Never call unrelated files “user-owned” without evidence.
8. **Publication:** `not requested`, `not attempted because blocked`, known rejection, unknown, observed matching remote state, or successful push with remote/full destination ref. For not-requested/blocked/rejected states, say no successful push was recorded; for unknown, say the push outcome is unknown; for observed matching, say the remote currently points to the desired OID but the original actor/attempt is unproven. Only witnessed success says the helper pushed the commit.
9. **Recovery/retention:** only when actionable: `recoveryRequired`, retained failed-log digest/path, compaction/cleanup warning, or explicit retention. A clean successful compaction needs no ceremonial paragraph.

The human report leads with the outcome and actionable exception, not an implementation inventory. The JSON retains exact machine facts even when the text compacts them. Tests cover every outcome/signature/publication combination so “signed,” “verified,” “published,” and “matching remote observed” cannot be used interchangeably.

- [ ] **Step 1: Write count- and byte-triggered workspace boundary tests**

At 49 entries, render exact paths only when the complete serialized result fits `MAXIMUM_REPORT_RESULT_BYTES`. At 50 and 1,000, render only the count/detail-query record and no detailed prefix. Add fewer-than-50 long-path fixtures that cross the serialized limit by one byte and therefore compact early. Compact path samples use a lossless-safe prefix/suffix, raw byte length, and SHA-256; invalid UTF-8 or control bytes are escaped and never injected into terminal text. No output calls a compact directory an exact path count.

```js
assert.equal(rendered50.match(/^  - `/gmu)?.length ?? 0, 0);
assert.match(rendered50, /50 paths/u);
assert.doesNotMatch(rendered50, /file-0049/u);
```

Define the former "full-inventory pointer" as a tested high-level query, never a dangling artifact path or a reason to retain an O(F) terminal inventory. A compact report records only its report-time count/kind/digest and `detailMode: "fresh-observation"`. The first `workflow report-detail` call acquires an exclusive fixed journal beneath the exact transaction, streams a new read-only exact workspace observation into a helper-generated UUID observation directory, returns its first bounded page, and labels the new timestamp/digest plus `exactAtReportTime: false`; it never pretends to reconstruct historical workspace state. A concurrent first call returns a state conflict rather than overwriting that observation. An opaque base64url cursor of at most 512 bytes binds the transaction, starting-report, new-observation digests, and next raw-byte ordinal, contains no filesystem path, and is rejected if malformed, stale for that observation, or supplied for another transaction. Later cursor calls read that same immutable on-demand observation without rerunning status. A later append-only publication augmentation does not invalidate an already materialized observation or its completion replay; `--refresh` binds a new observation to the then-current report. Publication and cleanup must acquire the same transaction-state exclusion before changing/removing detail state, returning a state conflict rather than racing an active page operation. Every page fits `MAXIMUM_REPORT_RESULT_BYTES`.

The helper cannot know that stdout reached the caller merely because it computed the final page. Before deleting the O(F) pages and active journal, atomically persist one fixed `report-detail.completed.json` replay record containing the final request-cursor digest and canonical bounded result model. Its canonical JSON serialization is at most 80 KiB regardless of the invocation's output format. A retry with that same cursor returns byte-identical default JSON (or the same `displayText` through `--format text`) without rerunning status; a different or malformed cursor cannot consume it. For a one-page observation whose final request had no cursor, another ordinary cursorless call replays that completion rather than ambiguously starting over. After a completed multipage observation, a cursorless call without `--refresh` returns a bounded state conflict instead of silently replacing the replay record. `--refresh` is the explicit mutually exclusive request for a new observation after any completion; it may remove/replace the prior replay record only after its own durable journal exists. This retains at most one 80-KiB response, not a historical inventory, and closes the crash-after-cleanup-before-output gap. Interrupted nonfinal paging remains retryable/cleanable by exact transaction and may otherwise await OS temp cleanup. Normal terminal compaction retains no historical full inventory merely to advertise this command.

Test cursor tampering/cross-transaction use, one-page and multipage completion replay, lost stdout after durable completion, explicit refresh, cursorless conflict after multipage completion, publication augmentation between pages, and publication/cleanup exclusion while a page operation holds the transaction lock.

- [ ] **Step 2: Make workspace inspection scope-aware**

Use `--untracked-files=all` only for full scope or explicit full-detail reporting. Use `normal` for staged/paths reports so a huge unrelated untracked directory is represented compactly. Stream-parse porcelain `-z` output, updating counts/digests and only retaining exact display entries while count and projected serialized bytes remain under budget; never buffer an unbounded status result merely to decide later that it should be compact. Use `--ignore-submodules=dirty` for the routine top-level summary; report selected gitlink changes from the manifest and label nested submodule worktree state as not inspected unless a deep report was explicitly requested. Record whether the inventory is exact files or compact directories; do not imply completeness beyond the selected mode.

Test staged, paths, and full scopes independently with nested untracked directories and dirty submodules. The compact report must distinguish `exactPaths`, `compactDirectories`, and `nestedSubmoduleWorktrees: "not-inspected"`; it must never summarize a directory count as though it were an exhaustive file count.

- [ ] **Step 3: Reuse manifest and transaction facts**

When parent-array/tree/raw-message bytes match, take statistics and normalized change kinds from the approved manifest. Record the complete `headAnchor`; use its target symbolic ref when nonnull and label detached `HEAD` explicitly rather than deriving a branch from a possibly moved current `HEAD`. Do not run two new similarity diffs.

When any comparison differs, compute actual facts once for the anomaly report.

Add a table-driven report-language test across matching/blocked/unknown creation; required/advisory/skipped and verified/unavailable/failed signature states; no checks versus real checks; clean/exact/compact remaining workspace; and not-requested/rejected/unknown/observed/succeeded publication. Assert the fixed information hierarchy, full OIDs in structured facts, honest abbreviated display, state-specific no-success/unknown/observed/witnessed publication wording, no identity claim from unreadable trust, no “user-owned” inference, and no duplicate file-by-file implementation narration.

- [ ] **Step 4: Write a failing no-duplicate-report publication test**

Instrument Git calls and assert that `workflow publish` consumes the existing successful report, validates its bound commit/verification, performs one push, and augments the report without repeating commit facts/statistics/workspace collection.

- [ ] **Step 5: Implement gated high-level publication**

For an initial or known-rejection attempt, require:

- transaction phase `reported`, including a prior publication attempt with a known server rejection/no update; `publication-pending` must go through recovery observation and user-directed resolution before another attempt, while `published` is already terminal;
- matching parent-array/tree/raw-message report with required signed-commit-header presence;
- selected verification policy permitting publication;
- exact full commit OID from the transaction;
- configured remote name; and
- full valid destination branch ref.

Do not accept `--retry-after-attempt` on that ordinary route. An uncertain-attempt retry is the exceptional route defined below and must bind the exact prior helper-generated attempt ID rather than silently treating `publication-pending` as `reported`.

Resolve the remote only from Git's configured remote-name list, reject option-like/control-containing input, require the `refs/heads/...` prefix, validate that full destination with `git check-ref-format`, and invoke the argv equivalent of `git push --porcelain -- REMOTE_NAME FULL_OID:FULL_DESTINATION_REF`, with both validated user-derived values after Git's option terminator. Never interpolate remote/ref input through a shell. Use the same durable `not-started -> launching -> running -> completed` launch-state contract as commit creation; a captured server rejection is known, while a crash after `launching` is unknown regardless of local process exit assumptions. Preserve every completed/unknown attempt, never force, and never retry automatically.

Capture push child output through the same complete hashed transcript and one-command 16 KiB head/16 KiB failure-tail display budget as commit creation. A successful publication log is compactable; a rejected or unknown publication log remains referenced by the attempt until resolution or exact cleanup.

After an unknown attempt has its one durable recovery observation (matching, nonmatching, absent, or unavailable), `workflow recover --resolution confirmed-no-live-child` may record `retryPermitted: true` only when the destination was not observed matching, the user explicitly confirmed termination/restart, and the same reuse-resistant child/lock checks used for commit recovery find no contradiction. If the attempt has no observation yet, that resolution call performs the one allowed `ls-remote`; if an observation is already durable, it performs no second one. An unavailable observation remains explicitly unknown and is not presented as absence. Resolution never rewrites the original attempt's unknown outcome. A later separately authorized `workflow publish --retry-after-attempt ATTEMPT_ID` must match the latest unresolved attempt, exact remote, full destination, commit OID, report, and policy; it rejects a live/contradictory child, a missing resolution, or any changed target. It creates a fresh helper UUID attempt linked by `retryOf`, uses the same exact non-force OID refspec, and preserves every prior attempt. The explicit flag is a machine binding, not proof of user authorization; the skill must obtain and state the new push authorization before invoking it. Repeating the same non-force exact-OID refspec is convergent if the first attempt actually succeeded, while normal server-side ref checks still prevent overwriting a differently moved destination.

Each fresh attempt owns the active publication phase: witnessed success advances to `published`/`succeeded`; a completed known server rejection returns to `reported`/`rejected` so another future push still needs separate authorization; another uncertain launch remains `publication-pending`/`unknown` and must repeat the observation-resolution discipline for that new attempt ID. Historical attempts are append-only facts and never make an older retry token reusable.

- [ ] **Step 6: Emit the final augmented report directly**

After a completed push result, update only the publication section of the existing report and return one result no larger than `MAXIMUM_REPORT_RESULT_BYTES`, with the exact final report in `displayText`. Do not invoke full `report create` a second time. If publication details push the complete result over budget, compact workspace/detail presentation first while preserving commit, verification, comparison, and publication facts.

- [ ] **Step 7: Preserve unknown-outcome recovery**

`workflow recover` must recognize a pending publication journal. Durable `not-started` needs no network observation and returns a known no-push result. For `launching`/`running` without completion, perform exactly one bounded, read-only argv invocation equivalent to `git ls-remote --refs --exit-code -- REMOTE_NAME FULL_DESTINATION_REF` for the recorded remote and ref. Parse only the exact requested full ref, reject duplicate/conflicting records, and distinguish confirmed absence from transport/auth/protocol failure. Persist the observation time, returned full OID or absence, command exit classification, and digest in the same pending attempt; perform no push, force, ref write, or automatic retry. If the observed destination equals the intended full commit OID, classify `matching-publication-observed`, set `publicationState: "observed-matching"`, advance to `published`, and disclose that recovery observed the desired remote state rather than witnessing the original push. If it differs, is confirmed absent, or could not be observed, retain `publication-pending`/`outcome-unknown`: the original push may have failed or the remote may have moved again, and even a matching observation can move after it is recorded. Only the explicit no-live-child resolution plus a new user-authorized `--retry-after-attempt` transition defined in Step 5 may create a later attempt; a fresh helper UUID, never an agent-selected numbered filename, identifies it.

Exercise the uniform exits: success is `0`; an observed server rejection with no ref update is `1`; invalid input before a publication journal is `2`; a known commit whose current report/policy blocks publication is `3`; and a transport interruption with unknown remote outcome is `4`. No `3` or `4` path may automatically invoke a second push. The only later push after an unknown attempt is the separately authorized, resolution-bound `--retry-after-attempt` path, which receives its own journal/exit. Every path emits one parseable JSON document on stdout with child/network diagnostics on stderr.

- [ ] **Step 8: Verify reporting/publication**

Run: `node --test tests/committing-to-git/git-process-transcript.test.mjs tests/committing-to-git/artifact-schemas.test.mjs tests/committing-to-git/commit-report.test.mjs tests/committing-to-git/report-artifact-contract.test.mjs tests/committing-to-git/publication.test.mjs tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: PASS, including exact-at-49 only within the serialized budget, mandatory compaction at 50, byte-triggered compaction below 50, bounded fresh-observation detail pages with byte-identical final-page replay after cleanup, unambiguous one-page replay versus explicit `--refresh`, no dangling artifact pointer, zero remote calls for durable not-started publication, exactly one observation-only `ls-remote` per unknown attempt, distinct witnessed-success versus observed-matching states, rejection of unresolved/live-child retries, one fresh UUID attempt after explicit resolution plus authorization, and no duplicate report collection.

- [ ] **Step 9: Commit the compact publication task**

Proposed subject: `perf(committing-to-git): Reuse final transaction facts`

## Task 9: Promote Stable Drafts Without Repeating Review

**Files:**

- Create: `src/committing-to-git/workflow/promoteDraftWorkflow.js`
- Modify: `src/committing-to-git/workflow/prepareWorkflow.js`
- Modify: `src/committing-to-git/transaction/transactionWorkspace.js`
- Modify: `src/committing-to-git/cli/commitWorkflow.js`
- Modify: `src/committing-to-git/snapshot/commitSnapshot.js`
- Modify: `src/committing-to-git/schema/commitTransaction.schema.json`
- Modify: `tests/committing-to-git/draft-isolation.test.mjs`
- Modify: `tests/committing-to-git/signature-policy.test.mjs`
- Modify: `tests/committing-to-git/artifact-schemas.test.mjs`
- Modify: `tests/committing-to-git/workflow-e2e.test.mjs`
- Modify: `tests/committing-to-git/transaction-recovery.test.mjs`
- Modify: `tests/committing-to-git/workflow-cost-contract.test.mjs`

**Interfaces:**

- `promoteDraftWorkflow({ transactionPath }) -> PromotionResult`
- CLI: `workflow promote --transaction TRANSACTION_JSON [--format json|text]`

- [ ] **Step 1: Write stable and drifted promotion tests**

Stable case:

- same repository root;
- same complete `headAnchor` (unborn/attached/detached kind, target ref, and zero/one full expected parent OIDs);
- same normalized scope;
- newly staged actual tree OID equals the draft tree OID;
- the deferred signature/trust preflight is completed under the draft's recorded verification policy before any real-object/index mutation, or returns the same bounded capability/policy result as actual preparation;
- concise evidence capsule/route unchanged, or extended review catalog and finalized message hashes unchanged; and
- real index installation is the only staging transition.

For a path draft that originally coexisted with disjoint staged work, require that unrelated staged state to be absent at promotion time. If it remains, return `PROMOTION_BLOCKED_STAGED_STATE` with exit `1`, leave the index and draft unchanged, and do not ask the user to shrink the selected commit scope.

Drift cases:

- changed head kind, target ref, or expected parent array;
- changed selected file bytes;
- changed modes/symlink/gitlink;
- added or removed selected path;
- pre-existing unrelated staged state;
- active operation/conflict; and
- draft staged source-index digest/tree mismatch.

- [ ] **Step 2: Implement actual-tree recreation and exact comparison**

Before creating real objects or installing an index, run the Task 7 signature/trust preflight that draft preparation deliberately deferred. If required access is unavailable, return the capability request or honor an explicit advisory/skipped override with the draft transaction and real index unchanged; resumption repeats the complete head/index/tree preconditions before mutation. Record the successful preflight/policy transition atomically in the promoted transaction.

For draft full/paths, recreate and compare the complete current `headAnchor`, create the actual prepared index using the same literal scope and Git filters, write its tree in the real object database, and compare that tree OID with the draft tree OID before installing the real index through the journaled `installPreparedIndex()` transition from Task 2. Identical content produces identical Git object IDs even though the draft objects lived in the attempt-local store. Cover zero-parent unborn, one-parent attached, and one-parent detached promotion; a changed symbolic attachment is drift even when the object OID happens to match.

For draft staged, compare the current real-index digest with the recorded source digest, then create the actual real-index tree and require it to equal the attempt-local draft tree OID.

- [ ] **Step 3: Preserve authorization semantics**

Promotion is staging, not commit authorization. If the user asks to commit the already presented exact draft and the canonical message is byte-identical, their new commit request supplies commit authorization; do not force a second message-review cycle merely because the mode changed. An unchecked concise promotion remains `evidence-ready` and passes that exact displayed subject to `workflow commit` only when it still satisfies the direct-transport predicate; a checked concise or finalized extended promotion reuses its recorded `message-ready` artifact. If the message or scope changes, present the changed text/scope again and apply the revision invalidation rules before selecting the direct-subject, `message check`, or extended-finalizer path.

- [ ] **Step 4: Make drift restart only what changed**

If the complete head anchor and tree match, reuse the concise capsule or extended review/message state. If selected content changes, start a fresh actual transaction. If only a deterministic derived artifact is missing, regenerate that phase from the unchanged draft manifest. Do not mutate the old draft into an ambiguous hybrid.

Return the uniform JSON envelope on every path. A successful promotion is exit `0`; a state/drift precondition stop is exit `1`; malformed or unsupported transaction input is exit `2`. Promotion has no legitimate exit `3`/`4` because it creates neither a commit nor a remote mutation. An unexpected index-installation interruption is exit `1` with `recoveryRequired: true`; preserve both recorded before/after identities and require an observation-only recovery result before any retry.

- [ ] **Step 5: Verify promotion**

Run: `node --test tests/committing-to-git/draft-isolation.test.mjs tests/committing-to-git/signature-policy.test.mjs tests/committing-to-git/artifact-schemas.test.mjs tests/committing-to-git/workflow-e2e.test.mjs tests/committing-to-git/transaction-recovery.test.mjs tests/committing-to-git/workflow-cost-contract.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the promotion task**

Proposed subject: `feat(committing-to-git): Promote unchanged draft snapshots`

## Task 10: Perform the Atomic Public Cutover and Rewrite the Skill

**Files:**

- Modify: `skills/committing-to-git/SKILL.md`
- Delete: `src/committing-to-git/command/snapshotCommand.js`
- Delete: `src/committing-to-git/command/snapshotVerificationCommand.js`
- Delete: `src/committing-to-git/command/inspectionCommand.js`
- Delete: `src/committing-to-git/command/messageCommand.js`
- Delete: `src/committing-to-git/command/postCommitCommand.js`
- Delete: `src/committing-to-git/command/publicationCommand.js`
- Delete: `src/committing-to-git/schema/inspectionLedger.schema.json`
- Create: `skills/committing-to-git/references/inspection-recovery.md`
- Create: `skills/committing-to-git/references/transaction-recovery.md`
- Create: `skills/committing-to-git/references/signature-recovery.md`
- Modify: `skills/committing-to-git/references/message-format.md`
- Modify: `skills/committing-to-git/references/publication-recovery.md`
- Delete: `skills/committing-to-git/references/change-inspection.md`
- Delete: `skills/committing-to-git/references/execution-permissions.md`
- Delete: `skills/committing-to-git/references/signature-verification.md`
- Delete: `skills/committing-to-git/references/transaction-artifacts.md`
- Modify: `tests/committing-to-git/commit-workflow-cli.test.mjs`
- Modify: `tests/committing-to-git/workflow-cost-contract.test.mjs`
- Modify: `README.md`

**Interfaces:**

The public main file must expose only:

1. scope/mode choice;
2. evidence-policy choice;
3. the rule that the user's hint guides but does not dictate type, scope, description, rationale, UX, or exact paths;
4. `workflow prepare` and its concise/extended route result;
5. direct construction by default for transport-safe subject text, or one fixed transaction-local `message-input.txt` plus `message check` for multiline/nonportable text, explicit checked-file preference, or checked-route revision, followed by exact approval;
6. conditional packet reading, worksheet editing, and `message finalize` only on the extended route;
7. `workflow promote` when an unchanged draft is later authorized as an actual commit;
8. `workflow commit` with the direct approved subject or the recorded checked/finalized text;
9. optional `workflow publish`; and
10. routing to exceptional `workflow recover` plus persisted-input `workflow resume`, fixed-input `workflow extend`, `workflow verify`, `workflow cleanup`, and on-demand `workflow report-detail` references.

Every command example uses the high-level JSON contract by default. The instructions tell the agent to parse `status`, `phase`, `terminalDisposition`, and exit class; present `displayText` verbatim when present; pass the one opaque transaction path without reading it; and never treat stderr hook/signing chatter as the canonical result. `--format text` is documented as a common option for direct human invocation only and is never required in an agent workflow.

- [ ] **Step 1: Write instruction-level regressions before rewriting**

Assert that the canonical skill:

- never instructs manual UUID allocation;
- never instructs manual scope/check file creation on the ordinary path;
- never requires per-packet acknowledgement commands;
- never requires `inventory.md` plus `ledger.json` reads;
- never requires standalone render plus validate;
- defaults a transport-safe subject-only concise message to no preapproval message command, while using exactly one recording `message check` for multiline/nonportable text, an explicit checked-file request, or a revision already on that route;
- writes checked text only to the fixed transaction-local `message-input.txt`, invokes `message check` without a caller-supplied path, and creates no second temporary directory/UUID or ownership handover;
- writes a later mixed/uncertainty evidence plan only to fixed transaction-local `evidence-plan-input.json`, invokes `workflow extend --reason evidence-uncertainty` without a caller-supplied plan path, uses `--reason semantic-structure-required` with no new plan/packet reads for structured bulk authorship, and writes extended content only to fixed `content.json` before invoking `message finalize` without a caller-supplied content path;
- never defines concise eligibility by one file, a maximum file count, or a mandatory subject supplied verbatim by the user;
- tells the agent to test the user's hint against evidence and select the accurate type, scope, outcome, rationale, and user-experience consequence;
- treats a user hint alone as `message` evidence and permits `reuse` only with specific authored/read/generated/surviving lineage;
- stages one unambiguous current-task scope for normal approval but asks before staging when two materially different scopes remain plausible;
- never passes a semantic hint as a glob, pathspec, prefix, or other fuzzy scope selector;
- follows loaded repository type policy before the built-in semantic type guide and performs no routine history scan for classification;
- chooses the most specific type for the dominant outcome when multiple ordinary types fit, without listing alternatives or asking unless release/user semantics materially differ;
- applies `canUseDirectSubjectTransport()` before interpolating any subject into a shell command and routes Unicode or shell-active/nonportable punctuation through an exact message file;
- permits a subject-only concise message at any coherent scope size and adds optional sections only when they contribute durable information;
- requires exactly one terminal LF in every canonical message, treats direct `--message` as a subject payload encoded only as `subject + LF`, and rejects CR/C0/C1/invalid-UTF-8 or normalized approval bytes;
- allows a checked detailed `File Changes:` inventory only below 50 units when exact path coverage fits, requires structured finalization for counted bulk domains, and never forces that optional section on a concise many-file commit;
- derives ordinal width from the final list count, right-aligns ordinals from one through four digits with two-space base indentation, aligns nested descriptions dynamically, adds derived singular/plural file counts to bulk domain titles, and does not add a count to the `File Changes:` heading;
- never escalates solely because a path/domain is security-, migration-, deployment-, lockfile-, generated-, or submodule-related; it escalates only for explicit review, unresolved evidence, or unexplained special Git facts;
- classifies revisions as wording-only, new semantic claim, or changed tree/scope and invalidates only the corresponding message, evidence delta, or complete preparation anchor;
- leaves semantic revision classification to agent judgment, never claiming that a keyword/edit-distance/embedding heuristic can distinguish wording from a new claim;
- keeps only the latest valid checked message/validation/hash plus a monotonic revision number, preserving the prior state on failure rather than accumulating historical bodies;
- gives a known-context concise transaction exactly the `workflow prepare` -> exact approval -> `workflow commit` path, with no artifact read/edit between those commands;
- embeds bounded `message` evidence in the preparation result and selects extended rather than truncating an over-budget patch;
- exposes `workflow extend` only for a named uncertainty discovered after concise preparation and reuses the same snapshot;
- exposes `workflow promote` as the only unchanged-draft-to-actual staging transition and preserves exact approval semantics;
- resumes a recoverably interrupted preparation only through `workflow resume` using persisted inputs, never by reconstructing or broadening the original prepare command;
- never requires standalone `git commit`, OID lookup, signature verify, or report create;
- requests the known required Git-metadata capability before the first actual preparation/commit command when the host declares `.git` read-only, rather than probing and failing;
- states and preflights the Git 2.45+ requirement before allocation so `GIT_NO_LAZY_FETCH=1` cannot be silently ignored by an older runtime;
- rejects every removed low-level route with `UNKNOWN_COMMAND` before filesystem or Git effects;
- rejects every old attempt/schema version with `UNSUPPORTED_ATTEMPT_VERSION` and never migrates it in place;
- distinguishes scope verification, message evidence, and full review;
- explains exact non-overlapping evidence partitions for mixed provenance without demanding a per-file policy list;
- treats `evidence-required` as a bounded delta read followed by the same finalizer, never a full preparation/review restart;
- explains that detailed rationales may overlap while counted bulk domains may not;
- selects structured bulk finalization at 50 units or when projected detailed output would exceed 32 KiB whenever a file/domain inventory is included, while permitting the concise message to omit that inventory and never questioning the selected scope;
- rejects unmatched path selectors without autocorrection;
- permits disjoint staged work only for path-scoped drafts and blocks promotion until it is gone;
- defines exit classes `0` through `4` and the no-repeat rule for known/unknown commit or push outcomes;
- uses one canonical head anchor for attached, detached, and zero-parent unborn transactions and compares raw commit-message bytes without trimming;
- treats an unchanged ref after a `launching`/`running` crash as unknown, and never supplies `confirmed-no-live-child` without explicit user confirmation of process termination/restart;
- distinguishes a witnessed successful push from a recovery-time matching remote observation, performs no automatic publication retry, and binds any separately authorized retry to the resolved prior attempt through `--retry-after-attempt`;
- bounds noisy child diagnostics, points to the complete hashed failure log, and distinguishes compaction from exact terminal purge;
- compacts report path output by serialized byte budget as well as count, and makes every detail pointer a bounded `workflow report-detail` query rather than an artifact that cleanup can delete;
- replays a completed detail page for the same cursor, including cursorless one-page output, and uses explicit `--refresh` rather than guessing whether a cursorless caller wanted new state;
- keeps exact approval and push authorization; and
- routes exceptions to focused references only after they occur.

- [ ] **Step 2: Delete obsolete routes, schema readers, and command-only adapters**

Delete every old command adapter and obsolete inspection schema listed in this task, remove their CLI dispatch/help entries, delete v1/live-workspace validator branches, and update or remove tests that exercised them. Retain reusable Git/snapshot/inspection/message/signature/report logic only in the focused domain and high-level workflow modules introduced by earlier tasks. Do not leave dormant readers, feature flags, aliases, deprecation warnings, or environment switches capable of selecting the removed workflow.

Run: `rg -n "snapshot create|snapshot verify|inspection acknowledge|message scaffold|message render|message validate|signature verify|report create|publication push" skills/committing-to-git src/committing-to-git tests/committing-to-git`

Expected: no executable/help/test caller of a removed route. Matches in explicit negative assertions or archived historical documentation outside those paths are allowed.

- [ ] **Step 3: Rewrite `SKILL.md` as a concise transaction guide**

Target:

- no more than 1,500 whitespace-delimited words;
- no more than 12 KiB;
- the complete known-context concise route, exact authorization boundary, and hint-as-hypothesis rule within the first 450 words;
- no prose hard-wrapping added to canonical `SKILL.md`; keep logical paragraphs readable as authored rather than inserting mechanical fixed-width line breaks;
- no always-required reference on the ordinary happy path;
- one command block per high-level phase;
- one table for draft/actual and staged/full/paths;
- one table for `reuse`/`message`/`review` evidence policy;
- one compact classification guide covering at least `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, and `chore`, with loaded repository policy taking precedence;
- one compact table for exit class, mutation certainty, and permitted next action;
- an explicit Git 2.45+ runtime statement tied to the no-hidden-lazy-fetch guarantee;
- one sentence explaining that file count never determines concise eligibility;
- one sentence for the conditional 50-unit/32-KiB file/domain presentation trigger and one sentence for `evidence-required` convergence;
- direct guidance to improve an imperfect hint rather than ask the user to supply a Conventional Commit category or exact description;
- explicit guidance to choose the most specific dominant-outcome type without routine alternatives, and to disclose a tie only when it changes material release/user meaning;
- the direct-transport predicate plus a rule to create/check an exact message file before command construction for multiline, Unicode, or nonportable punctuation;
- the fixed transaction-local message-input path, its successful-consumption/failure-preservation lifecycle, and the absence of arbitrary `--message-file` paths;
- a three-level revision table covering wording-only reuse, new-claim evidence deltas, and fresh preparation for every tree/scope change;
- a statement that deterministic code enforces declared evidence/tree/byte facts but does not infer semantic equivalence, plus a constant-space latest-valid-message revision rule;
- an explicit statement that no path/domain label is an escalation deny-list;
- a bounded history-inspection exception only when a material repository-specific convention remains unresolved;
- explicit side effects and authorization immediately before the relevant command; and
- no repeated prohibition when the helper already rejects the condition.

Do not chase the numeric target by deleting a safety decision. If the text exceeds it, move exception mechanics into the one relevant reference and retain the decision in the main file.

- [ ] **Step 4: Reorganize references by exception, not implementation internals**

Create, modify, and delete the exact reference files listed in this task. The final routing is:

- `references/inspection-recovery.md` - uncertain content, deletion expansion, binary/gitlink boundaries, packet truncation or corruption;
- `references/transaction-recovery.md` - permissions, locks, partial derived phases, pending/unknown commit outcome;
- `references/signature-recovery.md` - trust-source unavailability, policy change, backend-specific identity limits;
- `references/publication-recovery.md` - pending remote observation, explicit no-live-child resolution and separately authorized retry from a matching capsule, plus the honest refusal/limited guidance when no matching transaction capsule exists; and
- `references/message-format.md` - extended detailed/bulk mechanics and unusual policy conflicts; the main skill contains enough subject/optional-section guidance for the concise route without loading this reference.

Do not make a user load artifact allocation mechanics; the helper owns them.
The message reference must not reintroduce a mandatory body or `File Changes:` section on the concise route. It documents the exact optional-section order plus extended detailed/bulk mechanics, while `SKILL.md` already tells the agent when those sections add value.

- [ ] **Step 5: Explain why the streamlined steps exist**

The skill should say, in plain language:

- the user's hint supplies direction, while inspection lets the agent correct classification, sharpen the outcome, and add only useful rationale or UX context;
- exact scope comes from task lineage and Git facts rather than fuzzy interpretation of the hint; ambiguity is resolved before staging;
- loaded repository policy plus semantic classification avoids making the user remember type taxonomy or paying for routine history scans;
- concise eligibility tracks unresolved semantic uncertainty rather than file count;
- the exact manifest and bounded scope synopsis prevent accidental inclusion without pretending to display or review every bulk path;
- current-task evidence is reused, bounded message evidence is inline, and extended packets are driven only by unresolved uncertainty;
- the receipt binds exact packet identities but cannot prove reading;
- evidence revisions materialize only a new packet delta and preserve unchanged hash coverage;
- shared rationale prevents repetitive diff paraphrase;
- transport-safe subject approval keeps semantically simple messages at two helper calls, while one checked canonical file protects multiline or nonportable approval bytes without semantic scaffolding;
- the helper accepts any valid checked message because proportional route choice belongs to skill guidance/evaluation, while the one fixed UUID-transaction input prevents collision and external-file ownership ambiguity;
- revision invalidation follows the fact that changed prose, changed claims, and changed trees invalidate progressively stronger anchors;
- one commit transition reduces races and duplicate retries; and
- journals preserve unknown outcomes without automatic replay;
- bounded stderr plus a complete hashed failure log prevents diagnostic floods without discarding evidence; and
- safe terminal compaction reclaims temporary bulk without global attempt discovery.

- [ ] **Step 6: Update public discovery documentation**

Update `README.md` with the Git 2.45+ runtime floor and its no-hidden-lazy-fetch reason, the high-level command groups, the concise-versus-extended evidence distinction, transport-safe direct subject versus fixed transaction-local checked approval, the fact that the skill improves a strong user hint rather than requiring exact Conventional Commit terminology, and the distinction between deployable skill content and maintainer evals. State that arbitrary external message-file paths are not accepted, but do not expose authoring-only source module detail as an installation requirement.

- [ ] **Step 7: Build and verify the public bundle**

Run: `npm run build`

Expected: PASS and `skills/committing-to-git/scripts/commitWorkflow.mjs` regenerated from source.

Run: `npm run build:check`

Expected: PASS with no source/bundle drift and no ASCII violation.

- [ ] **Step 8: Commit the atomic cutover**

Proposed subject: `refactor(committing-to-git): Cut over to proportional transactions`

## Task 11: Run Deterministic, Model, and Human-Readability Evaluation

**Files:**

- Modify: `evals/committing-to-git/create-fixture-repository.mjs`
- Modify: `evals/committing-to-git/evals.json`
- Modify: `evals/committing-to-git/README.md`
- Modify: `tests/committing-to-git/eval-fixtures.test.mjs`
- Create: `docs/assurance-cases/2026-08-23-committing-to-git-proportional-workflow.md`
- Add only after execution: versioned result JSON files under `evals/committing-to-git/results/`

**Interfaces:**

- Fixture metadata records expected safety facts and cost-budget facts separately.
- Model run records contain exact model/version, effort, tool policy, input/output tokens, elapsed model time, helper/tool calls, failed commands, permission requests, approval turns, selected route, opaque transaction-handle pass-throughs, agent-managed workflow artifact reads/writes, and final Git state when the runner exposes them.
- Grading reports safety macro pass, hint-improvement/type-scope-outcome quality, optional rationale/UX usefulness, route correctness, and efficiency-budget pass separately.

- [ ] **Step 1: Obtain exact configuration approval and migrate evaluation identities**

This step is the sole planned configuration edit. Before changing `evals/committing-to-git/evals.json`, present its complete proposed diff: every active prompt/expectation, the exact metric list, and the migration table below. Obtain explicit approval naming that file and those fields. Approval to execute the implementation plan or to transmit later model prompts is not configuration approval. If the approved diff differs, amend this plan or record the approved delta before editing.

Keep active IDs stable when their safety/product intent survives, even though every old low-level command/ledger expectation is rewritten to the atomic high-level interface. Do not require contiguous IDs and never repurpose a retired ID. Git history is the source for old prompt text; the deployable/evaluated configuration contains no compatibility behavior, inactive legacy case, old-schema runner, or ignored `retired_evals` branch.

The exact existing-ID disposition is:

| ID | Disposition | Active post-cutover intent |
| ---: | --- | --- |
| 1 | Rewrite | Large draft uses exact manifest plus bounded synopsis/evidence, never aggregate-output overflow or ledger acknowledgement |
| 2 | Rewrite | Staged rename is committed as one unit without restaging the vanished source or unstaged lockfiles |
| 3 | Rewrite | Structured detailed ordinals and bulk-domain counts obey 9/10/49/50 alignment and heading rules |
| 4 | Rewrite | Unreadable SSH trust is preflighted/classified, an advisory override is obeyed, and the existing commit is never recreated |
| 5 | Rewrite | Vite warning prevention, container alignment, and native ESM rationale improve the mechanical hint |
| 6 | Rewrite | Rename/addition/binary/mode/symlink/gitlink facts are exact; similarity never invents copy provenance |
| 7 | Rewrite | A 1,000-file requested scope remains intact and an optional structured bulk inventory uses counted domains without O(F) authorship |
| 8 | Rewrite | Hook-altered message bytes are detected from the raw commit object; the commit remains intact and publication is blocked |
| 9 | Retain intent, update envelope | Active cherry-pick stops the ordinary workflow before mutation |
| 10 | Rewrite | Complete head-anchor drift invalidates the old approval and starts a fresh proportional transaction, not a forced full-review ritual |
| 11 | Rewrite | Literal hostile path selection remains byte-exact through high-level preparation |
| 12 | Rewrite | `chore` is syntactically supported, but an unrepresentable mandatory trailer stops before staging |
| 13 | Rewrite | Pre-authorized commit and push retain exact message approval and use one report augmented after exact-OID publication |
| 14 | Rewrite | Draft isolation, exact proposal, and no commit-authorization request |
| 15 | Rewrite | A later push without a transaction capsule does not claim missing assurance or touch current workspace changes |
| 16 | Rewrite | Mixed hunks require an intentionally staged scope; whole-path staging is rejected |
| 17 | Rewrite | Fixed UUID system-temp ownership prevents self-inclusion; an active draft remains until commit, abandonment, or OS cleanup |
| 18 | Rewrite | A reversible derived/preparation failure is observed and resumed from its durable transaction anchor, not blindly restarted |
| 19 | Rewrite | Verification identity is bound to the exact full commit OID, not merely the same signing key |
| 20 | Retire | Obsolete `manualReviewRequired`/legacy validator contract; deterministic validation plus agent semantic approval replaces it |
| 21 | Rewrite | Pending publication performs one observation-only `ls-remote`, distinguishes observed matching state, and never retries without explicit no-live-child resolution plus a separately authorized helper-UUID attempt |
| 22 | Retire | Obsolete compatibility rerender from a legacy copy-classified ledger; addition semantics remain covered by ID 6 and revision cases 53-55 |
| 23 | Rewrite | Exclusive CSPRNG UUIDv4 allocation avoids stale-attempt collision without registry/handover discovery |
| 24 | Rewrite | Numbered attempt directories, `owner.json`, handover, and occupied-artifact reuse remain prohibited |
| 25 | Retire | Duplicate of ID 4; retain its wording only as an out-of-file held-out paraphrase |
| 26 | Retire | Duplicate of ID 10; retain its wording only as an out-of-file held-out paraphrase |
| 27 | Retire | Duplicate of ID 5; retain its wording only as an out-of-file held-out paraphrase |
| 28 | Rewrite | Known read-only Git metadata causes scoped capability acquisition before the first actual preparation attempt |
| 29 | Rewrite | Undisclosed index-install permission failure is observed, then the same persisted scope resumes with narrow capability |
| 30 | Rewrite | A real live index lock is concurrency, not a permission prompt or authorization to delete the lock |
| 31 | Rewrite | A provably non-mutating preparation permission failure follows recover/resume without a new UUID or broadened scope |
| 32 | Rewrite | Grounded whole-file deletion summaries avoid rereading removed bodies and require no acknowledgement commands |
| 33 | Rewrite | An unexplained consequential deletion expands only its old blob through the current delta queue or asks the user |
| 34 | Rewrite | Bounded packet contents are read sequentially and completely without batched display overflow or hash acknowledgements |

Append only these genuinely new active prompt identities, starting after the historical maximum:

| ID | Case key | New behavior isolated |
| ---: | --- | --- |
| 35 | `known-context-skill-inventory-hint` | Strong but imperfect micro-flow hint reaches prepare/approve/commit without ceremony |
| 36 | `bounded-three-file-fix-misleading-feature-hint` | Evidence corrects `feat` to `fix` and explains why |
| 37 | `known-context-twelve-file-feature` | Coherent many-file work remains concise |
| 38 | `generated-many-file-migration` | Grounded generated lineage remains concise without a file ceiling |
| 39 | `single-file-unknown-security-review` | One unknown file correctly selects extended review |
| 40 | `grounded-security-change-concise` | The same domain remains concise when grounded |
| 41 | `unambiguous-six-file-scope` | One task-bounded scope stages without a redundant preliminary approval |
| 42 | `ambiguous-competing-scopes` | Materially different scopes stop before staging |
| 43 | `hint-only-message-evidence` | A hint alone selects `message`, never `reuse` |
| 44 | `generated-lineage-reuse` | Specific observed generator lineage permits `reuse` |
| 45 | `classification-without-history-scan` | Loaded policy/semantics avoid routine history inspection |
| 46 | `repository-specific-history-exception` | One bounded history query is justified only by a material unresolved convention |
| 47 | `dominant-outcome-type-tie` | The most specific dominant type is chosen without alternatives |
| 48 | `material-release-semantics-tie` | A truly material type ambiguity is disclosed |
| 49 | `concise-multiline-message-check` | Multiline concise text uses one fixed-file check |
| 50 | `concise-nonportable-subject-check` | Unicode/shell-active subject text is selected before interpolation and checked exactly |
| 51 | `portable-subject-explicit-check` | Explicit checked-file preference remains valid |
| 52 | `portable-direct-subject` | The ordinary portable subject uses no preapproval helper |
| 53 | `wording-only-revision` | Message approval changes while tree/evidence survive |
| 54 | `new-semantic-claim-revision` | Only missing evidence is acquired for a new claim |
| 55 | `changed-tree-revision` | Any tree/scope change creates a fresh anchor |
| 56 | `mixed-provenance-selectors` | Compact non-overlapping `reuse`/`message`/`review` partition |
| 57 | `mixed-evidence-delta` | Finalization requests only newly required packets |
| 58 | `reuse-after-compaction-sufficient` | Specific surviving lineage remains usable after compaction |
| 59 | `reuse-after-compaction-vague` | Vague lineage escalates instead of pretending reuse |
| 60 | `draft-promotion` | Exact unchanged draft promotion avoids rereview but still needs commit authorization |
| 61 | `draft-ready-retention` | Conversational presentation does not compact an active draft |
| 62 | `high-level-json-exits` | All exit classes produce one bounded result and enforce no-repeat mutation rules |
| 63 | `unsupported-old-attempt` | Old attempts fail explicitly with no migration path |
| 64 | `noisy-child-recovery` | Bounded diagnostics preserve a complete hashed failure log |
| 65 | `compact-report-and-publication-reuse` | Byte/count-compacted report detail is queryable and publication augments it once |
| 66 | `resolved-publication-retry` | An unknown push is observed once, a live-child/unresolved retry is refused, and only explicit resolution plus new push authorization permits a bound fresh attempt |

Add `schemaVersion: 2` and retain `id`, `prompt`, `expected_output`, `files`, and `expectations` for every active entry. Add only `case_key`, `execution_mode` (`policy` or `executable`), `fixture` (string or `null`), `critical_safety` (boolean), and `cost_profile` (named string or `null`). Replace the metric list with exactly: atomic expectation pass rate, all-or-nothing case pass rate, critical-safety pass, forbidden actions, approval round trips, permission requests, failed commands, high-level helper calls, opaque transaction-handle pass-throughs, agent-managed workflow artifact reads, agent-managed workflow artifact writes, route correctness, exact evidence coverage, hint/type/scope/outcome improvement, rationale/UX usefulness, input tokens, output tokens, total tokens, model elapsed time, wall-clock elapsed time, and final Git-state correctness. After approval, first add failing fixture/config tests for this exact schema, ID migration, retired-ID absence, and removed-command expectation rejection; run them and observe failure against the old file. Then edit the approved configuration and harness until those tests pass. The harness rejects unknown fields, duplicate IDs/keys, references to missing fixtures/cost profiles, and any expectation that names a removed command. It permits the intentional ID gaps and never loads retired cases.

- [ ] **Step 2: Add executable scale fixtures**

Add disposable scenarios for:

- `known-context-skill-inventory-hint`, reproducing the `skills-lock.json` update plus unrelated exclusions and the hint `Add new agent skills, update existing skill`;
- `bounded-three-file-fix-misleading-feature-hint`, where evidence must change the apparent type from `feat` to `fix`;
- `known-context-twelve-file-feature`, where one coherent current-task purpose remains concise;
- `generated-many-file-migration`, where a generated/derived functional unit remains concise without a file-count ceiling;
- `single-file-unknown-security-review`, where unknown content must select extended review, paired with `grounded-security-change-concise`, which must remain concise despite the same path/domain label;
- `implementation-mechanics-hint`, where the subject must describe the outcome and optional rationale/UX may capture non-deducible context;
- `unambiguous-six-file-scope`, with unrelated workspace changes and no preliminary scope-approval turn;
- `ambiguous-competing-scopes`, which must ask before staging either plausible set;
- `hint-only-message-evidence` and `generated-lineage-reuse`, proving the evidence-policy boundary on otherwise similar changes;
- `classification-without-history-scan`, plus a repository-specific ambiguity arm where one bounded history inspection is justified;
- `dominant-outcome-type-tie`, with ordinary `feat`/`fix`/`refactor` candidates but one most-specific dominant result, plus a material-release-semantics tie that justifies disclosure;
- `concise-multiline-message-check`, `concise-nonportable-subject-check`, and `portable-subject-explicit-check`, whose only preapproval addition is the fixed transaction-local input plus `message check`;
- `portable-direct-subject`, `unicode-subject`, and table-driven shell-active punctuation subjects, proving that the skill selects transport before interpolation and the helper rejects unsafe direct input before mutation;
- `wording-only-revision`, `new-semantic-claim-revision`, `changed-tree-revision`, and `checked-message-100-revisions`, proving the three invalidation levels and constant-space message state;
- `mixed-provenance-selectors` with compact `reuse`, `message`, and `review` groups;
- `mixed-evidence-delta` whose refinement requires three new packets while unchanged evidence remains covered;
- `invalid-utf8-inline-evidence` and `scope-synopsis-one-byte-over`, proving deterministic extended reasons without replacement decoding or partial concise output;
- `partial-clone-missing-object`, proving no lazy fetch/network/object write and resumable evidence after a separately authorized fetch;
- `configured-readonly-external-drivers`, proving diff/textconv/pager/filesystem-monitor configuration cannot execute during machine inspection;
- `reuse-after-compaction` with one sufficient and one deliberately vague lineage record;
- `binary-1000` using small deterministic blobs;
- `bulk-domain-1000`;
- `generated-lockfile-10mb`;
- `huge-single-line`;
- `canonical-message-terminal-lf`, `message-result-worst-case-escaping`, and `structured-bulk-only`, covering exact byte and serialized-envelope boundaries;
- `minimum-git-no-lazy-fetch`, proving an unsupported Git stops before allocation while a Git 2.45+ capability probe enables the network-free read-only contract;
- `head-anchor-attached`, `head-anchor-detached`, and `head-anchor-unborn`, including zero-parent commit/recovery comparison;
- `draft-promotion`;
- `draft-ready-retention`, proving that presentation alone does not compact an active draft and a later known local commit does;
- `draft-paths-disjoint-staged`, `draft-paths-overlap-staged`, and `actual-paths-prestaged`;
- `unmatched-include-selector` and `unmatched-exclude-selector`;
- `signature-trust-unreadable` with controlled Git output/path permissions where the platform supports it;
- `signature-header-required-under-skip`, proving skipped identity verification still requires a signed commit object and blocks publication otherwise;
- `preparation-permission-recover-resume`, proving the persisted-input continuation without scope reconstruction;
- `commit-outcome-pending` using failure injection rather than killing an uncontrolled real process;
- `noisy-hook-10mb` with deterministic output and a successful and rejecting arm;
- `known-safe-terminal-cleanup` plus link/reparse and pending-outcome purge rejection;
- `workspace-remaining-49`, `workspace-remaining-50`, and `workspace-long-path-byte-budget`;
- `report-detail-final-page-replay`, proving a crash after durable final-result creation cannot lose the response after O(F) pages are removed, cursorless one-page output replays, and only explicit `--refresh` starts a new observation;
- `workspace-nested-submodule-disclosed-uninspected`;
- `unsupported-old-attempt`;
- `high-level-json-exits` covering every exit class;
- `publish-existing-report` against a local bare remote;
- `publication-recovery-observation`, proving exactly one bounded read-only `ls-remote`, distinct `observed-matching` provenance, and no automatic push; and
- `resolved-publication-retry`, proving explicit user-confirmed no-live-child resolution and new push authorization are both required before a fresh UUID attempt bound to the uncertain predecessor.

The generator must keep its current absolute-new-destination and outside-source-worktree guarantees.

- [ ] **Step 3: Add executable cost assertions**

Grade transcript and repository state together. Examples:

- exactly one prepare and one commit helper call, one opaque transaction-handle pass-through, zero agent-managed workflow artifact reads/writes, and one approval turn for `known-context-skill-inventory-hint`;
- exactly one prepare, one message check, and one commit helper call for multiline and nonportable concise fixtures, with only the transient fixed input followed by one canonical message and no semantic/review artifact;
- exactly one prepare and one commit helper call for a transport-safe subject, with no message file or preapproval message command;
- successful explicit checked-file use for a transport-safe subject without weakening its ordinary two-call default;
- no worksheet/finalizer on any concise fixture, including the twelve-file and many-file cases;
- no concise route for the one-file unknown security fixture, while the grounded security fixture remains concise and proves there is no sensitive-path/domain deny-list;
- complete inline evidence and no truncation for bounded `message` fixtures, with automatic extended routing one byte beyond the result budget;
- no verbatim-hint requirement; grade accurate type/scope/outcome, grounded rationale, and relevant user-experience assessment separately;
- no preliminary scope-approval turn for the unambiguous current-task fixture and no staging at all for the ambiguous competing-scope fixture;
- no `reuse` from a prompt hint alone and no unnecessary patch inspection after specific generator lineage;
- no ordinary `git log`/history call for type classification;
- no routine alternatives or clarification for an ordinary type tie, with the most-specific dominant outcome selected; disclosure occurs for the material release-semantics tie;
- no shell command is constructed with Unicode or excluded shell-active subject text interpolated into `--message`; those exact bytes travel through the checked-file route;
- direct `--message` carries only a subject payload and produces canonical `subject + LF`; every checked/finalized message has exactly one terminal LF and no prohibited control or replacement-decoded bytes;
- wording-only revision performs no evidence acquisition, a supported new semantic claim reuses the tree and acquires at most its missing evidence delta, and any changed tree/scope creates a fresh preparation/approval anchor;
- no semantic keyword/similarity/embedding heuristic in the helper and no model claim that deterministic validation proved semantic equivalence;
- no manual temporary-directory command, no second UUID, no arbitrary message/evidence-plan/content path, and no fixed-input ownership handover;
- successful checking removes the transaction-local input after durable replacement, failed checking leaves it for correction, and 100 successful revisions retain one current canonical body/validation rather than 100 historical copies;
- an active draft in `evidence-ready`, `review-pending`, or `message-ready` retains reusable artifacts, while a fully recorded local commit compacts without waiting for publication;
- no per-packet acknowledgement command;
- no exhaustive individual-path read for a coherent 50+-file bulk synopsis unless full review or an anomaly requires it;
- one high-level post-approval commit command;
- no known-doomed permission attempt;
- no full-patch materialization under `reuse` unless an unexplained unit appears;
- no whole-scope escalation when one compact selector group alone needs `review`;
- no repeated synopsis/packet read when `message finalize` returns one mixed evidence delta;
- no eager whole-scope line-stat pass above the recorded byte budget;
- every read-only Git child uses `GIT_OPTIONAL_LOCKS=0` and `GIT_NO_LAZY_FETCH=1`, and every draft leaves real index/object/ref/log metadata unchanged;
- no configured external diff, textconv, pager, color, or filesystem-monitor helper executes on a read-only machine-inspection path;
- an unsupported Git cannot begin a transaction, so no test passes merely because an old runtime ignored `GIT_NO_LAZY_FETCH`;
- exactly one full non-deletion patch pass under `review`, with whole-file deletion bodies expanded only under the deletion rule;
- no O(F) domain ID array;
- no free-form counted bulk domain passes exact validation; structured selectors derive every domain count and ordinal indentation;
- no reversible preparation interruption is rebuilt from agent memory; recovery observation gates one persisted-input `workflow resume`;
- no second report collection before/after push;
- no bulky review packet directory after successful compaction;
- no bulky review/object/log directory after any known-safe terminal disposition unless retention was requested;
- no more than 32 KiB plus fixed markers of agent-visible child diagnostics for a 10 MiB child log, with exact full-log hash/byte facts retained on failure;
- no message result exceeds 80 KiB and no report/detail result exceeds 80 KiB after complete JSON serialization, including worst-case escaping and long paths;
- no compact report contains a dangling artifact pointer, and publication recovery performs one observation-only `ls-remote` with no push;
- final report-detail output is byte-identically replayable after its large page set is removed, cursorless one-page retry is distinct from explicit `--refresh`, and an observed-matching publication is never mislabeled as a witnessed push;
- no publication retry occurs without a matching prior attempt, explicit no-live-child resolution, and a new user push authorization; the retry receives a fresh linked UUID journal;
- exactly one bounded JSON stdout document per high-level command, including failures; and
- no automatic retry of commit/push after exit `3` or `4`; the sole publication exception is a fresh, separately authorized attempt after the recorded no-live-child resolution, and commit creation has no analogous retry.

- [ ] **Step 4: Run the full deterministic suite**

Run: `npm run verify`

Expected: format, lint, ASCII, bundle drift, full tests, canonical skill validation/lint, and diff check all pass.

- [ ] **Step 5: Run matched model arms sequentially**

For the weakest available production model in each approved runner, use at least five repetitions for the known-context inventory hint, concise multiline/nonportable messages, misleading-category three-file fix, dominant-outcome type tie, unambiguous/ambiguous scope pair, twelve-file coherent feature, grounded/unknown security pair, revision-invalidations, 1,000-file bulk path, permission/signature path, and one recovery path:

1. no-skill control with identical tools and repository fixture;
2. old-skill baseline from the pre-change commit; and
3. new-skill treatment.

Run one stronger model as calibration. Execute one arm/repetition at a time in the primary-agent session: do not use subagents, parallel runner processes, concurrent model calls, or concurrent fixture mutations. Randomize the sequential order with a recorded seed where the runner supports it, reset each disposable fixture to its declared initial state between runs, blind graders to arm labels, and retain all failures. Pin the old-skill arm to the exact pre-cutover commit OID recorded by Task 1 rather than an installed mutable copy; extract that committed skill/reference/bundle content read-only into the disposable evaluator input without checking out, resetting, or replacing the current worktree. Before any external call, present the exact provider, model, repository-authored skill/reference/bundle content, fixture content, and prompts that will be transmitted and obtain the applicable authorization; a prior provider approval does not silently authorize newly authored post-cutover content.

- [ ] **Step 6: Apply acceptance gates**

The release candidate fails when:

- any critical safety invariant regresses;
- the known-context inventory fixture uses anything beyond prepare, exact approval, and commit, or requires the agent to read/edit any workflow artifact beyond passing the opaque transaction handle;
- the known-context inventory fixture misses the two-helper-call, 80%-versus-old-skill, or two-times-no-skill median token gates;
- any route uses file count as its concise/extended eligibility rule;
- an unambiguous current-task scope incurs a redundant preliminary approval, an ambiguous competing scope is staged before clarification, or any hint is used as a fuzzy path selector;
- hint-only evidence selects `reuse`, or specific sufficient generated lineage is ignored without a named anomaly;
- routine classification scans Git history despite sufficient loaded policy/semantic guidance;
- multiline or nonportable concise text reaches approval without `message check`, the ordinary transport-safe fixture is needlessly checked without explicit preference/prior checked state, the explicit checked-safe fixture is rejected, or unsafe text reaches direct `--message` interpolation;
- `message check` accepts an arbitrary external input path, leaves a successfully consumed input without a recorded cleanup warning, deletes a failed input, or accumulates historical successful message bodies;
- a canonical message lacks exactly one terminal LF, contains a prohibited control/invalid UTF-8 replacement, or direct transport applies any rewrite beyond `subject + LF`;
- a free-form concise message claims counted bulk-domain coverage that was not derived from structured selectors;
- a many-file known-context or grounded sensitive fixture is forced into extended review without a named evidence uncertainty, or the unknown one-file security fixture remains concise;
- an ordinary type tie prompts/list alternatives instead of choosing the most-specific dominant outcome, or a materially different release/user-semantic tie is silently collapsed;
- a wording-only revision repeats evidence work, a new unsupported semantic claim is approved without acquiring its missing support, or any changed tree/scope reuses the prior preparation/approval anchor;
- deterministic code claims to infer semantic equivalence from prose, or an active draft `evidence-ready`/`review-pending`/`message-ready` transaction is compacted merely because its message was presented/approved;
- an agent copies a materially inaccurate hint instead of correcting its type/scope/outcome in the approval proposal;
- 1,000 binary files generate per-file metadata actions;
- 1,000-file semantic input grows O(F);
- a refined evidence plan rematerializes or rerequires unchanged packets;
- detailed or bulk canonical message output exceeds 32 KiB;
- any message or report result exceeds its 80-KiB complete serialized-JSON budget, or a 49-entry report is expanded despite exceeding that byte budget;
- a report points to a deleted artifact instead of a bounded detail query;
- an attached, detached, or unborn transaction is compared with a singular assumed parent/ref rather than its complete head anchor;
- draft preparation takes an optional real-repository lock or changes real repository metadata;
- a recoverable preparation failure requires the agent to reconstruct scope/policy inputs instead of observation plus persisted-input resume;
- a known-safe terminal transaction retains bulky artifacts without a retention request;
- a purge scans/discovers another attempt, follows a replacement link, or runs with an unknown mutation outcome;
- child output exceeds the accepted diagnostic budget or a failed command loses its complete hashed log;
- pending publication recovery performs anything other than one bounded read-only observation, or implies that an observation proves the remote cannot move later;
- a matching remote observation is labeled as a witnessed successful push, an uncertain publication is retried without explicit no-live-child resolution/new push authorization, or the retry is not bound to a fresh helper UUID and its predecessor;
- a final report-detail page can be lost between O(F) page cleanup and stdout delivery, or a cursorless one-page retry is mistaken for a refresh instead of replaying until explicit `--refresh`;
- Git below the no-lazy-fetch capability floor reaches repository discovery/allocation, or skipped signature verification permits a commit object with no signed-commit header to pass comparison/publication;
- median treatment tool calls or tokens fail the stated 50% reduction target against the old-skill baseline; or
- any removed route/old schema remains executable after cutover;
- any high-level command emits non-JSON or multiple stdout documents in default mode; or
- a human reader cannot identify the normal workflow, authorization gates, evidence escalation, exit/retry rules, and exceptional references without reading source code.

- [ ] **Step 7: Conduct a human installer review**

Ask reviewers to answer from the deployable skill only:

- Is a strong user hint exact canonical text, and what should the agent verify or improve?
- Does a hint alone permit `reuse`, and what additional lineage makes zero-patch reuse truthful?
- When may the agent stage an inferred coherent scope directly, and when must it ask before staging?
- What makes a transaction concise, and can that route contain many files?
- Can a one-file transaction require the extended route?
- When may the final message be subject-only, and when do rationale, UX, files, or domains add value?
- Which concise messages require `message check`, and what exactly does that check record?
- Where does checked-message input live, who owns it, and what happens to it after success versus failure?
- Where do later evidence-plan and extended-content inputs live, and why can no arbitrary path be passed to their commands?
- Which subject bytes may use direct transport, and when must the exact-file route be selected before constructing the command?
- What is the one allowed direct-subject encoding, and how many terminal LF bytes does every canonical message contain?
- How are ordinary type ties resolved, and when is a tie material enough to disclose?
- Does a security/deployment/migration/lockfile path force extended review by itself?
- Which anchors survive wording-only, new-claim, and changed-tree revisions?
- Which semantic revision decision belongs to the skill rather than the helper, and how many successful checked-message bodies are retained?
- Must the agent scan recent history to choose a Conventional Commit type?
- What will be staged and when?
- What must the agent read for a known current-task change versus unknown existing changes?
- What exactly does the review receipt prove?
- How is one unknown domain escalated without forcing full review of known domains?
- What does `evidence-required` require the agent to reread, and what coverage carries forward?
- Why can free-form checked text not claim counted bulk-domain coverage, and how is that coverage derived instead?
- How do ordinals, nested descriptions, domain counts, renames, and the `File Changes:` heading behave at 9/10/99/100/999/1,000 entries?
- When is another user approval required?
- What happens if the commit command's outcome is unknown?
- Why does an unchanged ref not clear a `launching`/`running` commit, and who may authorize `confirmed-no-live-child`?
- How do attached, detached, and unborn head anchors differ during commit comparison and recovery?
- After a reversible preparation interruption, what observation permits `workflow resume`, and which inputs may it change?
- What happens if signer trust cannot be read?
- What is retained after success?
- When does byte size select bulk even below 50 files?
- Where is complete noisy-hook output retained, and how much reaches the agent by default?
- When may a terminal transaction be compacted or purged?
- Which result states forbid repeating commit or push?
- What does a compact untracked-directory or uninspected-submodule disclosure mean?
- When does a report compact below 50 entries, and how does `workflow report-detail` avoid a dangling post-cleanup pointer?
- How is a lost one-page detail response replayed, and how does a caller explicitly request a fresh observation afterward?
- What can one publication-recovery `ls-remote` observation establish, and what can it not establish about later remote movement?
- What distinguishes `publicationState: "succeeded"` from `"observed-matching"`, and what exact resolution plus authorization permits a new attempt after an unknown push?
- Why does the skill require Git 2.45+, and what must happen before allocation when no-lazy-fetch support is absent?
- Does skipped signature verification permit an unsigned commit object?
- Can a 1,000-file change be described without 1,000 authored IDs or rationales?

Any inconsistent answer is a documentation defect even when tests pass.

- [ ] **Step 8: Create the successor assurance case honestly**

Record:

- which prior claims remain;
- which mechanisms changed;
- deterministic safety and cost evidence;
- actual model results with variance;
- context/tool-call/token changes;
- residual judgment boundaries; and
- any missed budget or unexecuted arm.

Do not retain `Status: PASS` solely because the previous version passed. The new version earns a new disposition from fresh evidence.

- [ ] **Step 9: Commit evaluation and assurance evidence**

Commit only real fixtures, rubrics, documentation, and completed result artifacts.

Proposed subject: `test(committing-to-git): Verify proportional workflow cost`

Do not push this or any preceding implementation commit automatically. After every gate passes, report the complete local commit range and final OID. A later, separately authorized publication updates the intended remote ref once to the final tip, making the complete stack public together.

---

## Cross-Product Test Matrix

| Dimension | Required values |
| --- | --- |
| Workflow | Draft staged/full/paths; actual staged/full/paths; recover plus persisted-input preparation resume; draft promotion; report detail; later publication |
| Route | Known-context concise; bounded-inspection concise; initial extended; concise-to-extended escalation on the same snapshot |
| User hint | Accurate but noncanonical; missing type/scope; misleading `feat` versus `fix`; implementation-mechanics wording; material contradiction disclosed; strong generated-change direction |
| Scope resolution | One unambiguous current-task set staged for normal approval; two materially plausible sets clarified before staging; hint never passed as fuzzy selector |
| Message source | Transport-safe direct subject payload encoded only as `subject + LF`; checked multiline/nonportable bytes; explicitly checked portable subject; exactly one terminal LF; fixed transaction-local message/evidence/content inputs; finalized extended bytes; revision before approval; unsafe interpolation, arbitrary input path, invalid UTF-8/control bytes, free-form bulk claims, and source mismatch rejected |
| Classification | Explicit loaded repository policy; built-in semantic guide; most-specific dominant-outcome tie; material release/user-semantic tie; no routine history read; bounded history exception for material repository ambiguity |
| Evidence policy | Reuse; message; review; selector-partitioned mixed policy; selective escalation; explicit all-scope review; deletion expansion |
| Evidence revision | Wording-only reuse; new supported/unsupported semantic claim; changed tree/scope; skill-owned semantic classification; no helper prose heuristic; no new packets/carry forward; one-group escalation; multiple 16 KiB queue pages; corrupted/missing queue page |
| Provenance | Current-agent authored; user-authored known intent; pre-existing unknown; generated/derived; mixed; detailed compaction/handoff lineage; vague lineage that must escalate |
| Scope size | 1, 9, 10, 49, 50, 99, 100, 999, 1,000; large bytes with few files; many files with tiny bytes |
| Message presentation | Subject-only concise at 1/12/1,000 units; optional rationale/UX; checked detailed inventory below 50 and 32 KiB; structured-only counted bulk; right-aligned dynamic ordinals/nested indentation; exact 32 KiB; 32 KiB + 1; over-budget bulk prose; no scope-reduction suggestion |
| Content | Normal text; huge single line; 10 MiB lock/generated file; full deletion; modified-to-empty; binary; symlink; mode; type; gitlink |
| Line statistics | Eager below budget; exact boundary; deferred above budget; selectively populated by later patch; matching report with disclosed deferred totals |
| Rename candidates | Exact object pair; bounded similarity; 40,000 candidate pairs; 40,001 candidate pairs; ambiguous identical objects |
| Repository | Attached one-parent; detached one-parent; unborn zero-parent; linked worktree; SHA-1; SHA-256 where installed Git supports it; sparse checkout; active operation; conflict |
| Path | ASCII; spaces; leading dash; pathspec metacharacters; newline; backtick; Unicode normalization variants; invalid UTF-8 fixture; grounded and unknown sensitive-domain counterparts |
| Scope selector | Exact include; prefix include; exact/prefix exclusion; unmatched include; unmatched exclusion; rename crossing; no fuzzy correction |
| Host boundary | Writable `.git`; declared read-only `.git`; undisclosed denial before output; denial after intermediate; live lock collision |
| Existing index | Empty; actual paths with staged state; draft paths with disjoint staged state; draft overlap/partial staging; promotion while staged blocker remains |
| Index installation | Not started; pending/original identity; pending/prepared identity; ambiguous third identity; live/stale lock; split/sparse extensions; interruption after replacement |
| Approval drift | Unchanged; index drift; head kind/ref/parent-array drift with identical tree; parent tree drift; operation marker appears |
| Hook/process output | None; reject; mutate index; mutate message; successful commit followed by helper interruption; below 16 KiB; 10 MiB success/failure; binary/non-UTF-8 bytes; interactive signer |
| Signature | Signed-header present under required/advisory/skipped; missing signed header blocks; SSH verified; OpenPGP verified; allowed signers readable; `allowed signers file` unreadable; `allowed keys file` unreadable; failed; advisory; skipped |
| Workspace report | Clean; 1/49/50/1,000 staged, unstaged, untracked, and conflicted records; below-50 byte overflow; hostile long path; persisted versus fresh detail query; multi-page and cursorless one-page replay after page cleanup; explicit refresh; large untracked directory; selected gitlink; dirty nested submodule disclosed but not inspected; explicit deep report |
| Publication | Not requested; initial authorization; later authorization; witnessed success; matching state observed; rejection; unknown outcome; one read-only recovery observation; unresolved/live-child retry rejected; explicit no-live-child resolution plus separately authorized linked retry; missing compact capsule; remote moves after observation |
| High-level result | Git 2.45+ capability accepted and older no-lazy-fetch support rejected before allocation; exit 0/1/2/3/4; default one-JSON stdout; diagnostics on stderr; common `--format text`; 32-KiB concise, 80-KiB message, and 80-KiB report serialized boundaries; known commit/push no automatic repeat; unsupported old attempt |
| Artifact disposition | Active draft retention; local-commit compaction before push; safely rejected/abandoned compaction; explicit retention; fixed message/evidence/content input success/failure cleanup; one latest message across 100 revisions; cleanup lock retry; exact purge; link/reparse/replaced-object rejection; pending/unknown purge rejection; no global discovery |

## Atomic Cutover

1. Build and review the new domain/high-level modules through separate local commits while remote `main` remains unchanged.
2. Old command code may exist only as temporary unpushed scaffolding needed to keep intermediate implementation commits reviewable. Do not add translation layers, schema unions, deprecation output, or compatibility-only behavior.
3. Task 10 simultaneously rewrites the canonical skill, removes every old CLI route/command-only adapter/schema reader, rebuilds the single bundle, updates public documentation, and adds negative tests proving the old interface is absent.
4. Old temporary attempts are deliberately unsupported after cutover. The new CLI returns `UNSUPPORTED_ATTEMPT_VERSION` without modifying them and requires a fresh UUID transaction.
5. Task 11 evaluates the exact final cutover state. Do not publish a partially migrated branch merely because deterministic tests pass before model/human evaluation.
6. Preserve the published single-bundle layout and direct `npx skills add Hadden-Industries/agent-skills` installation from `main`.
7. Update remote `main` only when the complete reviewed commit stack satisfies every deterministic, model, human-readability, and configuration-approval gate. A Git ref update exposes the final tip atomically even though the reviewable implementation commits remain in history.

## Rollback Strategy

- Every task ends in a separately reviewable commit with its own tests.
- Do not push intermediate implementation commits. Before publication, repair or reorder the local stack while preserving already approved user work; no compatibility code is required for a state users never receive.
- If final evaluation finds a safety or efficiency regression, fix the new workflow before publication or abandon the local stack and leave remote `main` unchanged.
- After publication, use the known pre-cutover commit in Git history as the recovery source. The rollback is one reviewed forward commit that restores the complete prior canonical skill, maintained source, bundle, public contract documentation, schemas, and matching tests together. Retain plans, assurance records, and real evaluation results as historical evidence, but mark the replaced release disposition as superseded/rolled back. Never leave a hybrid interface or force-rewrite published history.
- If a narrow post-publication defect does not invalidate the architecture, prefer a focused forward fix. If proportional inspection itself proves unsafe, restore the complete prior workflow rather than silently changing one evidence default while leaving incompatible artifacts behind.
- If draft alternate-object isolation is not portable across the supported Git floor, the release candidate fails its draft-isolation gate. Fix the implementation or explicitly revisit the supported environment/product requirement with the user; do not silently fall back to a weaker non-tree draft or write to the real object database while claiming read-only behavior.

## Final Acceptance Criteria

1. Exact commit authorization, exact message approval, and separate push authorization remain enforced in the public workflow.
2. Actual commit tree, complete attached/detached/unborn head anchor and parent array, byte-exact one-LF message, signed-commit-header presence, signature policy, and publication target retain full object-bound checks.
3. A known-context coherent transaction with a transport-safe subject, regardless of file count, uses one preparation command, one exact-message approval round trip, and one commit/verify/report command with one opaque transaction-handle pass-through and no agent-managed workflow artifact read/edit.
4. No ordinary happy path requires manual attempt, scope, template, acknowledgement, checks, verification, or report artifact management.
5. No mutable acknowledgement loop remains in the canonical workflow.
6. Mechanical review evidence is described as identity/coverage attestation, never proof of cognition.
7. The exact machine manifest accounts for every change unit; mandatory human scope evidence is exact below 50 only when the complete result fits its byte budget and is otherwise bounded, counted, hash-bound, encoding-safe, and anomaly-aware.
8. Mixed-provenance manifests use a compact, selector-based, non-overlapping `reuse`/`message`/`review` partition; one uncertain domain never forces unrelated grounded domains into full review.
9. `reuse` requires specific surviving task-lineage evidence; vague summaries or model identity never substitute for it.
10. Unknown/pre-existing or explicitly reviewed non-deletion text changes still receive complete patch coverage; full-file deletion bodies remain metadata-first and expand only when their meaning or risk requires old content.
11. Every unmatched include or exclude selector fails before attempt allocation/staging, with bounded diagnostics and no autocorrection.
12. Actual path scope rejects pre-existing staged state; a path draft may coexist only with disjoint staged work, rejects overlap, and cannot promote while any staged blocker remains.
13. Actual full/path staging installs one exact prepared index through a flushed journal; interrupted state is observed as original, prepared, or ambiguous and is never automatically rolled back or installed twice.
14. Patch and deletion processing are streaming and bounded independently of total input bytes.
15. A coherent 1,000-binary scope does not create 1,000 metadata artifacts or force an O(F) human inventory read.
16. A 1,000-file domain does not require 1,000 authored IDs.
17. On the extended route, detailed shared rationales are optional, every supplied selector matches, and truthful selections may overlap; counted bulk domains are accepted only from structured selectors and partition every unit exactly once whenever a bulk inventory is rendered.
18. Whenever a file/domain inventory is included, raw-byte path order, two-space base indentation, right-aligned dynamic ordinal width, nested-description alignment, singular/plural derived domain counts, and rename-as-one-unit counting remain deterministic; `File Changes:` has no count, and bulk mode begins at 50 units or when canonical detailed output would exceed 32 KiB.
19. Similarity detection has a measured candidate-pair budget and runs no more than once per matching transaction.
20. Eager line-stat work has a measured eligible-blob-byte budget, and deferred totals are disclosed rather than computed decoratively.
21. Every read-only Git child uses `GIT_OPTIONAL_LOCKS=0` and `GIT_NO_LAZY_FETCH=1`, rejects mutation argv through a closed semantic allowlist, and disables configured external diff/textconv/pager/color/filesystem-monitor execution where applicable; every draft scope receives an exact tree identity without changing the real index, object database, refs, logs, locks, or network state, while mutation-capable commands remain explicitly classified and missing promisor evidence is surfaced.
22. An unchanged draft can be promoted without repeated review or message approval; any tree/scope/head-anchor mismatch triggers a fresh actual transaction.
23. A derived/preparation failure retries only its phase when recovery observation marks the persisted transaction resumable; `workflow resume` accepts no reconstructed or changed scope/evidence/policy inputs.
24. High-level commands emit exactly one bounded JSON stdout document by default, use stderr for diagnostics/child output, and derive common `--format text` output from the same persisted result.
25. Exit classes and symbolic statuses distinguish safe stops, input/artifact failure, known blocked commits, and unknown outcomes; no exit `3` or `4` path automatically repeats commit or push.
26. A refined evidence plan materializes only newly required immutable packets through 16 KiB-or-smaller linked queue pages; unchanged hash coverage carries forward and no acknowledgement loop returns.
27. An interrupted attached, detached, or zero-parent unborn commit can be classified from durable launch/completion state plus its exact observation point, parent array, tree, and raw message without automatically invoking `git commit` again; baseline ref alone never clears a possibly live child, and manual no-live-child resolution requires explicit user confirmation.
28. The observed Git for Windows `allowed keys file` denial is classified as unavailable trust, and declared access needs are handled on the first relevant execution attempt; a promoted draft performs the preflight before any actual-object/index mutation.
29. The user can override verification policy at any point without the skill insisting, and the override never creates an unsigned retry or permits a created commit without a signed-commit header.
30. No empty checks artifact is required.
31. Commit/push child output is completely hashed and retained when needed, while one high-level command exposes no more than a 16 KiB head plus a non-overlapping 16 KiB failure/recovery tail.
32. Matching reports reuse manifest statistics and the complete recorded head anchor rather than deriving a branch from moved `HEAD`.
33. Workspace groups compact unconditionally at 50 and earlier when the complete 80-KiB serialized report budget would be exceeded; routine reports stream rather than buffer unbounded status, disclose exact paths versus compact directories and uninspected submodule worktrees, render hostile long paths safely, and expose detail only through a bounded fresh-observation query rather than retaining an O(F) historical pointer target.
34. Publication consumes the existing successful report and does not recollect the full commit twice; pending-outcome recovery performs exactly one bounded read-only remote observation, distinguishes witnessed success from observed matching state, never automatically pushes, and permits a fresh linked retry only after explicit no-live-child resolution plus separate push authorization while disclosing that the remote may move later.
35. Every known-safe terminal transaction compacts bulky helper-owned evidence unless retention is requested; exact purge cannot scan/discover attempts, follow links, or run while mutation outcome is pending/unknown.
36. Cleanup failure is warning/retryable and never repeats a commit or push.
37. The final public surface contains no removed low-level route, old schema reader, attempt migration, alias, feature flag, or deprecation branch.
38. The final evaluated local commit stack is published through one remote ref update; no intermediate implementation state is pushed.
39. A post-publication architectural rollback is a coherent forward restoration commit, never a force rewrite or hybrid deployment.
40. `SKILL.md` is ASCII-only, concise, human-readable, and routes only exceptional branches to references.
41. `npm run verify` passes on source and rebuilt bundle.
42. Matched weakest-model evaluations retain all critical safety passes and reduce median treatment tool calls and reported tokens by at least 50% against the old-skill baseline.
43. The successor assurance case states both improvements and residual limits without treating prior PASS status as inherited proof.
44. The `skills-lock.json` known-context evaluation has exactly two median helper calls, one opaque transaction-handle pass-through, zero agent-managed workflow artifact reads/writes, at least an 80% median token reduction from the old-skill arm, and no more than twice the no-skill arm's median tokens.
45. Concise versus extended routing depends on evidence sufficiency and semantic uncertainty, never a minimum/maximum file count; the deterministic and model suites prove both many-file concise and one-file extended cases.
46. The skill treats the user's hint as a hypothesis, independently resolves exact scope, improves type/scope/outcome wording, and discloses material contradictions before exact-message approval.
47. A concise subject-only message is valid at any coherent scope size; rationale, user experience, detailed files, and counted domains are included only when they contribute grounded durable information.
48. Bounded `message` evidence is complete, strict valid UTF-8, and inline at or below the 32-KiB complete-result budget; an over-budget, invalid-encoding, or incomplete requirement selects a named extended reason with no replacement decoding/truncation mislabeled as reviewed evidence.
49. Multiline or nonportable concise text adds exactly one preapproval `message check` and one transient fixed transaction-local input; it preserves exact canonical bytes/hash with exactly one terminal LF, supports precommit revision, and creates no worksheet, receipt, renderer, or extended-review state.
50. One unambiguous current-task scope may be staged for the normal exact approval; two materially plausible scopes are clarified before staging, and a semantic hint is never interpreted as a fuzzy selector.
51. A prompt hint alone selects bounded `message` inspection; zero-patch `reuse` requires specific authored/read/generated/surviving task lineage.
52. Type/scope classification follows loaded repository policy and the built-in semantic guide without routine history inspection; any bounded history exception is material and disclosed in cost evidence.
53. `workflow commit` accepts a direct subject payload only for an unchecked concise subject satisfying the conservative transport predicate, derives exactly `subject + LF`, rejects unsafe bytes and direct input for checked concise/finalized extended state before mutation, and consumes exactly one recorded/validated message source.
54. Ordinary type ties select the most-specific type for the dominant outcome without alternatives or a user question; only materially different release/user semantics justify disclosure or clarification.
55. No sensitive filename/domain deny-list exists: grounded security, migration, deployment, lockfile, generated, and submodule changes may remain concise, while unresolved evidence and special Git facts still escalate.
56. Wording-only revisions reuse all evidence, new semantic claims reuse the tree while acquiring only missing support, every message-byte change receives fresh exact-message approval, and every scope/tree change requires a fresh preparation and approval anchor.
57. The skill selects direct versus checked-file transport before constructing a shell command, and deterministic tests cover Unicode plus every excluded shell-active character so agent interpolation cannot redefine the approved message.
58. Conversational draft readiness is nonterminal: an active draft in `evidence-ready`, `review-pending`, or `message-ready` retains reusable evidence by default; automatic compaction waits for a known, fully recorded local commit disposition or another explicit safe terminal disposition, does not require a push, and never infers an external manual commit through global transaction discovery.
59. `message check` accepts every structurally valid canonical message, including a transport-safe one-line subject, while skill instructions and cost evals keep direct transport as the ordinary cheaper default unless the user requests checked-file handling or the transaction already uses it.
60. Checked input exists only at deterministic `message-input.txt` inside the existing UUID transaction, accepts no external path, is removed after durable successful recording only when a fresh non-following identity check proves it is the same opened object, survives validation failure/replacement for correction, and is retried by exact-path cleanup after a warning.
61. Deterministic code enforces tree, byte, validation, and declared evidence-plan facts but never claims to infer whether revised prose is semantically equivalent; that classification remains an explicitly evaluated skill judgment.
62. Precommit canonical-message revision storage remains constant-space for both concise checking and extended finalization: one latest valid body, validation, hash, and monotonic revision counter; failure preserves that state and success atomically replaces it without historical message-body accumulation.
63. Later evidence and extended-content inputs use only fixed transaction-local `evidence-plan-input.json` and `content.json`; success/failure cleanup follows explicit ownership/identity rules, and no high-level command accepts an arbitrary plan/content path after allocation.
64. A free-form checked message may be subject/contextual or an exact detailed inventory below 50, but counted bulk-domain coverage is valid only when the structured finalizer derives every membership/count from manifest selectors; a many-file concise message may simply omit `File Changes:`.
65. Complete serialized `message check`/`message finalize` results never exceed 80 KiB, complete commit/report/publication/detail results never exceed 80 KiB, and boundary tests use actual JSON serialization with worst-case valid escaping rather than assumed envelope sizes.
66. Source-path selectors and source arrows apply only to actual rename units; exact/similar retained content never creates copy provenance or a `copy-classified` change kind.
67. Evaluation IDs are never repurposed: active legacy intents are rewritten atomically, obsolete/duplicate IDs are absent from the runner and documented as retired, new cases begin at 35, and no compatibility gate or old-schema evaluator survives.
68. Model evaluations run sequentially without subagents or concurrent fixture/model activity, record their randomized order/seed, pin the old-skill arm to the Task 1 OID, and transmit post-cutover repository content only after exact provider/content authorization.
69. Git 2.45+ no-lazy-fetch capability is proven before attempt allocation; an older or vendor-incompatible Git fails pre-mutation rather than silently taking a network-capable fallback.
70. Final `workflow report-detail` output survives the page-cleanup/output crash boundary through one bounded byte-identical replay record, treats cursorless one-page retry as replay, and requires explicit `--refresh` for a new observation without retaining an O(F) historical inventory.
71. `publicationState: "succeeded"` is reserved for a witnessed completed push, while `"observed-matching"` records recovery provenance; an uncertain attempt can produce a new push only through its explicit resolved-and-reauthorized retry interface.

## Residual Limits That Must Remain Explicit

- No artifact protocol can prove that a model mentally read or understood content.
- Selective message evidence is not a code-review claim.
- Agent judgment still determines whether current context truly explains a change and whether a semantic domain is coherent.
- A deterministic helper can validate message bytes, structure, and manifest references but cannot prove that the agent chose the best `feat`/`fix` classification or accurately interpreted the user's hint; model/human evaluations remain necessary.
- Structured bulk selectors can prove membership and counts, not that a domain title or rationale is semantically wise; agent/human review remains responsible for that prose.
- Invalid-UTF-8 evidence can be hash-bound and rendered losslessly as escaped bytes, but it may not be cognitively equivalent to reading native source text; unexplained meaning still requires a domain-specific tool or user input.
- Superseded checked-message bodies are deliberately not an archive. Returning to earlier wording requires reconstructing that text from the conversation or another user-owned source and checking it as a new exact revision.
- A temporary external object database reduces draft side effects but still consumes temporary disk and must be tested with filters, alternates, linked worktrees, and SHA-256 repositories.
- Disabling partial-clone lazy fetch can make required historical evidence unavailable until a separate fetch is authorized; that explicit interruption is preferable to hidden network/object-store mutation.
- The no-hidden-lazy-fetch guarantee deliberately raises the runtime floor to Git 2.45. Supporting older Git would require a separately reviewed mechanism with equivalent proof, not an ignored environment variable or silent weaker branch.
- Git similarity remains heuristic even below the cost budget.
- Hooks and external processes can change repository state; journaling classifies outcomes but cannot make Git and arbitrary hooks one atomic transaction.
- A crash after durable launch intent but before child completion can remain blocked even while the ref is unchanged. Clearing that state may require the user to terminate/inspect processes or restart the host and explicitly confirm no live child; the workflow prefers a false-positive block to a duplicate commit.
- Complete failure/recovery logs may contain sensitive text deliberately emitted by repository hooks or Git/signing tools. Create them with the narrowest supported permissions, disclose retention, and delete them on resolution; exact-byte diagnostic preservation cannot also promise content redaction.
- Because the helper deliberately performs no global attempt discovery, a process crash before terminalization or a user independently committing a copied draft can leave an unreachable UUID directory until explicit exact-transaction cleanup or the operating system's normal temporary-storage cleanup; the skill must not reintroduce a registry merely to collect such orphans.
- SSH identity authorization still requires its configured trust source; no access-free integrity check may be reported as trusted identity verification.
- A remote can move after observation; publication journals, explicit observed-versus-witnessed provenance, no-live-child resolution, and exact non-force refspecs reduce ambiguity but do not create server-side transaction history or prove which actor produced a matching remote state.
- A compact scoped workspace report that deliberately observed directories rather than all untracked files cannot reconstruct an exact historical path list. Its on-demand detail route clearly returns a fresh timestamped observation, which may differ from report time.
- `workflow resume` reduces repeated preparation only when durable local evidence proves a reversible continuation. It cannot make an ambiguous index, commit, or publication outcome safe to replay.
- Cost budgets are product requirements informed by current runners. Recalibrate them with published evidence when runtimes or models change; do not silently relax them.

## Execution Start Gate

This plan is design-complete but does not itself authorize implementation. First complete the plan-only documentation commit described in the pre-execution boundary. After a later explicit implementation instruction, execute Tasks 1-11 sequentially in the primary-agent session with no subagents or concurrent commands/model arms. Stop at each verified task commit boundary for the repository's required exact staging/message approval and never push without separate authorization.
