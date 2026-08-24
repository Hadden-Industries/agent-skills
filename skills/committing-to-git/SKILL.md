---
name: committing-to-git
description: Drafts or revises commit messages for current workspace changes, guides creation of a signed commit from an approved staged snapshot, reports whether the result matches, and optionally pushes that exact commit. Use for a requested message draft, new local commit, or that workflow's push. Do not use to amend history or finish merge, rebase, cherry-pick, or revert operations.
compatibility: Requires a Git working tree, Node.js 24+, Git 2.45+, and configured commit signing. Required SSH identity verification also needs its configured trust source to be readable.
license: MPL-2.0
metadata:
  category: development
---

# Committing to Git

Use the bundled helper. JSON stdout is canonical: parse `status`, `phase`, `terminalDisposition`, and the exit class; pass the returned opaque `transaction` path back without reading it. Show `displayText` verbatim when present. Stderr chatter is never the result. `--format text` is only for direct human use.

Treat the user's hint as a hypothesis. Test it against policy, current-task evidence, and Git facts; correct type and scope, sharpen the outcome, and add useful rationale or user-experience consequences. Do not ask for Conventional Commit terminology or exact wording when evidence can improve the hint.

For a known-context concise commit with a transport-safe subject, the route is `workflow prepare` -> exact approval and commit authorization -> `workflow commit`, with no artifact access between helper calls. Drafting authorizes neither staging nor committing. Commit authorization binds the exact message; pushing needs separate authorization.

Derive exact scope from task lineage and Git state, never a semantic hint used as a glob, pathspec, prefix, or fuzzy selector. Stage one unambiguous task scope. Ask before staging only when two materially different scopes remain plausible. Never autocorrect unmatched selectors.

## Prepare

Git 2.45+ is required so the helper can preflight `--no-lazy-fetch` before allocation and make `GIT_NO_LAZY_FETCH=1` an enforceable no-hidden-network guarantee. If the host already declares `.git` read-only, request the narrow known metadata capability before the first actual preparation or commit command instead of probing a known failure. A live index lock is concurrency, not permission to delete it.

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

For mixed provenance, use exact non-overlapping selections covering the scope, not a per-file list. Rationales may overlap; counted bulk domains may not. Scope verification proves selection, message evidence supports claims, and full review inspects content. Bounded `message` evidence is inline; packets exist only for unresolved uncertainty. A receipt binds packet identities but cannot prove reading.

Immediately before `workflow prepare`, remember its side effects: every mode may write Git objects; actual `full` or `paths` may install the exact completed index, while drafts do not change staged entries. Run one form:

```text
node <skill>/scripts/commitWorkflow.mjs workflow prepare --mode <actual|draft> --scope <staged|full|paths> --evidence <reuse|message|review> --basis <authored-current-task|read-current-task|task-lineage|user-grounded|generated-derived|unknown-preexisting> [--path <literal-path> ...] [--allowed-type <type> ...]
```

Loaded repository type policy wins. Otherwise choose the most specific dominant outcome: `feat` capability, `fix` correction, `perf` performance, `refactor` internals, `docs` documentation, `test` tests, `build` build/dependencies, `ci` automation, or `chore` other maintenance. Do not routinely scan history; sample it only for a material unresolved repository convention. Do not list ordinary alternatives; disclose only a tie that changes release or user meaning.

Concise eligibility tracks unresolved semantic uncertainty; file count never determines concise eligibility. No path or domain label, including security, migration, deployment, lockfile, generated, or submodule, is an escalation deny-list. Escalate only for explicit review, unresolved evidence, or unexplained special Git facts. If bounded inline evidence cannot fit, preparation selects extended rather than truncating it.

## Approve a concise message

A subject-only message fits any coherent scope. Add sections only for durable rationale, UX impact, or useful inventory. Apply `canUseDirectSubjectTransport()` before constructing a command containing the subject. Safe ASCII may go directly to `workflow commit`. Multiline, Unicode, shell-active/nonportable punctuation, explicit checked-file preference, or a checked-route revision uses only fixed transaction-local `message-input.txt`; no arbitrary path or second workspace.

