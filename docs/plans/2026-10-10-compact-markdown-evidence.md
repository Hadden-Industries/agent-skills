# Compact hosted Markdown evidence adoption

Accepted follow-up to the shared Markdown centralization plan, section24.8.
Baseline: clean synchronized main `8bac0c3807d637355bb1acec6c2497ac04575c7c`.
HISEW R2 execution `b28bdecf-3a29-4a13-9ca2-9d9ea9a30b18`; accepted snapshot `c09ad9fe-77ca-474f-804a-d9ef594708e2`.

## Scope and invariants

Adopt qualified producer `2e619b8cd1024e3bd37a1452af55a2cdb9cd7867` by refreshing `tooling/markdown/source.json`, its exact development archives, isolated npm lock integrity, and the immutable reusable workflow pin together.
Use the producer's compact projection of complete receipts/results/logs and deduplicated staged manifests, retaining hidden paths and empty directories without uploading staged source copies.
Set the caller's `qualification-evidence` input for explicit manual qualification: routine successful runs retain7 days, failures14, selected runs30.
Preserve existing npm script names, Markdown scope, six fresh samples, resource bounds, trusted policy overlay, runtime declarations and candidate-as-data execution.
No registry release, historical artifact deletion, domain skill edits or unrelated dependency/runtime upgrades.

## Implementation and proof

1. Commit this plan before implementation; verify exact archive SHA256/SHA512 and source/tree/lock identities against the producer manifest, then update the bindings and document retention/reconstruction limits.
2. Use preservation verification through the installed public package and existing acquisition/selection/hostile-input tests. Add a parsed workflow assertion for the manual retention opt-in. Run focused tests and review prerequisites after consolidation.
3. Freeze a signed final candidate; perform ordinary/security review and different-vendor verification only for this consumer delta. Use narrow follow-ups for repairs. Run HISEW `full` (`npm run verify`) for the exact final candidate before normal fast-forward publication.
4. Inspect automatic positive Windows/Linux qualification and explicitly dispatch the retained hostile candidate against the new trusted commit. Verify compact artifact digests, indexed evidence/manifests and reconstruction against immutable Git/archive inputs. Compare actual compressed bytes with the original295576530-byte positive baseline; report results and limits independently from local gates.
5. Append actual delivery, measured size, evidence and HISEW closure details to the shared implementation plan after remote-main landing. Retain required evidence and acquisition inputs until consumers release them; reconcile task-owned resources before handoff.

## Acceptance

- REQ005/AC001: all consumer bindings agree with the qualified latest producer; installed public checks preserve maintained selection and exclusions.
- AC002: automatic positive and deliberate negative hosted results preserve trusted policy behavior on both platforms; compact artifacts verify completely and demonstrate reduced routine upload size.
- AC003: scoped reviews, exact-candidate local gate, remote-main identity, evidence retention and native handoff are recorded without relabeling failed, pending or historical evidence.

Replan if producer/consumer main advances, identities disagree, checks/reviews fail, hosted evidence cannot be reconstructed, or source-copy removal weakens accepted assurance.
