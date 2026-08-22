# Publication recovery

Read this reference before every `publication push`, when a `.pending` journal remains, when the user requests a retry, or when a later push request lacks an original transaction artifact.

## Standard publication

Continue only when the user authorized push, the full-workflow pre-push report returned `0`, the active verification policy permits publication, and no unresolved command failure remains. A verification result explicitly resolved by the user's advisory or skipped override is resolved for this gate.

Resolve one configured remote name and one full destination branch ref. Use the existing unambiguous upstream for a plain push request. Ask when no upstream exists, the destination is ambiguous, or the user named a different target. Do not set an upstream or edit configuration.

Run `publication push` with the full created object ID, remote name, full `refs/heads/...` destination, and a fresh output path. The helper executes non-force `git push --porcelain` for exactly `<commit-oid>:<destination>` and writes `<publication.json>.pending` before invoking Git. Exactness describes the destination tip; Git transfers every reachable object it needs.

Exit `0` records `pushed`. Exit `1` records Git's failed result. Exit `2` without a journal is a pre-invocation rejection; exit `2` with a journal is an unknown remote outcome. Never retry automatically.

Every authorized retry uses the next unused output path, such as `<attempt>/publication-attempt-002.json`. Preserve every earlier result and journal. Never reuse or overwrite an existing publication path; after a successful or failed retry, pass the newest completed result to `report create --publication`.

## Unknown publication outcome

The helper writes `<publication.json>.pending` before invoking Git. Exit `2` with no pending journal means it rejected the operation before push invocation. Exit `2` with the journal means the remote outcome is unknown; a network update may have occurred before the final artifact could be written.

Preserve the journal and do not retry automatically. Compare the exact destination with:

```text
git ls-remote --refs <remote> <destination>
```

If the returned OID matches, report only that the destination points at the intended commit at the time of observation; this does not prove that the failed helper attempt performed the update. If it is absent or different, report that observation and ask whether to retry the same exact non-force publication using the fresh output rule above. Never infer remote state from a local tracking ref.

## Later push with missing artifacts

For a later push request, regenerate a missing pre-push report when the full commit OID, original manifest, approved message, verification artifact, and checks artifact are all available; the regenerated report must return `0`.

If any required input is missing or unreadable, use only this reduced-assurance exception:

- Disclose which snapshot, message, verification, or check assurances cannot be reproduced. Do not reconstruct them from current workspace state.
- Continue without another authorization prompt only if the request already identifies an unambiguous source commit or ref and destination. Otherwise ask for the missing target information.
- Resolve that user-selected source once to a full commit OID. Use `HEAD` only when the user explicitly selected current `HEAD`; never guess a source from the checked-out branch.
- Apply the active signature-verification policy to that exact OID, then run only `publication push`. Report its durable result and state that the full transaction workflow was not reverified.

This exception waives only the unavailable manifest, approved-message, checks, and pre-push-report gates. It never waives explicit push authorization, exact-OID targeting, signature policy, or durable publication evidence.
