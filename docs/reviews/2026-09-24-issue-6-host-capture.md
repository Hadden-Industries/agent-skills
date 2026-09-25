# Issue 6: shell capture diagnosis and regression evidence

The confirmed cause was the consumer parsing a merged shell capture as helper
stdout. The original helper's one-JSON-value stdout contract held, but its
ancillary stderr was incompatible with this host's normal capture. The initial
documentation workaround below was superseded on September 25: the helper now
owns quiet JSON output and diagnostic retrieval. No HISEW change is required.

## Affected package reproduction

On Windows / PowerShell, the installed
`committing-to-git@0.1.0-dev.g8bbee1681f160f3f` helper was exercised through public
`workflow prepare`, `workflow commit` and `workflow publish` commands in a
disposable repository, with a generated SSH signing key, trusted allowed-signers
file and local bare publication remote. A remote hook emitted a diagnostic.

Implementation SHA-256:
`acc3f5fea6add2f3554b700d434862c043b23d02e6a6ad681c25054936fe82b1`.

| Operation | Exit | Stdout bytes | Stderr bytes | Entire stdout parses | Combined bytes parse |
| --- | --- | --- | --- | --- | --- |
| Prepare | 0 | 2023 | 0 | Yes | Yes |
| Signed commit | 0 | 4843 | 131 | Yes | No |
| Publication | 0 | 5980 | 192 | Yes | No |

Each stdout capture equalled `JSON.stringify(result) + "\n"`. Commit stderr
contained the Git commit summary. Publication stderr contained the remote hook
diagnostic and push porcelain output. Signature verification succeeded and the
remote ref equalled the returned commit OID. Separate stream files and an evidence
record were retained in the diagnostic fixture.

Replaying those captured commit bytes through the actual Codex `exec_command`
interface reproduced `JSON.parse(result.output)` failure with exit 0. This replay
performed no Git mutation. It isolates the host's merged capture from the helper's
separated streams; the original production transaction was never replayed.

## Initial workaround (superseded)

The canonical skill routes merged-stream hosts to the executable Node capture
recipe in `references/diagnostics.md`. It preserves both streams in a fresh
directory, retains an envelope before returning it, and leaves helper arguments,
exit codes and workflow result semantics intact. Capture loss invokes retained
output inspection and public transaction recovery, never automatic commit/push
replay.

The documented wrapper was also used for a fresh signed commit and publication
through actual Codex `exec_command` calls. Parsing the entire returned output as
the envelope, then its stdout as the workflow result, succeeded for both. The
commit returned `created`; publication returned `published` for the same OID.
The retained diagnostic streams contained 128 and 192 bytes respectively.

## Built-in remedy and repeatable checks

JSON mode now emits no child diagnostics on stderr. The ordinary CLI returns one
workflow result even when the host merges streams. Human text mode retains
diagnostic streaming. Automatic JSON commit/recovery compaction retains process
logs, and results point to the existing report-detail command with a diagnostics
section. It verifies complete transcript hashes using bounded memory and returns
bounded previews with omission counts. Public recovery/report commands use the
existing durable transaction; callers create no wrapper or transport envelope.

Run `node --test tests/committing-to-git/host-capture.test.mjs`. The tests invoke
the packaged CLI directly in disposable Git repositories. They cover signed
commit/publication, remote rejection, required verification failure after a known
commit, public recovery without another commit, bounded retained diagnostics,
corrupt evidence rejection, invalid input and human text output. The replacement
tests first failed on the old helper's Git stderr output.

Live Codex calls also exercised the rebuilt CLI directly on September 25. A
fresh signed commit and push to a disposable bare remote each parsed with one
`JSON.parse(result.output)`. The public diagnostics command returned the commit
summary and remote hook message from retained, hash-verified transcripts.

These are deterministic integration checks. They do not establish behavioral
evaluation across agents or execution on other operating systems.
