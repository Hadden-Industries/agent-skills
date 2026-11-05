# Committing-to-git memory path scope implementation plan

## Status and purpose

| Field | Value |
| --- | --- |
| Date | 2026-11-05 |
| Status | Implemented and deterministically verified locally; verification record below |
| Source baseline inspected | `2d0203eb9d1291805baf8409e52de1712ab8a3bc` |
| Reported installed consumer | `committing-to-git` `0.1.1-dev.15` |
| Decision and integration owner | Repository owner; implementation assignee to be named when work is authorized |
| Proposed risk route | R2, because the change crosses commit selection, index mutation, signing, and recovery boundaries; owner acceptance remains outstanding |

The user requested this plan after an authorized manifest-only commit could not be prepared with default memory storage while unrelated converter edits were present.
The desired outcome is a signed commit of the exact selected whole paths, using the existing checked message workflow, without persistent c2g transaction storage or a storage-consent detour merely because the scope is `paths`.
Preserving user work and approval scope is more important than simply removing the error.
The user's subsequent steering also rejects treating an empty staged index as a universal best practice: replace that implementation simplification with precise admission and preservation of unrelated staged work.

The original planning task authorized saving this Markdown file only.
The owner subsequently requested implementation and separately approved the exact test configuration, dev.16 release metadata, policy case 81, validator pins and preservation record.
Development commits, pushing, model evaluations, plugin installation and publication remain outside this implementation's authority.
The existing untracked Markdown-quality migration plan is unrelated and must be preserved.
The `google` repository is the incident context, not an implementation or test target.

The installed HISEW planning skill was read and applied.
A fresh native applicability inspection supplied by the parent task reported `personal`, `active: true` for this worktree.
Read-only `inspect-workflow-status` reported `ready`; ordering for the `focused`, `affected`, and `full` profiles remains `unknown` because input semantics are undeclared.
No current session identity, accepted change dossier, risk route, or accepted QA/decision record was supplied.
The identifiers below are proposed draft traceability, not invented HISEW receipts or approvals; no execution was started or adopted.

## Observed defect and current contract

The incident invocation was:

```text
node <skill>/scripts/commitWorkflow.mjs workflow prepare --mode actual --scope paths --path "chrome/extensions/Terminological Entries to OWL/src/manifest.json" --evidence reuse --basis authored-current-task --message-format detailed
```

It returned exit 5, `STATE_STORAGE_REQUIRES_DISK`, reason `paths-scope`, with `human-decision` recovery and no mutation.
The owning rejection is `assertMemoryRoute()` in [prepareProposalWorkflow.js](../../src/committing-to-git/workflow/prepareProposalWorkflow.js), not the generated bundled script.
It rejects every path scope before repository observation because the old path route uses a transaction-owned index.
[memory-state.test.mjs](../../tests/committing-to-git/memory-state.test.mjs) currently makes that rejection an expected result.

