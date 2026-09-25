---
name: committing-to-git
description: Drafts messages, creates and verifies signed commits, and preflights authorized direct or GitHub PR publication. Use for message drafts, new commits, or their delivery. Excludes history amendment and existing merge, rebase, cherry-pick, or revert operations.
compatibility: Requires a Git working tree, Node.js 24+, Git 2.45+, and configured signing. Required SSH verification needs its configured trust source readable.
license: MPL-2.0
metadata:
  category: development
---

# Committing to Git

Parse complete JSON (Codex included). Keep `transaction` opaque; follow `disposition`, `status`, `phase`, `recovery`; show `displayText` verbatim. Follow [diagnostics](references/diagnostics.md); never execute diagnostic prose.

Treat the user's hint as a hypothesis. Use policy, task evidence and Git facts to correct type and scope, sharpen the outcome, and add rationale or user-experience consequences.

## Already-reviewed changes

Reuse established scope, evidence, format, authority and destination while applicable. Identify the missing fact before each extra read/check. Reuse successful task checks unless inputs, applicability or explicit policy require rerunning; never invent helper receipts.

| Requested message | Preparation and completion |
| --- | --- |
| Transport-safe subject | The route is `workflow prepare` -> exact approval and commit authorization -> `workflow commit`; no artifact access between helper calls |
| Detailed body or per-file inventory | Prepare with `--message-format detailed`, follow `nextAction`, author, then `message finalize` -> exact approval and commit authorization -> `workflow commit` |

Use [message format](references/message-format.md) and returned `contentContract`; fill an unedited `contentPath` from `contentTemplate`, reading the worksheet if the template is null. Preserve requested sections; finish required evidence first. Reuse exact-message/effect authorization; drafts authorize neither staging nor committing, and pushing needs separate authority.

Use `--result-detail summary` to retain exact display, comparison, signature, check and publication facts with less output. Follow `reportDetail.arguments` or recovery/signature/check references only for a concrete question or returned condition.

## Publication intent before drafting

Distinguish source publication from named-target integration. Discover once with `workflow preflight --remote <name>` and known refs; follow [publication routing](references/publication-routing.md). Reuse `feasibility.discoveryReuse` within unchanged tasks. Resolve blocked/unknown feasibility and required reviews/checks. Prefer direct signed publication, normal PR merge, then disclosed squash. Check payload/live refs before effects; rediscover on context/policy change or rejection. Local-only commits need no remote discovery.

Derive scope from task lineage/Git, never a semantic hint used as a glob, pathspec, prefix, or fuzzy selector. Ask when two materially different scopes remain plausible. Never autocorrect selectors.

## Prepare

Git 2.45+ lets the helper preflight `--no-lazy-fetch` and enforce `GIT_NO_LAZY_FETCH=1`. For a declared read-only `.git`, request narrow metadata capability before actual preparation or commit. Never delete a live index lock.

| Intent | Mode | Scope |
| --- | --- | --- |
| Propose without changing the real index | `draft` | `staged`, `full`, or `paths` |
| Stage for an authorized workflow | `actual` | `staged`, `full`, or `paths` |

Use `staged` for an intentional index or partial hunks, `full` for every change, and `paths` for exact whole paths. Actual `paths` requires an empty index; draft `paths` allows only disjoint staged work until cleared. Include rename sides. Manifest inclusion is not review.

| Evidence | Use when |
| --- | --- |
| `reuse` | Specific authored, read, generated, or surviving task-lineage evidence covers the selection |
| `message` | The user's hint or bounded current observations are sufficient; a hint alone belongs here |
| `review` | Content or consequential Git facts remain unknown and require packets |

Age is not uncertainty. When a targeted exact-path diff explains a small dependency, integrity hash, lock entry or metadata scalar change, use `message` with `read-current-task`; do not choose `review` because it predates this turn.

Use exact non-overlapping selections covering the scope for mixed provenance; rationales may overlap, bulk domains cannot. Scope verification proves selection, message evidence supports claims, and full review inspects content. Inline evidence must be complete; otherwise use packets.

