# Phase 6: Git integration, full verification and controlled retirement

Parent: [master plan](../2026-10-03-evaluation-modernization.md). Slices: SLICE-007 and SLICE-008. Ledger: all rows, especially KEEP-006 through KEEP-008 and KEEP-021 through KEEP-026. Decisions: DEC-003 through DEC-012.

## Entry and outcome

Enter after the coordinated source/contract migration and shared bridge qualification. Integrate Git last because its fixtures, approval controller, artifact identity, signing, recovery and publication behavior are the most consequential. This phase changes evaluation integration, not the production commit workflow or the meaning of existing experiments.

Deliver a fake-provider campaign through the qualified consumer boundary with the same fixture facts, selection, approvals, grading inputs and durable evidence as the direct path. Then establish the whole-repository deterministic gate and an independently reviewed disposition for every preservation row. Real-provider calibration, host performance experiments, signing against personal keys, commits, pushes and publication are separate authorized operations.

## Predicted file work

| End-state path | Responsibility and constraint |
| --- | --- |
| `src/committing-to-git/evals/assurance/v1/evaluation-runner.mjs` | Preserve candidate/baseline checks, fresh remote observation, selected matrix, seed/order, isolation catalog, frozen repository manifest, prepared sessions and blinded/private evidence. Dispatch already-prepared sessions through explicit direct or qualified bridge mode. |
| `src/committing-to-git/evals/assurance/v1/session-controller.mjs` | Preserve Git-specific scope resolution, predetermined decisions, state checks and exact local-commit approval. Do not replace it with the generic text-only scripted controller. |
| `src/committing-to-git/evals/assurance/v1/create-fixture-repository.mjs` | Preserve every registered fixture and independently specified starting/final facts. Path changes do not license changing generated repository states. |
| `src/committing-to-git/evals/assurance/v1/profile.mjs` (new if needed) | Thin compiled-suite/current-preparation/authoritative-result seam; do not wrap production CLI modules or copy shared runtime policy. |
| `src/committing-to-git/evals/assurance/v1/reviewed-change-host.json`, `.mjs`, `.md` | Retain all four scenarios and offline measurement behavior. Correct live path references only; no implied live-host execution. |
| `src/committing-to-git/evals/evals.json` and extension | Keep all 72 active cases, retired ID ledger, current 27 selected IDs, exact approvals, critical-safety metadata, ordered assertions, scenario/cost references and baseline identity. |
| `scripts/evaluation/derive-reports.js` and consumer projection | Derive report references from sealed evidence, preserving experimental arm names, failed/unknown/ungraded records and blinded mappings. |
| Existing `tests/committing-to-git/` and `tests/scripts/` tests | Extend characterization at actual seams. Retain source, generated installed helper, plugin, archive and host-analysis tests as different consumers. |
| `scripts/evaluation/check-conformance.js` and approved package/workflow configuration | Integrate pinned offline conformance after local platform qualification. Preserve the existing verification order and all existing checks. |
| Root/suite authoring and evaluation READMEs | Finish the live path/tool/mode inventory and supported-platform matrix; retain explicit links to historical documents and evidence. |

All production Git modules stay in their existing source responsibilities. A flaw discovered in production behavior is a separate change unless it blocks this migration and receives an explicit scoped re-plan.

## Fixed Git experimental contract

Keep active IDs `1..77` except retired `20, 22, 25, 26, 27`; next ID is `78`. Case 77 is active but is not silently added to the current selected calibration set. The selected IDs are:

```text
4, 7, 18, 28, 35, 36, 37, 39, 40, 41, 42, 47, 49, 50,
53, 54, 55, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76
```

The current matrix is 27 cases x `no-skill`, `old-skill`, `new-skill` x one repetition: 81 sessions for the configured Spark-low profile. Keep the baseline Git OID `76baa9b25e0afeaa2c62c4cf7042976444edc15e`, seed, sequential matched order, case-specific fixture metadata and uniform capability policy. Source movement alone does not change these experimental choices or authorize those 81 calls.

Read historical bundles from the recorded Git tree and path without checkout or restoration. Candidate bundles come from the actual generated distribution. Bind relevant source/build/compiler/toolchain identities separately so an unchanged prompt with changed execution machinery is not misidentified as the same experiment. Preserve clean/pushed-candidate rules and fresh remote observation; missing remote evidence fails preparation without performing fetch or push automatically.

Git controller outcomes include predetermined scope, including case 42, exact comparison of Git state before approval, bounded fixture permissions, and the exact local-commit continuation. No turn grants pushing. The fixture oracle checks final repository/index/commit/signature/recovery facts independently of an agent's prose and of the consumer's grade.