| Current fact | Owning source and implication |
| --- | --- |
| Memory defaults to staged/full proposals. Detailed messages already work in memory. | [prepareProposalWorkflow.js](../../src/committing-to-git/workflow/prepareProposalWorkflow.js), [state-storage.md](../../src/committing-to-git/references/state-storage.md). Preserve detailed inventory validation; the November 3 plan's detailed-message rejection is historical. |
| Actual path preparation rejects any staged changes. | [prepareWorkflow.js](../../src/committing-to-git/workflow/prepareWorkflow.js): `PREEXISTING_STAGED_CHANGES`. This guards the current index-based executor; it is an implementation restriction, not the desired path-scope invariant. A clean staged index means no staged difference from HEAD, not zero index entries. |
| Draft paths may coexist with disjoint staged work, but reject selected-path overlap. | Same module: `DRAFT_SCOPE_OVERLAPS_STAGED`; [commit-workflow-cli.test.mjs](../../tests/committing-to-git/commit-workflow-cli.test.mjs) and [draft-isolation.test.mjs](../../tests/committing-to-git/draft-isolation.test.mjs). A draft proposal cannot commit. |
| Paths selects whole paths; staged scope preserves intentional partial hunks. | [SKILL.md](../../src/committing-to-git/SKILL.md). The native path-only route must make the selected whole-worktree-content meaning explicit when selected paths also contain staged changes; it must never silently treat a staged-only request as whole-path authorization. |
| Literal include/exclude paths, prefixes, and canonical raw-byte selectors already exist. | [preparationInputs.js](../../src/committing-to-git/workflow/preparationInputs.js). Existing unmatched-selector and rename-boundary checks must remain effective. |
| Current proposals only admit staged/full and have a 4,096-byte encoded transport bound. | [commitProposal.js](../../src/committing-to-git/workflow/commitProposal.js). Path selectors must survive between calls; a digest without reconstructible selectors is insufficient. |
| Memory working-tree observation currently describes the full workspace. | [workingTreeSnapshot.js](../../src/committing-to-git/snapshot/workingTreeSnapshot.js). It cannot merely be called unchanged and relabeled paths: unrelated files, caps, evidence, and rename pairing would still affect the selected scope. |
| Native literal selected staging already exists. | [gitRepository.js](../../src/committing-to-git/git/gitRepository.js): `add-paths` sends NUL-delimited paths through stdin to `git --literal-pathspecs add -A --pathspec-from-file=- --pathspec-file-nul`. |
| Current memory commit consumes approved message bytes on stdin and commits the current index. | [commitProposalWorkflow.js](../../src/committing-to-git/workflow/commitProposalWorkflow.js). Full scope stages at commit time and checks the staged change set first; hooks and signature/result checks then run. |
| Read-only message evidence currently uses one whole-scope tracked diff. | [proposalEvidence.js](../../src/committing-to-git/workflow/proposalEvidence.js). Filtering only the manifest would leak unrelated evidence and can exceed the budget unnecessarily. |

The [November 3 ephemeral-state plan](2026-11-03-committing-to-git-ephemeral-state.md) deliberately shipped staged/full first and deferred memory paths.
This plan repairs that residual gap; it does not reopen the broader transaction-engine redesign.
The parent task subsequently completed the authorized incident commit through ordinary signed native Git `--only`, reporting commit `3412ed7ca2e99a4accbc1efd0e855a53337d2102`, the expected parent, one changed manifest, a good SSH signature, and preserved converter edits.
That is task-reported evidence of the small path-only Git capability, not verification of a fixed c2g route or its transport policies.

## Proposed requirements and acceptance

| ID | Requirement and falsifiable acceptance |
| --- | --- |
| REQ-001 / AC-001 | Default memory prepare, message check, and authorized signed commit support the reported one-file `actual/paths/reuse/detailed` case. No storage question, transaction, retained proposal/message/report file, or implicit disk retry occurs. Commit tree contains exactly the approved file change. |
| REQ-002 / AC-002 | Prepare and message check remain read-only: compare index bytes, refs, Git metadata/object inventory, worktree contents/status, and a controlled temporary-directory sentinel before and after both successful and rejected requests. No transient preparation writes are permitted either; instrument write-capable boundaries as well as checking final inventory. |
| REQ-003 / AC-003 | Selection uses existing literal exact/prefix/exclusion/raw-byte meaning. Every selected whole-path final state and rename endpoint is correct; unmatched selectors and cross-boundary renames reject. Unrelated edits and untracked files stay outside the manifest, evidence capsule, message inventory, and commit. |
| REQ-004 / AC-004 | Actual memory paths accepts unrelated staged work and preserves its exact entries/content and staged-versus-unstaged distinctions. Selected paths mean their entire current working-tree state, consistent with native `--only`; show that meaning when a selected file is partially staged. Staged-only intent continues to use staged scope. Reject actual conflicts/unmerged or unsupported operation state precisely; never clear, stash, restore, or accidentally commit unrelated work. Draft observation remains read-only, including overlap characterization. |
| REQ-005 / AC-005 | Caller-held proposal binds repository, HEAD/ref anchor, mode, canonical selector data, selected expansion/final-state digest, message format, type policy, and verification policy. Recompute at check and commit. Selected content, selected prefix membership, HEAD/ref, or a selected-index change that invalidates the approved interpretation rejects before effects. Unrelated staged or worktree changes remain outside scope and are preserved; do not bind the whole index merely to recreate the blanket gate. |
| REQ-006 / AC-006 | Keep exact checked message bytes/digest, `-S`, ordinary hooks, configured verification policy, and resulting parent/tree/message/signature comparisons. A hook-altered result is reported as an existing mismatched commit, never as an absent or successful one. No publication is performed. |
| REQ-007 / AC-007 | After commit authorization, native Git files and bounded task-owned transient transport files, if the proven executor needs them, are distinct from persistent c2g workflow retention. They require documented ownership/lifetime and exact cleanup, not a new per-commit storage-consent question. Failure reports observed index/HEAD effects; cancellation or lost output never triggers a blind second commit, cleanup of foreign locks, or automatic restoration. |
| REQ-008 / AC-008 | Staged/full memory behavior, explicit disk behavior, bounds, diagnostic envelopes, and generated consumers remain coherent. Genuine unsupported capabilities retain truthful existing recovery. Ordinary supported path selection alone is no longer a disk requirement. |

