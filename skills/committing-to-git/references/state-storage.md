# Workflow state storage

`workflow prepare` selects where workflow state lives.
The choice is made once, at preparation; later commands follow the returned handle.

| Storage            | Selection                                                | State                                                                        |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `memory` (default) | No flag, or `--state-storage memory`                     | Process memory only; preparation returns a caller-held `proposal`            |
| `disk`             | `--state-storage disk --state-directory <absolute-path>` | A recoverable transaction beneath the named directory; returns `transaction` |

Disk storage never falls back to the operating system's temporary directory.
`--state-directory` with memory storage, a relative directory, or disk storage without a directory is `invalid-input`.
Retain memory storage when correcting invalid arguments; a stray directory does not authorize switching to disk.
Ask for a directory only after the user selects disk and neither the user nor repository instructions names one.

Message presentation and storage are separate choices.
Use the supported memory continuation when it meets the request; never allocate disk state to discover an alternative.
Only a verified required capability with no equivalent memory route permits proposing a storage switch.
Explain the blocker and proposed effects, then wait for the user's decision; an agent-supplied approval flag is not human consent.
Disk preparation creates a recoverable transaction, authoring and evidence files under the selected directory, may write Git objects, and may update the index for actual full/path scope.
An unrelated execution failure does not justify recommending disk.

## Memory storage

Memory preparation reads Git and process memory only.
Before the authorized commit it creates no file or directory, writes no Git object, and leaves the index, refs and working tree unchanged.
Interrupted work needs no recovery: prepare again.

It supports `staged`, `full`, and literal `paths` scope, uniform `message` or `reuse` evidence (or an evidence plan whose single `message` group covers the whole selected scope), and the concise route.
`--message-format detailed` uses the same checked stdin route, with exhaustive per-file validation, fewer than 50 units and the existing 32 KiB presentation limits.
The proposal retains that intent: both checking and committing reject a missing `File Changes:` inventory.
Execute `checkedAuthoring.arguments`, present exact `displayText`, and after approval use the returned commit arguments with the same bytes.
Full scope observes at most 128 untracked paths of at most 512 bytes each and rejects submodule changes and untracked embedded repositories.
Path scope applies observation limits to selected paths; unrelated working-tree files do not consume the selected evidence budget.
Native per-path untracked observation and selected message evidence require lossless UTF-8 path transport within 512 bytes.

Path selectors, their expanded final states, and selected index entries are bound in the proposal and rechecked.
Unrelated staged changes are allowed and preserved, including staging added after preparation.
Whole-path selection includes the selected files' entire current working-tree contents even when they are partially staged; use `staged` scope when only staged hunks are authorized.
The legacy disk executor retains its empty-index requirement for actual path preparation and rejects selected staged overlap in drafts; these restrictions do not apply to memory paths.

The `proposal` is an opaque, self-contained value that binds approval to the head anchor and the exact final state of every changed path.
It is not authority: every later command recomputes those facts from the repository.

| Step                 | Command                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Check body text      | Pipe the message to `message check --proposal <proposal>`; show the returned `displayText`               |
| Commit a subject     | `workflow commit --proposal <proposal> --message <transport-safe-subject>`                               |
| Commit checked bytes | Pipe the same bytes to `workflow commit --proposal <proposal> --message-stdin --message-sha256 <digest>` |

Commit recomputes the scope and rejects any difference with `PROPOSAL_STALE` before mutation.
Full scope then runs `git add -A` and requires the staged result to equal the proposal; a difference stops with the index updated and nothing committed.
Path scope stages only the selected whole paths, verifies their final staged states, and uses native `git commit --only` with a literal NUL-delimited path list, so unrelated staged entries remain outside the commit.
The path list uses a task-owned temporary file created only after commit authorization, with a 64 MiB transport bound; the checked message still travels through stdin.
The file and its exclusive directory are removed after the native Git process exits.
This transient transport does not retain a proposal, message, report, or recoverable transaction and needs no per-commit storage choice.
Hooks and signing remain enabled through `git commit --cleanup=verbatim -S -F -`.
The result reports `commit.parentMatches`, `treeMatches`, `messageMatches`, `signed` and `verification`; no report file exists.

