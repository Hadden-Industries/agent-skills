---
name: committing-to-git
description: Drafts or revises commit messages for current workspace changes, guides creation of a signed commit from an approved staged snapshot, reports whether the result matches, and optionally pushes that exact commit. Use for a requested message draft, new local commit, or that workflow's push. Do not use to amend history or finish merge, rebase, cherry-pick, or revert operations.
compatibility: Requires a Git working tree, Node.js 24+, and Git 2.25+. Commit creation requires configured Git signing. Trusted SSH verification requires a readable allowed-signers source unless the user selects advisory or skipped verification.
license: MPL-2.0
metadata:
  category: development
---

# Committing to Git

## Workflow contract and enforcement boundary

The helper records one Git index tree, deterministically derives mechanical message structure from it, and later reports whether the resulting commit matches the recorded tree, parent, and message. Supply what a diff cannot establish: why the change exists, which outcome it enables, and which constraint or failure it addresses.

The helper enforces selected artifact shapes and cross-artifact invariants, literal path identity, structural rendering, inspection acknowledgements, and object comparisons. It does not create the commit, lock the index, establish semantic truth or authorization, or enforce verification and report gates inside the standalone publication command. The invoking agent must follow the ordered gates below. Hooks can produce a mismatch; preserve and report it instead of claiming the approved transaction succeeded.

Agent-reviewed requirements include scratch placement, repository-relative scope values, actually reading before acknowledgement, imperative phrasing, truthful rationale, coherent domains, authorization, and command order. Do not describe those judgments as mechanically validated.

The workflow is deliberately opinionated. Git does not require Conventional Commit subjects, a `File Changes:` section, or numbered file entries. This skill uses those conventions as a stable review interface; do not present them as universal Git best practice.

Draft mode never changes the real index. Actual mode records and stages the intended tree before showing the message for approval, but it does not lock the index; later verification detects drift. Every commit created by this workflow uses `git commit -S`; changing signature-verification policy never authorizes an unsigned retry.

## Supported transaction

This skill drafts from current staged changes, all current changes, or a task-bounded set of whole paths. It can create a new root or ordinary one-parent commit and optionally push that exact commit with separate authorization.

Do not use this workflow for amend, fixup, squash, merge commits, merge/rebase/cherry-pick/revert continuation, empty commits, history rewriting, or automatic rollback. It also does not render arbitrary repository-specific subject types, trailers, or footer grammars. If applicable repository instructions conflict with the message contract below, stop before staging and explain the incompatibility; do not bypass either policy.

## Authorization and state safety

- Drafting or revising a proposed message does not authorize staging or committing.
- Creating a commit requires explicit user authorization and approval of the exact rendered message.
- Pushing requires explicit authorization. One request may explicitly authorize both commit and push, but either action alone never implies the other.
- A request to push an existing commit does not authorize staging or committing workspace changes.
- Treat every existing staged, unstaged, and untracked change as valuable. Never silently include, unstage, discard, or call it user-owned without evidence.
- If actual-mode staging occurred but approval is withheld, preserve that index and report it; do not undo it automatically.
- Never amend, reset, delete, or replace a created commit after a hook, comparison, verification, check, or push failure.

## Attempt directory

Create every attempt at an absolute path outside the repository and outside any nested worktree, such as `<system-temp>/commit-workflow/attempt-001`. Never place the attempt under the working tree. Every regenerated snapshot uses a new numbered attempt; never overwrite a temporary or preparation index.

Keep the optional `scope.json`, manifest, inspection artifacts, semantic content, rendered message, checks, verification, optional publication result, and reports together until the transaction finishes. The helper never removes attempts. Retain them by default and remove them only when the user or an applicable retention policy authorizes cleanup.

These files are mutable workflow records, not tamper-evident evidence. Do not hand-edit generated manifests, ledgers, verification, publication, or report artifacts. Hash, canonical-rendering, and Git-object comparisons detect defined inconsistencies; they do not authenticate the artifacts against deliberate replacement.

In commands below, `<skill>` is this installed skill directory and `<attempt>` is the current external attempt directory. Use the bundled executable directly. Do not recreate its behavior with ad hoc shell, PowerShell, Python, or JavaScript.