Canonical bytes are strict UTF-8 with exactly one terminal LF. Direct `--message` means only `subject + LF`. Reject CR, C0/C1 controls, format controls, invalid UTF-8, altered normalization, or any approval whose raw bytes differ. Write the fixed input, then run:

```text
node <skill>/scripts/commitWorkflow.mjs message check --transaction <opaque-transaction>
```

Success consumes the input after recording the latest valid message; failure preserves prior valid state and input. Keep only its latest validation/hash and monotonic revision, never historical bodies. Code enforces declared evidence, tree, and byte facts, not semantic equivalence.

| Revision | Invalidation and route |
| --- | --- |
| Wording-only | Recheck/reapprove prose; reuse tree and evidence |
| New semantic claim | Read only the missing evidence delta, then use the same finalizer |
| Changed tree/scope | Start a fresh preparation and approval anchor |

Classify revisions by judgment, not keywords, edit distance, or embeddings.

## Complete an extended message

When `route: extended`, read each packet completely; use [inspection recovery](references/inspection-recovery.md) only for uncertain content, deletions, binary/gitlinks, truncation, or corruption. Later uncertainty on an unchanged concise snapshot uses only fixed `evidence-plan-input.json` and `evidence-uncertainty`. Structured inventory uses `semantic-structure-required` with no new plan/packet reads. Included file/domain inventory requires structured bulk at 50 units or projected detailed output above 32 KiB; concise may omit it without questioning scope. Write only fixed `content.json`, follow [message format](references/message-format.md), then finalize:

```text
node <skill>/scripts/commitWorkflow.mjs workflow extend --transaction <opaque-transaction> --reason <evidence-uncertainty|semantic-structure-required>
node <skill>/scripts/commitWorkflow.mjs message finalize --transaction <opaque-transaction>
```

An `evidence-required` result means read only the bounded delta of new packets and invoke the same finalizer again; unchanged hash coverage survives. Shared rationale avoids repetitive diff paraphrase.

## Promote a draft

Only an unchanged draft may become actual, and only through promotion. It rechecks the canonical attached, detached, or zero-parent unborn head anchor, raw tree/scope facts, and staged-state constraints; it never implies commit authorization:

```text
node <skill>/scripts/commitWorkflow.mjs workflow promote --transaction <opaque-transaction>
```

## Commit

Immediately before this command, confirm explicit commit authorization for the exact displayed bytes. The helper performs one journaled signed commit transition, compares raw commit-message bytes without trimming, verifies the exact full OID under the selected policy, and records the report. Never substitute standalone `git commit`, OID lookup, signature verification, or report creation:

```text
node <skill>/scripts/commitWorkflow.mjs workflow commit --transaction <opaque-transaction> [--message <transport-safe-subject>] [--verification <required|advisory|skipped>]
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

Resume a recoverably interrupted preparation only with `workflow resume --transaction <opaque-transaction>` so persisted inputs cannot broaden. Use [transaction recovery](references/transaction-recovery.md) after permission, lock, partial-phase, or pending/unknown commit failures. Bounded diagnostics point to a complete hashed failure log; compaction may remove safe bulk, while exact terminal purge has stricter gates. Query compacted count/byte-limited report paths only through bounded `workflow report-detail`; replay the same cursor or cursorless completed page, and use explicit `--refresh` for a new observation.

Immediately before publication, obtain separate push authorization for the exact OID, remote, and full destination ref:

```text
node <skill>/scripts/commitWorkflow.mjs workflow publish --transaction <opaque-transaction> --remote <name> --destination <refs/heads/name> [--retry-after-attempt <prior-attempt-id>]
```

A witnessed success differs from a recovery-time matching remote observation. Never retry automatically. An unchanged ref after a `launching` or `running` crash remains unknown; `confirmed-no-live-child` requires explicit user confirmation that the process ended or the host restarted. A separately authorized retry must bind the resolved prior attempt with `--retry-after-attempt`. Follow [publication recovery](references/publication-recovery.md) only after an unknown result or when no matching transaction exists. Use `workflow verify`, `workflow recover`, `workflow cleanup`, and `workflow report-detail` only for their named exceptions.
