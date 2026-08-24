# Transaction Recovery

Read this reference only after a permission, lock, partial-phase, commit-pending, or unknown-outcome result. The transaction handle is opaque: pass it to the named helper without reading or repairing its files.

## Preparation and permissions

When the host declares `.git` read-only, acquire the narrow required metadata capability before an actual preparation or commit command. If the boundary was not disclosed and preparation reports a permission failure, use `workflow recover` for an index-installation journal when directed, then `workflow resume`. Resume uses persisted scope, evidence, policy, snapshot, and head anchors; never reconstruct the command, broaden scope, or allocate a replacement attempt.

An existing `index.lock` with a live or unclassified owner is concurrency. Wait or ask the user; never delete it, relabel it as a sandbox denial, or treat capability approval as lock ownership. After the collision is resolved, use only the helper-recommended resume or fresh-preparation route.

A failure before an irreversible journal may be a known no-mutation stop. A missing deterministic derived artifact can be regenerated from the unchanged durable anchor. A changed tree, scope, head anchor, or source identity requires fresh preparation and fresh exact approval.

## Pending or unknown commit

Run only:

```text
node <skill>/scripts/commitWorkflow.mjs workflow recover --transaction <opaque-transaction> [--resolution confirmed-no-live-child]
```

Recovery observes the exact ref, head anchor, journal, and candidate commit; it never launches `git commit`. If the journal says `launching` or `running` and the ref is unchanged, the outcome remains unknown. Supply `confirmed-no-live-child` only after the user explicitly confirms that the Git, hook, and signer processes ended or that the host restarted. An unchanged ref by itself is not that confirmation.

If recovery identifies a matching created commit, preserve it and continue only through the reported `workflow verify` or reporting phase. If it proves no commit was created, follow the returned permitted next action. Never repeat a known or unknown commit transition.

Child stdout/stderr is bounded in the envelope. Use the complete hashed failure-log pointer only when diagnosis needs omitted bytes; do not print an unbounded log into the conversation. Normal terminal compaction removes safe bulk while preserving the durable report, message hash, journals, and detail-query state. Exact `workflow cleanup --purge` is allowed only for a helper-confirmed safe terminal attempt or explicit abandonment before commit; it refuses pending/unknown mutations and path-link substitutions.