## 1. Establish intent, repository policy, and scope

Read the repository instructions that apply to the work, including any commit-message convention. Then inspect the complete state without changing it:

```text
git status --porcelain=v2 --branch --untracked-files=all
```

Classify both mode and scope:

| User intent | Mode | Scope |
| --- | --- | --- |
| Draft the current staged snapshot | `draft` | `staged` |
| Draft every current change | `draft` | `full` |
| Draft a task-bounded set of whole paths | `draft` | `paths` |
| Commit the current staged snapshot | `actual` | `staged` |
| Commit every current change | `actual` | `full` |
| Commit a task-bounded set of whole paths | `actual` | `paths` |

Apply these rules:

- Use `staged` for an existing staged subset or partial hunks. Describe only that patch, even when the same path has unstaged edits.
- Use `full` only when the user clearly means every non-ignored change. A large scope is not a reason to reduce it.
- Use `paths` only for task-bounded whole paths. For mixed intended and unrelated hunks in one path, require an intentional index and use `staged`.
- Actual `paths` refuses any pre-existing staged change rather than combining scopes.
- For an unstaged rename in `paths`, include the vanished source and current destination. For an already-staged rename, use `staged` without restaging its source.
- `scope.json` uses repository-relative, slash-separated UTF-8 Git paths, never absolute paths. For a non-UTF-8 path, use an already prepared `staged` scope or an unambiguous `full` scope.
- If existing staging makes scope ambiguous, ask before mutation.

For `paths`, write:

```json
{
  "paths": [
    "path/to/first-file",
    "path/to/deleted-or-current-file"
  ]
}
```

The helper sends each value to Git as a literal NUL-delimited path. Do not shell-quote paths or treat rename display labels as later pathspecs.

## 2. Create the exact snapshot

Run:

```text
node <skill>/scripts/commitWorkflow.mjs snapshot create --mode <actual|draft> --scope <staged|full|paths> [--scope-file <attempt>/scope.json] --output <attempt>/snapshot.json
```

The helper rejects unresolved conflicts and active merge, rebase, cherry-pick, revert, or sequencer state before mutation. It also rejects an empty scope.

Scope behavior is exact:

- Actual `staged` and draft `staged` read the real index without restaging it.
- Actual `full` and `paths` prepare and validate the target tree in a temporary index, write the snapshot, recheck `HEAD`, operation state, conflicts, and the original real-index tree, then install the completed tree into the real index in one final Git operation. A preparation or output failure before that installation leaves the real index unchanged.
- Actual `paths` includes only the literal whole-path set and requires an initially empty real index.
- Draft `full` and draft `paths` stage into a temporary index beside `snapshot.json`; the real index remains unchanged.

The manifest records pre-snapshot `HEAD`, the index tree, source index, fixed diff policy, raw path identities, normalized change units, and binary-aware statistics.

Copy detection is disabled: a retained-source destination is an addition. A detected rename counts once, but similarity does not prove the command or provenance.

## 3. Inspect every recorded change

Prepare bounded review artifacts:

```text
node <skill>/scripts/commitWorkflow.mjs inspection prepare --manifest <attempt>/snapshot.json --output-dir <attempt>/inspection
```

Read `inspection/inventory.md` first for scale and artifact counts. It is a bounded overview, not the exhaustive file list. Then read every pending artifact in `inspection/ledger.json`, in ledger order, with a native file-reading tool:

- inventory pages contain the exhaustive change-unit inventory;
- text-patch artifacts contain the complete staged patch in contiguous byte order; and
- binary and submodule artifacts contain the metadata Git can establish.

Every artifact is at most 200 lines and 16 KiB. The splitter prefers line and valid UTF-8 boundaries; an overlong logical line continues in adjacent byte-ordered artifacts. Metadata does not prove unseen binary or submodule contents, so inspect them separately when a rationale depends on them.

After fully reading one artifact, acknowledge its exact ID and recorded hash:

```text
node <skill>/scripts/commitWorkflow.mjs inspection acknowledge --ledger <attempt>/inspection/ledger.json --id <unit-id> --sha256 <recorded-sha256>
```

Check progress with:

