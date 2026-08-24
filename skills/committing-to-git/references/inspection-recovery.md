# Inspection Recovery

Read this reference only after `workflow prepare`, `workflow extend`, or `message finalize` reports unresolved inspection evidence, or after a returned packet cannot be read and verified exactly. Do not load it on the concise happy path.

## Packet traversal

Use only the bounded `reviewQueue` or delta-queue pointers returned by the helper. Resolve each returned relative queue or packet artifact beneath the directory containing the opaque transaction handle; never read or edit `transaction.json`. Read one queue page and then one listed packet at a time, verify that the complete bytes were returned, and follow the recorded next-page pointer. Do not batch packet reads. There is no acknowledgement command: packet identities are sealed into the later receipt, while actual understanding remains the agent's responsibility.

If a queue page or packet is truncated by the host, retry that exact bounded read with a tool mode that can return the full file. If bytes or SHA-256 differ, stop with corruption; do not accept a replacement packet, edit the catalog, or reconstruct evidence from a partial response. `workflow resume` may regenerate only a deterministically missing derived phase from persisted inputs. It must not silently replace a changed artifact.

## Uncertain content

The manifest and synopsis establish exact scope, modes, object identities, and bounded statistics; they do not establish semantics. If those facts leave one selection unknown, use a compact, non-overlapping `review` group for that selection. If uncertainty appears after concise preparation, write the revised mixed plan only to fixed transaction-local `evidence-plan-input.json`, then run `workflow extend --reason evidence-uncertainty`. This preserves the same snapshot and materializes only the new evidence delta.

Whole-file deletions normally use grounded synopsis facts rather than rereading removed bodies. Expand historical content only when the deletion is consequential and its purpose or effect cannot otherwise be explained. Ask the user instead if reading the old blob would exceed authority. Never infer deleted behavior from a path alone.

Binary content has exact path, object, size, and Git metadata boundaries but no invented text semantics. A gitlink records the superproject entry and old/new commit identities; it does not mean the nested repository was inspected. State that boundary. A rename is a Git similarity classification, not proof of the command, provenance, or copy relationship.

After reading every required packet, record only the fixed `content.json` review fields expected by the structured finalizer. If finalization returns `evidence-required`, read that bounded delta and invoke the same finalizer again. Never restart full review merely because evidence was extended.
