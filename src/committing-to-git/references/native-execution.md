# Native execution for large snapshots

`workflow commit --execution native` explicitly requests the supported native signed Git route. It retains the helper's transaction journal, checks, complete inventory and verification receipts. The default `auto` uses the same native executor; this selector changes neither behavior nor authority. Preparation reports `commitExecution.selection: snapshot-capacity` above the former 8 MiB snapshot limit. Retry eligibility always comes from transaction state, never from changing this selector.

The 8 MiB caller JSON limit is separate from the 64 MiB recorded-snapshot bound. Snapshot size describes serialized inventory metadata, not changed-file bytes or message length. Snapshot reads use budget-checked allocation, bounded reads, stable file identity, digest checks and transaction anchors. The full inventory is parsed in memory within that bound; this is not unlimited or constant-memory processing. New preparation rejects unsupported capacity before installing an actual index or acquiring evidence.

## Continue an existing prepared transaction

For the older `MESSAGE_INPUT_TOO_LARGE` diagnostic whose message identifies **Recorded snapshot**, preserve the transaction, scope, evidence and authoring input. With a helper supporting this route, continue the same operation:

1. In `authoring-pending`, complete the supplied `content.json` and call `message finalize --transaction <transaction>`; an `author-message` action instead uses its fixed message input and `message check`. Keep complete bulk domain coverage. A failed finalization has not consumed the input.
2. Honor required evidence and checks. Show finalized `displayText` and reuse existing exact-byte approval when it still matches. Reapprove changed bytes.
3. Once `message-ready` and the exact commit is authorized, run:

   ```text
   node <skill>/scripts/commitWorkflow.mjs workflow commit --transaction <transaction> --execution native
   ```

This is a method continuation under existing authority, not a new permission request or a reason to prepare another transaction. A concise transaction can use its approved transport-safe `--message` as usual. Switching executors does not authorize a commit, non-passing checks, signature-policy changes or pushing. If the available helper does not support this operation, report that concrete capability gap; this reference does not authorize editing installed artifacts.

## Guarantees and recovery

Native execution preserves the exact staged tree (including partial staging and exclusions), parent/ref anchor, canonical message bytes, required check receipts, signing and ordinary Git hooks. It invokes signed `git commit`, then verifies the resulting full OID, parent, tree, message and required signature. Hook-altered commits remain recorded mismatches. There is no difference in receipt guarantees from ordinary helper-managed commits; no synthetic receipts or manual adoption are needed.

An absent commit with unchanged valid authoring state may continue finalization. A `commit-pending`, unknown or created outcome instead follows `workflow recover --transaction <transaction>`. Never repeat commit to discover whether it succeeded. Recovery observes the recorded attempt; it cannot create a second commit. Explicit process-liveness resolutions retain their ordinary confirmation requirement.

`SNAPSHOT_CAPACITY_EXCEEDED` identifies the separate 64 MiB implementation bound and returns a prerequisite: retain the complete transaction and obtain a helper implementation supporting that capacity. Do not shrink the message, omit files, split the commit, edit limits or repository configuration as recovery. Permission denials, mandatory-check failures and signing failures use their own recovery; native execution provides no bypass for them.
