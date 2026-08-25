# Inspection Recovery

Read this reference only after `workflow prepare`, `workflow extend`, or `message finalize` reports unresolved inspection evidence, or after `workflow review-next` rejects a packet. Do not load it on the concise happy path.

## Packet traversal

Use the transaction-bound reader, never raw queue or packet paths, on the normal path:

```text
node <skill>/scripts/commitWorkflow.mjs workflow review-next --transaction <opaque-transaction> [--cursor <opaque-cursor>]
```

The first call has no cursor. Each success returns exactly one complete packet of at most 16 KiB, its verified identity, cumulative progress, and either an opaque `nextCursor` or `complete: true`. Read that complete packet before requesting the next one. Pass back only the exact cursor; do not decode, alter, invent, or use it as a path. Repeating the request that produced the latest packet replays the same packet and progress, while an earlier stale cursor fails without advancing. The helper records the current catalog-bound receipt only after every required packet has been delivered. Delivery integrity does not prove actual understanding.

If output is truncated despite the command's result budget, replay the same request; do not advance from a partial response. If the helper reports replacement, byte-count, digest, catalog, or encoding failure, stop with corruption. Do not manually acknowledge a raw artifact, edit the catalog or transaction, or reconstruct evidence from a partial response. Returned fallback artifact paths are transaction-directory-relative and include `review/`, but direct reads are diagnostic only and can never create a receipt. `workflow resume` may regenerate only a deterministically missing derived phase from persisted inputs; it must not silently replace a changed artifact.

## Uncertain content

The manifest and synopsis establish exact scope, modes, object identities, and bounded statistics; they do not establish semantics. If those facts leave one selection unknown, use a compact, non-overlapping `review` group for that selection. If uncertainty appears after concise preparation, write the revised mixed plan only to fixed transaction-local `evidence-plan-input.json`, then run `workflow extend --reason evidence-uncertainty`. This preserves the same snapshot and materializes only the new evidence delta.

Whole-file deletions normally use grounded synopsis facts rather than rereading removed bodies. Expand historical content only when the deletion is consequential and its purpose or effect cannot otherwise be explained. Ask the user instead if reading the old blob would exceed authority. Never infer deleted behavior from a path alone.

Binary content has exact path, object, size, and Git metadata boundaries but no invented text semantics. A gitlink records the superproject entry and old/new commit identities; it does not mean the nested repository was inspected. State that boundary. A rename is a Git similarity classification, not proof of the command, provenance, or copy relationship.

After `reviewProgress.complete`, choose concise checked text unless a requested or useful body requires structured finalization. Review receipt and presentation recommendation are helper-owned transaction state, not editable `content.json` members. If finalization returns `evidence-required`, traverse that bounded delta through `workflow review-next` and invoke the same finalizer again. Never restart full review merely because evidence was extended.