```text
node <skill>/scripts/commitWorkflow.mjs inspection status --ledger <attempt>/inspection/ledger.json
```

Never acknowledge an unread or truncated artifact. Rendering requires every ledger entry reviewed and binds the ledger to the manifest tree. Do not use one unbounded `git diff HEAD` response as the sole inspection evidence.

## 4. Scaffold and author the message

Run:

```text
node <skill>/scripts/commitWorkflow.mjs message scaffold --manifest <attempt>/snapshot.json --output <attempt>/content.json --template <attempt>/commit-message.template.txt
```

The template is intentionally invalid while placeholders remain. Read [Commit message format](references/message-format.md), then edit only semantic fields in `content.json`. The renderer owns mechanical structure; the agent owns grounded, WHY-first meaning. Known lineage such as "adapted from" belongs in a rationale only when the request or inspected evidence establishes it; never infer lineage from content similarity. Ask when a material reason is unknown, and never invent claims.

## 5. Use detailed or bulk file changes

Use the mode selected by the scaffold: detailed entries for `1-49` change units or counted semantic domains for `50` or more. The reference defines the WHY requirement, subject grammar, numbering, alignment, domain construction, and bulk-mode limits. Do not override those rules by editing rendered text.

## 6. Render, validate, and present

After the ledger is complete and semantic fields are filled, run:

```text
node <skill>/scripts/commitWorkflow.mjs message render --manifest <attempt>/snapshot.json --content <attempt>/content.json --ledger <attempt>/inspection/ledger.json --output <attempt>/commit-message.txt
```

Then run the manifest-backed canonical validator:

```text
node <skill>/scripts/commitWorkflow.mjs message validate --manifest <attempt>/snapshot.json --content <attempt>/content.json --ledger <attempt>/inspection/ledger.json <attempt>/commit-message.txt
```

Exit `0` means there are no blocking validation errors, not necessarily that review is complete. Always read the emitted JSON; when `manualReviewRequired` is `true`, inspect every `review` issue before presenting the message and shorten any divisible overlong text. Exit `1` is a structured negative result: correct the named canonical or inspection problem, rerender when semantic input changes, and validate again. Exit `2` means a command, input, Git, renderer, schema, or artifact failure. The validator route that rereads mutable scope without all three manifest arguments is outside this workflow and is not sufficient evidence.

For a draft-only request, present the exact validated `commit-message.txt` and invite prose revisions; do not ask for commit approval. For actual mode, present that exact file and request approval to create the commit.

For message-only revisions, edit `content.json`, rerender, and revalidate against the existing artifacts; never restage, reinspect, or hand-edit generated output. Apply the reference's rule for legacy copies, or stop if the renderer remains inaccurate.

A later request to commit a previously drafted message starts a new actual-mode attempt. Never treat a draft temporary index or old inspection ledger as commit authorization or current-state proof.

## 7. Reverify and create the approved commit

Only continue when the user authorized a commit and approved the exact rendered message. Immediately before committing, run:

```text
node <skill>/scripts/commitWorkflow.mjs snapshot verify --manifest <attempt>/snapshot.json
```

Exit `0` proves that repository root, `HEAD`, index tree, and operation state still match the approved snapshot. Exit `1` means drift: stop and create a fresh attempt, including new inspection, rendering, validation, and approval. Reclassify scope first. If the intended content is now deliberately staged, use `actual` plus `staged`; do not blindly rerun `paths` against a now-populated index. Exit `2` means an execution or artifact failure.

Create the commit without path arguments and without bypassing hooks:

```text
git commit --cleanup=verbatim -S -F <attempt>/commit-message.txt
```

If this command fails, stop. Do not retry unsigned, restage, verify, report success, or push. If it succeeds, immediately record the exact created object ID:

```text
git rev-parse --verify HEAD
```

Do not perform normal restaging between approval and commit. Hooks may still reject the commit or alter its final tree or message; the report compares the actual commit with the approved artifacts. Preserve any mismatch for the user instead of amending it automatically.

## 8. Apply signature-verification policy

For every actual commit, read [Signature verification](references/signature-verification.md) before this step. Commit signing, signature validity, and identity authorization are separate facts. Verification defaults to `required`, but the user may change it to `advisory` or `skipped` at any point. Accept the override once without insisting or silently changing policy.