A memory draft is never committed; prepare again with `--mode actual`.
Witnessed checks, review packets, report detail, resume, recovery and helper publication require disk storage.

## Diagnostics

| Code                                   | Meaning and remedy                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STATE_STORAGE_REQUIRES_DISK`          | A verified capability has no equivalent memory route; `details[0].reason` and `storageEffects` explain it. `human-decision` has no retry commands; wait for the user's storage choice. |
| `PROPOSAL_TOO_LARGE`                   | The proposal exceeds its transport budget; use the same human storage decision, without an automatic disk retry.                                                                       |
| `CORRECTION_FROM_REQUIRES_TRANSACTION` | Remove `--correction-from` and prepare again in memory; no retained transaction is needed.                                                                                             |
| `DETAILED_MESSAGE_LIMIT_EXCEEDED`      | The per-file presentation exceeds a storage-independent limit; preserve requested meaning and resolve the presentation requirement.                                                    |
| `DETAILED_INVENTORY_REQUIRED`          | Include the complete requested `File Changes:` inventory and check the message again.                                                                                                  |
| `PROPOSAL_STALE`                       | HEAD, index or working tree changed; nothing was mutated. Prepare again and approve the new result.                                                                                    |
| `INVALID_PROPOSAL`                     | The value is not an unmodified proposal from `workflow prepare`.                                                                                                                       |
| `PROPOSAL_REPOSITORY_MISMATCH`         | The proposal belongs to another working tree.                                                                                                                                          |
| `MESSAGE_DIGEST_MISMATCH`              | Piped bytes differ from the checked `messageSha256`; pipe the approved bytes.                                                                                                          |
| `DRAFT_PROPOSAL_NOT_COMMITTABLE`       | Prepare again with `--mode actual`.                                                                                                                                                    |
| `GIT_COMMIT_FAILED`                    | `git commit` failed and HEAD is unchanged; `details.stderrTail` and `indexUpdated` explain it.                                                                                         |
| `COMMIT_OUTCOME_UNKNOWN`               | `git commit` failed but HEAD moved; inspect HEAD before another commit.                                                                                                                |
| `POST_COMMIT_OBSERVATION_FAILED`       | The commit exists but its comparison or verification did not finish; inspect it.                                                                                                       |
| `PATH_SCOPE_TOO_LARGE`                 | Expanded selected paths exceed the 64 MiB native transport bound; nothing was changed.                                                                                                 |
| `PATH_TRANSPORT_CLEANUP_FAILED`        | Inspect HEAD, process closure, and the returned owned transport path before retrying; do not assume no commit was created.                                                             |
| `STATE_DIRECTORY_REQUIRED`             | Disk storage needs an absolute `--state-directory`.                                                                                                                                    |

`PATH_STAGING_FAILED` means no commit was attempted; inspect the reported selected-index changes from native staging.

## Disk authoring

Obey `nextAction`: `author-message` uses `messagePath` (`message-input.txt`) and `message check`; null `contentPath` is expected.
`author-content` uses `contentPath` (`content.json`), versioned `contentContract`, and `message finalize`.
Preserve `schemaVersion`, `evidenceGroups`, and `mode`.
Supported sections are `Rationale:`, `User Experience Changes:`, and `File Changes:`; resolve others before approval and fix aggregate diagnostics by exact JSON pointer together.
New uncertainty uses fixed `evidence-plan-input.json`.
`workflow extend --reason semantic-structure-required` requires `route: concise`, `phase: evidence-ready`; otherwise follow `nextAction`.
For `evidence-required`, traverse bounded delta, then finalize.
`authoring-pending` means evidence is complete but approval bytes are unavailable; an older revision cannot commit.
