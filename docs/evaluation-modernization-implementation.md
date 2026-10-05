# Evaluation modernization implementation evidence

Original implementation baseline: `0c59a3877b58de234347e2c19488e0b407c8ee9d`; branch `evaluation-modernization`. Delivered executable/test candidate: `e2c00f5e6267f7d4747c3e404b835dc0d0b33ac2`, tree `c3b235d089e4d4f92909cdcf045d5f3f64f6e745`. Governed full verification, independent source review and Windows/Linux CI passed for that candidate. The original documentation reconciliation changed no executable, test, configuration or generated payload. The dated records below retain their original candidate identities; the [Windows recovery and enablement continuation](#windows-recovery-and-enablement-continuation) records later work separately.

## Preserved identities and approved exceptions

The migration preserves 111 authored cases across four suites, including ordered assertions, follow-ups, selected schedules, retired IDs, capability declarations and trigger datasets. Frozen case/suite identities reside under `tests/fixtures/evaluation-preservation/`; compiler tests compare the migrated contracts to those independent baseline identities. No real model calibration or host activation was performed.

The runtime inventory contains 57 files. Fifty-five remain byte-identical. The owner required repository formatting for the naming policy and EPUB result schema; `evidence/migrations/2026-10-03-approved-json-formatting.json` records their before/after hashes and identical parsed JSON values. Generated copies match source. Neither file is ignored by formatting.

The historical relocation comprises 412 files and 6,028,581 checkout bytes. `evidence/migrations/2026-10-03-historical-results.json` records old/new paths, lengths, checkout hashes and Git identities. Two defining aggregate files differed only in checkout CRLF versus committed LF; the owner selected checkout bytes as authoritative and required recording the Git difference. Historical contents, including old embedded paths and invalid UTF-8 bytes, remain untouched. The `.gitattributes` rule prevents text conversion in the historical tree. Pre-existing ignored naming results remain at their original paths.

The owner also approved exact per-path whitespace rules for the two CRLF aggregates: Git recognizes CR as part of the line terminator while retaining its normal whitespace checks. This does not exempt authored JSON from formatting or change historical bytes.

Eight pre-existing EPUB bytecode files were relocated with owner approval into `.agent-tools/evaluation/preexisting-runtime-cache/reading-epubs/`. The migration receipt records both paths and hashes. These files are preserved local assets, not deployable runtime files.

## Preservation ledger disposition

Every row retains its original acceptance meaning. Test paths below identify deterministic coverage, not real-provider/platform acceptance. Shared script tests are under `tests/scripts/`; suite test locations are explicit. The full gate runs these tests, including installed-helper and archive tests.

| Row | Implementation and proof | Remaining boundary |
| --- | --- | --- |
| KEEP-001 | Source-first orchestration, intended projection then generated plugin; `build-repository.test.mjs` | Delivered candidate full gate passed; see exact receipt below |
| KEEP-002 | Central runtime inventory plus unchanged Git bundle transform; `build-skill-artifacts.test.mjs`, `skill-distribution.test.mjs`, runtime preservation fixture | Two owner-approved JSON formatting exceptions |
| KEEP-003 | Source/generated ASCII and Markdown validation; `skill-repository-validation*.test.mjs` | Imported skills excluded from canonical-source rule |
| KEEP-004 | Source/output ownership and both test roots; `verify-skill.test.mjs` | Scoped checks retain explicit full-gate omissions |
| KEEP-005 | Existing managed validators retained; `repository-verification.test.mjs`, `evaluation-tools.test.mjs` | Explicit tool preparation still required |
| KEEP-006 | Generated plugin provenance and content-derived version; `build-plugin-packages.test.mjs` | No marketplace update |
| KEEP-007 | Existing deterministic archive producer/readback; `package-plugin-archive.test.mjs` | No release publication |
| KEEP-008 | Source tests and installed Git/EPUB/naming payload tests remain distinct | Deterministic installed behavior only |
| KEEP-009 | Existing packet/canonical-hash authority reused; `evaluation-runtime.test.mjs` | No second authority implementation |
| KEEP-010 | Registered profiles delegate prepared authorization and consumption to shared runtime; runtime and bridge tests | Windows bound host/recorder path enabled by separate owner approval; Linux remains disabled |
| KEEP-011 | Both authoritative layouts retained; runtime tests and naming profile exercises | Consumed authority never revived |
| KEEP-012 | Codex adapter retained; `codex-app-server.test.mjs` | Real-provider acceptance not run |
| KEEP-013 | Claude adapter retained; `claude-cli.test.mjs` | Existing follow-up restrictions retained |
| KEEP-014 | Antigravity adapter reused; `antigravity-cli.test.mjs`, naming profile fake-provider tests | No inferred tool/research capability |
| KEEP-015 | Home lease, transfer, tracking and quarantine modules retained; home/management tests | Fake credentials and children only |
| KEEP-016 | Native path metadata implementations retained; path metadata tests | Linux runtime qualification pending; no macOS claim |
| KEEP-017 | Full generated bundle capture retained; `evaluation-skill-bundle.test.mjs` | Historical revisions read without checkout |
| KEEP-018 | Shared scripted controller retains ordered follow-ups; scripted tests, naming cases 4/7, defining case 10 | Consumer projections disclose partial protocol coverage |
| KEEP-019 | Deny-default capability reconciliation reused; capability tests and compiler fixtures | Naming text-only mode rejects additional requirements |
| KEEP-020 | Runtime failures/closure retained; outcome derivation verifies authoritative artifact hashes | Native report scores and zero usage defaults are not authority |
| KEEP-021 | Git schedule, remote checks and source fingerprint retained; `tests/committing-to-git/evaluation-runner.test.mjs` | No 81-session real campaign run |
| KEEP-022 | Git controller unchanged apart from location/imports; existing controller scenarios | No consumer permission to push |
| KEEP-023 | Fixture registry and independent state oracles retained; Git fixture/cost tests | Production behavior not redesigned |
| KEEP-024 | Four host scenarios and analyzer retained; reviewed-host tests; live command paths updated | Actual host run not performed |
| KEEP-025 | Production Git source behavior retained; source and installed workflow tests | Task delivery is separately authorized |
| KEEP-026 | Native snapshots, resumable preparation, diagnostics and publication tests retained | Test publication uses disposable repositories |
| KEEP-027 | Defining durable campaign progression retained; `tests/evals/defining-concepts/evaluation-runner.test.mjs` | Bridge is optional and explicitly selected |
| KEEP-028 | Defining trial/session preparation and controller retained; trial/session tests | Integrity verification remains ungraded |
| KEEP-029 | Blind concept grading/aggregation retained; result/definition/structure tests | No fabricated URL or entailment verification |
| KEEP-030 | Sixteen concept cases and capability envelope preserved; frozen identity and conversation tests | No new behavioral claim |
| KEEP-031 | EPUB installed paths preserved; `tests/reading-epubs/` | Pandoc-dependent skips remain visible |
| KEEP-032 | Conversion measurement script moved with corrected runtime resolver; conversion/fixture tests | Historical measurements remain historical |
| KEEP-033 | Naming checker profiles/examples characterized in `tests/naming-objects-in-software-engineering/` | `semantic_certified: false` remains meaningful |
| KEEP-034 | Naming direct-launch bypass retired; registered prepared profile, exact follow-ups, legacy diagnostic characterization | Keyword scores cannot become semantic grades |
| KEEP-035 | Trigger bytes/labels retained; trigger contract and frozen suite identities | Selection and body injection do not prove activation |
| KEEP-036 | History manifest, byte/hash inventory, explicit readers and preservation tests | Historical Git-blob reconciliation completed; immutable manifest retained |

The initial independent verification completed the historical Git-blob reconciliation and exact distribution readback. Governed run `b1f91b23-e694-4483-a6f3-1a7b3dcbd22d` verified clean commit `c4fcb9e`: 1,135 tests passed, six skipped, none failed. CI runs `37120653530` and `37120651300` passed functional conformance and CodeQL respectively. These receipts do not cover later changed source bytes.

### Dispatch continuation and remaining qualification

The plan audit after CI found that registered profiles and manual carrier construction did not yet provide the promised operator campaign-dispatch mode. The continuation adds explicit preparation-time mode selection to Git sessions, defining-concepts campaigns/sessions and naming requests, with a shared packet-bound dispatcher. Existing campaign schedules, reconciliation, provider adapters, controllers and grading remain the owners of their behavior. A consumer error has no direct fallback, and successful readback comes from artifact-checked Hadden evidence.

The native fake-provider contract now compares direct versus consumer dispatch for Git policy case 3, Git fixture/controller case 35, defining case 10 and naming case 4. It exercises exact follow-up counts, one provider launch, rejection of missing approval and timeout overrides, replay refusal and Git's commit-approval transition. The added Git path exposed a Windows metadata-probe PATH dependency; the probe now locates PowerShell under the inherited absolute Windows system root without broadening the consumer PATH. Qualification checks belong to the toolchain module, avoiding an executable-entry-point import cycle.

A later Windows CI trace isolated the timeout to the worker's first JSON cmdlet call (29.22 seconds, versus 187 ms to script entry). The worker now explicitly imports its OS Utility and Management module files from `PSHOME`, removing reliance on ambient cmdlet discovery. The fresh-worker regression fails on the old source with autoloading disabled and passes on the repair. All temporary profiling, boundary tracing and diagnostic deadline changes have been removed; ordinary execution deadlines and production qualification flags are unchanged. Subsequent governed verification and normal-budget Windows/Linux CI passed on the delivered candidate.

The final test repair removes fixture dependence on provider startup speed. Antigravity and Claude timeout tests wait for an owned inherited-stdio holder and retain unsafe closure, single-launch and no-retry assertions. Codex's cleanup fixture withholds responses until stdin closes; the test checks ordered unanswered cleanup requests and bounded completion. Controlled temporary startup delay reproduced the prior failures and passed after the correction. That instrumentation was removed before freezing the seven-file test/fixture change. Production deadlines and policy were not changed.

At the original dispatch checkpoint, production native dispatch remained disabled. Following the repeated QA-002 Windows failures, the owner specifically approved the per-invocation Python/Windows Job Object revision on 2026-10-03. The host binds interpreter/source identity and atomically assigns the consumer to its job; fake tests cover parent/host/workload death, nested jobs, startup loss and missing APIs. Those isolated tests did not enable production or establish complete Hadden failure/lease recovery and egress qualification. Ubuntu CI run `37125253782` also observed surviving descendants; a Linux lifecycle revision needs separate design and approval. Real-provider calibration, host activation and human evaluation remain separate authorized experiments. No duplicate safety orchestration is retired before these equivalence and qualification conditions are met.

## Acceptance and quality evidence

AC-001/002/005/006/009/010 are covered by the source/distribution, compiler, frozen identity, history, suite, installed payload and plugin/archive tests. The explicit JSON and historical-checkout exceptions above are owner decisions, not silent normalization. AC-003/004 use the retained runtime/adapter/home tests and new fake-provider seams. AC-007/008 use actual pinned native consumer, SDK and installer checks with fake providers; supported integrated-gate platforms are Windows x64 and Linux x64. AC-011/012 retain explicit authority, isolated environment inputs, fail-closed qualification and ungraded/unknown/failed distinctions.

QA-001/003/004/005 use replay, identity/tamper, confined-path and authoritative-outcome checks. QA-007/008 use fresh/read-only build, exact distribution and installation/archive checks. QA-009 uses the relocation inventory and hashes; ignored evidence is separately owned. QA-010/011/012 use explicit projection exclusions and retained campaign/evidence-schema rejection tests. These deterministic checks do not establish every physical failure interleaving.

At the original modernization handoff, QA-002 was not production-qualified: the original native path left descendants alive on Windows and Linux. The approved single Windows host then had a separate fake-process proof suite; it did not erase the original observations or establish all failure interleavings. Owned fixture processes were stopped and qualification stayed disabled at that checkpoint. QA-006 has isolated environment, credential sentinels and installer Node-network denial observations, but no complete OS-level egress observation. Direct Hadden execution remains available; failed native execution never silently falls back or retries.

See [toolchain status](evaluation-toolchain-status.md) for exact versions, rights/notices, platform/consumer limitations and retained temporary resources. Initial migration receipts remain with execution `6c3b46a1-6e2e-4879-88ea-81462a59731a`; final timeout-repair receipts belong to `e1d16f1d-fa24-477c-b335-57bfe1387d97`. Logs and reviewer reports are operator evidence unless a matching engine receipt explicitly consumes them.

## Review and retirement

Claude Code completed the reduced implementation review after one earlier broad attempt exhausted its cap. The review excludes relocated historical payloads, ignored results and unchanged generated copies; migration manifests, preservation tests and changed readers remain review targets. It identified cancellation/deadline, prelaunch replay claim, case/suite identity and documentation fixes. One narrow follow-up passed after those corrections, with no blocking finding or repair regression. The retained transcript is `.agent-tools/evaluation/implementation-review-followup.json`; it explicitly accepts existing fingerprint checks for Git/defining source staleness and the disabled-platform limitations.

For the final timeout-fixture delta, the owner selected Antigravity with Codex fallback and renewed a bounded review after earlier unusable attempts. Antigravity CLI 1.2.16 completed a native static source review in conversation `332eaa05-da83-4666-8637-54c6dc0cf13e`: 28 file reads covered the seven changed files and three adjacent adapters in a frozen plain clone. Exactly one tool-free report correction removed unsupported timing/scheduling claims. Corrected verdict: PASS for static source review, no blockers. No independent test execution occurred, and Codex fallback was not needed in that renewed cycle. Native transcripts and the implementer's admission check are retained in the external operator-evidence directory below. No further broad review is required.

Live suite readers, fixtures and operator commands now use source-owned paths. Root evaluation forwarding shims were not added. Historical result paths are resolved through the external relocation manifest. Existing providers, homes, controllers, fixture oracles, campaign reconciliation, domain grading, historical readers and installed-artifact tests remain maintained. The legacy naming heuristic is retained solely for historical diagnostic interpretation.

## Final delivery identities and disposition

The committed executable/test candidate passed one canonical fixed-engine `verify-and-hand-off-change-execution` invocation: `npm run verify`, 1,145 tests, 1,139 passed, none failed, six skipped. Execution `e1d16f1d-fa24-477c-b335-57bfe1387d97`, owner generation 11, consumed full run `b86546c6-4f4f-4a08-a52f-da832ed39e8b`; receipt SHA-256 `ca130413abef60f0fb69335ebbaf0dbf995bc1b70e838a3f7f9d12052b87c1a2`. Receipt HEAD/tree match the delivered candidate above, with `dirty: false`. Disposition was `implementation-handoff`, `evidenceBasis: fresh-execution`, `releaseApproval: false`. Engine assurance covers the consumed commands; it does not promote reviewer prose or platform qualification claims.

[Consumer conformance CI](https://github.com/Hadden-Industries/agent-skills/actions/runs/37157238453) passed on Windows 2025 and Ubuntu 24.04 for that exact commit. [CodeQL](https://github.com/Hadden-Industries/agent-skills/actions/runs/37157235687) passed JavaScript/TypeScript, Python and Actions analysis. Native Git verified its SSH signature and the normally pushed `origin/refs/heads/evaluation-modernization` readback. No helper-witnessed check evidence is attached to that transaction; the accepted ordinary Git fallback supplied signature/publication evidence. At that source handoff, [PR #13](https://github.com/Hadden-Industries/agent-skills/pull/13) was an unmerged draft; source publication alone was not target integration. Its later integration is recorded below.

| Artifact at executable/test candidate | Exact identity |
| --- | --- |
| Canonical `src/` Git subtree | `a414f36cce99c7e86ff7c15f00e6b0e98347d577` |
| Generated `skills/` Git subtree | `4015d04d80d043b08bc57540ace89b19ed86c697` |
| Generated `plugins/committing-to-git/` Git subtree | `039fcd27cbb62a4de68b01e9a9381685fc8022ff` |
| Both host plugin versions | `0.1.0-dev.gb3d785f489f87954` |
| Reproduced desktop ZIP, 22 members, complete source-byte readback | SHA-256 `71a2a2acd34041da091d1ad148ca7d527fe5f0cbc2bb3da2e20e250c4d5c98cf` |
| Historical relocation manifest | SHA-256 `1cf1e42b700fe804aded8ed50d7a86895d7b2774c8fca7deeac4e3f6765a5592` |

Durable operator evidence lives under `C:/Users/maksy/.hi/w/e/operator-evidence/2026-10-03-timeout-static-review-e1d16f1d-generation11/` (native reports, admission, full log, CI/PR readback and retention manifest). `2026-10-04-modernization-final-handoff/` under the same root retains the reproduced archive, artifact identities and documentation closure evidence. These are supplemental operator artifacts, not imported native verification receipts. Per-file changes remain inspectable in the branch's detailed signed commits and PR diff.

All eight implementation slices had a delivered disposition at this original handoff. Source/distribution ownership, portable contracts, suite dispatch, preservation and offline consumer checks were implemented. Native process qualification then had the plan's failed/disabled disposition: direct Hadden execution and safety orchestration were retained. That handoff did not authorize real evaluation calls, enablement, marketplace updates, release or merge. Later separately authorized integration, recovery and Windows enablement are recorded below; original receipts and failed observations remain unchanged.

## Windows recovery and enablement continuation

The modernization source was subsequently integrated through [PR #13](https://github.com/Hadden-Industries/agent-skills/pull/13). Windows integrated lifecycle qualification followed separately, then [PR #17](https://github.com/Hadden-Industries/agent-skills/pull/17) delivered the independent closure recorder and explicit state-bound interrupted execution-home recovery. Its merge is `6bd15b3dd22200fba058be1b8c46c1739a240487`, with tree `f6f3cdbb9bb1a6d35377802f334f2962be6ef8af`. Both signed source commits remain in merge ancestry. Canonical full run `4fbbb973-5985-429e-8287-0060c1e34668` passed 1,300 tests, six skipped and zero failed/cancelled; native producers were quiescent. Windows/Ubuntu consumer CI and post-main CodeQL passed. One consolidated and one narrow Antigravity static review passed; their verdicts do not claim independent test execution. Detailed delivery and original evidence references are retained in `C:/Users/maksy/.hi/w/e/operator-evidence/2026-10-05-evaluation-home-recovery/`.

The revised Windows QA-002 boundary covers the real pinned native consumer, host/recorder, bridge, Hadden controller/runtime, synthetic provider and descendants. The current missing-recorder-termination negative control detects absent signed zero-active proof. Unknown simultaneous-loss proof retains the lease and blocks progression. Explicit recovery preserves original attempts/outcomes/evidence and credentials, distinguishes recovered resources from completed evaluations, and refuses consumed replay, live owners, stale state and unsupported lease versions/roles. See [Windows qualification](evaluation-windows-bridge-qualification.md) and [recovery commands](evaluation-runtime.md#interrupted-evaluation-home-recovery).

On 2026-10-05 the owner separately approved the exact Windows x64 qualification scalar `assured-disabled-descendant-survived` -> `assured-qualified`, plus matching documentation and a bounded review/verification/delivery cycle. This admits the already implemented `windows-job-v2` assured path when explicitly selected. It changes no runtime implementation, generated distribution, provider policy, model authority or deadline. The enablement candidate's exact review, canonical full verification and delivery identities are recorded separately under `C:/Users/maksy/.hi/w/e/operator-evidence/2026-10-05-windows-bridge-enablement/`; the earlier PR17 receipt is reused only for unchanged implementation coverage.

Linux remains disabled with marker `pending` and needs its own approved lifecycle revision. QA-006 retains isolated environment/config/telemetry controls; no complete OS-level egress isolation is claimed. Real-provider calibration/acceptance, human grading, actual host activation and real-home recovery retain their separately prepared authority requirements. This enablement performs none of those operations. Direct Hadden mode and safety orchestration remain maintained; failed or consumed authority is never revived. Retained resources are reassessed on 2026-10-12.
