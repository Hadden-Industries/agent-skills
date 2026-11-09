---
name: committing-to-git
description: Drafts messages, creates and verifies signed commits, and preflights authorized direct or GitHub PR publication. Use for message drafts, new commits, or their delivery. Excludes history amendment and existing merge, rebase, cherry-pick, or revert operations.
compatibility: Requires a Git working tree, Node.js 24+, Git 2.45+, and configured signing. Required SSH verification needs its configured trust source readable.
license: MPL-2.0
metadata:
  category: development
  version: "0.1.1-dev.17"
---

# Committing to Git

Parse complete JSON (Codex included).
Keep `proposal`, `publicationProposal` and `transaction` opaque; follow `disposition`, `status`, `phase`, `recovery`; show `displayText` verbatim.
Follow [diagnostics](references/diagnostics.md); never execute diagnostic prose.

Treat the user's hint as a hypothesis.
Use policy, task evidence and Git facts to correct type and scope, sharpen the outcome, and add rationale or user-experience consequences.

## State storage

Default memory storage writes nothing before the authorized commit; `workflow prepare` returns a `proposal`.
After interruption or `PROPOSAL_STALE` (nothing mutated), prepare again and reapprove.
Use supported memory routes and corrections; detail never requires disk.
Propose disk only for verified requirements without equivalent memory routes; explain storage effects and await the user's choice.
After disk selection, use a user/repository-named absolute directory; ask if missing, never default to OS temp.
See [state storage](references/state-storage.md).

## Already-reviewed changes

Reuse applicable scope, evidence, format, authority and destination.
Read missing facts; reuse successful checks without inventing helper receipts.

| Requested message           | Preparation and completion                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Transport-safe subject      | The route is `workflow prepare` -> exact approval and commit authorization -> `workflow commit`; no artifact access between helper calls |
| Body text                   | Pipe it to `checkedAuthoring.arguments`, show `displayText`, approve, pipe the same bytes to `commit.arguments`                          |
| Eligible per-file inventory | Memory: `--message-format detailed`, then the body-text route; disk: follow `nextAction`                                                 |