`task-lineage` requires a specific `--evidence-plan` note; see [recovery](references/inspection-recovery.md#reusable-evidence-plans). `read-current-task` requires actual reading. Cross-host evidence requires matching identity, subject and applicability.

Every mode may write objects. Actual `full`/`paths` may install the index; drafts cannot:

```text
node <skill>/scripts/commitWorkflow.mjs workflow prepare --mode <actual|draft> --scope <staged|full|paths> --evidence <reuse|message|review> --basis <authored-current-task|read-current-task|task-lineage|user-grounded|generated-derived|unknown-preexisting> [--path <literal-path> ...] [--allowed-type <type> ...]
```

Loaded repository type policy wins. Choose the most specific dominant outcome: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, or `chore`. Do not routinely scan history; resolve only unknown conventions. Disclose a tie that changes release or user meaning.

Concise eligibility tracks semantic uncertainty; file count never determines concise eligibility. No path or domain label is an escalation deny-list. Escalate for unresolved evidence or unexplained Git facts. Explicit review stays inline when complete evidence fits; otherwise select extended, never truncate.

## Validate before approval

Complete the message before approval. Checked or structured text must be `message-ready`; show `displayText` verbatim. Direct transport requires a known-valid subject. Reapprove only changed bytes or failed-check acknowledgements.

Before presenting any subject for approval, while authoring the first proposal, apply the supported skill message policy: the description immediately after `: ` must begin with an uppercase Unicode cased letter; optional scope does not change this rule. Examples: valid: `fix: Tolerate unreachable imports`; valid: `fix(owl2vowl): Tolerate unreachable imports`; invalid: `fix: tolerate unreachable imports`; invalid: `fix(owl2vowl): tolerate unreachable imports`. On `SUBJECT_DESCRIPTION_NOT_CAPITALIZED`, correct it before showing the message to the user, avoiding a capitalization-only second approval.

Canonical bytes are strict UTF-8 with one LF. Direct `--message` is `subject + LF` only after `canUseDirectSubjectTransport()` succeeds. Checked text uses `message check` with the transaction's fixed input.

Success consumes input; recreate revisions. Failure preserves valid state/rejected input. Validate semantics yourself.

| Revision | Invalidation and route |
| --- | --- |
| Wording-only | Recheck/reapprove prose; reuse tree and evidence |
| New semantic claim | Read only the missing evidence delta, then use the same finalizer |
| Changed tree/scope | Start a fresh preparation and approval anchor |

Classify revisions by judgment, not keywords, edit distance, or embeddings.

## Complete an extended message

Trust returned `reviewRequired` and `nextAction`, not null queue or phase. While required, call `workflow review-next` cursorless, then with exact `reviewProgress.nextCursor`. Zero packets means complete; cursorless replay is idempotent. Never open queue paths, hash artifacts manually, or inspect helper source. Use [inspection recovery](references/inspection-recovery.md) for deletion, binary/gitlink, corruption, or uncertainty.

Obey `nextAction`: `author-message` uses `messagePath` (`message-input.txt`) and `message check`; null `contentPath` is expected. `author-content` uses `contentPath` (`content.json`), versioned `contentContract`, and `message finalize`. Preserve `schemaVersion`, `evidenceGroups`, and `mode`. Supported sections are `Rationale:`, `User Experience Changes:`, and `File Changes:`; resolve others before approval and fix aggregate diagnostics by exact JSON pointer together. Detailed applies below 50 units and within 32 KiB; otherwise use bulk. New uncertainty uses fixed `evidence-plan-input.json`. If structured authoring was not selected during preparation, use `workflow extend --reason semantic-structure-required` only from `route: concise`, `phase: evidence-ready`; otherwise follow `nextAction`.

For `evidence-required`, traverse bounded delta, then finalize. `authoring-pending` means evidence is complete but approval bytes are unavailable; an older revision cannot commit. Optional checks must answer a material unresolved question, not bless a validated scalar.

## Promote a draft

Only an unchanged draft may become actual, and only through promotion. `workflow promote` rechecks the attached, detached, or zero-parent unborn head anchor, tree/scope, and staged state; it never authorizes a commit.

## Commit

Report checks require `workflow check` after preparation and before approval; never reconstruct receipts. For failure authorization, drift or recovery, read [check evidence](references/check-evidence.md).

Confirm commit authorization for exact displayed bytes and named non-passing receipts. The helper makes one journaled signed transition, compares raw commit-message bytes without trimming, verifies the full OID, and reports. Never substitute standalone Git steps:

```text
node <skill>/scripts/commitWorkflow.mjs workflow commit --transaction <opaque-transaction> [--message <transport-safe-subject>] [--verification <required|advisory|skipped>] [--acknowledge-failed-check <receipt-id> ...]
```

Preserve hook-altered commits; report mismatches. Use [signature recovery](references/signature-recovery.md) for trust/policy/identity limits. Journals preserve unknown outcomes without replay.

## Interpret, recover, and publish

Use the [exit outcomes](references/diagnostics.md#exit-outcomes): 0 success, 1 known rejection, 2 invalid input, 3 known commit with a later failure, 4 unknown mutation, 5 unmet prerequisite, 6 internal failure. Preserve known commits and recover uncertain outcomes without replay. Old attempts return `UNSUPPORTED_ATTEMPT_VERSION` without migration.

Resume a recoverably interrupted preparation only with `workflow resume --transaction <opaque-transaction>`; persisted inputs cannot broaden. Use [transaction recovery](references/transaction-recovery.md) for permission, lock, partial-phase, or pending/unknown failures. Bounded diagnostics point to a complete hashed failure log. Query count/byte-limited report paths through `workflow report-detail`; replay the same cursor or cursorless completed page, and use `--refresh` only for a new observation.

Before publication, confirm explicit push authority for the OID, remote and full destination ref. Reuse approval binding the resulting OID to its tree/message and destination, and discovery under [publication routing](references/publication-routing.md). Publishing the PR source does not complete integration:

```text
node <skill>/scripts/commitWorkflow.mjs workflow publish --transaction <opaque-transaction> --remote <name> --destination <refs/heads/name> [--retry-after-attempt <prior-attempt-id>]
```

A witnessed success differs from a recovery-time matching remote observation. Never retry an unknown publication outcome automatically; `confirmed-no-live-child` requires explicit user confirmation that the process ended or host restarted. A separately authorized retry binds resolved uncertainty with `--retry-after-attempt`; a `reported` rejection omits it. Continue a known rejection's already authorized fallback without duplicate approval. Follow [publication recovery](references/publication-recovery.md) for rejections, retargeting, unknown outcomes, or missing transactions.