Partial-hunk path selection, review packets, witnessed checks, durable memory recovery, helper publication, new dependencies/services, and repository configuration are outside scope.
Supporting arbitrary unbounded path lists or every formerly unsupported filesystem case is also outside this repair.
Existing finite limits must be stated accurately and tested at their boundary; they must not be used to reject a small ordinary selected file because unrelated workspace files exceed a full-scope limit.

| QA ID | Scenario and measurable response |
| --- | --- |
| QA-001 | With one selected manifest and unrelated converter edits, prepare/check leave all observed storage unchanged; commit creates one signed selected-path change and preserves unrelated bytes and staging. |
| QA-002 | With unrelated staged changes before preparation or arriving before native commit, commit only selected paths and preserve unrelated index entries plus their worktree differences. For a partially staged selected file, prove the explicit whole-path result and distinguish staged-only intent; include intent-to-add, selected-index changes after approval, drafts, and unmerged-state rejection. |
| QA-003 | Change selected bytes, mode, deletion/addition, prefix membership, HEAD/ref, or message bytes after preparation. Each affected approval fails at its owning boundary without claiming unchanged state after a mutation. |
| QA-004 | Use spaces, Unicode, leading dashes, pathspec metacharacters, exclusions, deletes, exact renames, and platform-supported raw path bytes. Git sees literal selected names; no adjacent path or rename endpoint escapes the approved scope. |
| QA-005 | Inject signing failure, hook failure/mutation, index contention, process termination, and post-commit observation failure. Reports distinguish absent, created, mismatched, and unknown outcomes; unrelated state survives; no duplicate commit occurs. |
| QA-006 | At supported proposal/evidence/path bounds and one step beyond, resource use is bounded and diagnostics identify the actual limit. Unrelated oversized or unsupported worktree entries do not force disk when the selected scope is observable. |

## Design decisions and the unresolved native boundary

The selected architectural direction is read-only selected-scope observation plus a caller-held proposal and native Git commit after authorization.
Reuse existing c2g selection, message, signature, and reporting rules; keep durable transaction allocation out of this route.
There is one material design gate before implementing the mutation boundary, recorded as `DEC-003` below.

| ID | Draft decision |
| --- | --- |
| DEC-001 | Replace the memory path route's blanket empty-index requirement with precise native prerequisites and preservation checks. Unrelated staging is allowed. Whole-path selection authorizes current worktree content of selected paths, including their selected staged/unstaged differences when that scope is explicit; partial-hunk intent is a different scope. Do not remove the old disk executor's guard until its executor independently provides equivalent isolation. |
| DEC-002 | Store canonical selector data in the opaque proposal, then re-expand it on every check/commit. Bind final selected states as today, including both rename endpoints. Prefer a strictly validated paths-specific extension of the existing proposal contract while keeping staged/full representations unchanged; do not silently reinterpret old proposals. |
| DEC-003 | Prefer Git's native path-only commit semantics, subject to a real-Git transport/recovery experiment on Windows and POSIX. The exact implementation is unresolved; owner acceptance of the proven route is required before mutation implementation. See alternatives below. |
| DEC-004 | Reuse pure selector meaning and genuine Git operation prerequisites across memory and disk. Keep executor-specific admission separate: the legacy disk executor's index restriction is not a universal selection rule. Do not route memory through a transaction with a different storage label. |
| DEC-005 | Expand within existing source categories and use existing build/test entry points. No new dependency or configuration is currently justified. Any exact configuration change must be separately identified and approved before editing or generating it. |
| DEC-006 | Keep existing selected-scope capability limits explicit. Do not silently change evidence provenance, whole-path intent, detailed presentation, scope, or storage to make a request pass. No compatibility shim or alias is proposed or approved. |

