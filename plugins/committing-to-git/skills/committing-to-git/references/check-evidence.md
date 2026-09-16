# Check Evidence

Read this reference when the user wants local checks represented in the commit report, a check fails or produces noisy output, selected files change during a check, or a check process is interrupted.

Checks are optional. The no-check route remains preparation, exact approval, and commit. A successful command mentioned in conversation, run before preparation, or run outside this helper is useful task context but is not a witnessed receipt. Never reconstruct a passed or failed result from prose, a pasted transcript, package-script output, or memory. The truthful empty report wording is: `No helper-witnessed check evidence is attached to this transaction.`

## Run one command

Run checks only after `workflow prepare` or draft promotion has fixed the transaction and before presenting the exact commit approval:

```text
node <skill>/scripts/commitWorkflow.mjs workflow check --transaction <opaque-transaction> [--label <neutral-description>] [--working-directory <repository-relative-directory>] [--timeout-ms <milliseconds>] [--retry-after-attempt <receipt-id>] -- <executable> [argument ...]
```

Everything after `--` is one executable-and-argument vector. Do not pass a shell command string, choose a shell, or join commands with `&&`, `;`, or pipes. Shell metacharacters inside individual argument tokens remain literal. The bundled launcher resolves platform command shims such as `npm.cmd` on Windows without granting shell interpretation.

One top-level command creates one receipt. For example, `npm run verify` is one witnessed receipt even if that package script invokes lint, tests, and a build. The helper records the top-level child's actual exit; it does not parse stdout to manufacture three subordinate passes. If independently useful results need separate identities, run separate `workflow check` commands.

Use a neutral label that describes the command's purpose without predicting success, such as `Repository verification`. The receipt records the exact argv, repository-relative working directory, duration, exit or signal, complete stdout and stderr byte counts and SHA-256 digests, bounded retained segments, and prepared-scope comparisons.

## Understand the context

The supported context is `current-worktree`. The process can observe workspace files outside the commit selection, so never describe the result as an isolated staged snapshot or container result. Before and after execution, the helper compares every selected source and destination path with the prepared tree. Changes outside the selection do not invalidate the receipt; the current-worktree label keeps that limitation visible.

If a selected path changes before or during the command, the helper returns `CHECK_SCOPE_DRIFT`, stops the transaction without committing, and requires fresh preparation. Do not restage, reuse the receipt, or ask the user to shrink the approved commit. Recreate the same intended scope from its new state.

Wording-only message revision retains receipts because their tree, manifest, scope, and head anchor remain unchanged. Any new transaction, changed tree or scope, manifest replacement, or head-anchor change has a new receipt subject and cannot inherit old receipts.

## Interpret outcomes and output

`passed` means the exact displayed child exited zero. It does not prove what an opaque package script contained or whether its test framework skipped internal work. `failed` records a nonzero exit. `signaled` and `timed-out` record that no passing exit was observed. `launch-error` records that the intended command did not produce reportable check evidence. An interrupted `launching` or `running` attempt remains unknown until recovery.

Ordinary successful output is not echoed. The transaction retains at most a 256 KiB head and 256 KiB non-overlapping tail for each stream while its byte count and SHA-256 cover the complete stream. A non-passing command displays at most 32 KiB of diagnostics, divided between nonempty streams, with an omission marker when content is suppressed.

Read retained evidence only through a bounded transaction-owned detail request:

```text
node <skill>/scripts/commitWorkflow.mjs workflow check-detail --transaction <opaque-transaction> --receipt <receipt-id> --stream <stdout|stderr> --segment <head|tail> [--offset <bytes>]
```

Each page is at most 16 KiB and returns UTF-8 when valid or base64 otherwise. Follow `nextOffset` until `complete: true`. The helper accepts no artifact path and verifies the whole retained segment's recorded size and digest before returning a page. `CHECK_DETAIL_UNAVAILABLE` after a successful commit normally means process logs were compacted; receipt facts remain in the transaction and report. Active and failed transactions retain their bounded logs for diagnosis.

## Authorize a non-passing result

A witnessed `failed`, `signaled`, or `timed-out` receipt blocks commit creation until the user knowingly authorizes that exact receipt. Present the message and named receipt IDs together; one reply may authorize both. Do not insist that the user fix the check, reduce the commit, or abandon an intentional checkpoint.

Pass every required ID exactly once:

```text
node <skill>/scripts/commitWorkflow.mjs workflow commit --transaction <opaque-transaction> [message options] --acknowledge-failed-check C000001 [--acknowledge-failed-check C000002 ...]
```

Unknown IDs, passed receipts, duplicates, and missing failed IDs are rejected before the commit journal. The post-commit report records the exact argv, context, outcome, duration, exit or signal, output facts, selected-scope stability, and whether failure authorization was required. Launch errors and recovered unknown attempts remain visible in transaction history but are never rendered as passed checks.

## Recover an interrupted command

Never retry an interrupted check automatically. First observe it:

```text
node <skill>/scripts/commitWorkflow.mjs workflow recover --transaction <opaque-transaction>
```

If it reports `CHECK_OUTCOME_UNKNOWN`, ask for explicit confirmation that the recorded process and its children ended or that the host restarted. Then, and only then, record that fact:

```text
node <skill>/scripts/commitWorkflow.mjs workflow recover --transaction <opaque-transaction> --resolution confirmed-no-live-child
```

Recovery never launches or kills the check. It records an unknown resolved attempt without inventing an exit. A replacement must immediately name that receipt:

```text
node <skill>/scripts/commitWorkflow.mjs workflow check --transaction <opaque-transaction> --retry-after-attempt <prior-receipt-id> -- <executable> [argument ...]
```

Commit creation remains blocked until the linked retry has a durable result. A failed durable result does not use recovery; either run a new intentional check or obtain exact failed-check authorization.
