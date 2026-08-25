---
name: committing-to-git
description: Drafts or revises commit messages for current workspace changes, guides creation of a signed commit from an approved staged snapshot, reports whether the result matches, and optionally pushes that exact commit. Use for a requested message draft, new local commit, or that workflow's push. Do not use to amend history or finish merge, rebase, cherry-pick, or revert operations.
compatibility: Requires a Git working tree, Node.js 24+, Git 2.45+, and configured commit signing. Required SSH identity verification also needs its configured trust source to be readable.
license: MPL-2.0
metadata:
  category: development
---

# Committing to Git

Use the helper. Parse JSON `status`, `phase`, `terminalDisposition`, and exit class; pass the opaque `transaction` path back unread. Show `displayText` verbatim. Stderr is never the result; `--format text` is human-only.

Treat the user's hint as a hypothesis. Use policy, task evidence, and Git facts to correct type and scope, sharpen the outcome, and add useful rationale or user-experience consequences. Do not ask for wording when evidence can improve it.

For a known-context concise commit with a transport-safe subject, the route is `workflow prepare` -> exact approval and commit authorization -> `workflow commit`, with no artifact access between helper calls. Drafting authorizes neither staging nor committing; commit authorization binds exact message bytes; pushing needs separate authorization.

Derive exact scope from task lineage and Git state, never a semantic hint used as a glob, pathspec, prefix, or fuzzy selector. Stage unambiguous scope; ask only when two materially different scopes remain plausible. Never autocorrect unmatched selectors.

## Prepare

Git 2.45+ lets the helper preflight `--no-lazy-fetch` before allocation and enforce `GIT_NO_LAZY_FETCH=1`. If the host declares `.git` read-only, request narrow metadata capability before actual preparation or commit, avoiding a known failure. A live index lock is concurrency, never permission to delete it.

| Intent | Mode | Scope |
| --- | --- | --- |
| Propose without changing the real index | `draft` | `staged`, `full`, or `paths` |
| Stage for an authorized workflow | `actual` | `staged`, `full`, or `paths` |

Use `staged` for an intentional index, including partial hunks; `full` only for every change; and `paths` for exact whole paths. Actual `paths` requires no staged work. Draft `paths` permits only disjoint staged work and cannot be promoted until it is gone. Include both sides of an unstaged rename. The exact manifest and bounded synopsis prevent accidental inclusion without pretending every bulk path was reviewed.

| Evidence | Use when |
| --- | --- |
| `reuse` | Specific authored, read, generated, or surviving task-lineage evidence covers the selection |
| `message` | The user's hint or bounded current observations are sufficient; a hint alone belongs here |
| `review` | Content or consequential Git facts remain unknown and require packets |

For mixed provenance, use exact non-overlapping selections covering the scope, not per-file lists. Rationales may overlap; counted bulk domains may not. Scope verification proves selection, message evidence supports claims, and full review inspects content. Bounded `message` evidence is inline; packets exist only for unresolved uncertainty.

Before `workflow prepare`, note that every mode may write Git objects; actual `full` or `paths` may install the completed index, while drafts leave the index unchanged. Run:

```text
node <skill>/scripts/commitWorkflow.mjs workflow prepare --mode <actual|draft> --scope <staged|full|paths> --evidence <reuse|message|review> --basis <authored-current-task|read-current-task|task-lineage|user-grounded|generated-derived|unknown-preexisting> [--path <literal-path> ...] [--allowed-type <type> ...]
```

Loaded repository type policy wins. Otherwise choose the most specific dominant outcome: `feat` capability, `fix` correction, `perf` performance, `refactor` internals, `docs` documentation, `test` tests, `build` build/dependencies, `ci` automation, or `chore` other maintenance. Do not routinely scan history; sample it only for a material unresolved convention. Disclose only a tie that changes release or user meaning.

Concise eligibility tracks unresolved semantic uncertainty; file count never determines concise eligibility. No path or domain label is an escalation deny-list, including security, migration, deployment, lockfile, generated, or submodule. Escalate only for explicit review, unresolved evidence, or unexplained special Git facts. Oversized inline evidence selects extended, never truncation.

## Validate before approval

Complete the message before approval. Checked or structured text must be `message-ready`; show `displayText` verbatim. Direct subject transport validates during commit and is only for known-valid text. Reapprove only if bytes or failed-check acknowledgements change.

Before presenting any subject for approval, while authoring the first proposal, apply the supported skill message policy: the description immediately after `: ` must begin with an uppercase Unicode cased letter; optional scope does not change this rule. Examples: valid: `fix: Tolerate unreachable imports`; valid: `fix(owl2vowl): Tolerate unreachable imports`; invalid: `fix: tolerate unreachable imports`; invalid: `fix(owl2vowl): tolerate unreachable imports`. If local validation returns `SUBJECT_DESCRIPTION_NOT_CAPITALIZED`, correct it before showing the message to the user, avoiding a capitalization-only second approval. This is an authoring defect, not a repository-specific rejection.

