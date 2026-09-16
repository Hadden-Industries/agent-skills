# Publication Recovery

Read this reference only after an unknown publication result, when a separately authorized retry is requested, or when a later push request has no matching transaction capsule. Pushing always requires explicit authorization separate from commit creation.

## Unknown result

Run `workflow recover --transaction <opaque-transaction>`. Recovery performs at most one bounded, read-only `ls-remote` observation for the exact configured remote and full destination ref. It never pushes. A success witnessed by the original child is `witnessed-success`; a matching remote OID found later is `observed-matching`. Report the distinction.

If the remote matches the exact recorded commit, publication is complete by observation. If the ref differs or is absent while the journal was `launching` or `running`, the result remains unknown because the child may still be live or delayed. Do not retry, change destination, or infer failure from an unchanged ref.

`confirmed-no-live-child` may resolve that uncertainty only after the user explicitly confirms that the Git process and its credential/signing children ended or that the host restarted. Once the helper records the resolution, a retry still requires new explicit push authorization for the same OID, remote, and destination. The fresh attempt must bind its predecessor:

```text
node <skill>/scripts/commitWorkflow.mjs workflow publish --transaction <opaque-transaction> --remote <name> --destination <refs/heads/name> --retry-after-attempt <resolved-attempt-id>
```

Never reuse an attempt ID, omit the binding, force push, or retry automatically. A known rejection is also not authorization to retry.

## No matching transaction

When a user asks to push an existing local commit but no matching transaction capsule survives, do not claim snapshot, exact-message approval, comparison, signature-policy, or report assurance that cannot be recovered. Do not inspect, stage, commit, or alter current workspace changes. Explain the missing assurance and offer limited guidance for an ordinary explicit-OID non-force push only if the user separately chooses a workflow outside this skill. This skill's `workflow publish` must honestly refuse without a matching reported transaction.
