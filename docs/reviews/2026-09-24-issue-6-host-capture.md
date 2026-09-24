# Issue 6: shell capture diagnosis and regression evidence

The confirmed cause is the consumer parsing a merged shell capture as helper
stdout. The helper's one-JSON-value stdout contract holds. The integration remedy
belongs in committing-to-git's supported invocation guidance; no helper stream
change or HISEW change is required.

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

## Remedy and repeatable checks

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

Run `node --test tests/committing-to-git/host-capture.test.mjs`. The tests execute
the recipe extracted from the documentation against the packaged helper and real
disposable Git repositories. They cover successful signed commit/publication,
remote rejection, required verification failure after a known commit, retained
diagnostics, recovery from truncated host output and public recovery without an
additional commit. The successful case also asserts that the old combined-stream
parser fails on the actual helper bytes.

These are deterministic integration checks. They do not establish behavioral
evaluation across agents or execution on other operating systems.