[Git's commit manual](https://git-scm.com/docs/git-commit) documents native `--only`, file/stdin message input, and file/stdin pathspec input.
These establish reusable capabilities, not proof that two independent payloads can share one stdin stream.
The current helper uses `-F -`; simply appending `--pathspec-from-file=-` is not a valid transport design.
The existing large-scope contract also keeps path lists out of Git argv and tests an argv budget below 1 KiB.
The incident workaround used a temporary message file and one literal argv path, so it does not settle this contract.

Evaluate the following in `SLICE-001`, without making an automatic fallback chain:

1. Native `commit --only` with separate, supported, bounded transports for exact paths and checked message bytes. Prove Windows and POSIX behavior, unrelated staged preservation, selected partial staging, new/untracked paths, deletions, hooks, index reconciliation, and interruption. A bounded temporary message/pathspec transport file created only during authorized commit is a viable candidate with exact ownership, cleanup, and failure evidence; it is not a retained c2g transaction or a per-commit consent detour. Any change to the existing argv or no-skill-owned-file implementation contract must be documented and tested explicitly.
2. Existing native `add-paths`, exact staged comparison, then ordinary signed `commit -F -` is insufficient: it commits unrelated staged entries and two commands do not provide atomic scope isolation. Reuse selected staging only if a scoped native commit still isolates the result, including newly untracked paths. Do not preserve the blanket empty-index rule merely to make an unscoped executor usable; post-commit mismatch detection alone is not prevention.
3. A transient alternate Git index only if native path-only transport cannot satisfy the contract. This has additional hook, final real-index reconciliation, lock ownership, and crash-state costs. It must not become a hidden durable transaction system or overwrite concurrent index changes.

Decision owner: repository owner, informed by implementation evidence.
Minimum decision evidence: exact commands/transports, native versions, before/after index entries and worktree bytes, hook-observed index, commit contents/signature, controlled race and interruption results, and explicit ownership/cleanup of each created file.
If none satisfies the invariant without changing a current contract, stop mutation implementation and present the smallest concrete contract amendment.
Do not substitute a storage-consent detour, weaken signing, claim atomicity, or quietly select full/staged scope.

Git `2.56.0.windows.4` was observed locally; the skill declares Git `2.45+` and Node `24+`.
Primary Git documentation was checked on 2026-11-05: [literal pathspec semantics](https://git-scm.com/docs/git), [NUL-delimited selected staging](https://git-scm.com/docs/git-add), and [commit behavior](https://git-scm.com/docs/git-commit).
The prior [ephemeral-state research](../committing-to-git/reviews/Deep%20Research%20Report_%20Simplifying%20committing-to-git%20Around%20Ephemeral%20State,%20Native%20Git,%20and%20Enforced%20Architecture.md) remains relevant to using real Git and avoiding a custom Git emulator.
This is a bounded repair using the already adopted native consumer and Node standard library; no new package, vendored implementation, or licence clearance is claimed.
Before implementing, verify the chosen native options against the supported consumer floor and current supported release; a floor change or new integration requires its own exact configuration/version and terms decision.

## Predicted seams and shared authority

File names below are predictions, not a mandatory edit list.

| Rule / boundary | Authority, affected consumers, and implementation strategy |
| --- | --- |
| Literal selection and admission | `workflow/preparationInputs.js` owns normalization; `workflow/prepareWorkflow.js` currently combines candidate expansion, rename boundaries, and executor admission. Extract coherent pure selection/operation rules into an existing registered category if needed. Share selector meaning; distinguish the new native executor's precise admission from the legacy disk guard. Retain independent expected outcomes in tests. |
| Read-only selected state | `snapshot/workingTreeSnapshot.js`, `workflow/proposalObservation.js`, `snapshot/changeSet.js`. Select candidates before content hashing, untracked observation limits, and evidence budgets where semantics permit. Preserve necessary global operation/index checks and rename-boundary discovery. Do not compute a full manifest then merely change its label. |
| Proposal and freshness | `workflow/commitProposal.js`, `prepareProposalWorkflow.js`, `proposalObservation.js`, `checkProposalMessageWorkflow.js`. Validate canonical path data and exact allowed keys; recompute selection/count/digest and admission. Keep proposal capacity and malformed-input rejection effective. |
| Evidence and detailed authoring | `workflow/proposalEvidence.js`, existing capsule/approved-message validators. `reuse` needs no patch projection; `message` needs complete selected evidence. Prefer consumer-parsed Git output and existing byte-safe records over regex parsing patch headers or implementing Git filters. |
| Authorized mutation and outcome | `workflow/commitProposalWorkflow.js`, `git/gitRepository.js`, existing signature/report modules. Add the proven native route at the narrow process boundary, with explicit failure effects. Do not duplicate signing, message-validation, or final comparison policy. |
| User-facing meaning and delivery | Canonical `src/committing-to-git/SKILL.md` and `references/state-storage.md`; generated `skills/committing-to-git/` and host packages. Source owns meaning; generators own copies. Preserve historical plans and installed caches. |

The DRY decision is shared code for literal selection and policy, separate executor admission/orchestration for native scoped commits versus legacy durable transactions, and generation for shipped copies.
Independent deployment boundaries are the source checkout, generated skill, host package, and installed plugin; a source test does not prove installed behavior.
Build correspondence and consumer tests control drift.
Reassess names such as `buildWorkingTreeSnapshot`, `scope`, `sourceIndex`, and `assertMemoryRoute` if their responsibilities change; do not retain misleading full-scope descriptions or introduce a storage mode that actually writes a transaction.

## Vertical slices and traceability

| Slice | Requirement / AC / QA / decision links | Observable increment and falsifiable proof | Release / cleanup implication |
| --- | --- | --- | --- |
| SLICE-001: Prove the native path commit boundary | REQ-003/004/006/007; AC-003/004/006/007; QA-002/004/005; DEC-001/003 | In independently owned disposable repositories, demonstrate the chosen command/transport with literal selected paths, exact multiline message, real signing, ordinary hooks, preservation, contention, and interruption. Compare native observations, not a mock Git verdict. Resolve DEC-003 before mutation implementation. | Evidence only; no user repository mutation. Retain useful counterexamples and transcripts; remove only proven task-owned spent artifacts under the applicable retention rules. |
| SLICE-002: Complete the incident path end to end | REQ-001/002/004/005/006/008; AC-001/002/004/005/006/008; QA-001/002/003; DEC-001/002/004 | One tracked selected path with spaces, unrelated staged and unstaged edits, `reuse`, and detailed checked stdin message: read-only prepare/check -> exact signed commit -> verified result. Replace the blanket memory-path rejection with this positive case, retain genuine disk-only cases, and prove unrelated staging never enters the commit. Inject selected drift and new unrelated staging before commit. | Keep support constrained to combinations actually proven until SLICE-003 closes the matrix. No persistent c2g files, unapproved fallback, or dependency/config change. |
| SLICE-003: Complete literal selectors and failure semantics | REQ-002 through REQ-008; AC-002 through AC-008; QA-002 through QA-006; DEC-001 through DEC-006 | Add prefixes/exclusions, scope-file/raw-byte validation, selected add/delete/rename, selected partial-staging and draft cases, selected message evidence, bounds, filters/modes, and failure/interruption/race cases. Compare final trees to independent native Git fixtures; assert unchanged unrelated index entries/worktree content. | Public paths support must not overstate cases or silently reduce whole-path intent. Any remaining genuine limitation has a specific observed cause and truthful recovery. |
| SLICE-004: Deliver one coherent supported consumer | All requirements and ACs; QA-001/005/006; DEC-004/005/006 | Update canonical guidance, build generated skills/plugins, verify correspondence, run focused and affected regressions, then the final `npm run verify`. Exercise the generated CLI/package with the incident fixture. Separate deterministic proof from any later authorized host/model behavior evaluation. | No installed-cache edit or automatic release. Release owner decides version/publication/activation separately and verifies the installed artifact when authorized. |

Order: SLICE-001 gates the mutation design; SLICE-002 establishes one complete user-visible path; SLICE-003 completes contract coverage; SLICE-004 qualifies the final candidate.
The implementation assignee owns integration and preservation of preexisting changes.
Preparation/proposal/evidence and commit execution share semantic boundaries, so do not assign parallel writers to them before DEC-003 and the proposal shape are settled.
Independent read-only native documentation review or test-matrix review may be parallelized if later authorized; this plan does not delegate further work.

## Verification and oracle ownership

Use real Git for selection, attributes/filters, object modes, refs, signatures, hooks, and index behavior.
Existing harness setup may be reused, but expected selected paths and bytes must be independently specified; never compute the expected digest with the implementation under test and call it independent proof.
Mock only controlled external/process failures and timing seams; retain real-Git integration cases for the behavior those seams protect.
Test fixtures must have independent working files and Git metadata/object storage; linked worktrees do not qualify as disposable repositories.
Test setup configuration and signing remain subject to exact applicable configuration approvals; do not infer those approvals from permission to make disposable commits.

Predicted focused command after building the candidate:

```text
node --test tests/committing-to-git/memory-state.test.mjs tests/committing-to-git/commit-proposal.test.mjs tests/committing-to-git/commit-workflow-cli.test.mjs tests/committing-to-git/draft-isolation.test.mjs
```

Add the final selected-path test module if split from these files.
Affected regressions include `approved-message`, `signature-policy`, `git-process-transcript`, `large-change-unit-transport`, `native-snapshot`, `transaction-recovery`, `index-installation`, `help-contract`, and `architecture-dependency-policy` tests under `tests/committing-to-git/`.
Use the existing Node test runner; no test configuration edit is anticipated.
Cover Windows and POSIX, and clearly report platform-only cases and unsupported byte/path cases.

Run `npm run build` from canonical source to regenerate `skills/` and host packages; never patch generated bundles or installed copies directly.
Inspect anticipated generated paths first: if rebuilding requires a configuration/manifest setting change, obtain approval for that exact setting before writing it.
Keep canonical `SKILL.md` ASCII-only.
Before review, satisfy `npm run format:check` and `npm run lint` or their unchanged-input equivalent in `build:check`/`verify`.
The repository's final implementation gate is `npm run verify`; capture individual failing commands and reports, not just an aggregate status.
Use route-selected HISEW focused/affected/full evidence only after real session ownership and accepted routing exist; no profile evidence is claimed by this draft.

Changing agent-facing scope/storage instructions requires an appropriate behavioral case demonstrating that the agent follows returned memory continuation without a storage question, scope expansion, or invented approval.
Read [evaluation-runtime.md](../evaluation-runtime.md) and the skill suite before preparing that work.
Exact model/provider evaluation authorization remains separate; deterministic verification cannot be relabeled behavioral or cross-host proof.
Any new eval policy/configuration file or setting requires its own exact approval.

## Compatibility, recovery, security, and release

There is no persisted data backfill or transaction schema migration in this plan.
Existing disk transactions retain their existing readers and semantics; removing their empty-index guard is gated on an independently proven scoped executor, not on the memory fix alone.
Staged/full proposals remain unchanged; new path proposals carry strictly validated selection data within the current bounded opaque transport.
An incompatible or malformed proposal must fail closed and be prepared again with the current supported consumer; no dual-version shim is proposed.

Before commit mutation, interruption discards only caller-held state and re-preparation is sufficient.
After native commit starts, inspect HEAD, selected commit/tree/message/signature, index, and lock ownership before choosing recovery.
An absent commit can still leave staged selected content or native Git files; an existing commit must never be retried because a report was lost.
Retain Git-owned failure evidence and unknown/live locks.
Cleanup must identify exact ownership and liveness; never restore a saved whole index over later user changes or claim general rollback of arbitrary hooks.

Security-sensitive boundaries are untrusted selector/proposal bytes, pathspec interpretation, inherited Git overrides, hooks/signers, transient path ownership if any, and the scope of the native mutation.
Reuse existing override rejection, literal byte transport, strict decoding, bounds, and signature verification.
The repository owner assigns required native scoped security assessment at implementation routing; this planning task neither runs a scan nor substitutes its own approval.
No new dependency, network service, telemetry collection, filesystem-wide inventory, or authority-bearing approval flag is proposed.

Production acceptance questions are: did ordinary selected-path preparation stay in memory, did only the approved paths enter the signed commit, were unrelated changes preserved, and did failures describe actual effects?
Use existing structured result fields, bounded diagnostics, and explicit native observations as signals.
Do not add persistent logs solely to prove memory behavior.

Release only the complete verified consumer under separate publication/activation authority.
The responsible observer is the implementing maintainer or designated release owner, using a disposable installed-consumer incident fixture before any real task.
Abort promotion for any scope spill, user-work loss, preparation write, unverifiable message/signature, leaked artifact, or false recovery state.
Before release, reverse only this change's specific source edits if abandoning it, then rebuild and reverify; do not restore unrelated working-tree state.
After activation, prefer a scoped forward fix or temporarily stop the affected route pending an owner decision.
Removing software support does not undo a created commit; rewriting history or restoring an index requires separate concrete authorization and evidence.

## Unknowns, cheapest experiments, and replanning triggers

| Unknown | Cheapest discriminating evidence / decision owner |
| --- | --- |
| DEC-003 transport, index isolation, and failure ownership | SLICE-001 real-Git experiments on both platforms; implementation assignee records evidence, repository owner accepts the route. This gates mutation implementation, not saving this draft. |
| Selected untracked/new paths and path-only commit admission | Test additions and unborn HEAD with exact native command and supported version floor. Do not infer behavior from a tracked-file incident. |
| Sparse index, skip-worktree/assume-unchanged, intent-to-add, filters, symlinks, and submodules | Characterize admission and selected final-state observation with native Git; preserve existing supported semantics or report a precise limit. Do not let unrelated unsupported entries poison selection. |
| Rename pairing and selected message evidence without a preparation index | Compare existing disk selection, read-only observation, and independently enumerated expected paths, including ambiguous exact-content pairs and boundary-crossing renames. Resolve any semantic disagreement before general support. |
| Selector encoding within 4,096-byte proposal capacity | Measure exact canonical encoding at the bound, re-expansion after prefix membership changes, and malformed/raw-byte selectors. Keep genuine capacity failures distinct from the blanket path bug. |
| Recovery after helper loss during native mutation | Controlled kill/failure experiments with Git process liveness, HEAD and index observations. A same-user arbitrary writer cannot be made safe by a proposal digest alone; document the supported concurrency boundary honestly. |

Replan if safe native execution needs persistent workflow state, unbounded or unowned temporary artifacts, a larger transport budget, a supported-version increase, new configuration, partial-hunk path semantics, changes to the legacy disk executor, a compatibility shim, or a persisted journal.
Also rebaseline if current source changes, selection/evidence semantics diverge between memory and disk, the required test oracle is unavailable, or the chosen route can commit outside the approved scope.
Reassess the purpose anchor after each material discovery: a green rejection test, smaller diff, or faster helper is insufficient if the authorized small path commit still forces persistent state or risks unrelated work.

## Planning validation record

This draft was based on read-only source/test/policy inspection, the parent-supplied incident evidence, current native HISEW applicability/status, and primary Git documentation.
No product tests, build, configuration edit, implementation, review, staging, commit, push, or plugin update was performed for this plan.
`docs/plans/**` is explicitly excluded from the repository Markdown-quality automation, so no claim of that automated gate applies to this file.
Final planning checks are limited to this document's links, whitespace/structure, and confirmation that only this new plan was added by this subtask.

## Implementation and verification record

The implementation adds read-only memory observation of literal selected paths, canonical bounded selector transport, and a selected-index digest.
Whole-path scope includes the selected file's unstaged content. Unrelated staging does not invalidate approval; selected content, selected staging, HEAD and selector membership remain bound.
Actual commits stage only the selected paths and use native signed `git commit --only`, with separate checked-message stdin and an exclusive NUL path file removed after child closure.
Post-commit observations compare parent, selected final states, exact message and signature. Hook mutation, staging failure, spawn failure and cleanup uncertainty retain truthful native effects.
The legacy disk path admission rules are unchanged.

New Windows regressions cover read-only prepare/check, detailed message evidence isolation, selected partial staging, unrelated late staging, new/deleted paths, unborn HEAD, prefix/exclusion membership, rename boundaries, literal metacharacters, required SSH verification and native failure cleanup.
The POSIX raw-byte-path regression is present but skipped on this Windows host; no POSIX execution is claimed.
Native-snapshot regression checks pass all eight cases after bounding large fixture output and shortening Windows-only disposable fixture prefixes for native lock paths.
The latest-consumer contract and affected evaluation checks pass 46 cases with fake providers only.

The generated c2g package is `0.1.1-dev.16`, payload SHA-256 `6b4bbe158a4c3cb003364c2d5741083bf5101aad9a35d70022f27485fbec81d6`.
Case 81 records the storage/scope agent behavior; adding and compiling it is not a behavioral evaluation or host activation experiment.
Validator provisioning uses current upstream skills-ref commit `83021e2be457a9b6679148719c1f6074f0ad975e`, Tessl `0.119.0` and skill-up `0.14.0` with reviewed native identities.
The new skill-up input contract omits `kwargs`; the bridge retains exact correlation checks against that contract and rejects the older additional field.
Windows assured qualification stays `pending` for this new binary. Test-only fixture overrides do not enable production dispatch.

Command logs are retained under `C:\Users\Iryna\AppData\Local\Temp\c2g-memory-paths-validation`.
These are ordinary local command observations, not HISEW verification receipts: no current native session identity was supplied, and no execution or receipt was invented.
The original unrelated Markdown-quality migration plan was preserved. No agent-skills development commit, push, plugin activation or publication was performed.

`npm run verify` in `verify-approved-latest.log` passed diff, build/ASCII, formatting/lint, Markdown, all four skills-ref validations, Tessl lint and deterministic evaluation conformance before running all 1,662 Node outcomes: 1,594 passed, 65 skipped and three failed.
Two failures were stale policy schedule assertions after the approved addition of case 81; the corrected assertions pass both targeted checks (`policy-case81-schedules.log`).
The remaining preservation failure expects the earlier `message-format.md` identity (17,338 bytes); the current 18,788-byte file is identical to committed HEAD `2d0203e` and was not edited by this task.
The owner subsequently approved its separate baseline successor record, `tests/fixtures/evaluation-preservation/message-detail-runtime-change.json`.
The record binds exactly that committed path and identity; the focused preservation test now passes. No historical record or unrelated source was changed.
The selected-path staging failure regression passes independently (`staging-failure-contract.log`), proving the pre-existing index and owned test lock remain unchanged and no commit is attempted.
The failed full run remains retained as intermediate evidence; final full verification follows the approved baseline repair and corrected policy assertions.

Final `npm run verify` completed with exit 0 in `verify-final-baseline-repair.log`: all validation stages passed, followed by 1,663 Node outcomes (1,598 passed, 65 skipped, zero failed or cancelled).
The repaired preservation test and selected-path staging-failure regression both passed in that full run.
Skipped cases include platform-specific cases and EPUB cases requiring unavailable Pandoc; this is Windows deterministic evidence, not POSIX, behavioral-model or installed-host acceptance.
Final inspection confirmed `message-format.md` remains unchanged, the development index remains empty and HEAD remains `2d0203eb9d1291805baf8409e52de1712ab8a3bc`.
The dev.16 payload identity is unchanged. No development commit, push, plugin installation or publication was performed.