Agent-authored bodies or requested inventories use `semantic-structure-required` and `message finalize`; nonportable subjects or exact user/repository bytes use fixed `message-input.txt` and `message check`. Follow [message format](references/message-format.md) and preserve every requested section.

Canonical bytes are strict UTF-8 with one LF. Direct `--message` is `subject + LF` only after `canUseDirectSubjectTransport()` succeeds. Checked text uses the fixed local input:

```text
node <skill>/scripts/commitWorkflow.mjs message check --transaction <opaque-transaction>
```

Success consumes the input; recreate it only for revision. Failure preserves prior valid state and rejected input. Code enforces mechanics, not semantics.

| Revision | Invalidation and route |
| --- | --- |
| Wording-only | Recheck/reapprove prose; reuse tree and evidence |
| New semantic claim | Read only the missing evidence delta, then use the same finalizer |
| Changed tree/scope | Start a fresh preparation and approval anchor |

Classify revisions by judgment, not keywords, edit distance, or embeddings.

## Complete an extended message

For evidence uncertainty, read packets completely and use [inspection recovery](references/inspection-recovery.md) only for deletion, binary/gitlink, truncation, corruption, or remaining uncertainty. Later uncertainty uses fixed `evidence-plan-input.json`; semantic structure reuses sufficient evidence without packet reads. The renderer chooses detailed inventory below 50 units and within 32 KiB, otherwise counted bulk domains; omit it only when neither requested nor useful. Write fixed `content.json`, then finalize:

```text
node <skill>/scripts/commitWorkflow.mjs workflow extend --transaction <opaque-transaction> --reason <evidence-uncertainty|semantic-structure-required>
node <skill>/scripts/commitWorkflow.mjs message finalize --transaction <opaque-transaction>
```

For `evidence-required`, read only the bounded delta and invoke the same finalizer; unchanged coverage survives. Shared rationale avoids repetitive diff paraphrase.

## Promote a draft

Only an unchanged draft may become actual, and only through promotion. It rechecks the canonical attached, detached, or zero-parent unborn head anchor, raw tree/scope facts, and staged-state constraints; it never implies commit authorization:

```text
node <skill>/scripts/commitWorkflow.mjs workflow promote --transaction <opaque-transaction>
```

## Commit

Optional checks enter the report only through `workflow check` after preparation and before exact approval; never reconstruct receipts from prose or prior command output. For commands, bounded diagnostics, failure authorization, drift, detail access, and recovery, read [check evidence](references/check-evidence.md).

Immediately before this command, confirm explicit commit authorization for the exact displayed bytes and every named non-passing receipt. The helper performs one journaled signed commit transition, compares raw commit-message bytes without trimming, verifies the exact full OID, and records the report. Never substitute standalone `git commit`, verification, or report creation:

```text
node <skill>/scripts/commitWorkflow.mjs workflow commit --transaction <opaque-transaction> [--message <transport-safe-subject>] [--verification <required|advisory|skipped>] [--acknowledge-failed-check <receipt-id> ...]
```

Hooks may change the message; preserve the known commit and report the mismatch. For trust-source failure, policy change, or backend identity limits, use [signature recovery](references/signature-recovery.md). One commit transition reduces races and duplicate retries; journals preserve unknown outcomes without replay.

## Interpret, recover, and publish

| Exit | Mutation certainty | Permitted next action |
| ---: | --- | --- |
| `0` | Requested phase completed | Continue from returned phase |
| `1` | No irreversible mutation, or durable known rejection | Fix the stated condition; resume only when directed |
| `2` | Invalid/unsupported input or pre-journal failure | Correct input; old versions return `UNSUPPORTED_ATTEMPT_VERSION` and are never migrated |
| `3` | Commit exists but a later gate failed | Preserve it; verify/recover, never recommit |
| `4` | Commit or push outcome unknown | Observe with recovery; never repeat the mutation |

Resume a recoverably interrupted preparation only with `workflow resume --transaction <opaque-transaction>`; persisted inputs cannot broaden. Use [transaction recovery](references/transaction-recovery.md) for permission, lock, partial-phase, or pending/unknown commit failures. Bounded diagnostics point to a complete hashed failure log. Query compacted count/byte-limited report paths through `workflow report-detail`; replay the same cursor or cursorless completed page, using explicit `--refresh` only for a new observation.

Immediately before publication, obtain separate push authorization for the exact OID, remote, and full destination ref:

```text
node <skill>/scripts/commitWorkflow.mjs workflow publish --transaction <opaque-transaction> --remote <name> --destination <refs/heads/name> [--retry-after-attempt <prior-attempt-id>]
```

A witnessed success differs from a recovery-time matching remote observation. Never retry automatically: an unchanged ref after a `launching` or `running` crash remains unknown; `confirmed-no-live-child` requires explicit user confirmation that the process ended or host restarted. A separately authorized retry must bind the prior attempt with `--retry-after-attempt`. Follow [publication recovery](references/publication-recovery.md) only after an unknown result or missing transaction. Use `workflow verify`, `workflow recover`, `workflow cleanup`, and `workflow report-detail` only for named exceptions.