Disk bodies use `checkedAuthoring.messagePath`.
`--message-format detailed` requires exhaustive inventory, fewer than 50 units, and at most 32 KiB projected UTF-8 bytes.
For larger inventories, preserve requested meaning; [bulk/recovery](references/message-format.md#large-inventory-and-rejected-preparation) requires disk structured authoring and the user's storage choice.

For disk structured authoring, follow [message format](references/message-format.md), `contentContract`, `contentPath` and `contentTemplate`; read the worksheet when the template is null.
Preserve requested sections; finish required evidence first.
Reuse exact-message/effect authorization; drafts authorize neither staging nor committing, and pushing needs separate authority.

## Publication intent before drafting

Distinguish source publication from target integration.
Follow [publication routing](references/publication-routing.md) with `workflow preflight --remote <name>` and known refs; reuse `feasibility.discoveryReuse` within unchanged tasks.
Resolve mandatory feasibility/reviews/checks.
Prefer direct signed publication, normal PR merge, then disclosed squash.
Check payload/live refs; rediscover after context/policy changes or rejection.
Local-only commits need no remote discovery.

Optional identity failures alone never block/prompt.
Stop guard-denied operations.

Derive scope from task lineage/Git, never a semantic hint used as a glob, pathspec, prefix, or fuzzy selector.
Ask when two materially different scopes remain plausible.
Never autocorrect selectors.

## Prepare

Git 2.45+ lets the helper preflight `--no-lazy-fetch` and enforce `GIT_NO_LAZY_FETCH=1`.
Request narrow metadata capability before actual preparation/commit in read-only `.git`.
Never delete a live index lock.

| Intent                                  | Mode     | Scope                        |
| --------------------------------------- | -------- | ---------------------------- |
| Propose without changing the real index | `draft`  | `staged`, `full`, or `paths` |
| Stage for an authorized workflow        | `actual` | `staged`, `full`, or `paths` |

`staged` preserves partial hunks; `full` selects all; `paths` selects whole working-tree paths.
Memory drafts never commit.
Memory `paths` preserves unrelated staging; whole-path scope includes unstaged content.
Disk actual paths needs an empty index; disk drafts need disjoint staging.
Include rename sides.
Manifest inclusion is not review.

| Evidence  | Use when                                                                                    |
| --------- | ------------------------------------------------------------------------------------------- |
| `reuse`   | Specific authored, read, generated, or surviving task-lineage evidence covers the selection |
| `message` | The user's hint or bounded current observations are sufficient; a hint alone belongs here   |
| `review`  | Content or consequential Git facts remain unknown and require packets                       |

Age is not uncertainty.
When a targeted exact-path diff explains a small dependency, integrity hash, lock entry or metadata scalar change, use `message` with `read-current-task`; do not choose `review` because it predates this turn.

Use exact non-overlapping selections covering the scope for mixed provenance; rationales may overlap, bulk domains cannot.
Scope verification proves selection, message evidence supports claims, and full review inspects content.
Inline evidence must be complete; otherwise use packets.

`task-lineage` requires a specific `--evidence-plan` note; see [recovery](references/inspection-recovery.md#reusable-evidence-plans).
`read-current-task` requires actual reading.
Cross-host evidence requires matching identity, subject and applicability.

Disk preparation may write objects; actual `full`/`paths` may install the index:

```text
node <skill>/scripts/commitWorkflow.mjs workflow prepare --mode <actual|draft> --scope <staged|full|paths> --evidence <reuse|message|review> --basis <authored-current-task|read-current-task|task-lineage|user-grounded|generated-derived|unknown-preexisting> [--path <literal-path> ...] [--allowed-type <type> ...] [--state-storage disk --state-directory <absolute-path>]
```

Loaded repository type policy wins.
Choose the most specific dominant outcome: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, or `chore`.
Do not routinely scan history; resolve only unknown conventions.
Disclose a tie that changes release or user meaning.

Concise eligibility tracks semantic uncertainty; file count never determines concise eligibility.
No path or domain label is an escalation deny-list.
Escalate for unresolved evidence or unexplained Git facts.
Explicit review stays inline when complete evidence fits; otherwise select extended, never truncate.

## Validate before approval

Complete the message before approval.
Checked or structured text must be `message-ready`; show `displayText` verbatim.
Direct transport requires a known-valid subject.
Reapprove only changed bytes or failed-check acknowledgements.

Before presenting any subject for approval, while authoring the first proposal, apply the supported skill message policy: the description immediately after `: ` must begin with an uppercase Unicode cased letter; optional scope does not change this rule.
Examples: valid: `fix: Tolerate unreachable imports`; valid: `fix(owl2vowl): Tolerate unreachable imports`; invalid: `fix: tolerate unreachable imports`; invalid: `fix(owl2vowl): tolerate unreachable imports`.
On `SUBJECT_DESCRIPTION_NOT_CAPITALIZED`, correct it before showing the message to the user, avoiding a capitalization-only second approval.

Canonical bytes: strict UTF-8, one LF.
Direct `--message` is `subject + LF` only after `canUseDirectSubjectTransport()` succeeds.
Checked disk text uses `message check` with the transaction's fixed input.

| Revision           | Invalidation and route                                            |
| ------------------ | ----------------------------------------------------------------- |
| Wording-only       | Recheck/reapprove prose; reuse tree and evidence                  |
| New semantic claim | Read only the missing evidence delta, then use the same finalizer |
| Changed tree/scope | Start a fresh preparation and approval anchor                     |

Classify revisions by judgment, not keywords, edit distance, or embeddings.

## Disk transactions

Disk success consumes fixed input; recreate revisions.
Failure preserves valid state/rejected input.
Validate semantics yourself.

Trust returned `reviewRequired` and `nextAction`, not null queue or phase.
While required, call `workflow review-next` cursorless, then with exact `reviewProgress.nextCursor`.
Zero packets means complete; cursorless replay is idempotent.
Never open queue paths, hash artifacts manually, or inspect helper source.
Use [inspection recovery](references/inspection-recovery.md) for deletion, binary/gitlink, corruption, or uncertainty.

Read [disk authoring](references/state-storage.md#disk-authoring) before obeying `nextAction`.
Optional checks must answer a material unresolved question.

Only an unchanged draft may become actual, and only through promotion.
`workflow promote` rechecks the attached, detached, or zero-parent unborn head anchor, tree/scope, and staged state; it never authorizes a commit.

## Commit

Report checks require disk `workflow check` after preparation and before approval; never reconstruct receipts.
For failure authorization, drift or recovery, read [check evidence](references/check-evidence.md).

Confirm exact-byte authorization and named non-passing receipts.
The helper signs with `git commit`, compares raw commit-message bytes without trimming and verifies full OID.
For capacity, [native execution](references/native-execution.md) retains existing authority; standalone Git mutations remain unsupported:

```text
node <skill>/scripts/commitWorkflow.mjs workflow commit (--proposal <proposal> | --transaction <opaque-transaction>) [--execution native] [--message <transport-safe-subject> | --message-stdin --message-sha256 <digest>] [--verification <required|advisory|skipped>] [--acknowledge-failed-check <receipt-id> ...]
```

Preserve hook-altered commits; report mismatches.
Use [signature recovery](references/signature-recovery.md) for trust/policy/identity limits.
Disk journals preserve unknown outcomes without replay.

## Interpret, recover, and publish

Use the [exit outcomes](references/diagnostics.md#exit-outcomes): 0 success, 1 known rejection, 2 invalid input, 3 known commit with a later failure, 4 unknown mutation, 5 unmet prerequisite, 6 internal failure.
Preserve known commits and recover uncertain outcomes without replay.
Old attempts return `UNSUPPORTED_ATTEMPT_VERSION` without migration.

Resume a recoverably interrupted preparation only with `workflow resume --transaction <opaque-transaction>`; persisted inputs cannot broaden.
Use [transaction recovery](references/transaction-recovery.md) for permission, lock, partial-phase, or pending/unknown failures. Bounded diagnostics point to a complete hashed failure log. Query count/byte-limited report paths through `workflow report-detail`; replay the same cursor or cursorless completed page, and use `--refresh` only for a new observation.
Use `--result-detail summary` for display, comparison, signature, check and publication facts.
Use `reportDetail.arguments` or focused recovery/signature/check references for concrete gaps or returned conditions.

Confirm explicit push authority for the exact OID, remote and full destination ref; reuse tree/message bindings and [discovery](references/publication-routing.md).
For memory, follow [memory publication](references/publication-recovery.md#memory-publication): add remote/destination to `publicationPreparation.arguments`, or prepare an earlier OID with read-only `workflow publish --commit-oid`, then use `publish.arguments`.
Caller-held data proves neither authority nor historical receipts.
For disk use `workflow publish --transaction`; [publication recovery](references/publication-recovery.md) covers exceptions.
PR source publication does not complete integration.
A witnessed success differs from a recovery-time matching remote observation.
Never retry unknown outcomes automatically; `confirmed-no-live-child` requires explicit user confirmation that the process ended or host restarted.
A separately authorized retry uses `--retry-after-attempt`; reported rejections omit it.
Continue a known rejection's authorized fallback without duplicate approval.
