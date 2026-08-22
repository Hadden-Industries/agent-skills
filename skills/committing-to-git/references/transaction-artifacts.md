# Transaction Artifacts

Read this reference before every snapshot attempt. It defines attempt allocation, same-worktree concurrency, artifact retention, and which workflow records may change.

## Allocate one attempt

Obtain one genuine UUIDv4 from a cryptographically secure platform API; do not type, predict, or imitate it. Form the absolute directory name `<system-temp>/committing-to-git-<uuid-v4>`, where `<system-temp>` is the operating system's temporary directory. Create that exact directory directly with one exclusive, non-recursive directory-creation operation. Do not check whether it exists first.

If creation reports `EEXIST`, discard that UUID and retry with a newly generated UUIDv4. For every other failure, stop and report it. Once creation succeeds, use the path immediately. Do not add an ownership file, allocation record, numbered handover, discovery scan, registry, heartbeat, or stale-attempt protocol.

Never place an attempt under the working tree, share it between transactions, or reuse it for a regenerated snapshot. A fresh snapshot always receives a fresh directory. The skill prefix makes it recognizable; the CSPRNG UUID and exclusive creation make allocation collision-safe.

## Serialize Git state

Unique scratch directories do not isolate Git state. Do not deliberately overlap transactions in one worktree or run mutating helper commands concurrently within one attempt. The helper neither discovers other attempts nor holds a cross-command lock, so do not invent a persistent lock, registry, or handover.

If overlap becomes known, stop further mutation in both transactions. The coordinating agent or user must designate exactly one survivor; resume only that transaction. After it finishes or stops, preserve the loser and restart it from current repository state in a fresh UUID attempt. Git's operation locks reject simultaneous low-level mutations; later snapshot verification detects drift between commands and across approval pauses.

## Retain and classify artifacts

Keep the optional `scope.json`, manifest, inspection artifacts, semantic content, rendered message, checks, verification, optional publication result, and reports together until the transaction finishes. The helper never removes attempts. Retain them by default and remove them only when the user or an applicable retention policy authorizes cleanup.

These files are mutable workflow records, not tamper-evident evidence. Do not hand-edit generated manifests, ledgers, verification, publication, or report artifacts. Hash, canonical-rendering, and Git-object comparisons detect defined inconsistencies; they do not authenticate the artifacts against deliberate replacement.

The following operations are create-only:

- snapshot creation;
- inspection preparation;
- message scaffolding; and
- publication result creation.

Snapshot creation also reserves one fixed helper-owned intermediate beside `snapshot.json`: `temporary-index` for draft `full` or `paths`, or `preparation-index` for actual `full` or `paths`. A failed Git command can leave that file behind before the manifest exists, and the helper will refuse to reuse it.

If a create-only target or reserved intermediate is occupied, preserve the attempt unchanged and start a fresh UUID attempt. Reclassify current state first. Use actual `staged` for an index populated by a successful prior snapshot only when `snapshot verify` still exits `0` for that manifest. Otherwise scope provenance is ambiguous, so ask before mutation. Never delete an intermediate to reuse an attempt, undo the index, or blindly retry `paths`.

Within an established attempt:

- `scope.json` may change only before snapshot creation;
- `content.json` may receive semantic revisions;
- `commit-message.txt` may be rerendered;
- `checks.json` may record additional checks actually run;
- `verification.json` may be replaced after a policy change for the same commit; and
- reports may be regenerated.

No other generated target is replaceable.