## Production and distribution preservation proof

In addition to packet/schedule parity, retain regression evidence for draft/index isolation, selection and review cursors, canonical message bytes, witnessed checks, signature policy, exact commit tree/parent, recovery records and final reports. Newer contracts require explicit attention:

- Native snapshots support the current 64 MiB bound with explicit overflow handling; `--execution native` retains hooks/checks/signing/recovery and is not a provider bypass.
- Resumable preparation retains the authored worksheet and exact index/recovery identity; fresh turns cannot silently replace it.
- Host capture and diagnostics preserve a single public JSON result plus hash-checked retained detail; diagnostic transport must not contaminate the public result.
- Publication preflight preserves Git versus hosting-API identity, source branch versus final integration destination, and direct/PR-guided distinctions. A source push is not proof of final delivery.
- Installed helper and plugin tests still execute the generated copies outside the source tree. Source-only unit success cannot establish package correctness.

The source cutover already occurred in Phase 2. Here re-verify plugin inventory, license/notices, generated README provenance, content-derived version, both host manifests and reproducible archive readback against the integrated candidate. A generated byte change legitimately changes the package version; do not manually preserve a stale version. No marketplace pin or remote release change is implicit.

## Host and trigger acceptance remain separate

Preserve the four reviewed-change-host scenarios and `measureReviewedChangeHostRun` accounting: helper duration, overlap, hosted waiting and unattributed time. An offline timing record does not prove a real agent followed approval boundaries or completed the final delivery destination. Future host acceptance needs separately authorized runs with exact artifact/client/model identity, independent safety/final-state observations, all attempted outcomes and cited measurement limitations.

Likewise, the 22 Git trigger queries are retained as ten positive and twelve negative cases. Actual skill activation requires the host-observation contract from Phase 5. Neither a keyword classifier nor injecting the entire skill into a model proves automatic discovery.

## Integrated proof and rollout

Existing focused commands after path/import updates:

```powershell
node --test tests/committing-to-git/evaluation-runner.test.mjs tests/committing-to-git/eval-fixtures.test.mjs tests/committing-to-git/reviewed-host-evaluation.test.mjs
node --test "tests/committing-to-git/*.test.mjs"
```

Run the appropriate existing build/plugin/archive/scoped-verifier and shared runtime/provider/home tests, the new consumer-conformance tests, and finally `npm run verify`. Preserve its current `diff:check -> build:check -> skills:validate -> skills:lint -> ... -> npm test` sequence, inserting only the separately approved offline evaluation gate. Do not replace the full gate with focused success. Run platform-specific process/metadata tests on their actual platforms and record unavailable requirements honestly.

Qualify actual `skills@1.7.0` discovery/installation from a disposable checkout and inspect installed bytes/relative references, then read back the standalone plugin/archive. Perform explicit tool acquisition in its approved preparation phase, never during offline verification. Reconcile the candidate with pinned skills-ref/Tessl expectations and root plugin ownership. These are distribution-consumer experiments, not automatic real-provider runs.

Complete an independent R2 review covering architecture, preservation, trust boundaries and relevant security before claiming implementation acceptance. Update each AC/QA and ledger row with exact evidence, qualified platforms, exclusions and unresolved gaps. If a native consumer cannot represent a protocol, retain its partial-coverage record and the Hadden path; do not alter the suite to make a dashboard green.

## Retirement and recovery

Retire moved root eval paths only after all live imports, tests, operator commands, fixture resolvers and report links are migrated. Historical report bodies and embedded paths remain immutable, with external path-map resolution. Do not add compatibility entry points under old paths without an explicit owner exception. Keep historical schema readers while evidence consumers need them.

Retire duplicated report/orchestration code only after the new consumer has demonstrated equivalent required behavior and independent review has accepted the mapping. Keep the shared runtime, provider/home controls, suite controllers, fixture oracles, durable campaign reconciliation, domain grading and installed-artifact tests. Do not delete an old safety test in the same change that first introduces its replacement.

Direct Hadden execution remains available for supported workflows whose bridge platform is unqualified. It is an explicit maintained mode, not a silent fallback after a failed consumer attempt. Consumed authority is never revived. Retain failed/uncertain outcomes, quarantine/lease ownership and recovery instructions before any scratch cleanup.

Final handoff includes the complete per-file change account, source/distribution/plugin/archive identities, fixed history manifest, consumer/platform/coverage matrix, full-gate evidence, independent review, rights status, open real-provider/host experiments and any temporary assets still owned. Commits need separate explicit authorization and detailed per-file messages; pushing and publication need their own authorization. A report rendering successfully is not completion of this plan.
