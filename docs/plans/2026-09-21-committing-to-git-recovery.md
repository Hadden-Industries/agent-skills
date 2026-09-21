# Committing-to-git shared diagnostic contract implementation plan

Status: draft for design review and grilling; not approved for implementation.

Origin: [agent-skills issue #3](https://github.com/Hadden-Industries/agent-skills/issues/3).
The user accepted REQ-001 through REQ-004, AC-001 through AC-004, guardrails, and
R2 in this conversation on 2026-09-21, then explicitly expanded the planning scope
to a shared contract for all committing-to-git diagnostics. REQ-005/006 and their
acceptance criteria below operationalize that expansion. This revised draft
supersedes the earlier four-journey-only migration boundary. It remains a plan,
not authorization to implement or publish.

Latest accepted constraint: the user is the only consumer and explicitly requires
no backward compatibility and no shims. Adopt a direct, coordinated cutover of the
helper, public references, and controlled consumers. This supersedes earlier
compatibility-preservation proposals. The user also accepted the broader AIP-based
contract recommendations recorded below.

## Purpose and boundary

Enable agents to understand failures and recover consistently throughout the
committing-to-git workflow, including the four reported journeys, using the shipped
skill's output, help, generated authoring artifacts, and public references, while
preserving truthful evidence and explicit commit authorization. Fewer errors is
not success if the agent bypasses a check, invents provenance, or changes the
requested message to escape a validation failure.

Scope includes a common public diagnostic contract, shared construction and
rendering, migration of every public command boundary and diagnostic producer,
documentation, and package regressions. Include dispatch/preflight failures,
expected rejections, partial-success and uncertain-outcome results, and unexpected
exceptions. Issue #3 cases 1-4 remain mandatory end-to-end recovery regressions;
case 5 and closed issue #2 supply additional behavioral regression context. Exclude new
publication behavior, transaction migration, new dependencies, and changes to
authorization or signing policy. Existing adequate recovery semantics should be
preserved when their representation is migrated.

Agent behavioral trials in this plan cover only committing-to-git, not every
authored skill in agent-skills. Repository-wide deterministic `npm run verify`
remains required and may check other skills; it is not a repository-wide agent
evaluation campaign. This release-evidence decision is specific to issue #3.

This document is the planning handoff, not a new repository policy. No build,
package, lockfile, test-runner, CI, environment, or repository-policy configuration
change is proposed. Any necessary exact configuration change requires separate
approval under AGENTS.md. Implementation, commits, pushing, issue updates, and
release are not authorized by this plan.

## Evidence and current-state limits

Inspected repository HEAD: `a913dd632146ddc77f66b9fa36a95e6ebc4e3193`, the issue #2
fix. The working tree also contains pre-existing tracked and untracked changes.
Preserve them; record the actual source and package hashes at implementation time.
HEAD alone does not identify the dirty worktree's full contents.

Read-only HISEW inspection found this worktree active with personal applicability.
Its retained execution concerns completed issue #2, with a brief-only R0 route;
that execution is not issue #3's accepted R2 baseline or verification evidence.
Recheck applicability and inspect the accepted task before future engine mutations.

Observed source facts, not reproduced package outcomes:

- `workflow/createCommitWorkflow.js` returns failed receipt IDs and an approval
  action for `FAILED_CHECK_ACKNOWLEDGEMENT_REQUIRED`. The public check reference
  already documents `--acknowledge-failed-check`.
- `workflow/prepareWorkflow.js` accepts `--evidence-plan`, including
  `groups[].basis.note`; its inline basis path supplies a null note and has no
  `--note` flag. `inspection/reviewCatalog.js` requires nonempty task-lineage notes
  for reused evidence. The public journey still needs end-to-end reproduction.
- `MESSAGE_REQUIRES_CHECKED_FILE` names `message-input.txt` without returning the
  resolved path or next command at that failure site.
- `message/semanticContentContract.js`, `workflow/authoringProgress.js`, and
  `references/message-format.md` already expose structured content shape, selector
  fields, helper-owned fields, and checked versus structured routes.
- Existing CLI tests mix source-level assertions with execution of
  `skills/committing-to-git/scripts/commitWorkflow.mjs`. Passing those tests alone
  would not establish a source-free recovery journey from a delivered artifact.

- The CLI registers 15 routes. Message check/finalize failures intentionally emit
  JSON even when text was requested; verify/recover/cleanup have sparse error
  envelopes. Under the accepted direct cutover these representations may change.
  Commit/publication outcome distinctions and nested warnings must remain truthful
  through shared construction, irrespective of their new field or code names.

The two read-only CLI probes recorded under DEC-008/010 ran during planning.
No test suite, behavioral trial, scan, or release check ran. The original four
recovery journeys and historical installed versions remain unverified.

## Accepted requirements and proposed proof

| ID | Requirement | Acceptance criterion |
| --- | --- | --- |
| REQ-001 | Recover from failed-check acknowledgement using public guidance. | AC-001: A package test identifies affected receipts and the valid route while preserving explicit authorization. |
| REQ-002 | Make task-lineage evidence submission discoverable and valid. | AC-002: Package tests cover absent and supplied evidence and truthful use of `read-current-task`. |
| REQ-003 | Explain the valid message operation for the actual transaction state. | AC-003: Recovery uses the returned fixed path and a command accepted by that package version. |
| REQ-004 | Support structured authoring without implementation inspection. | AC-004: Public artifacts support successful authoring; invalid inputs identify expected shapes at failing pointers. |
| REQ-005 | Use one shared public diagnostic contract across all committing-to-git commands. | AC-005: A complete producer inventory maps every public diagnostic to the shared contract, its domain owner, and test evidence; no command retains a separate public error envelope or renderer. |
| REQ-006 | Preserve state truth and authorization through a direct contract cutover. | AC-006: Package tests cover dispatch and all 15 command routes, JSON/text equivalence, the new code/exit contract, malformed inputs, and failures before/after mutation; unknown outcomes never become assertions of absence or automatic retries. Controlled consumers use only the new contract; no legacy adapters, aliases, or dual-format support remain. |
| REQ-007 | Parse helper arguments once and use one authoritative transaction admission path. | AC-007: Child arguments after `--` remain opaque; duplicate/invalid helper options fail before transaction access; dispatch cannot interpret child paths or bypass transaction validation. |
| REQ-008 | Keep command syntax and help synchronized by construction. | AC-008: Shared command-option definitions supply parsing and help; package tests verify real accepted/rejected inputs and child argument boundaries rather than comparing manually duplicated option lists. |
| REQ-009 | Identify the actual installed artifact without a repository or transaction. | AC-009: A read-only `--version` operation reports authoritative packaged implementation identity and diagnostic-contract version; it works outside a Git checkout and produces no transaction or repository effects. |
| REQ-010 | Give shared semantic rules one authoritative owner. | AC-010: Evidence policies, provenance kinds, selector vocabulary, and note limits are defined once for their consumers; diagnostics reuse authoritative authoring state and command definitions. Superseded duplicate definitions and implementations are removed without shims. |
| REQ-011 | Reject every unmatched explicit selector value consistently. | AC-011: Review and message selection use shared matching semantics; mixed matching/unmatched inputs reject and identify each failing value through bounded diagnostics. All-valid selections preserve intended membership and domain-owned coverage checks; matching does not silently change canonical ordering. |

Proposed quality scenarios:

- QA-001, recoverability: for each covered recoverable failure in an isolated
  installed package, a consumer follows public output/help/references to the next
  valid state without reading the bundle or maintained source. Every diagnostic
  command is exercised against the exact package that produced it.
- QA-002, integrity: absent approval, invalid acknowledgement, unknown check
  outcome, or untruthful evidence never becomes a successful commit. Compare HEAD,
  index, receipt identities, and canonical message at relevant boundaries; permit
  only the documented transaction bookkeeping for that operation.
- QA-003, portability: recovery paths and command arguments survive spaces,
  non-ASCII paths, and shell metacharacters in isolated Windows and POSIX fixtures.
  Structured arguments remain data; diagnostic text is never blindly evaluated.
- QA-004, behavioral usability (host sufficiency accepted by the user): require
  one successful fresh executable trial per covered journey on any one supported
  host, using a frozen package and recorded host/model versions. Codex has no
  preferred release status; Claude Code or Antigravity evidence is equally valid
  when it demonstrates actual recovery. Trials must reach the expected safe outcome
  without implementation inspection or undocumented coaching. Aim for optional
  cross-host smoke coverage, but missing additional-host results do not block
  release or require another waiver. Record untested coverage honestly. Retain and
  triage observed failures; optional coverage does not make a discovered defect
  irrelevant. This finite sample supports observed journeys, not a statistical
  reliability claim or proof that every host was tested.
- QA-005, whole-workflow consistency: inventory every public diagnostic producer,
  including returned non-success states that do not throw. All producers use the
  shared construction/validation/rendering boundary. Exercise every stable code
  or dynamic code family at its appropriate test boundary; execute representative
  failures for every public command and every distinct recovery disposition through
  the installed package. Record any unexercised producer as an assurance gap.
  Extend single-host agent trials beyond the original four journeys to cover
  recovery dispositions not represented there, especially uncertain mutations and
  terminal failures. Other-host trials remain optional and non-blocking.

Invariants: exact authorization remains a user decision; scope and approved bytes
remain bound to the transaction; provenance must describe evidence actually held;
unknown outcomes retain recovery requirements; helper-owned fields remain owned
by the helper; diagnostics do not leak source content or authorization material.

## Risk route and ownership

Risk class: R2, accepted in this conversation.

Decision owner: the user/repository maintainer for baseline, design, residual
evidence gaps, and release. The eventual implementing agent owns integration and
evidence collection; an independent verifier owns challenge of the test oracles.

Reasoning: this changes public machine-readable recovery guidance around a Git
mutation workflow. A wrong command can misroute authoring or imply authorization.
The changed surface is bounded but its consumer contract is consequential.

Potential blast radius: consumers of the packaged committing-to-git skill, across
hosts; existing transactions if recovery advice is inconsistent with their state.

Reversibility: guidance-only changes can be replaced in a subsequent artifact;
rolling back a package cannot undo a commit or guarantee old code can consume a
new transaction. No automatic rollback of repository or transaction data.

Principal unknowns: which historical gaps reproduce now; whether existing output
already suffices in agent trials; whether generic evidence exceptions lose needed
context; supported diagnostic bounds; host evaluation availability.

Required artifacts: this accepted-baseline/draft-plan record, case disposition
matrix, exact package identities, regression and trial evidence, independent review
findings and dispositions, and release/recovery decision. Keep them together where
practical; do not create a separate document for every identifier.

Required specialist lenses: agent-mediated usability and public contract review;
scoped security assessment if implementation changes authorization-adjacent command
construction, input parsing, or filesystem boundaries, as HISEW SEC-01 requires.
Use the designated native provider when applicable and authorized. Planning does
not authorize a scan or delegation. Unavailable required assurance blocks release
unless the accountable owner accepts a documented alternative.

Required verification: focused package journeys per slice, impacted regressions,
`npm run verify`, independent R2 verification, and agreed behavioral/host coverage.
Select actual engine profile names from active configuration at execution time;
do not reuse issue #2's `focused` selection as issue #3's final assurance route.

Required human approvals: design and behavioral coverage after grilling;
implementation authority; any exact configuration change; external evaluation
transmission/consumption where the runner requires it; separate Git and release
effects. Reuse authorization already supplied for the exact effect.

Maximum sensible autonomy: inspect and draft now; implement and run appropriate
local verification only once authorized. Never supply missing user authorization
or fabricate an evidence note to make a test or real transaction progress.

Next lifecycle step: grill the proposed decisions, incorporate answers, and obtain
confirmation of shared understanding before execution.

## Proposed design decisions

DEC-001 (expanded by the user's all-workflow decision): provide one shared public
diagnostic contract for all committing-to-git command boundaries. Define clear,
stable identities and fields for the new contract without preserving legacy names
or shapes for compatibility. Reuse existing names when they remain the best fit. Return
the next action, required inputs, and a valid command description or fixed path
where the current state supports one. Classify human-decision and terminal cases
explicitly; never manufacture a runnable mutation for them. Final field placement
must follow the existing error envelope and bounded-output conventions.

The shared component owns representation, validation, bounded serialization, and
human-readable rendering. Domain operations own state facts and permitted recovery.
It does not infer retries from error codes, reread untrusted transaction paths, or
perform recovery. Local internal exceptions can remain where useful; they must be
translated into the one public contract. No per-command shadow public formats.

The selected option is complete migration, rather than four isolated patches or
an indefinitely mixed old/new public contract. Shared contract principles are
consistent with RFC 9457's machine-readable problem details, but this is a CLI:
do not introduce HTTP status codes, media types, or an HTTP dependency.
Reference: https://www.rfc-editor.org/rfc/rfc9457.html.

Proposed contract semantics (exact naming follows NAM-01 and the accepted purpose):

- Stable code and safe human explanation; diagnostic severity distinguishes a
  warning after success from a failed operation.
- Actual operation state remains authoritative. Define exit codes that distinguish
  relevant outcomes without retaining old numbers solely for compatibility. Represent
  unknown state explicitly; never default an unobserved commit to absent or an
  unobserved publication to not-requested.
- Recovery disposition distinguishes correcting input, completing review/authoring,
  requesting a human decision, inspecting/recovering uncertain state, and stopping.
- Required inputs, valid fixed paths, relevant receipt IDs, and commands encoded
  as executable/argument data where appropriate. A human decision has no fabricated
  approval value. Unsafe or unsupported continuations have no runnable command.
- Structured problem details retain validation pointers, expected shapes, bounded
  samples, truncation/count metadata, and existing recovery evidence references.
- JSON and text are projections of the same validated result. Keep stdout/stderr
  responsibilities and exit codes consistent, with safe redaction and size bounds.

DEC-006 (accepted by the user): one structured diagnostic is the authoritative
validation result. JSON remains the default machine-readable output; explicit
`--format text` renders the same result for humans, including message check/finalize
failures. Both projections preserve the same codes, explanations, validation
details, and recovery meaning; there is one validation implementation. This
intentionally replaces the current JSON-on-error exception for those commands.
Update controlled consumers and documentation to the new contract, and test both
formats. No old JSON-on-error exception or adapter remains. This design acceptance
does not authorize implementation beyond the planning request.

DEC-007 (accepted by the user): direct cutover, no backward compatibility. Do not
add shims, aliases, fallback readers, parallel old/new renderers, compatibility
flags, or dual-version modes to preserve the old public diagnostic contract.
Update every controlled caller and fixture together; remove superseded public
builders and expectations. Do not introduce a deprecation period or old-consumer
test matrix. Schema/version identifiers describe the delivered artifact accurately;
they do not require supporting multiple versions. This scope changes diagnostics,
not the persisted transaction model: retain existing state machinery unless a
demonstrated requirement calls for separate re-planning. Retain historical evidence
as history without requiring the new runtime to consume it.

Additional accepted applications of AIP-193/180/194:

- Document the complete new CLI contract: input/output shapes, absent/null/unknown
  meanings, defaults, limits, streams, exit outcomes, and operation transitions.
  AIP-180 explicitly allows tailoring compatibility to controlled consumers; no
  backward-compatibility obligation is adopted for this cutover.
- Use stable identities within the committing-to-git error domain and consistent
  names for transaction references, receipt IDs, locations, and unmet prerequisites.
  Never require parsing prose or reuse one identity for distinct recovery meanings.
- Link complex diagnostics to the relevant installed-package reference section,
  alongside the immediate explanation and action. Qualify these references in the
  assembled artifact; do not rely on floating remote documentation for recovery.
- Use shared structured detail categories for invalid input, unmet prerequisites,
  limits, and internal failure, drawing on Google's standard error-detail concepts
  without adding Protobuf or gRPC. Reuse existing valid semantic validation facts.
- Specify recovery/retry eligibility per operation and observed state. Recoverable
  is not synonymous with repeatable; existing journal and authorization rules own
  safe continuation. No automatic retries are introduced by this migration.

Sources: https://google.aip.dev/193, https://google.aip.dev/180,
https://google.aip.dev/194, and
https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto.

Never merge arbitrary detail objects over reserved identity, state, authorization,
or recovery fields. Unknown exceptions map to a bounded internal-failure diagnostic
with state supplied only by the owning operation. Diagnostic rendering must not
mask a completed or potentially completed mutation. Do not add automatic retry,
cleanup, broad file inspection, or stack/secret disclosure in the shared layer.
Provide a bounded fallback for non-Error throws, malformed/cyclic details, or
failure during normalization/rendering, preserving known/unknown mutation state.
Do not expose raw arbitrary exceptions as trusted user-facing recovery advice.

DEC-002: use the supported `--evidence-plan` route for a task-lineage note. Expose
its complete minimal valid shape and show that it replaces inline evidence/basis
flags. Do not add `--note` by default. `read-current-task` is appropriate only when
the relevant evidence was actually read in the current task; it is not fallback
provenance. Adding an inline note flag is an alternative if public-only trials
show the existing route is materially inadequate; that finding requires revisiting
this decision rather than implementing both paths preemptively.

Reuse means retaining the authored JSON input or template, not transplanting a
canonical transaction plan or review receipt. Current input limits are 8 MiB,
4,096 groups, and 512 UTF-8 bytes per basis note. Each preparation revalidates the
input against its current manifest. Selectors and evidence claims must still be
appropriate and truthful; current-task provenance does not automatically carry
into a new task. JSON suits the existing structured consumer and avoids placing
large nested input into shell arguments; it does not make old evidence current.

DEC-003: resolve message guidance from validated transaction state and existing
authoring semantics. Checked text uses the returned `messagePath` and `message
check`; structured content uses `contentPath`, `contentContract`, and `message
finalize`. A route label alone is insufficient. Pending review remains review;
an unsupported transition remains unsupported. Never recommend finalize for a
transaction without a valid structured authoring path.

DEC-004: retain the real semantic validator and content contract as the consumer
authority. Add only missing public examples and pointer-specific expected shapes;
do not create a parallel schema/validator, change content schema version 3, or
invent template comments that would make JSON invalid. Preserve bounded aggregate
diagnostics, count/truncation semantics, and helper-owned fields.

DEC-005: use installed-artifact subprocess tests plus separate agent trials.
Test authors may inspect implementation to diagnose defects. The recovery driver
and trial agent may use only public artifacts. Independent expected states and
assertions must not be computed from the same production helper being tested.

No alias, compatibility shim, replacement library, or external software adoption
is selected. Reuse the existing CLI, validator, test harness, packaging, and
evaluation facilities. Reopen HISEW reuse/version/licensing research if a new
dependency or replacement capability becomes necessary; do not infer clearance.

## Vertical slices and traceability

DEC-008 (accepted by the user): one parse and admission boundary. Parse helper
arguments using a shared command definition and pass validated values to the domain
operation. The `workflow check --` child argv is opaque thereafter. Remove the
dispatcher's raw `--transaction` scan and direct JSON pre-read; the transaction
component owns admission and validated state. Do not replace it with a second
generic reader. Preserve transaction lock/revalidation requirements at mutations;
parse-once does not mean state checked once and trusted indefinitely.

DEC-009 (accepted by the user): derive parser configuration and help syntax from
one command-option definition, retaining domain validation in the operation. Assess
Node's native `util.parseArgs` against actual flags, multiplicity, booleans, values,
and opaque child argv before choosing an implementation. Reuse the installed
supported runtime; do not add a parser dependency without the HISEW reuse assessment.
No new parser framework, legacy syntax shim, or duplicate help option inventory.
Independent behavioral fixtures remain necessary to challenge the shared definition.

DEC-010 (accepted by the user): expose installed-artifact identity with `--version`.
Use authoritative packaged metadata, not the caller's checkout, a floating branch,
or a hand-maintained duplicate constant. Include implementation identity and the
new diagnostic-contract version. Qualify metadata availability in the assembled
skill/plugin/archive. Any exact package/build configuration change still requires
its separate approval; identify it concretely before effects.

Source evidence: bundled invocation `workflow check -- node --transaction
package.json` incorrectly reports an unsupported transaction version for the child
argument. Bundled `--version` reports UNKNOWN_COMMAND. These read-only probes ran
during planning and created no transaction. Options currently occur in individual
parsers, CLI help maps, and a copied list in help-contract.test.mjs.

Guidance: [Node util.parseArgs](https://nodejs.org/api/util.html#utilparseargsconfig),
[GNU CLI conventions](https://www.gnu.org/prep/standards/html_node/Command_002dLine-Interfaces.html),
and [AIP-192 documentation](https://google.aip.dev/192). The shared definition is a
project design choice supporting contract accuracy, not a required Google library.

### Standards and guidance audit (2026-09-21)

Conclusion: the proposed architecture is consistent with the following established
principles. This is a source-grounded design assessment, not certification or proof
that an unimplemented contract conforms. Apply each source within its actual scope.

| Decision | Authoritative basis | Application and limit |
| --- | --- | --- |
| One machine-readable error contract, stable identity, structured details | [IETF RFC 9457, sections 3-4](https://www.rfc-editor.org/rfc/rfc9457.html); [Google AIP-193](https://google.aip.dev/193) | Reuse the principles of common representation and actionable details. These are HTTP/API sources; do not claim this CLI implements their wire protocols or import gRPC/HTTP codes. |
| Useful recovery without implementation inspection | [Google AIP-193, Guidance and Help](https://google.aip.dev/193); [W3C error-suggestion guidance](https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html) | Identify the problem and known correction, retaining security/purpose constraints. W3C guidance concerns web accessibility; it supports the usability principle, not CLI WCAG conformance. |
| Structured data instead of parsing human prose | [Google AIP-193, ErrorInfo](https://google.aip.dev/193) | All recovery-relevant dynamic facts in messages also exist in structured fields. Codes and fields, not wording, drive consumers. |
| Interoperable JSON and failing-location pointers | [IETF RFC 8259](https://www.rfc-editor.org/rfc/rfc8259); [IETF RFC 6901](https://www.rfc-editor.org/rfc/rfc6901.html) | Produce valid interoperable JSON; define whether a pointer is a JSON Pointer string or URI fragment and encode it accordingly. These syntax contracts apply directly when used. |
| No blind repeat after an uncertain mutation | [IETF RFC 9110, section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2) | Apply the idempotency/recovery principle by analogy to the CLI's journaled Git operations. The HTTP rule does not itself define Git retry semantics or authorize recovery. |
| Bound and sanitize public diagnostic detail | [IETF RFC 9457, section 5](https://www.rfc-editor.org/rfc/rfc9457.html#section-5) | Preserve useful details without exposing implementation internals, secrets, or unsafe advice. Exact limits remain consumer-specific decisions and need tests. |
| Retained evidence may be assessed by another host | [W3C PROV overview](https://www.w3.org/TR/prov-overview/) | Object identity, producing activity/agent, versioning, and derivation support portable provenance. This is a conceptual basis, not a requirement to adopt PROV serialization or proof that a particular receipt is trustworthy. |

The choice to implement a shared internal module, offer JSON-default/text-on-request,
migrate all 15 commands in one change, and accept successful behavioral evidence on
any one supported host are explicit project design/acceptance choices. No cited
standard mandates this exact implementation, default format, migration breadth,
trial count, or release threshold. Optional cross-host coverage remains non-blocking.

Add these concrete contract checks to SLICE-001/004 and final conformance testing:

- Recovery-relevant identifiers, paths, expected values, and input requirements
  must be available as structured fields rather than extracted from message text.
  Human text may improve without changing stable machine identity or semantics;
  update controlled consumers to structured fields during the direct cutover.
- Test JSON Pointer's empty-root representation, array locations, and escaping of
  `~` and `/` in property names; never confuse pointer paths with filesystem paths.
- Specify absent versus null versus unknown field meanings and extension behavior.
  Pin reserved fields and machine identities. Validate complete mappings through
  the actual consumer, not a second inferred schema or renderer-specific grammar.
- Test hostile/control-character details, oversized and cyclic values, and literal
  command arguments. Neither renderer interprets supplied data as shell commands.
- Test the new contract with updated controlled consumers, both renderers,
  and distinct completed/blocked/unknown outcomes. All-command migration does not
  justify inventing missing transaction facts to fill a uniform envelope.

Before implementation, complete the producer/consumer inventory and concrete wire
contract. Implementation assurance then requires packaged conformance tests,
independent review, relevant security assessment, and actual single-host behavioral
evidence. Research supports the design direction; it does not replace those checks.

Each slice begins with package reproduction, then makes the smallest demonstrated
correction and its public guidance change together. A passing current journey is
recorded as already fixed. Source locations below are predictions, not commitments
to rewrite every named file. All source paths are under `src/committing-to-git/`;
public references are under `skills/committing-to-git/references/`.

| Slice | Links | Observable proof | Release/cleanup implication |
| --- | --- | --- | --- |
| SLICE-000: command boundary and identity | REQ/AC-007/008/009; QA-001/002/003; DEC-008/009/010 | Packaged CLI respects opaque child arguments, uses authoritative transaction admission, derives truthful help, and identifies itself outside Git. | Directly replace duplicated parsing/help sources; package metadata must describe the artifact actually running. |
| SLICE-001: failed-check recovery | REQ/AC-001; QA-001/002/003; DEC-001/005 | Isolated package reports exact failed receipt IDs, explicit approval prerequisite, and supported continuation; missing/invalid approval stays blocked. | Guidance-only unless reproduction proves more; retain failed-check evidence. |
| SLICE-002: task-lineage recovery | REQ/AC-002; QA-001/002/003; DEC-001/002/005 | Missing/blank note rejects safely; public evidence-plan example with a specific note reaches valid preparation; truthful read-current-task also works. | No note flag or migration by default; preserve provenance receipts. |
| SLICE-003: message transport recovery | REQ/AC-003; QA-001/002/003; DEC-001/003/005 | Returned paths and operations recover direct-message rejection in valid checked/structured states, while pending/unsupported states remain explicit. | Preserve requested sections and exact approved bytes; retain transaction evidence. |
| SLICE-004: structured authoring recovery | REQ/AC-004; QA-001/002/003/004; DEC-001/004/005 | Public-only authoring succeeds; malformed subject, authoringState, fileNotes, and selection yield useful failing pointers/shapes without corrupting helper fields. | Preserve content schema; retain trial failures and package identities. |
| SLICE-005: preparation and review recovery | REQ/AC-005/006; QA-001/002/003/005; DEC-001/002/005 | Prepare, resume, extend, review-next, and promote expose the shared contract for input, review, lock, and interruption failures. | Preserve draft isolation, installed-index ownership, and review state. |
| SLICE-006: checks and verification recovery | REQ/AC-005/006; QA-001/002/003/005; DEC-001/005 | Check, check-detail, verify, and report-detail cover nonpassing checks, unavailable details, signature failures, and partial success without false state. | Preserve recorded commits and receipt identity; no repeated commit to repair verification. |
| SLICE-007: publication, recovery, and completion | REQ/AC-005/006; QA-001/002/003/004/005; DEC-001/005 | Publish, recover, cleanup, and remaining dispatch/fallback diagnostics conform; unknown outcomes never suggest unsafe repetition or cleanup. | Complete inventory closure is required before release; retain existing transaction and publication recovery rules. |

### SLICE-000

Likely files: `src/committing-to-git/cli/commitWorkflow.js`, a predicted adjacent
command-definition module, command argument adapters, existing transaction
admission code, and existing build metadata producers. Tests: help-contract,
commit-workflow-cli, and new package identity/boundary cases in public-recovery.
Replace the copied help-option test list with registry coverage plus independent
accepted/rejected argv fixtures. A generated expectation alone is not an oracle.

Prove `--transaction`, `--format`, and `--help` after the child separator cannot
affect helper parsing, file access, or rendering. Check duplicate helper options,
missing values, booleans, repeated acknowledgements, and literal metacharacters.
Use malformed/non-transaction paths to prove admission occurs only through the
owning module, before any mutating operation. Validate `--version` outside Git and
against assembled artifact metadata. Add no fake release identifier. This slice
establishes command definitions; SLICE-001 supplies the shared diagnostic result
used by the complete migrated CLI. No intermediate mixed package is released.

### SLICE-001

Likely seams: `workflow/createCommitWorkflow.js`, `cli/commitWorkflow.js`,
`references/check-evidence.md`; `tests/committing-to-git/transaction-recovery.test.mjs`
and a proposed `tests/committing-to-git/public-recovery.test.mjs`.

Start with one and multiple nonpassing witnessed receipts. Verify required IDs
against fixture-owned receipts, help syntax, and the returned continuation.
Exercise invalid/duplicate acknowledgements and unknown check outcomes as guardrails.
Tests that actually commit use isolated fixture repositories and explicit simulated
approval, never the user's checkout or signing identity. Assert the intended commit
and report when authorized, and absence of a commit when authorization is missing.

This first slice also introduces the shared diagnostic constructor/validator and
renderer in a predicted `src/committing-to-git/diagnostics/` module boundary, with
`tests/committing-to-git/diagnostic-contract.test.mjs`. Migrate dispatch failures
and the complete commit command boundary alongside the first journey, including
unknown commit outcomes and partial verification results. Demonstrate one complete
CLI path with the shared contract before migrating other operations. Add a public
`references/diagnostics.md` explaining the common semantics; link it from applicable
skill/help entry points without replacing domain-specific recovery references.

Before implementation, produce a finite inventory covering all producers and
consumers, reserved fields, code families, state/disposition meanings, size bounds,
and exit/stream behavior. Record the direct-cutover mapping and test oracles in
this dossier. Shared-module names are predictions, not an instruction to create
generic infrastructure beyond the contract these operations actually need.

Command ownership inventory: prepare and resume own preparation/snapshot state;
extend and review-next own review/authoring progress; promote owns draft-to-index
transition; message check/finalize own fixed inputs and canonical message;
check/check-detail own witnessed outcomes and bounded output; commit/verify own
commit and verification outcomes; report-detail owns durable report traversal;
publish owns remote-attempt outcomes; recover/cleanup own observation and eligible
artifact retention; dispatch owns unknown commands/version admission/load failures.
Use the CLI registry as the source of route completeness. A manually copied list
alone is not a conformance gate.

### SLICE-002

Also implements REQ/AC-010/011 and DEC-011/012 below: establish the domain-owned
vocabulary and shared selector normalization/matching, migrate preparation and
review consumers, and replace message-selection duplication in the same slice.
Do not temporarily deliver different matching semantics between these consumers.
Use independent fixtures with all-valid values, no matches, mixed valid/unmatched
values in one field, multiple fields, exact paths, prefixes, IDs, kinds, and
all/remaining selection. Retain caller-owned overlap, exhaustive coverage, and
provenance decisions. Test review canonical ordering separately from membership;
remove the old implementations rather than leaving wrappers or fallback modes.

Likely seams: `workflow/prepareWorkflow.js`, `inspection/reviewCatalog.js`,
`cli/commitWorkflow.js`, `references/inspection-recovery.md`; the new public
recovery suite and `commit-workflow-cli.test.mjs` / `review-catalog.test.mjs`.

Capture actual CLI errors for absent note, blank note, and unsupported `--note`.
Exercise a complete evidence-plan example using only public keys. Preserve intended
mode, scope, and path selection through the retry; do not rerun a mutating prepare
if its returned state requires resume/recovery instead. Inspect mutation ordering
to establish this rule from the actual failed attempt. Compare provenance meaning
and canonical evidence, not just exit status. Keep `read-current-task` as a separate
valid fixture whose evidence was read, not an automatically suggested bypass.

### SLICE-003

Likely seams: `workflow/createCommitWorkflow.js`, `workflow/authoringProgress.js`,
checked/finalize workflows, `cli/commitWorkflow.js`, `references/message-format.md`;
the public recovery suite and `transaction-recovery.test.mjs`.

Cover transport-safe subject success, detailed direct-message rejection, extended
checked text, structured authoring, and pending review. Assert an exact resolved
transaction-owned path and an operation valid in that state. Preserve an existing
requested File Changes section and exact-message ownership. Compare canonical bytes
and final state; a test that merely matches an error string is insufficient.

### SLICE-004

Complete REQ/AC-010 and DEC-011/013 integration: derive returned allowed fields,
values, and limits from the shared domain definitions, reuse existing structural
validation, and verify examples against the consuming validator. Diagnostics use
authoritative authoring state and CLI definitions instead of copied state/option
tables. Keep independent expected states and invalid-input examples in tests.

Likely seams: `message/semanticContentContract.js`,
`message/semanticContentValidation.js`, `references/message-format.md`, and CLI
help; `semantic-content-contract.test.mjs` and the public recovery suite.

Author detailed and bulk fixtures from generated content and returned contract.
Exercise null and nonnull subject scope, valid selector families, selector
exclusivity, helper-owned field edits, and wrong value shapes. Correct independently
reported shape errors, then demonstrate semantic coverage validation. Check that
examples agree with the real consumer without deriving expected values from it.
Reuse the existing evaluation runner for public-only host trials; proposed scenario
or runner-configuration changes must first receive exact configuration approval.

## Ordering, verification, and integration

SLICE-005 likely touches prepare/resume/extend/review-next/promote workflow modules
and their existing package/regression suites. Cover malformed and unsupported
transactions, stale snapshots, held locks, missing evidence, and interruption after
index installation. Migrate every diagnostic at these boundaries, not only those
related to task-lineage. Reuse domain-provided authoring/review transitions.

SLICE-006 likely touches runCheck/checkDetail/createCommit/reportDetail workflow
modules. Cover failed, timed-out, recovered-unknown and oversized-output checks;
verification failure after a recorded commit; unavailable report details. Confirm
bounded diagnostics preserve meaningful outcome distinctions and receipt links.

SLICE-007 likely touches publish/recoverTransaction workflow modules and the CLI
fallback. Use isolated local remotes, never a real push. Exercise known rejection,
unknown publication, active/expired ownership, unavailable/corrupt recovery state,
and cleanup refusal with pending mutations. Inventory nested warnings and returned
non-success results as well as thrown exceptions. Retire superseded public result
builders/renderers after their last consumer migrates; no compatibility shim is
permitted. Add shared-contract conformance checks across all
15 registered routes and dispatch. Internal causes need not become public APIs.

Implement SLICE-000 first, then SLICE-001 through SLICE-007. The command definitions
and first recovery journey establish the shared contract and public-only fixtures.
Slices 2-7 are conceptually separable,
but share CLI/error semantics and tests; do not assign concurrent writes without
settled ownership. No parallel agents are required by this plan.

Use the current package build path, then run the slice's focused Node tests. The
proposed package suite command is
`node --test tests/committing-to-git/public-recovery.test.mjs` once that file exists.
Reuse current `node --test tests/committing-to-git/commit-workflow-cli.test.mjs`
and the relevant recovery/semantic suites as impacted checks. Regenerate shipped
bundles through `npm run build`; never hand-edit the generated implementation.
Inspect generated outputs before retaining changes to any configuration file.

The package fixture must contain the assembled delivered skill and its public
references, outside the source checkout, with a recorded hash and no source imports
in the recovery driver. Include an archive extraction smoke check using the existing
packager where that distribution is claimed. A canonical bundle test alone does
not prove archive completeness or installation on each host.

At integration run `npm run verify` as required by AGENTS.md, including canonical
SKILL.md ASCII validation through build:check. If baseline user-owned changes fail
a check, retain the failure and identify its scope; do not silently repair or
discard unrelated work. Review complete diff/status and current test evidence.
Freeze the target for independent R2 verification and applicable specialist review;
retest affected inputs after accepted repairs. Deterministic verification does not
replace required agent trials or semantic review. Additional-host smoke coverage
is optional under the accepted QA-004 release criterion.

## Compatibility, observation, and release

### Evidence handoff across agents and hosts

Evidence validity does not depend on the receiving agent matching the producing
agent or host. Claude Code may inspect and reuse retained verification performed
under Codex, and vice versa. Changing model, host, subscription availability, or
conversation alone does not invalidate completed checks or require rerunning them.

Retain accessible evidence identifying the tested source/package (including relevant
uncommitted inputs), command, environment/tool versions, completed outcome, and
logs/receipts. The receiving agent checks that the evidence applies to the current
target and required scope; it does not relabel the producer or claim it reran the
check. Changed relevant inputs, missing/ambiguous evidence, or different required
environment coverage can justify new verification. Receipt integrity and applicable
workflow validation still matter; a producer's prose assertion is not a substitute
for a required witnessed receipt.

Separate evidence review from additional execution coverage: Claude can validate
that a retained Codex-host trial succeeded, but that record does not establish
that the same journey was executed on Claude. Under QA-004 the additional Claude
execution is optional, so this distinction does not block release or handoff.

If output exists only in an inaccessible conversation, volatile process state, or
a removed temporary file, the new agent has an availability gap, not a host-based
invalidation rule. Preserve durable evidence and use the existing resume/recovery
contract for in-flight work; do not replay an uncertain mutation to replace lost
context. This plan introduces no new cross-host evidence store, receipt format, or
transfer service. Qualify existing retained evidence references for handoff within
the package/regression work, and report any infrastructure gap separately.

### Direct cutover and release

Select one coherent diagnostic contract and update all controlled consumers,
documentation, generated package outputs, and relevant tests in the same delivery.
Old diagnostic fields, codes, renderers, and exit values need not remain supported.
Retain safety and outcome distinctions; represent them clearly in the new contract.
No old-consumer fixtures, fallback adapters, or dual-contract transition period.
Check that no current caller still depends on a removed format or code, and qualify
the final package as a whole. Intermediate slices are demonstrable but the complete
all-command migration is required before release. Refresh any loaded older skill
artifact before continuing with the new CLI; do not combine mismatched instructions
and implementation or pretend an active mutation can be safely restarted.

Signing/authorization requirements, content schema, and persisted transaction state
are not redesigned by this contract migration. No backfill or reconciliation is
expected. A demonstrated need to alter persisted state requires re-planning and a
concrete interruption/resumption and recovery design, not a compatibility shim.

Record per-case package hash, host/version, initial state, emitted diagnostic,
public recovery sequence, final state, source-inspection attempts, human decisions,
and failures. Do not invent historical timing or installed versions. Distinguish
necessary approval prompts from avoidable clarification/coaching. Reassess the
purpose anchor if improved diagnostics increase wrong-route actions or hide failures.

Release requires the maintainer to accept the frozen evidence and resolve independent
review findings. Successful required behavioral coverage on any one supported host
satisfies QA-004; absent results on other hosts are non-blocking and need no further
exception approval. Deterministic verification and the remaining R2 obligations
still apply. Observed trial failures require triage; an unresolved failure of an
accepted requirement, unsafe command guidance, lost authorization, or state
incompatibility aborts promotion. Retain the last qualified artifact. Prefer
a forward fix for defective guidance; do not downgrade live transactions unless
compatibility is demonstrated. Never undo a user commit as package rollback.

The release observer is the maintainer or their explicitly designated operator.
Observe the first authorized use of each changed journey when available, retain
outcomes, and reopen the issue on source inspection, unsafe recovery, or repeated
misrouting. No new telemetry service or automatic reporting is introduced.

Retain reproduction failures, package identities, reviews, and trial transcripts
as evidence. Disposable fixtures can be removed only after their owner and evidence
retention needs are satisfied and the specific cleanup is authorized. Preserve
all pre-existing working-tree changes and artifacts.

## Re-planning triggers and pending decisions

### Accepted DRY decisions

The user accepted these recommendations, including the stricter selector behavior.
They are part of this plan's scope, not a general deduplication campaign.

1. Shared contract vocabulary is duplicated across `workflow/prepareWorkflow.js`,
   `inspection/reviewCatalog.js`, `message/changeSelection.js`,
   `message/semanticContentValidation.js`, `message/semanticContentContract.js`,
   and `transaction/transactionWorkspace.js`. Evidence policies, provenance kinds,
   selector fields, and the 512-byte basis-note limit have multiple definitions.
   DEC-011: use a domain-owned definition imported by these consumers, with allowed
   fields/values and public contract descriptions derived from it. Keep distinct
   schemas' optionality and ownership rules explicit. Do not centralize every
   unrelated constant in a generic constants file.

2. Selector normalization and matching are independently implemented in reviewCatalog
   and changeSelection. They are not equivalent: review matching rejects a selector
   field only when none of its values match; message matching rejects each unmatched
   value. Review normalization sorts values, while message normalization preserves
   input order. DEC-012: use a shared selector implementation, separating matching
   from canonical ordering. Reject every unmatched explicit selector value so
   partially mistyped selections cannot silently succeed. This is an accepted
   behavior correction, not a claim of mechanical semantic equivalence. Preserve
   stage-specific coverage, overlap, and evidence ownership checks at their callers.

3. Existing `workflow/authoringProgress.js` already owns extended authoring state,
   paths, and next action across prepare/resume/extend/review-next/promote. Shared
   diagnostics consume that authoritative interpretation under DEC-013, not create an
   error-specific table of the same transitions. Likewise CLI help and diagnostic
   continuation argv should use the same command definitions, with live eligibility
   and authorization supplied by the domain operation. Never pre-fill approval.

4. Hash helpers, JSON serializers, and filesystem checks repeat, but equal-looking
   code is not proof of equal contracts. Serialization feeds durable digests and
   journals; path checks differ by trust and ownership. Do not unify them merely to
   reduce line count. Reuse an existing exact primitive when its byte/locking/IO
   contract matches; broader persistence refactoring remains outside this plan.

DRY acceptance measures single ownership of semantic rules and removal of
superseded implementations. Preserve independent test expectations and fixture facts;
deriving the oracle from the same definition under test hides incorrect definitions.
Retain both public-contract conformance tests and independent behavior examples.

Re-plan if package behavior contradicts the source hypothesis, all reported gaps
are already fixed, recovery requires transaction migration or a new flag, consumers
cannot be updated atomically with the new contract, a new dependency is needed, or no supported host can supply
required executable coverage. Missing optional-host results alone do not trigger
re-planning. A newly discovered authorization defect needs its own explicit scope
and risk assessment; it is not permission for an incidental rewrite.

Grilling decisions recorded: complete all-command shared-contract migration;
retained JSON evidence plans; any-one-host behavioral release sufficiency with
optional additional-host coverage; reusable cross-agent verification evidence;
DEC-006's JSON-default/text-on-request projections from one structured result;
DEC-007's direct cutover with no backward compatibility or shims; and DEC-011/012/013's
shared domain vocabulary, strict selector matching, and reused state interpretation.
The producer
inventory determines concrete mappings, not whether old callers must be supported.
New domain behavior, persisted-state changes, or configuration changes still need
their applicable scope decisions. Implementation remains outside this planning request.

### Q3 evidence correction

The original two-trials-per-journey-per-host proposal is not an existing runner
capability or a HISEW-mandated sample size. The current committing-to-git suite
supports executable OpenAI/Codex sessions and a Google/Antigravity policy-only
lane; it does not support executable Claude sessions. Antigravity policy answers
cannot establish successful Git recovery. Shared runtime adapters do not establish
that a suite supports the same executable scenario on every host.

The existing executable campaign is also fixed around a broader matched-arm
screen, rather than an arbitrary eight-session issue-specific schedule. An exact
issue-specific campaign needs either a supported scoped route confirmed before
use, approved runner/case changes, or supervised isolated host sessions with
equivalent retained evidence. Do not claim that a generic repetitions option makes
the proposed matrix executable without this qualification.

Across four journeys and three hosts, one trial per journey/host means 12 sessions;
two means 24. These are minimum journey counts, excluding variant cases, baseline
comparisons, invalid runs, and post-fix retests. Elapsed time and usage are unknown
until a representative authorized pilot is measured. Two passes provide a small
repeatability screen, not a statistical reliability threshold.

Accepted revision: retain deterministic package and Windows/POSIX checks, then
require one successful executable trial per original journey on any one supported
host, plus coverage of additional recovery dispositions introduced by the expanded
all-command migration. Four journey trials are a floor, not the full expanded
campaign. Additional-host smoke testing is an aim, not a release
prerequisite. Use the installed package in fresh isolated fixtures and retain
commands, outputs, approval decisions, and final Git facts. A policy-only answer
does not satisfy an executable recovery trial; supervised host sessions may supply
equivalent evidence without a new automated adapter. Expand trials for observed
ambiguity or host-specific behavior, retaining failures. Missing optional coverage
is recorded without blocking release or seeking another exception. Building
additional cross-host automation is a separate scope decision, not an implicit
prerequisite implementation hidden inside issue #3.
