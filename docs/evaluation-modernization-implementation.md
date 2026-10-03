# Evaluation modernization implementation evidence

Implementation baseline: `0c59a3877b58de234347e2c19488e0b407c8ee9d`; branch `evaluation-modernization`. The earlier design baseline remains historical. The initial implementation and CI repair passed governed verification and independent review through `c4fcb9ea7438ea4815cb8f46fc3593ee48ff9546`; Windows/Linux conformance and CodeQL passed on that commit. This record separates those completed checks from subsequent dispatch work and still-unqualified platform behavior.

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
| KEEP-001 | Source-first orchestration, intended projection then generated plugin; `build-repository.test.mjs` | Final candidate gate required |
| KEEP-002 | Central runtime inventory plus unchanged Git bundle transform; `build-skill-artifacts.test.mjs`, `skill-distribution.test.mjs`, runtime preservation fixture | Two owner-approved JSON formatting exceptions |
| KEEP-003 | Source/generated ASCII and Markdown validation; `skill-repository-validation*.test.mjs` | Imported skills excluded from canonical-source rule |
| KEEP-004 | Source/output ownership and both test roots; `verify-skill.test.mjs` | Scoped checks retain explicit full-gate omissions |
| KEEP-005 | Existing managed validators retained; `repository-verification.test.mjs`, `evaluation-tools.test.mjs` | Explicit tool preparation still required |
| KEEP-006 | Generated plugin provenance and content-derived version; `build-plugin-packages.test.mjs` | No marketplace update |
| KEEP-007 | Existing deterministic archive producer/readback; `package-plugin-archive.test.mjs` | No release publication |
| KEEP-008 | Source tests and installed Git/EPUB/naming payload tests remain distinct | Deterministic installed behavior only |
| KEEP-009 | Existing packet/canonical-hash authority reused; `evaluation-runtime.test.mjs` | No second authority implementation |
| KEEP-010 | Registered profiles delegate prepared authorization and consumption to shared runtime; runtime and bridge tests | Production native bridge disabled |
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
| KEEP-036 | History manifest, byte/hash inventory, explicit readers and preservation tests | Staged Git-blob reconciliation required before history commit |

The initial independent verification completed the historical Git-blob reconciliation and exact distribution readback. Governed run `b1f91b23-e694-4483-a6f3-1a7b3dcbd22d` verified clean commit `c4fcb9e`: 1,135 tests passed, six skipped, none failed. CI runs `37120653530` and `37120651300` passed functional conformance and CodeQL respectively. These receipts do not cover later changed source bytes.

### Dispatch continuation and remaining qualification

The plan audit after CI found that registered profiles and manual carrier construction did not yet provide the promised operator campaign-dispatch mode. The continuation adds explicit preparation-time mode selection to Git sessions, defining-concepts campaigns/sessions and naming requests, with a shared packet-bound dispatcher. Existing campaign schedules, reconciliation, provider adapters, controllers and grading remain the owners of their behavior. A consumer error has no direct fallback, and successful readback comes from artifact-checked Hadden evidence.

The native fake-provider contract now compares direct versus consumer dispatch for Git policy case 3, Git fixture/controller case 35, defining case 10 and naming case 4. It exercises exact follow-up counts, one provider launch, rejection of missing approval and timeout overrides, replay refusal and Git's commit-approval transition. The added Git path exposed a Windows metadata-probe PATH dependency; the probe now locates PowerShell under the inherited absolute Windows system root without broadening the consumer PATH. Qualification checks belong to the toolchain module, avoiding an executable-entry-point import cycle.

A later Windows CI trace isolated the timeout to the worker's first JSON cmdlet call (29.22 seconds, versus 187 ms to script entry). The worker now explicitly imports its OS Utility and Management module files from `PSHOME`, removing reliance on ambient cmdlet discovery. The fresh-worker regression fails on the old source with autoloading disabled and passes on the repair. All temporary profiling, boundary tracing and diagnostic deadline changes have been removed; ordinary execution deadlines and production qualification flags are unchanged. Final full verification, narrow independent review and normal-budget CI remain required for this candidate.

Production native dispatch remains disabled. Following the repeated QA-002 Windows failures, the owner specifically approved the per-invocation Python/Windows Job Object revision on 2026-10-03. The host binds interpreter/source identity and atomically assigns the consumer to its job; fake tests cover parent/host/workload death, nested jobs, startup loss and missing APIs. These tests do not enable production or establish complete Hadden failure/lease recovery and egress qualification. Ubuntu CI run `37125253782` also observed surviving descendants; a Linux lifecycle revision needs separate design and approval. Real-provider calibration, host activation and human evaluation remain separate authorized experiments. No duplicate safety orchestration is retired before these equivalence and qualification conditions are met.

## Acceptance and quality evidence

AC-001/002/005/006/009/010 are covered by the source/distribution, compiler, frozen identity, history, suite, installed payload and plugin/archive tests. The explicit JSON and historical-checkout exceptions above are owner decisions, not silent normalization. AC-003/004 use the retained runtime/adapter/home tests and new fake-provider seams. AC-007/008 use actual pinned native consumer, SDK and installer checks with fake providers; supported integrated-gate platforms are Windows x64 and Linux x64. AC-011/012 retain explicit authority, isolated environment inputs, fail-closed qualification and ungraded/unknown/failed distinctions.

QA-001/003/004/005 use replay, identity/tamper, confined-path and authoritative-outcome checks. QA-007/008 use fresh/read-only build, exact distribution and installation/archive checks. QA-009 uses the relocation inventory and hashes; ignored evidence is separately owned. QA-010/011/012 use explicit projection exclusions and retained campaign/evidence-schema rejection tests. These deterministic checks do not establish every physical failure interleaving.

QA-002 is not production-qualified: the original native path left descendants alive on Windows and Linux. The approved Windows host has a separate fake-process proof suite; it does not erase the original observations or establish all failure interleavings. Owned fixture processes are stopped, and production qualification remains disabled. QA-006 has isolated environment, credential sentinels and installer Node-network denial observations, but no complete OS-level egress observation. Direct Hadden execution remains available; failed native execution never silently falls back or retries.

See [toolchain status](evaluation-toolchain-status.md) for exact versions, rights/notices, platform/consumer limitations and retained temporary resources. Local verification logs and Claude review transcripts reside under `.agent-tools/evaluation/`. HISEW execution `6c3b46a1-6e2e-4879-88ea-81462a59731a` owns governed verification receipts. Logs cited here are operator evidence unless a matching engine receipt explicitly consumes them.

## Review and retirement

Claude Code completed the reduced implementation review after one earlier broad attempt exhausted its cap. The review excludes relocated historical payloads, ignored results and unchanged generated copies; migration manifests, preservation tests and changed readers remain review targets. It identified cancellation/deadline, prelaunch replay claim, case/suite identity and documentation fixes. One narrow follow-up passed after those corrections, with no blocking finding or repair regression. The retained transcript is `.agent-tools/evaluation/implementation-review-followup.json`; it explicitly accepts existing fingerprint checks for Git/defining source staleness and the disabled-platform limitations. No further broad review is required. Final independent verification must be reported separately; the current document is not its acceptance receipt.

Live suite readers, fixtures and operator commands now use source-owned paths. Root evaluation forwarding shims were not added. Historical result paths are resolved through the external relocation manifest. Existing providers, homes, controllers, fixture oracles, campaign reconciliation, domain grading, historical readers and installed-artifact tests remain maintained. The legacy naming heuristic is retained solely for historical diagnostic interpretation.
