# Workflow state storage

`workflow prepare` selects where workflow state lives.
The choice is made once, at preparation; later commands follow the returned handle.

| Storage            | Selection                                                | State                                                                        |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `memory` (default) | No flag, or `--state-storage memory`                     | Process memory only; preparation returns a caller-held `proposal`            |
| `disk`             | `--state-storage disk --state-directory <absolute-path>` | A recoverable transaction beneath the named directory; returns `transaction` |

Disk storage never falls back to the operating system's temporary directory.
`--state-directory` with memory storage, a relative directory, or disk storage without a directory is `invalid-input`.
Use a directory the user or repository instructions name; otherwise ask.

## Memory storage

Memory preparation reads Git and process memory only.
Before the authorized commit it creates no file or directory, writes no Git object, and leaves the index, refs and working tree unchanged.
Interrupted work needs no recovery: prepare again.

It supports `staged` and `full` scope, uniform `message` or `reuse` evidence (or an evidence plan whose single `message` group covers the whole scope), and the concise route.
Full scope observes at most 128 untracked paths of at most 512 bytes each and rejects submodule changes and untracked embedded repositories.

The `proposal` is an opaque, self-contained value that binds approval to the head anchor and the exact final state of every changed path.
It is not authority: every later command recomputes those facts from the repository.

| Step                 | Command                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| Check body text      | Pipe the message to `message check --proposal <proposal>`; show the returned `displayText`               |
| Commit a subject     | `workflow commit --proposal <proposal> --message <transport-safe-subject>`                               |
| Commit checked bytes | Pipe the same bytes to `workflow commit --proposal <proposal> --message-stdin --message-sha256 <digest>` |

Commit recomputes the scope and rejects any difference with `PROPOSAL_STALE` before mutation.
Full scope then runs `git add -A` and requires the staged result to equal the proposal; a difference stops with the index updated and nothing committed.
The commit itself is `git commit --cleanup=verbatim -S -F -`, so hooks and signing behave as on disk storage.
The result reports `commit.parentMatches`, `treeMatches`, `messageMatches`, `signed` and `verification`; no report file exists.

A memory draft is never committed; prepare again with `--mode actual`.
Witnessed checks, review packets, report detail, resume, recovery and helper publication require disk storage.

## Diagnostics

| Code                             | Meaning and remedy                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `STATE_STORAGE_REQUIRES_DISK`    | The route needs durable state; `details.reason` names it. Prepare again with disk storage.          |
| `PROPOSAL_STALE`                 | HEAD, index or working tree changed; nothing was mutated. Prepare again and approve the new result. |
| `INVALID_PROPOSAL`               | The value is not an unmodified proposal from `workflow prepare`.                                    |
| `PROPOSAL_REPOSITORY_MISMATCH`   | The proposal belongs to another working tree.                                                       |
| `MESSAGE_DIGEST_MISMATCH`        | Piped bytes differ from the checked `messageSha256`; pipe the approved bytes.                       |
| `DRAFT_PROPOSAL_NOT_COMMITTABLE` | Prepare again with `--mode actual`.                                                                 |
| `GIT_COMMIT_FAILED`              | `git commit` failed and HEAD is unchanged; `details.stderrTail` and `indexUpdated` explain it.      |
| `COMMIT_OUTCOME_UNKNOWN`         | `git commit` failed but HEAD moved; inspect HEAD before another commit.                             |
| `POST_COMMIT_OBSERVATION_FAILED` | The commit exists but its comparison or verification did not finish; inspect it.                    |
| `STATE_DIRECTORY_REQUIRED`       | Disk storage needs an absolute `--state-directory`.                                                 |

## Disk authoring

Obey `nextAction`: `author-message` uses `messagePath` (`message-input.txt`) and `message check`; null `contentPath` is expected.
`author-content` uses `contentPath` (`content.json`), versioned `contentContract`, and `message finalize`.
Preserve `schemaVersion`, `evidenceGroups`, and `mode`.
Supported sections are `Rationale:`, `User Experience Changes:`, and `File Changes:`; resolve others before approval and fix aggregate diagnostics by exact JSON pointer together.
New uncertainty uses fixed `evidence-plan-input.json`.
`workflow extend --reason semantic-structure-required` requires `route: concise`, `phase: evidence-ready`; otherwise follow `nextAction`.
For `evidence-required`, traverse bounded delta, then finalize.
`authoring-pending` means evidence is complete but approval bytes are unavailable; an older revision cannot commit.
