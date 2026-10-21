# Issue 20: Actionable preparation diagnostics and bulk authoring recovery

## Status, authority, and baseline

- Status: draft implementation plan, revision 3. Prepared and amended following independent Claude review on 2026-10-19; reassessed against HISEW dev.29 on 2026-10-21, Europe/Bucharest.
- Issue: [agent-skills #20](https://github.com/Hadden-Industries/agent-skills/issues/20), open and last updated at `2026-10-18T23:39:25Z` when inspected; no comments were present.
- Planning baseline: local HEAD and observed remote `main` were both `c6155772378bdddb34f85850b6c0e87c96627fdb`; the working tree was clean before this document was created.
- Incident package: `committing-to-git` `0.1.1-dev.2`; the generated helper SHA-256 was independently checked as `aa2f9b3662839e02d1c827a134a8fd89bb94cf9265b82209a50c1fd41054fc77`, matching the issue.
- Originating chat: `codex://threads/01a14fd5-0972-7102-8beb-a844cb279515`. Its incident account was read and a bounded, read-only consultation confirmed the constraints below.
- Original planning method: HISEW `hadden-industries-plan-software-change`, installed development version 27. Revision 3 uses the installed dev.29 planning procedure and all 13 principles in its `method/engineering-principles.md`; exact authorities and evidence limits are recorded below.
- Reassessment baseline: local HEAD `7c928c974798ae0548f3353ce9c0589256b8b7fe`. Compared with the original baseline, the affected committing-to-git source/tests, shared stable-file primitive, repository instructions, package manifest, Markdown policy, evaluation-runtime guidance, and Linux workflow are unchanged. The intervening changes concern repository-skill reconciliation; the original incident identity remains historical evidence.

The user authorized this plan and its save in `docs/plans`, then explicitly directed that planning use no execution context and leave the other execution untouched.
Retained execution `d6008bfb-a5b6-4047-9a9a-327854f34d89`, observed on 2026-10-19 at generation 11 and paused under another session, is unrelated to this issue; its present state is not asserted by this reassessment.
This planning task does not adopt, resume, close, or otherwise change it.

The requirements, risk route, quality scenarios, and design decisions below form a proposed dossier for review.
There was no separately accepted issue-20 dossier, risk route, or implementation baseline available during planning; none is asserted here.
Saving the plan does not approve implementation, configuration changes, model calls, commits, publication, or a release.
The implementation owner must obtain the accepted baseline and applicable execution authority before implementation.

## Outcome and scope

A caller who requests detailed presentation for an ineligible scope should immediately learn why it is ineligible, retain that explanation after reopening the attempt, and reach a valid bulk message using supported public operations.
The completed message must retain the requested supported sections and all selected change units, while preserving evidence provenance and normal approval, signing, and verification requirements.

The repair covers preparation error classification, durable stopped-attempt diagnostics, supported fresh-preparation guidance, discoverable structured authoring, canonical guidance, and their focused assurance.
It must not remove the presentation limits or weaken the existing transaction and evidence boundaries.

Non-goals are a new commit engine, generic retry framework, automatic execution of recovery commands, support for arbitrary message sections, a repository-wide diagnostic rewrite, historical exception reconstruction, or changes to Git/publication policy.
Do not split a commit, reduce its scope, drop a requested section, weaken verification, or bypass the helper as the recovery strategy.
Do not add `--message-format bulk`, another CLI alias, a compatibility shim, or a new dependency under this plan.
If the existing native operations cannot satisfy the accepted outcome, replan the specific missing contract before extending the public command surface.

## Evidence and current behavior

The incident used actual mode, staged scope, an explicit task-lineage evidence plan, and `--message-format detailed` for 64 change units.
The reviewed tree was `45b05255c7558b7e3827c6dd01202bf1952b9260`; its parent was `fbf067c61ef0b38b19f33172921e7805bba9f4a0`.
Both retained attempts had a 48,814-byte snapshot artifact, but their stopped transaction records had null snapshot and HEAD anchors because the format rejection preceded attachment of those facts.
That snapshot JSON size is not the projected message size and must not be used as the presentation-limit measurement.

| Current authority | Observed behavior and implication |
| --- | --- |
| [`message/changeSelection.js`](../../src/committing-to-git/message/changeSelection.js), `selectMessagePresentation` | Selects bulk at 50 or more units, or when projected detailed bytes exceed 32,768. Exactly 32,768 bytes remains eligible below 50 units. |
| [`message/commitMessageRenderer.js`](../../src/committing-to-git/message/commitMessageRenderer.js), `messagePresentationForManifest` | Projects a minimal subject plus exact-path inventory titles, without rationale, user-experience prose, or file notes. This lower bound selects presentation; it is not the final message size. It currently returns only the mode, although diagnostics need the measurements and reasons too. |
| [`workflow/prepareWorkflow.js`](../../src/committing-to-git/workflow/prepareWorkflow.js) | Rejects explicit detailed presentation after snapshot validation and before real-index installation. `stopAllocatedPreparation` preserves snapshot-capacity errors specially but wraps this actionable error in `PREPARATION_STOPPED`. |
| [`diagnostics/workflowDiagnosticError.js`](../../src/committing-to-git/diagnostics/workflowDiagnosticError.js) | Public results project the recognized outer diagnostic. An in-memory `cause` is not durable diagnostic storage and is intentionally not exposed as arbitrary recovery advice. |
| [`workflow/recoverTransactionWorkflow.js`](../../src/committing-to-git/workflow/recoverTransactionWorkflow.js) | Terminal stopped attempts return their effect state with no actionable original preparation diagnostic. |
| [`workflow/reportDetailWorkflow.js`](../../src/committing-to-git/workflow/reportDetailWorkflow.js) and [`workflow/processDiagnostics.js`](../../src/committing-to-git/workflow/processDiagnostics.js) | The diagnostics section currently reports commit/publication process evidence. It cannot explain an earlier preparation failure; report/workspace sections require later phases. |
| [`workflow/resumePreparationWorkflow.js`](../../src/committing-to-git/workflow/resumePreparationWorkflow.js) | A stopped attempt cannot resume. Keep that terminal boundary. |
| [`workflow/extendReviewWorkflow.js`](../../src/committing-to-git/workflow/extendReviewWorkflow.js) | Semantic-structure extension is admitted only from concise, evidence-ready state. It cannot repair an already-extended route by being called again. |
| [`workflow/authoringProgress.js`](../../src/committing-to-git/workflow/authoringProgress.js) | Evidence-driven extended preparation can advertise `author-message` with null `contentPath` and `contentContract`, even though the native finalizer supports structured authoring after review completes. The current message-format reference explicitly calls the bulk transition unsupported; repairing this requires a deliberate public contract and guidance change. |
| [`tests/committing-to-git/reviewed-preparation.test.mjs`](../../tests/committing-to-git/reviewed-preparation.test.mjs) | The existing 50-unit test expects the generic wrapper and inspects its private cause. Replace that expectation with the public contract while retaining the unchanged-index oracle. |

The original exception was not persisted.
The detailed/bulk mismatch is a source-and-artifact diagnosis of the captured incident, not a recovered exception or a newly executed reproduction.
The originating chat's prohibition on incident test reruns and helper retries remains respected by this planning task.

## Proposed route, ownership, and prerequisites

Propose R2 for implementation because this repair changes a public diagnostic/recovery contract, retained transaction data, and guidance adjacent to Git mutations.
The affected surface is bounded to this skill and its consumers; no R3 consequence is established by the evidence.
The user/repository maintainer owns acceptance of the dossier and consequential decisions.
One implementation owner integrates transaction, public-result, and guidance changes together.
An independent verifier owns the final assessment of effect-state truthfulness, diagnostic disclosure, and recovery eligibility.
The changed retained-input, parsing, filesystem, and diagnostic-disclosure boundaries trigger a scoped native security assessment under SEC-01, with the maintainer owning its scope and disposition.

Before implementation:

1. Recheck the issue, source baseline, working-tree changes, current HISEW applicability, execution ownership, and evidence/temporary destinations. Preserve unrelated work and resolve actual ownership through the user's chosen route; this plan does not authorize taking over the retained execution.
2. Accept or revise `REQ-001` through `REQ-006`, the proposed R2 route, and `DEC-001` through `DEC-005`; identify and protect the exact accepted baseline before implementation. Bind the future native route record to that baseline, assess every required risk trigger and specialist lens, and declare the affected trust-boundary/input-limits scope. Missing acceptance remains a prerequisite, not an assumed approval.
3. Resolve exact configuration approvals where applicable. No configuration edit is needed to save this plan. Proposed evaluation-policy bindings or generated package metadata changes must be shown as exact file/setting diffs before approval; do not change build, package, lock, CI, lint, formatting, or repository-policy files implicitly.
4. Before executing tests that create disposable repositories, establish the applicable authorization for their fixture configuration and signing setup. The existing harness writes local Git identity/signing settings; the disposable-commit exception expressly does not waive configuration or signing controls.
5. Select current verification profiles and record their actual commands. Require the final `npm run verify` gate; a HISEW `full` receipt satisfies it only if that profile actually executes this command for the final candidate and completes the native handoff.
6. Bind available native security and destructive-command controls to the implementation host. Establish any required scan authority and actual coverage; capability discovery, installation, and this plan do not supply it. Retain unresolved coverage as a prerequisite rather than substituting the earlier Claude document review.

Read-only research, the document save, and the separately requested static Claude review and plan amendments are the scope of the present task.
Implementation and evaluation commands below are future proof obligations, not a record of commands run.

## Requirements and acceptance criteria

| Requirement | Proposed acceptance criterion |
| --- | --- |
| `REQ-001`: Preserve actionable expected preparation failures. | `AC-001`: Ineligible explicit-detailed preparation exposes stable `DETAILED_MESSAGE_LIMIT_EXCEEDED`, safe explanation, unit count, projected detailed bytes with their minimal-subject/titles-only meaning, both limits, requested/required modes, and the reasons that selected bulk. Use the existing invalid-input disposition/exit mapping, documenting the change from the current generic rejection. |
| `REQ-002`: Retain a trustworthy diagnostic across process boundaries. | `AC-002`: A fresh process can obtain the original bounded diagnostic and current effect/recovery facts through `workflow recover` and `workflow report-detail --section diagnostics`, in summary/full JSON and text presentations where supported. No private transaction read is required. |
| `REQ-003`: Give a version-valid correction without losing intent. | `AC-003`: Recovery distinguishes terminal stop from fresh preparation, provides exact public arguments or fixed public input worksheets, preserves mode, scope/selectors, evidence groups and basis notes, allowed types, and verification policy, and identifies required freshness/authorization checks. Guidance identifies the supported sections and tells callers to carry their requested sections into `content.json`; it does not claim that preparation retained section intent it never received. |
| `REQ-003`: Reach bulk authoring on every relevant evidence route. | `AC-004`: A packaged public-command driver reaches `message-ready` using separate 64-unit fixtures for concise-then-semantic-extension and evidence-driven already-extended routes, asserting each route and its reason before continuing. The first preserves the incident's task-lineage reuse shape; the second deliberately exercises evidence-driven extension. All units and caller-requested `Rationale:`, `User Experience Changes:`, and `File Changes:` sections survive; no second extension, unsupported resume, or private-artifact workaround is used. |
| `REQ-004`: Make guidance correct at the choice point. | `AC-005`: Canonical instructions, message/recovery references, prepare/extend help, and returned authoring contracts agree on the thresholds, body-versus-presentation distinction, and complete recovery sequence. Every executable example is accepted by the matching built package. |
| `REQ-005`: Preserve safety, capacity, and truthful effects. | `AC-006`: No commit or real-index installation occurs on the format rejection; unknown exceptions stay sanitized; checkpoint failures do not claim a durable stop or an unverified resume path. Existing snapshot-capacity, index-interruption, signature, review, approval, and publication guarantees continue to hold. |
| `REQ-006`: Deliver and qualify the exact maintained package. | `AC-007`: Canonical changes regenerate all corresponding distributions, deterministic local gates pass, the new public recovery path passes packaged tests, and the independent verifier and triggered native security assessment cover the exact candidate. Behavioral/portability/hosted evidence and any unexecuted acceptance work are recorded separately. |

## Invariants and quality scenarios

| Scenario | Stimulus and measurable expected result |
| --- | --- |
| `QA-001`, boundary correctness | Counts 49, 50, and 64 and projected sizes 32,767, 32,768, and 32,769 bytes produce the independent expected matrix. Count and byte reasons are distinguishable; the projection measures the minimal subject and inventory titles in UTF-8, not the full authored message or snapshot JSON. A separate below-50 fixture fits the projection but exceeds the final rendered-byte budget and receives a reachable prose-correction remedy. |
| `QA-002`, effect safety | For staged, full, and path scopes in applicable actual/draft modes, reject ineligible detailed presentation and independently compare HEAD, real-index bytes/tree, selected membership, and excluded/untracked working files. No commit, publication, or index installation is attributed to the rejected preparation. Scratch artifacts or Git objects may exist. |
| `QA-003`, restart recoverability | Stop at the known rejection, exit the process, and reopen through public recovery/detail commands. The diagnostic remains available, the stopped phase stays terminal, and recovery inspection does not advance into authoring or commit. |
| `QA-004`, input and repository drift | Change a scope/evidence file, selected content, HEAD, or staged membership between rejection and correction. Do not present old evidence or authorization as covering the new candidate. Missing/unverifiable bindings produce explicit required inputs or a blocked correction, not a claim of safe identical replay. |
| `QA-005`, disclosure and boundedness | Inject unknown exceptions, forged diagnostic-like objects, getters, `toJSON`, cyclic/deep details, control characters, large text, and long operands. Also alter retained scope/evidence fields and digests independently: normalization or identity failure must suppress runnable correction advice. Preserve the existing 192-KiB result and 4,096-byte diagnostic-text budgets; never truncate a recovery operand into another identity. No raw stacks, cause chains, credentials, or environment dumps escape. |
| `QA-006`, interrupted persistence | Fail worksheet creation, failure-record validation, the stop write, and post-replacement directory flush separately, then inspect again. Report observed record state separately from confirmed checkpoint durability; never hard-code the phase or promise resume when its full native prerequisites are absent. Assert the `recover`, `resume`, ordinary-cleanup, and separately authorized purge results for a leftover `allocated` attempt with no snapshot, as specified in DEC-002. |
| `QA-007`, authoring usability | From returned public instructions alone, preserve 64-unit membership, evidence coverage, caller-carried requested sections, and edited worksheet content through finalization. Assert distinct route/reason preconditions; an extended `author-message` inventory error must advertise its admitted structured alternative. First present exact message approval only after `message-ready`. No commit is required to prove this recovery path. |
| `QA-008`, compatibility and retention | Updated readers accept untouched older schema-4 transactions without inventing a missing diagnostic. New records validate in runtime and schema checks. Ordinary compaction retains the diagnostic and dedicated correction inputs; a fresh public inspection can still supply a working correction. Missing, replaced, or corrupt inputs withdraw runnable advice without regeneration during inspection. |

## Proposed design decisions

### DEC-001: Reuse the presentation and diagnostic authorities

Keep `selectMessagePresentation` as the authority for the count/byte decision and the renderer as the authority for exact projected inventory bytes.
Expose a coherent presentation assessment from these existing seams so preparation, scaffolding, diagnostics, and help-contract checks use the same measurements and decision.
Move the count threshold to one shared `BULK_CHANGE_UNIT_THRESHOLD` authority beside `MAXIMUM_CANONICAL_MESSAGE_BYTES` in `message/changeSelection.js`, and update selection, rendering, approved-message validation, and diagnostic consumers together.
Resolve the existing renderer export and its callers directly; do not add a legacy-name alias or introduce a renderer/validator import cycle.
Do not duplicate the counting rule inside recovery or infer it from serialized snapshot size.
Keep boundary expectations independently written in tests.

Define `projectedDetailedBytes` as the UTF-8 lower bound produced from the minimal `a: A` subject and numbered inventory titles, excluding authored narrative and notes.
Preparation eligibility does not guarantee that the completed detailed message fits the independent final 32,768-byte budget.
For a below-50 detailed transaction whose final rendering exceeds that budget, replace the unreachable instruction to select bulk with a supported correction: shorten prose while preserving every selected unit, requested section, and required meaning, then finalize again.
The current fixed mode cannot be changed by editing `content.mode`, and repeating prepare without the flag still selects detailed when the projection fits.
If the accepted meaning cannot fit, report the unmet requirement and replan the minimal native capability; do not promise a bulk switch, drop a requested section, or weaken the limit.

Use the branded expected-diagnostic path and existing safe projectors in `workflowDiagnosticError.js` and `diagnosticContract.js`.
Preserve recognized preparation diagnostics, including snapshot-capacity diagnostics, while combining them with independently established stopped-state facts.
An arbitrary object with a `code` property, an arbitrary exception cause, or an unvalidated retained JSON object is not diagnostic authority.
Keep a sanitized generic outcome for unknown failures.

### DEC-002: Checkpoint the safe preparation failure with the stop

Propose an optional, versioned `preparationFailure` record in the existing transaction, written in the same atomic transition that records the terminal stopped state.
It contains the normalized public diagnostic and the bounded facts needed to explain/correct that attempt, not an Error object or executable code.
Validate both the runtime shape and `commitTransaction.schema.json`, including which phases may contain the record.
The record is optional when reading existing schema-4 attempts; absence means the original diagnostic was not retained.

Capture validated snapshot observations needed for the format-failure explanation and later comparison inside `preparationFailure`, before throwing that failure.
Do not attach or trust snapshot observations from failures that occurred before successful snapshot validation.
Leave top-level `snapshot` and `headAnchor` unattached on this rejection; the current allocated-resume path would otherwise become eligible without repeating the presentation check.
Do not make the stopped attempt resumable, move it to `snapshot-created`, or imply that a real index was installed merely because a snapshot artifact exists.

Construct and pre-validate the bounded failure record with the same pure validator used by transaction admission before attempting the atomic stop.
Failure-record construction, validation, or optional correction-file creation must not prevent the terminal transition itself.
If the record cannot be admitted, checkpoint the stop without that optional record and clearly report that the original diagnostic was not retained; keep a safe original diagnostic in the current response when possible.
Do not attach an invalid or partial correction binding just to make the stop succeed.

If the checkpoint throws, reread the authoritative transaction before reporting its phase: replacement may have succeeded before a directory-flush failure.
Distinguish observed stopped state from confirmed durability, and preserve the original failure and checkpoint failure as separate safe facts in the current result.
If readback itself fails, mark that state unavailable and withhold executable recovery advice instead of substituting an assumed `allocated` or `stopped` phase.
Compute resume eligibility from the complete native phase, snapshot, journal, repository, and identity requirements; a non-null field alone is insufficient.
For a leftover `allocated` record with no valid snapshot/journal, require these public outcomes:

- `recover` retains the `RECOVERY_NOT_REQUIRED` distinction for absent irreversible-journal recovery but explains that preparation is incomplete, with `resumeAllowed: false`; it must not fabricate the original rejection when no failure record survived.
- `resume` retains `INVALID_TRANSACTION_ARTIFACT` for the missing valid snapshot, advertises no executable resume path, and leaves the attempt unchanged.
- Ordinary cleanup retains `CLEANUP_NOT_ALLOWED` for the nonterminal attempt; separately authorized `cleanup --purge` follows the existing abandonment/purge rules and is never automatic or a prerequisite for fresh preparation.
- A fresh preparation is possible only under normal repository/input preflight and current authority. If original correction bindings were not retained, require the caller's validated inputs rather than reconstructing a known failure from an unattached snapshot.

Persist safe machine-readable facts and reconstruct public recovery advice through the current domain owner.
Do not deserialize a retained error into a newly trusted exception or execute stored command strings.
Keep the original failure distinct from a successful inspection: a successful `recover` can return exit 0 with a clearly named original preparation diagnostic and current correction guidance, without claiming that preparation succeeded.

Extend the existing diagnostics detail section to include preparation diagnostics while preserving process diagnostics.
If that orchestration now covers multiple diagnostic domains, reassess its name under NAM-01; a function still named `readProcessDiagnostics` should continue to mean process evidence only.
Do not loosen report/workspace phase restrictions to expose unrelated private files.

### DEC-003: Retain the stopped attempt and start a corrected fresh preparation

The preferred correction uses existing `workflow prepare` arguments with the explicit detailed request omitted.
`--message-format bulk` is not currently accepted and is not part of this design.
The failed transaction remains inspectable and terminal; `workflow resume` must reject it with useful guidance toward the supported fresh operation.

Build correction inputs from validated retained request facts: original mode, normalized scope/selectors, evidence policy/groups and basis notes, allowed types, and verification policy.
The current transaction reader only requires `scope` and `initialEvidencePlan` to be objects; that is insufficient authority to emit a correction.
Reuse or extract the existing pure `normalizeScopePayload` and `normalizeEvidencePlan` owners, reconstructing the admitted input payloads and comparing their canonical-byte digests with the pre-routing `scope.selectorDigest` and `initialEvidencePlan.sha256`.
For staged/full scope, check the existing digest of the scope kind and the absence of path selectors; apply scope-payload normalization only to path scope.
Do not confuse the pre-routing evidence digest with the manifest-bound digest assigned after successful evidence routing.
Malformed facts, mismatched digests, or unavailable provenance withdraw correction advice; digest consistency is not authentication of a maliciously rewritten record and does not replace authority or freshness checks.

During preparation's known-rejection handling, create dedicated attempt-owned correction inputs before the stop checkpoint: `preparation-correction-evidence-plan.json`, plus `preparation-correction-scope.json` for path scope.
Use the existing public `--evidence-plan` schema 1 and `--scope-file` schema 2 formats and input-size limits, preserving canonical bytes and all groups, basis notes, selectors, and exclusions.
Do not reuse `evidence-plan-input.json`: it is a transient input also used by evidence extension and is explicitly deleted by ordinary compaction.
Use existing stable, bounded, non-link file primitives; retain exact paths, byte counts, and digests in the optional failure record only after successful creation and verification.
A file-creation failure leaves the diagnostic retainable but marks the correction inputs unavailable, without a runnable command.
Keep large input contents out of the 192-KiB result envelope.

The stopped-attempt branches of `recover` and diagnostic inspection verify these files and publish their exact public paths/identities without creating, rewriting, or regenerating them; other recovery domains retain their existing mutation semantics.
Ordinary compaction preserves the dedicated files and failure record until separately authorized purge.
If a required file is missing, corrupt, replaced, or no longer bound to valid request facts, return a specific unavailable-input prerequisite and suppress the runnable correction.
Checkpoint-orphaned files are not executable authority and remain subject to the existing attempt cleanup rules.
Never instruct the caller to inspect or edit `transaction.json`.
Do not flatten mixed evidence into uniform reuse, discard exclusions, or silently change full/staged/path semantics.

Preparation has no section-intent input, so correction cannot recover a persisted list of requested sections.
Guidance must identify the supported `Rationale:`, `User Experience Changes:`, and `File Changes:` fields and tell the caller to carry its conversation/request intent into the semantic worksheet.
The public driver's independent oracle supplies and checks that intent through finalization; no new section-intent flag or transaction field is proposed.

Recovery must state the repository working directory and distinguish an informational correction from authority to execute it.
Revalidate repository anchors and input identities before recommending a fresh mutation.
Treat the new preparation as a fresh candidate subject to normal native preflight and subsequent snapshot/evidence comparison; do not carry over approval or check receipts as if it were the old attempt.
The approval scope can remain valid, but changed files or claims require reassessment.
A prior observation cannot eliminate the race between separate commands: if the implementation cannot enforce a material freshness precondition with existing supported inputs, return the missing prerequisite and replan that bounded native seam rather than advertise an unconditional safe replay.

After fresh preparation:

| Returned state | Public continuation |
| --- | --- |
| Concise, evidence-ready; structured inventory requested | `workflow extend --transaction <new-handle> --reason semantic-structure-required`, then follow returned review/authoring state. |
| Extended with review outstanding | Follow `workflow review-next` and its exact cursor until review is complete; never extend again or finalize early. |
| Extended with required structured authoring | Use returned `contentPath`/`contentContract`, preserve helper-owned fields, and run `message finalize`. |
| Extended, author-message, but a bulk inventory is requested | Use the explicit supported structured-authoring alternative defined in DEC-004, then `message finalize`; do not hand-render counted domains or drop the inventory. |
| Any uncertain-effect or invalid state | Follow the applicable native diagnostic; this known no-commit correction does not authorize retrying an uncertain mutation. |

### DEC-004: Advertise the existing structured alternative explicitly

Preserve checked subject-only/multisection text as the default when the evidence route legitimately returns `author-message`.
Do not force an inventory merely because a change contains many files.
For an extended transaction whose evidence is complete and whose phase admits finalization, expose an additive, named structured-authoring alternative, for example `structuredAuthoring`, from the shared authoring-progress authority.
It identifies the admitted finalizer, fixed `contentPath`, selected mode, content contract, and template availability.
This is a proposal for an explicit public contract, not a claim that those fields already exist.
Explicitly replace the current message-format reference's assertion that an `author-message` counted-bulk transition is unsupported, while preserving the checked-text default and its nullable default `contentPath`.
The named alternative supplies its own fixed content path and contract; native finalizer permissiveness alone does not establish this new supported public choice.

The alternative must be present consistently at preparation, resume, completed review traversal, and applicable message-error recovery boundaries.
Audit `message/approvedMessage.js`, `workflow/checkMessageWorkflow.js`, and the `messageAuthoringRecovery` consumers in `workflow/createCommitWorkflow.js` as part of that contract.
Replace the current `STRUCTURED_BULK_FINALIZATION_REQUIRED` remedy to extend or omit `File Changes:` with route-aware advice: extend only from concise/evidence-ready; from admitted extended/author-message state, expose the named structured alternative and its literal finalizer arguments.
Keep state-specific guidance in the workflow/authoring authority, with the lower-level validator supplying the presentation diagnostic rather than guessing transaction transitions.
For other phases, return the actual prerequisite instead of suggesting a forbidden extension, premature finalization, or section removal.
It must not advertise an executable finalizer before evidence completion or in terminal/committed phases.
Use the same content schema, semantic validator, renderer, receipt checks, and native finalization operation as required structured authoring.
A caller choosing that supported alternative still supplies semantics only; the helper derives counts, ordering, and exhaustive membership.

Preserve authored worksheet bytes: return a fresh template only when the existing unedited scaffold is verified and the inline budget permits it.
Otherwise expose the fixed worksheet and explain why the template is absent.
Guidance must explain that `nextAction` identifies the default/required route and the named alternative is an explicitly supported choice when the requested presentation needs it.
If this creates ambiguous host behavior during the targeted experiment, replan the public transition before implementation proceeds; native finalizer acceptance alone is insufficient proof of a usable contract.

### DEC-005: Keep compatibility, reuse, and approval boundaries explicit

This is a repair of existing native preparation, transaction, recovery, and authoring capabilities.
The research question is whether those existing mechanisms can preserve the diagnostic and carry callers through the already-supported finalizer without adding a retry engine, parser, or alternate workflow.
The source assessment above identifies the native owners and their residual gaps: safe diagnostic persistence, validated correction inputs, and public discovery of an admitted authoring choice.
Repair those seams and reuse the existing package-test/evaluation runtime; a second framework would duplicate their state and authority without meeting an unmet requirement.
The absence of a new dependency is not an exemption from REU-01: if implementation discovers a genuinely new capability, complete the required broad current-component research and requirement-by-requirement fit/rights assessment before custom design.

One existing assurance mechanism needs replacement within this issue's affected tests.
[`tests/helpers/json-schema.mjs`](../../tests/helpers/json-schema.mjs) implements a hand-written subset of JSON Schema; `artifact-schemas.test.mjs` and `reviewed-preparation.test.mjs` currently use it.
Dev.29 VAL-01 requires a maintained schema-language implementation, so use the repository's existing Ajv dependency for these committing-to-git assertions instead of extending the subset interpreter.
[`scripts/evaluation/compile-suite.js`](../../scripts/evaluation/compile-suite.js) already uses `Ajv2020` with strict schema checks; reuse that supported API pattern without importing the evaluation compiler or coupling business workflows to it.
The target transaction schema declares draft 2020-12, which requires the dedicated class described in the [Ajv schema documentation](https://ajv.js.org/json-schema.html).
Use strict compilation and local references, preserve root definitions/references, and leave coercion, default insertion, property removal, and remote loading disabled; these controls follow the [Ajv option contract](https://ajv.js.org/options.html).
Keep application-specific transaction/effect validation separate and exercise its parity with the full schema validator.
Migrate the affected committing-to-git consumers together; unrelated EPUB/helper consumers remain outside this repair and must not be used as a fallback for the migrated assertions.

On 2026-10-21 the installed Ajv and the [npm registry's authoritative release metadata](https://registry.npmjs.org/ajv/latest) both identified version `8.20.0`.
Its installed licence text is MIT, requiring preservation of the copyright and permission notice; this use remains development/test tooling within the repository's existing MPL-2.0 project, with no proposed runtime bundling or distribution change.
Preserve existing notices and dependency resolution; technical suitability, rights assessment, and successful integration remain separate claims.
Refresh release/terms evidence before adoption or material extension if it changes, and obtain the accountable owner decision for any unresolved rights or deployment restriction.
No dependency, package, lockfile, licence, or configuration edit is authorized by this selection; any newly necessary edit requires exact approval.
There is no identified prior NSH-01 override; no shim is proposed.

An optional field still changes what strict older readers can accept.
Updated readers must accept old records; do not claim that an older package can read new `preparationFailure` records.
Historical records remain immutable evidence read by the qualified current reader, not authority to support superseded executable consumers.
Update and qualify all affected current consumers before activation; refuse incompatible consumers without aliases, fallback readers, or a dual-version support window.
Retained old package bytes serve historical evidence only. Any deployment recovery must satisfy the current contract; reverting to an earlier artifact does not establish that qualification.
Do not rewrite historical attempts, manufacture missing exception bytes, or silently migrate retained records.
Use a new transaction version instead only if the compatibility experiment demonstrates a real need, with that decision explicitly re-baselined.

## Dev.29 principle and assurance contract

The beneficiary is the caller preparing the complete requested commit message: success means one truthful public explanation and a supported path to message readiness with all scope, meaning, and evidence preserved.
Reason from that outcome and first principles, then maintained practice and authoritative contracts, while honoring binding requirements throughout.
Recheck it at route/plan acceptance, material discoveries, pre-review, and release: easier recovery must not introduce unsafe replay, private-data disclosure, unbounded retention, or ambiguous authoring choices.
If the structured alternative or extra retained files impose more cost than their recovery benefit, compare simplification, existing native reuse, coordinated contract change, and deferral before expanding the implementation.

| Principle | Issue-specific implementation and review obligation |
| --- | --- |
| NAM-01, non-waivable | Review every added/changed code and filesystem object, including retained names whose behavior changes and the enclosing file's role. Names must express actual meaning at all uses, units, cardinality, and positive boolean propositions where applicable. Review synonym collisions and refactor affected callers, tests, schemas, and guidance together. A presentation function returning measurements needs an assessment name; `preparationFailure` must mean retained historical failure, not current effects. Keep process-only diagnostics named accordingly or rename the aggregate. Report even low-severity semantic defects without requiring a separate harm story. No per-identifier ledger is required. |
| DOC-01, non-waivable | At changed module/type/public or non-obvious function declarations, document contracts: inputs, returns, failures, and relevant ownership/lifetime/concurrency. Explain projection lower bounds, diagnostic/effect separation, input retention, and post-replacement durability uncertainty where names/code cannot. Update or remove stale comments in the same change; do not narrate syntax, preserve obsolete behavior in comments, or use comments as an authority override. Unresolved TODOs need a concrete closure reference. |
| NSH-01 | Use the native finalizer, input normalizers, and error contract. No compatibility bridge, alias, or alternate validation fallback has an approved override. Normal expected-error handling is not itself a shim. |
| PRP-01 | Preserve R2's prior accepted protected baseline, full relevant verification, independent verifier, and triggered specialists. Use bounded slice checks and existing task records; neither automatic agent fan-out nor repeating unchanged full suites is required. |
| REU-01 | Use DEC-005's native-owner and residual-gap assessment. New functionality, even without a dependency, requires the deeper research gate before custom design; unfamiliarity or integration inconvenience does not justify duplication. |
| DRY-01 | Apply the seams table's authority/consumer/failure-boundary decision to all current representations. Qualify latest consumers together, reject obsolete contracts, preserve independent test oracles and immutable history, and record the reason/owner/conformance control for any deliberate duplication. |
| VER-01 | Freeze the selected supported version/source identity after checking authoritative current stable/applicable LTS evidence. An old pin alone is not freshness proof, and an unpinned `latest` execution is not reproducible selection. Recheck materially changed selections before deployment. |
| LIC-01 | Inspect actual selected terms and intended use; retain notices and distinguish technical fit, rights clearance, and integration proof. A badge or SPDX identifier alone is insufficient. Material unknowns block the affected adoption for an accountable decision. |
| VAL-01 | Use actual consumer parsers/normalizers and Ajv for JSON Schema. Do not extend the hand-written schema grammar or run an effectful operation merely to validate input. Validate the parsed value, with limits/admission separate from schema semantics and independent expected outcomes. |
| OUT-01 | Judge scope/section survival, truthful effects, usable next steps, privacy, retention cost, and authorization burden against the beneficiary outcome above. Passing tests or fewer tool calls alone do not establish success. |
| SEC-01 | Perform one appropriately scoped top-level native security workflow on a frozen implementation candidate: Codex Security on the current Codex host. Cover retained JSON, paths/files, digests versus authenticity, bounded diagnostics, authoring eligibility, and stop/cleanup effects. Retain the restricted original bundle with scan, revision, plugin/model identities, actual coverage, gaps, and finding dispositions. Keep triage, remediation, fix verification, and release authority distinct. The Claude plan review and deterministic checks do not substitute for it; unavailable or unauthorized coverage requires an accountable alternative and stays unresolved until that decision and its proof. |
| CMD-01 | Use available native destructive-command protection alongside sandbox and action authority. Verify actual host/hook coverage rather than infer it from installation; do not write a shell-command parser, weaken protection, or retry blocked effects through an interpreter. A necessary exception requires its exact accountable decision. |
| CLEAN-01 | Use native bounded resource allocation and inventory for future fixtures/reviews/evaluations; retain compact sufficient evidence and close spent working material only when ownership, consumers, and preservation obligations permit it. Never delete records to make recovery or completion appear successful. |

The independent verifier must explicitly cover naming and comments even if an ordinary review provider filters low-severity findings; supplement the existing review record only for that uncovered scope.
Use source, consumer validation, behavioral oracles, and actual review coverage as evidence.
Native workflow assessments are generation-bound operator claims: recording `satisfied` yields `claimed-unverified`, not a machine certification that these principles were followed.

## Seams and DRY assessment

These file predictions guide implementation; they are not an approved edit list or predicted line numbers.

| Rule and current authority | Likely consumers/files | Strategy and failure boundary |
| --- | --- | --- |
| Presentation eligibility and UTF-8 projection | `message/changeSelection.js`, `message/commitMessageRenderer.js`, `message/approvedMessage.js`, `workflow/prepareWorkflow.js` | Share count/byte constants and the existing assessment seam; distinguish lower-bound projection from final rendered bytes and give reachable remedies. Keep independent boundary oracles and evidence routing separate. |
| Public diagnostics and effect vocabulary | `diagnostics/workflowDiagnosticError.js`, `diagnostics/diagnosticContract.js`, `transaction/transactionDiagnosticState.js` | Reuse branded normalization and shared bounds. Domain code owns effects; serializers cannot infer no mutation from an exception alone. |
| Durable stop and strict record admission | `workflow/prepareWorkflow.js`, `transaction/transactionWorkspace.js`, `schema/commitTransaction.schema.json` | Pre-validate the optional failure record; checkpoint the stop even when optional diagnostics/inputs cannot be retained. Re-read state after write failure. Runtime/schema parity tests control drift. |
| JSON Schema language validation | Existing Ajv dependency; `tests/committing-to-git/artifact-schemas.test.mjs`, `tests/committing-to-git/reviewed-preparation.test.mjs` | Replace affected hand-written schema-helper assertions with strict Ajv2020 validation. Preserve independent expected decisions and application-specific runtime checks; do not broaden the change to unrelated legacy consumers. |
| Correction input admission and identity | Existing scope/evidence normalizers in `workflow/prepareWorkflow.js`, stable file primitives, transaction/recovery consumers | Reuse the canonical input rules, validate pre-routing digests, create dedicated files during rejection handling, and inspect them without regeneration. Keep command bounds and file-input limits distinct. |
| Public recovery and diagnostic inspection | `workflow/recoverTransactionWorkflow.js`, `workflow/reportDetailWorkflow.js`, `workflow/processDiagnostics.js`, `workflow/resumePreparationWorkflow.js` | Share the validated preparation-diagnostic projection; keep process evidence, index recovery, and terminal-state authority distinct. |
| Structured authoring and native validation | `workflow/authoringProgress.js`, `workflow/extendReviewWorkflow.js`, `workflow/reviewNextWorkflow.js`, `workflow/finalizeMessageWorkflow.js`, `workflow/checkMessageWorkflow.js`, `workflow/createCommitWorkflow.js`, `message/approvedMessage.js`, `message/semanticContentContract.js` | Derive both advertised authoring paths and remedies from admitted state; cover message-check/create error consumers and reuse the finalizer/schema without duplicating finalization. |
| Retention and cleanup | `transaction/transactionRecovery.js` | Retain the failure record and dedicated correction inputs through ordinary compaction. Missing/corrupt inputs withdraw advice without inspection-time writes; purge remains separately authorized. |
| Public explanation | `SKILL.md`, `references/message-format.md`, `references/diagnostics.md`, `references/transaction-recovery.md`, `references/inspection-recovery.md`, `cli/commandArguments.js` | Canonical source owns guidance. Repeated essential thresholds are deliberate reader-facing duplication, checked against executable examples and the same package contract. |
| Deployment and evaluation consumers | `skills/committing-to-git/`, `plugins/committing-to-git/`, `tests/committing-to-git/`, `src/committing-to-git/evals/` | Build from `src/`; never patch generated/installed copies. Package identity, deterministic checks, model behavior, and host activation remain separate evidence. |

The integration owner reviews each shared rule against current consumers and owns any deliberate duplication decision.
Reassess these boundaries if another independently deployed consumer or a conflicting contract is discovered.

## Vertical implementation slices

### SLICE-001: Explain one rejected preparation immediately and after restart

Implement the presentation assessment, recognized-diagnostic preservation, atomic failure record, and public recovery/detail projection for the known detailed-limit rejection.
Include a bounded generic unknown-failure path and preserve snapshot-capacity behavior.
Update runtime/schema admission and legacy-record handling as part of this same observable path.
Move both affected schema-test consumers to Ajv2020 in this slice, preserving complete schema reference resolution and testing valid, invalid, and malformed optional records against independent expectations.
Do not expand or silently fall back to the hand-written schema checker when native compilation reveals a defect; fix the smallest contract error or obtain any required exact configuration approval.

Demonstrate with a packaged 64-unit staged fixture that the caller receives the useful diagnostic, unchanged effect facts, and the same explanation after a new process opens the attempt.
Add focused checkpoint-failure and disclosure regressions, including malformed optional records, failed correction-file creation, and an atomic replacement followed by failed directory flush.
This slice can improve inspection independently, but issue closure waits for a usable continuation.
Preserve new records and their qualified current reader; deployment recovery must not reactivate a superseded consumer.

### SLICE-002: Complete the supported correction through bulk message readiness

Expose exact fresh-preparation correction inputs and the explicit structured-authoring alternative.
Create and bind dedicated correction files during preparation, verify retained request facts through the existing normalizers, and preserve those files through compaction.
Connect the returned states across prepare, review traversal, resume of eligible nonterminal preparations, message diagnostics, and finalize.
Keep the original stopped transaction terminal and retain the normal evidence and approval gates.

Demonstrate both concise and already-extended 64-unit paths using only copied public package resources, returned commands, and public worksheets.
Use distinct route-driving fixtures and assert their returned route/reason first; include compaction followed by fresh-process inspection and execution of the advertised correction.
Exercise the extended checked-text inventory error and follow its structured alternative to completion.
Verify membership, meaningful requested sections, unchanged evidence provenance/policy, and `message-ready` before approval.
Include changed-input/anchor cases and reject stale or unavailable recovery material.
Do not create a source-repository commit to demonstrate this path.

### SLICE-003: Make the skill guide callers onto those paths

Update the mode-choice paragraph in canonical `SKILL.md`, message-format guidance, recovery/diagnostics references, and CLI help together.
Place the count/byte restrictions beside the explicit detailed flag, distinguish a meaningful body from detailed per-file presentation, and give one complete larger-scope example plus one accidental-detailed recovery example.
Document the projection's lower-bound meaning, final-message byte enforcement, caller-owned section intent, and the newly supported alternative that supersedes the current unsupported-transition wording.
The examples must cover mixed evidence or task-lineage reuse, the already-extended branch, requested sections, and finalization without unsupported flags.

Extend the existing portable evaluation cases/fixtures for the 64-unit mistake and its recovery, plus appropriate near-miss cases that preserve concise authoring.
Keep cases/fixtures in `src/committing-to-git/evals/`, protocol/assurance bindings in `evals/extensions/v1/suite.json`, and executable policy in `evals/assurance/v1/`.
Use the current compiler/runtime contract; the suite README contains older schema descriptions and is not authority to move metadata back into portable cases.
Preserve existing case IDs and historical evidence; allocate new IDs only after inspecting the current case registry.
Any executable suite-policy/configuration changes require exact approval before editing.

Demonstrate that the documented commands execute against the generated package and that unchanged trigger boundaries remain intact.
Model-based evaluation is separately gated as described below.

### SLICE-004: Qualify and deliver the exact candidate

Build deployable skill/plugin outputs from canonical source and freeze the candidate identity.
Run focused affected regressions, the independent verifier, the triggered native security workflow, and the final full repository gate.
Retain qualified current package identities and evidence for Windows and Linux qualification; inspect actual results before claiming portability.
Prepare release/adoption notes describing new diagnostic fields, any exit-code change, legacy diagnostic absence, and the current-contract consumer requirements.
Publish/install only under separate authority, then inspect the selected artifact and run the authorized public smoke scenario before claiming live adoption.

| Slice | Traceability | Falsifiable proof | Release/cleanup implication |
| --- | --- | --- | --- |
| `SLICE-001` | `REQ-001/002/005`; `AC-001/002/006`; `QA-001/002/003/005/006/008`; `DEC-001/002/005` | Packaged rejection, fresh-process recovery/detail, independent effect checks, Ajv/runtime parity, malformed-record and persistence tests | Retain new records plus qualified current reader; no historical backfill. |
| `SLICE-002` | `REQ-003/005`; `AC-003/004/006`; `QA-002/004/007/008`; `DEC-003/004` | Public-only 64-unit paths reach message-ready with complete coverage and requested sections | No automatic retry/commit; correction artifacts remain until consumers release them. |
| `SLICE-003` | `REQ-004/006`; `AC-005/007`; `QA-001/007`; `DEC-001/004/005` | Executed documentation examples, help contracts, approved behavioral/trigger evaluation | Guidance ships with matching helper; unexecuted model arms remain explicit. |
| `SLICE-004` | `REQ-006`; `AC-007`; `QA-001` through `QA-008`; `DEC-005` | Exact-candidate verify/reviews, platform evidence, separately authorized packaged smoke | Source, hosted qualification, publication, installation, and activation reported separately. |

Order: SLICE-001 establishes the durable/public contract; SLICE-002 depends on it; SLICE-003 finalizes guidance against those outputs; SLICE-004 integrates the frozen result.
Independent documentation/example review and test-oracle design can proceed after the contracts are fixed.
Do not assign parallel writes to the transaction schema, authoring state contract, and their dependent guidance while meaning remains unresolved.
No subagent delegation is required or authorized merely by this plan.

## Verification and oracle ownership

Use existing tests rather than a second assurance harness.
Likely focused files are `change-selection.test.mjs`, `reviewed-preparation.test.mjs`, `diagnostic-contract.test.mjs`, `transaction-workspace.test.mjs`, `artifact-schemas.test.mjs`, `public-recovery.test.mjs`, `help-contract.test.mjs`, `semantic-content-contract.test.mjs`, and `workflow-e2e.test.mjs` under `tests/committing-to-git/`.
Add index-installation, transaction-recovery, message-renderer, and large-change-unit regressions when the actual diff affects their contracts.

The independent oracle specifies expected counts, exact threshold operators, permitted states, scope membership, requested section meanings, and before/after repository facts.
Do not derive expected answers by calling the production presentation or recovery function under test.
The public recovery driver may set up and independently inspect its disposable repository, but must consume only the copied package, help/reference files, public outputs, and advertised worksheets to complete recovery.
It must not import source modules or open private transaction artifacts to discover the next action.
Use real local Git and the actual generated helper for that lane; inject faults at filesystem/checkpoint boundaries in focused tests, and mock only genuine external boundaries such as unavailable remote providers.
No live remote or model is needed for deterministic recovery proof.

The minimum matrix includes:

- Strict native JSON Schema compilation/validation with full reference resolution, untouched older records, new valid/invalid optional records, and meaningful mutations independently rejected by the schema/runtime boundaries. Do not derive all expected results from production decisions or weaken the schema to match the old subset checker.
- Count boundaries 49/50/64, with exact-limit and above-limit UTF-8 projections below 50; include an independently constructed projection that distinguishes bytes from characters, and a projection-fit/final-render-overflow case with reachable correction.
- Actual staged incident shape with preserved index and task-lineage note, actual full/path rejection before index installation, and draft isolation.
- Uniform and mixed evidence, allowed-type restrictions, nondefault verification policy, selectors/exclusions, and a rename counted as one unit.
- Recognized detailed and snapshot-capacity failures; unknown and forged errors; normalized request/digest mismatches; missing/corrupt/replaced correction inputs; optional-record validation and checkpoint failures, including post-replacement failure.
- Fresh-process recover/detail, invalid resume, JSON/text and summary/full projections, compaction followed by inspection and correction, and explicit nonterminal cleanup/purge outcomes under their separate authority.
- Concise semantic extension, evidence-driven extended review, already-complete extended authoring, route-aware checked-text error recovery, edited worksheet preservation, and no early finalize or redundant extension.
- Exact unit coverage and requested sections through message-ready; evidence and signature policy retained; no commit/publication side effect.

Use a short-path, uniform task-lineage-reuse 64-unit fixture for the concise route and a separate 64-unit fixture with a genuine review-policy group whose required evidence exceeds the concise budget for the extended route.
Assert concise/evidence-ready before semantic extension in the first case and extended with `required-evidence-over-budget` before review traversal in the second; do not run one route twice and count it as branch coverage.
If a platform-valid synopsis-over-budget fixture is used instead, assert `scope-synopsis-over-budget` explicitly and keep that fixture distinct from the literal incident reproduction.
Fixture evidence policies differ intentionally to exercise routing; the corrected attempt must preserve each fixture's own original evidence policy and provenance.

For exact byte boundaries, use independent synthetic manifests in focused tests and a genuine supported-path fixture in the packaged lane.
Do not bypass filesystem/path admission or silently claim cross-platform coverage if a long-path fixture is unsupported on a platform.
Retain that limitation and provide equivalent platform-valid evidence before accepting the portability claim.

Future command examples, selected for the affected slice rather than blindly rerun as a sequence:

```text
npm run build
node --test tests/committing-to-git/change-selection.test.mjs tests/committing-to-git/reviewed-preparation.test.mjs tests/committing-to-git/artifact-schemas.test.mjs tests/committing-to-git/diagnostic-contract.test.mjs tests/committing-to-git/public-recovery.test.mjs tests/committing-to-git/help-contract.test.mjs
npm run verify:skill -- --skill committing-to-git
npm run verify
```

Run format/lint prerequisites before review; `npm run build:check` or an unchanged passing `npm run verify` supplies those prerequisites.
Build enforces ASCII-only canonical/generated `SKILL.md` files and source/output correspondence.
Install the locked Markdown toolchain with the established command only if needed and authorized; format maintained canonical guidance through the repository policy and rebuild afterward.
Do not format historical evidence or portable fixtures.
`docs/plans/**` is excluded by the current Markdown policy; a repository Markdown pass is not evidence that this plan was checked, and the policy need not change for this document.

Reserve the full gate for the final candidate; reuse valid unchanged evidence proportionately and refresh affected evidence after review fixes.
Read-only dev.29 profile inspection on 2026-10-21 found `focused` running `npm run test` with a 600-second timeout, and `affected`/`full` each running `npm run verify` with a 1,200-second timeout.
The inspection reported `risk-route-not-selected`, unknown declared coverage/order, and an unprobed environment; it did not establish an accepted issue-20 route, a passing receipt, or input-complete evidence reuse.
Use these observations as configuration facts to refresh at implementation, not proof that identical command strings establish profile subsumption or repository-gate mappings.
Do not change profile configuration merely to make this plan appear covered; exact approval is required for any necessary mapping change.
A qualifying native full run of the current `npm run verify` satisfies the repository gate without a second bookkeeping run.
At completion, reconcile intent, review, resources, and completion assessments for the actual execution generation, then use `complete-change-execution --inputs-settled` to select admissible evidence reuse or missing verification and complete the required handoff.
An explicit `verify-and-hand-off` requests a fresh run; do not invoke it merely to relabel already sufficient evidence.
The existing Linux committing-to-git workflow is `workflow_dispatch` only, so a push does not automatically run it.
Obtain authority for a selected hosted run or use an already authorized equivalent Linux environment; do not silently edit CI or describe local Windows success as Linux qualification.

For skill behavior, read `docs/evaluation-runtime.md` and the current suite contract before preparing any evaluation.
Use the existing prepare/authorize/run boundary with a frozen skill bundle and exact packet authorization for every external model call.
Target the mistaken-detailed recovery, concise/extended branch choice, requested-section preservation, and refusal to bypass the helper; include bounded trigger/near-miss checks if instruction edits can affect activation.
Run compatible supported host/provider arms as authorized, record unsupported/unexecuted arms, and keep fake-provider transport checks separate from semantic results and live host activation.
The plan and deterministic build authorize no model call.

## Compatibility, rollout, observability, and recovery

No database migration or backfill is proposed.
Existing stopped attempts remain readable and honestly report that an original preparation diagnostic is unavailable when it was never stored.
Do not infer a lost exception from file count and relabel that inference as a retained fact.
New records and authoring alternatives must be documented as a candidate contract; schema/runtime parity tests and current-reader/historical-record plus obsolete-consumer refusal fixtures establish the exact compatibility limits.

Keep source changes in `src/committing-to-git/`, regenerate `skills/committing-to-git/` and corresponding plugin payloads, and compare all generated differences semantically.
Build outputs are not installed artifacts and installation is not current-chat activation.
Any package-version/catalog/configuration update must receive exact approval before it is made.

The release observer is the assigned implementation owner, with the maintainer accepting the result.
Record the candidate source/tree and helper digest, case identity, requested/selected mode, unit count, projected bytes, diagnostic code, effect state, public next action, and finalization outcome in existing evidence artifacts.
Use bounded local evidence; this fix requires no new telemetry service or transmission of repository contents.
Useful acceptance questions are whether one public inspection reveals the cause, whether the emitted next operation is executable for that package, whether every requested section survives, and whether unchanged authority/evidence remains correctly bound.

Abort release on any scope/evidence loss, invalid authoring transition, missing retained diagnostic, misleading effect state, sensitive disclosure, failed candidate check, or unresolved compatibility gap.
Stop automatic or suggested retries when effects or freshness are uncertain.
Before activation, abort if any required current consumer is unqualified; after activation, restrict the affected operation and prefer a bounded forward fix while preserving original records.
A separately authorized rollback is eligible only if its artifact is independently qualified against the still-supported current contract; a superseded helper is not an automatic recovery option.
Do not claim that old binaries can resume new-format attempts, delete records to enable rollback, introduce a compatibility bridge, or restore a real index merely to retry message presentation.

Retain the incident captures unchanged.
For implementation-time test/review/evaluation material, inspect the current environment and use `allocate-resource-group` before accumulation, with an admitted purpose, finite byte budget, typed obligation and concrete supporting subject reference.
Use explicit independent working-material placement when a disposable repository is needed, and the admitted external evidence destination for retained proof.
Record the original coordinator, current owner, next actor, event/checkpoint, consumer lifetime, removal condition, and bounded reassessment; preserve the same group identity through updates.
Reconcile original coordinators and current consumers through `inspect-resource-inventory` before completion, retaining only required compact evidence and leaving unresolved preservation obligations explicit.
An empty registry or an operator assertion is not proof that resources are clear; an intentionally empty inventory must state its inspected boundary.
This requested maintained plan is a repository document, not scratch output. The present reassessment creates no execution or resource group, and does not adopt or alter the historical review's resource ownership.
Ordinary helper compaction must preserve the bounded failure record and dedicated correction files; unavailable or invalid files withdraw their runnable advice without recreation during stopped-attempt inspection.
Purge and fixture disposal follow their existing ownership, quiescence, preservation, and authorization controls.
Do not broaden this repair into cleanup of unrelated attempts or pending HISEW continuations.

## Unknowns, cheapest experiments, and replanning

| Question | Cheapest discriminating evidence | Owner and consequence |
| --- | --- | --- |
| Can current native input formats carry the complete correction with adequate freshness checks? | One disposable staged fixture and one selector/mixed-evidence fixture; execute only advertised correction inputs and introduce deliberate drift | Implementation owner; if a material precondition cannot be enforced, replan the minimal native seam instead of publishing unsafe advice. |
| Is the additive structured-authoring alternative unambiguous to real callers? | Public-only already-extended test followed by an exactly authorized targeted behavioral case | Maintainer accepts the public contract; ambiguous behavior blocks guidance finalization. |
| Is optional schema-4 diagnostic storage the smallest safe compatibility change? | Runtime/schema parity and updated-reader/older-record plus older-reader/new-record tests | Record owner; document older-reader refusal or explicitly revise the versioning decision. |
| Can stop persistence and correction inputs fail independently without misleading state? | Fault injection at dedicated-file creation, failure-record validation, atomic replacement, and directory flush, followed by public recover/resume/cleanup inspection | Implementation owner and reviewer; preserve stop fallback, truthful readback, and non-executable orphan handling before expanding scope. |
| Are platform-valid byte-boundary and public-package fixtures available on both systems? | Inspect/test the minimal path fixture under the supported Windows and Linux environments | Verification owner; retain gaps rather than weakening the oracle. |
| Which current profile/provider evidence is reusable? | Inspect exact mappings, candidate identities, relevant receipts, and supported host capabilities at implementation time | Integration owner; do not infer applicability from a historical pass or discovery alone. |
| Does native schema validation reveal assumptions masked by the subset checker? | Compile the full draft-2020-12 schemas with existing Ajv2020 and exercise valid/invalid records without coercion | Verification owner; fix the smallest real contract defect, obtain exact approval if configuration is implicated, and keep unrelated validator migration out of scope. |
| Can the required native security assessment cover the changed boundaries? | Resolve current host capability, authority, frozen target, and supported scan scope before review | Maintainer/security reviewer; missing coverage remains a release prerequisite, not a clean result or permission to substitute an unapproved workflow. |

Replan if requirements change, baseline code materially advances, another consumer depends on the old diagnostic exit/code, strict-record compatibility requires migration, the public alternative needs a new transition, recovered scope/evidence cannot be preserved, or a new dependency/configuration/permission is necessary.
Also reassess the higher outcome if the proposed repair adds repeated approvals or inspection loops without reducing caller uncertainty.
Do not trade away truthful state, complete scope, or exact-message approval to improve call counts.

## Original planning and revision-2 completion record

This document is a source-grounded draft and does not establish product correctness or release readiness.
Planning used the issue, current source/tests/guidance, repository policy, current local/remote identities, read-only HISEW inspection, and the originating chat.
No product tests, helper preparation retries, evaluations, builds, commits, configuration changes, publication, or execution-ownership mutations were performed to create the plan.
Plan verification is limited to the document and its references; implementation, behavioral, portability, hosted, installed, and live-activation evidence remain future obligations.
Revision-2 document-only validation confirmed all 11 then-present relative link targets exist, the REQ/AC/QA/DEC/SLICE identifier inventory is consistent, and the file has no trailing whitespace, contains ASCII bytes, and ends with LF.
That working-tree review identified only this new plan; no repository Markdown-gate coverage is claimed for the excluded plans directory.

## Independent Claude review and revision record

The user separately authorized Claude to review the plan with a 30-minute allowance and requested action on valid findings.
Claude Opus 5.5 at the saved medium effort reviewed frozen revision-1 inputs using Read/Grep/Glob only, completing successfully in 413 seconds and 50 turns with no permission denials or timeout.
The reviewed plan SHA-256 was `19beabc21b08732a041ef7d9e0e316169193287da24219bf3eae2c5ca4b1097b`; the 150-file frozen input manifest remained unchanged.
The shared `lib/filesystem/stableFile.js` dependency was supplied as a separately hashed supplemental input during the review.
The full report, inputs, native output, process outcome, and document checks are retained under external evidence locator `operator/issue-20-plan-review-20261019-2f3b9f74`.

Claude found no high-severity issue, five medium findings, and three low findings, one of which was a test-feasibility question.
Each was checked against maintained source before the following amendments:

| Finding | Disposition and revision-2 amendment |
| --- | --- |
| F-01, medium: unspecified correction-file creation/lifetime | Accepted. DEC-003 creates dedicated inputs during rejected preparation, binds verified files, retains them through compaction, and keeps stopped-attempt inspection free of regeneration. Other recovery domains retain their existing effects. |
| F-02, medium: weak validation of retained request facts | Accepted. Reuse the actual input normalizers and pre-routing digest rules before emitting advice; validate staged/full separately from path selectors and withhold commands on invalid bindings. Digest consistency is not authenticity or approval. |
| F-03, medium: misleading checkpoint/resume handling | Accepted with tighter admission. DEC-002 pre-validates optional records, permits a stop without them, reads state after checkpoint failure, keeps diagnostic snapshot observations separate, and specifies allocated/no-snapshot outcomes. Resume needs its complete native prerequisites, and purge is never a prerequisite for fresh work. |
| F-04, medium: conflicting remedies and missing public consumers | Accepted. DEC-004 explicitly changes the unsupported-transition contract, includes check/create diagnostic consumers, and supplies route-aware alternatives without dropping sections. |
| F-05, medium: projected versus rendered byte limits | Accepted. Define the lower-bound projection and add final-render overflow coverage. Correct prose within the fixed detailed mode while preserving required meaning; if that cannot fit, report the unmet requirement and replan rather than promise an unavailable bulk switch. |
| F-06, low: section intent was never a preparation input | Accepted as an acceptance-ownership clarification. The caller carries requested sections into supported semantic fields, and the independent public driver proves their survival. |
| F-07, low: both routes may not arise from one incident fixture | Accepted as a proof-design clarification, not an observed runtime failure. Use separate 64-unit fixtures with asserted route/reason preconditions and preserve each one's evidence policy. |
| F-08, low: repeated count threshold | Accepted. DEC-001 makes the existing selection layer own the shared change-unit threshold for rendering, validation, and diagnostics, with independent test expectations. |

This was a standalone static document review, not a canonical HISEW execution/release receipt or a product evaluation.
Claude's report notes limited depth on the HISEW planning skill and evaluation runtime; this review does not replace their future implementation and evaluation gates.
Revision 2 was checked against source and validated as a document; it did not receive a second Claude review.
No product tests, helper attempts, builds, source/configuration changes, commits, publication, or execution-ownership mutations were performed for this review and revision.

## Dev.29 reassessment record

On 2026-10-21 the user requested verification against the newer engine's stricter requirements.
The input was revision 2, SHA-256 `34a0ba70dcbc2efffc68bf7a1acc3a89b961be62a7a56c58cf1763731757a7a3`.
This assessment compares that document directly with dev.29, rather than claiming an exhaustive historical dev.27-to-dev.29 policy diff.

| Observed authority | Exact identity |
| --- | --- |
| Installed plugin | `hisew-dev/0.1.0-dev.29` |
| Selected native engine | `0.1.0.dev29-a69680c5-00`; installed package version `0.1.0.dev29` |
| Matching plugin/engine release | `a69680c5fa7d47f2ffb7a56d75747d7696e102ac61d3998a1481f66e5fb176fb` |
| Plugin `method/engineering-principles.md` | SHA-256 `777ad41e148d5b4378a7b5960fecfcc3ea1471e046cec5a697fda2b59712f261` |
| Plugin `skills/hadden-industries-plan-software-change/SKILL.md` | SHA-256 `3b3b770b060acdbce7725fea2a660b34cf575f0a80e08244e8fb66e5145a2d35` |

Read-only applicability inspection confirmed the personal workflow is active for this checkout.
The installed invocation, risk-route, execution-evidence, workflow-progression, verification-obligation, resource-retention, and security-control guidance informed the revised gates; installed workflow policy and assessment implementation were inspected for what the engine actually enforces.
The selected release and installation checks do not establish current-chat hook activation or release acceptance.

Revision 2 was not fully aligned: its naming coverage was narrower than NAM-01, DOC-01 and the triggered native security assessment were not explicit, the affected schema tests depended on a subset interpreter, rollback could reactivate an obsolete consumer, and resource/completion gates lacked dev.29's concrete obligations.
Revision 3 corrects those gaps in the design, slices, acceptance criteria, verification, and release/resource instructions, and adds the complete principle contract above.
The 17 required planning categories are represented: baseline/scope and traced slices; seams/dependencies/ownership; independent proof and mocking boundaries; compatibility/security/observability/release; unknowns/experiments/replanning/outcome; and names/reuse/validators/override/security ownership.

Assessment result: aligned as a draft implementation plan, with acceptance and implementation evidence still outstanding.
It is not an accepted R2 baseline, an engine-attested principle pass, a native security result, or a claim that the proposed implementation works.
No additional Claude review was run for revision 3; the earlier review remains bound to its original inputs and findings.
Document-only validation confirmed 13 existing relative link targets, six REQ/seven AC/eight QA/five DEC/four SLICE identifiers, all 13 principle rows, consistent table columns and code fences, ASCII text with LF endings, and no trailing whitespace.
The reassessment changed only this plan and ran document-only checks; it did not run product tests, helper retries, builds, evaluations or scans, or change configuration, commits, publication, execution ownership, or historical review evidence.