Run the exact created object ID:

```text
node <skill>/scripts/commitWorkflow.mjs signature verify --commit <commit-oid> --initial-policy required --policy <required|advisory|skipped> --output <attempt>/verification.json
```

- `required` must produce the backend-appropriate `verified` result described in the reference before this workflow may push.
- `advisory` attempts verification and reports its result, but that result alone does not block an authorized push.
- `skipped` invokes no verifier and must never be described as verified.

If verification fails or the SSH trust source is unavailable, follow the reference's narrow remediation and reporting rules. The generated artifact records the full verified commit OID, and report generation rejects an artifact for another commit. Never amend, reset, delete, or replace the created commit because of the result.

If the user changes policy after an earlier verification run, rerun the command for the same `<commit-oid>` with `--initial-policy required` and the selected final `--policy`. Use the replacement `verification.json` for every later report and push gate. If the user chooses `advisory` or `skipped` instead of granting access to an unreadable trust source, stop requesting that access.

## 9. Record checks and generate the report

Record only checks actually run in `checks.json`. Use status `passed` or `failed` and exactly one truthful execution context: `approved staged snapshot`, `current working tree`, `isolated worktree/container`, or `external environment`.

```json
{
  "schemaVersion": 1,
  "checks": [
    {
      "label": "Focused Node tests",
      "status": "passed",
      "context": "current working tree"
    }
  ]
}
```

Use an empty `checks` array when no check ran. Do not label a check `approved staged snapshot` unless it ran against an environment materialized from that exact tree.

Before any full-workflow push, generate the local result report without a publication argument:

```text
node <skill>/scripts/commitWorkflow.mjs report create --commit <commit-oid> --manifest <attempt>/snapshot.json --approved-message <attempt>/commit-message.txt --verification <attempt>/verification.json --checks <attempt>/checks.json --output-json <attempt>/report.json --output-text <attempt>/report.txt
```

Exit `0` means parent shape, tree, and stored message match the approved transaction. Exit `1` writes the report but identifies at least one mismatch; preserve the commit, present the anomaly, and do not push without new direction. Exit `2` means the report inputs or Git inspection failed.

The report reads actual commit identity, signature presence, parent, tree, message, statistics, checks, publication, and remaining porcelain state. Present the exact `report.txt`; do not add an `Includes...` synopsis, duplicate the full file inventory, infer checks, or describe excluded files as user-owned without explicit evidence.

## 10. Push the exact commit only when authorized

For a full-workflow push, continue only when the user authorized it, the pre-push report returned `0`, the active verification policy permits it, and no unresolved command failure remains. A verification failure explicitly resolved by the user's advisory or skipped override is resolved for this gate.

Resolve one configured remote name and one full destination branch ref. Use the existing unambiguous upstream when the user asked simply to push; ask when no upstream exists, the destination is ambiguous, or the user named a different target. Do not set an upstream or edit configuration as part of this workflow.

Run the helper with the full created object ID and full destination ref:

```text
node <skill>/scripts/commitWorkflow.mjs publication push --commit <commit-oid> --remote <remote-name> --destination <refs/heads/branch> --output <attempt>/publication.json
```

The helper executes a non-force `git push --porcelain` for exactly `<commit-oid>:<destination>` and writes `<publication.json>.pending` before invoking Git. Exactness refers to the destination tip; Git still transfers reachable objects as needed. Exit `0` records `pushed`; exit `1` records Git's failed result. Never retry automatically. For exit `2`, a remaining journal, or a later user-authorized retry after exit `1`, follow [Publication recovery](references/publication-recovery.md).

Regenerate the report with the recorded result:

```text
node <skill>/scripts/commitWorkflow.mjs report create --commit <commit-oid> --manifest <attempt>/snapshot.json --approved-message <attempt>/commit-message.txt --verification <attempt>/verification.json --checks <attempt>/checks.json --publication <attempt>/publication.json --output-json <attempt>/report.json --output-text <attempt>/report.txt
```

Present the exact final `report.txt`. For a later push request with incomplete original artifacts, read and follow [Publication recovery](references/publication-recovery.md) before any network mutation.
