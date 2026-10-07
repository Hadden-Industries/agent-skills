# GitHub Actions artifact reduction implementation plan

Date: 8 October 2026.
Status: accepted for implementation by Maksym Shostak on 8 October 2026, with the execution amendment below.
Decision and integration owner: Maksym Shostak.

## Accepted execution amendment and commit points

The owner's implementation request accepts this plan's R2 route and exact configuration scope, authorizes signed commits and pushes to the synchronized local/remote `main`, and requires thorough semantic naming and no compatibility shims.
Commit this accepted plan as the first commit point, before implementation. Consolidate all implementation slices for final review and the second commit point; scope follow-up reviews to actual findings and changed questions. External reviews apply only to that final implementation candidate.

Do not dispatch remote GitHub Actions runs that could produce artifacts. Complete deterministic local qualification through HISEW's `full` profile and independent final review, then publish the artifact-free workflows through the authorized direct-main route. Hosted Linux/Windows execution, actual log-size observations and per-run zero-artifact inventory remain deferred acceptance evidence; local checks cannot satisfy those hosted criteria. This amendment supersedes instructions below to run hosted qualification during this execution. No historical artifact deletion is authorized.

Feedback preferences are Automatic submission, Full disclosure and sanitisation off, as explicitly approved for this project; preserve those settings if already configured.
No external/manual archive consumer has been identified in the accepted scope. Discovery of a concrete consumer still triggers re-planning before removing its diagnostic transport.

## Purpose and baseline

Make both repository-authored verification workflows produce **zero GitHub Actions artifact archives**, on successful and failed runs, without weakening their checks or losing actionable native diagnostics.
Replace the current report and temporary-directory uploads with protected diagnostic logs and compact summaries.
Do not introduce a replacement archive, cache, job-output transport, release pipeline or external storage service.

The inspected local and remote `main` revision is `0b5193609dbfbd45bb39db1f3ca4904dbf9a7498`; the working tree was clean before drafting.
GitHub's authenticated repository API currently reports `private: false`, `visibility: public` for `Hadden-Industries/agent-skills`.
The `private: true` field in `package.json` prevents npm publication; it does not make the GitHub repository private.
Visibility is an observed fact, not a proposed setting change.
The earlier private-repository inventory excluded this repository for that reason.

The governing local constraints are [AGENTS.md](../../AGENTS.md), the [evaluation runtime](../evaluation-runtime.md), the [evaluation modernization plan](2026-10-03-evaluation-modernization.md), and [plugin release identity](../plugin-releases.md).
All REQ, AC, QA and DEC records below are proposed amendment records, not claims of owner acceptance.
This draft changes no workflow, dependency, generated distribution, historical evidence or repository setting.

Requested reference inputs:

| Input                           | Exact identity                                                                                                                                                                                                    | Use and limits                                                                                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BBCode retention plan           | `C:\Users\maksy\GitHub\steam-community-bbcode\docs\plans\2026-10-07-github-actions-artifact-retention.md`; SHA-256 `66ffabae4aea8ed5fdfeb6ebf98240ab8359065269332e4dd1131c9a609d6c7e`                             | Adapt its evidence and consumer analysis; its historical draft baseline is not this repository's acceptance.                                                                                                                  |
| Delivered BBCode implementation | [PR #18](https://github.com/MaksymShostak/steam-community-bbcode/pull/18), source `4cb54e7697471a482668722ead5aa96db0e65682`, normal merge `3c33db288e1eb59032446adb2238ecf9765f0a66`                             | Reuse the lessons from passing local, independent and hosted verification, including repaired reporter defects. Its package archive and release candidate have consumers absent here.                                         |
| Other producer handoff          | `C:\Users\maksy\Desktop\github-actions-artifact-handoff-2026-10-07.md`; SHA-256 `5016f5cfc0af347ca07cb6863c6a02bd12fb649f9930394fc53fed606c15b52b`; producer candidate `a02e8435646ef1573dfa14c6b4bf87f9fc033ca6` | Reuse safe raw-log streaming, explicit evidence gaps and publication separation. The producer's zero-artifact hosted run had a cancelled lane and failed aggregate; its later local pass does not turn that hosted run green. |

HISEW applicability is active/personal for the explicitly selected `agent-skills` checkout.
Its retained workflow state is `handoff-committed`, with no current verification gaps; a new execution requires its own accepted scope.
Configured profiles are `focused` (`npm run test`), `affected` (`npm run build:check`, `npm run test`) and `full` (`npm run verify`).
Their path coverage/input ordering is undeclared, so command resolution does not prove workflow coverage.
Planning inspection does not adopt the prior execution, start another execution, dispatch reviewers or authorize hosted runs.

## Observed producers, consumers and waste

Both authored workflows use the existing pinned `actions/upload-artifact` v7.0.1 commit `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`.
Neither contains an artifact download or a downstream job that consumes its uploaded bytes.
A scoped search of maintained workflows, scripts, tests and documentation found no consumer of either archive name.
Unknown external/manual file consumers remain a pre-implementation question; absence from repository code is not proof of their absence everywhere.

| Producer                                                                                    | Current execution and upload                                                                                                                                                                                                                                              | Proposed replacement                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Committing-to-git Linux verification](../../.github/workflows/committing-to-git-linux.yml) | Manual `workflow_dispatch` only; requested revision, Ubuntu 24.04, Node 24, 30-minute deadline. Always uploads `$RUNNER_TEMP/committing-to-git-linux/`: environment, install, build-check and TAP text; retention 30 days.                                                | Keep the existing commands, requested revision, native exit status and text evidence. Remove the archive upload; protect diagnostic streaming and add a bounded result summary.         |
| [Evaluation consumer conformance](../../.github/workflows/evaluation-conformance.yml)       | Every PR and manual dispatch; Windows 2025 and Ubuntu 24.04, Node 24.21.0/Python 3.14.7, 20-minute deadline, `fail-fast: false`. Always uploads the entire `$RUNNER_TEMP/evaluation-conformance/` and `.agent-tools/evaluation/acquisition-failures/`; retention 30 days. | Keep acquisition, all deterministic checks and both lanes. Remove the archive upload; stream allowlisted native diagnostic records, including partial acquisition/conformance failures. |
| GitHub-managed CodeQL and Dependabot                                                        | Provider workflows exist outside the two authored YAML files. No separately authored SARIF archive was found in these workflows.                                                                                                                                          | Preserve provider behavior. SARIF remains a file/native code-scanning input where applicable; do not print complete SARIF, add a new upload, or alter filtering.                        |
| Local plugin packaging/release preparation                                                  | `package:plugin` and `preparePluginRelease.js` produce a real installable ZIP and provenance; no authored Actions release workflow was found.                                                                                                                             | Preserve these file products and their exact identity/recovery contracts. This amendment removes CI diagnostic archives only.                                                           |

The current conformance workflow has **no push/main trigger**.
Ordinary PR updates create its bundles; a merge to `main` does not, by itself, invoke this authored workflow.
The Linux workflow is manual only.
Do not add BBCode's documentation selector or change event/path filters to solve this repository's upload problem: removing these uploads makes all existing invocations artifact-free while retaining the current qualification breadth.

Authenticated Actions inventory on 8 October 2026 returned one complete page: 45 non-expired artifacts, **882,928,477 bytes** (approximately **842.03 MiB**).
These are provider-reported compressed archive bytes, not expanded workspaces or an account billing statement.

| Retained family                         | Count |       Bytes | Approximate MiB |
| --------------------------------------- | ----: | ----------: | --------------: |
| `committing-to-git-linux-*`             |     7 |     174,309 |            0.17 |
| `evaluation-conformance-ubuntu-24.04-*` |    19 | 437,406,062 |          417.14 |
| `evaluation-conformance-windows-2025-*` |    19 | 445,348,106 |          424.72 |
| Total                                   |    45 | 882,928,477 |          842.03 |

The latest inspected [evaluation run 37252336997](https://github.com/Hadden-Industries/agent-skills/actions/runs/37252336997), PR source `506bf14a4d0321f05c10ff7a267d3a2fb416f40b`, passed and produced 24,431,799 Linux bytes plus 24,618,997 Windows bytes: approximately **46.78 MiB per two-platform run**.
These expire on 4 November 2026 under their current 30-day retention.
The latest inspected [manual Linux run 37338252379](https://github.com/Hadden-Industries/agent-skills/actions/runs/37338252379), source `710298f8e210dd220d5ca03ca3993581cb28d644`, passed and produced 29,515 bytes.
Those historical sources are observations, not proof for the current or eventual changed candidate.

Read-only inspection of the Linux ZIP (artifact ID `11321262053`) found **6,792 entries and 66,457,110 expanded bytes**, entirely under `_temp/evaluation-conformance/`.
The bridge fixture alone held 43,766,004 bytes, including a copied checkout with `node_modules` and an 11,427,952-byte esbuild executable.
Two installation fixture trees each held roughly 8.58 million bytes; the archive also contained a Node compile cache and copied/generated skill trees.
The source confirms this behavior: `tests/scripts/skill-up-invocation.contract.mjs` copies dependencies into a disposable bridge checkout; `check-installation.js` copies and installs generated skills; the workflow makes their common temporary parent its upload root.
Those copies are required runner inputs for the existing tests, not necessary remote evidence.
Removing the upload does not authorize deleting fixtures early, reducing consumer tests or rewriting their disposal ownership.

The current sample shows that shortening retention would preserve the main mistake: routinely archiving copied software and caches.
There is no established same-archive consumer here, so the BBCode seven-day shared archive and the producer's dependency-lock job-output transport do not apply.

## Risk route and selected decisions

**Proposed route: R2.** The product/API remains unchanged, but CI diagnosis, candidate-controlled output, failure propagation and assurance evidence cross a runner trust boundary.
A defect could hide a failure, interpret a workflow command or falsely present deterministic fixture results as production assurance.
Reversal is a reviewed Git revert restoring future uploads; it cannot recreate evidence lost from already disposed runners or expired logs.

Minimum lifecycle records: accepted exact plan/configuration scope, native route/execution record, focused and final verification, immutable independent review targets, hosted readbacks and native handoff.
Use the currently configured external HISEW evidence destination for personal records; rediscover it before producing implementation receipts.
Do not place personal receipts into product output roots or invent engine/reviewer acceptance.
The owner accepts the exact configuration changes; commits, pushes, review dispatch and release/publication remain separate authorities.

| Decision | Proposed choice and rationale                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-001  | Zero Actions archives in both authored workflows, including manual and failed invocations. No generic `retain_reports` input and no automatic failure bundle: all identified contents are diagnostics or reproducible fixtures.       |
| DEC-002  | Native logs carry required diagnostic text; escaped summaries carry source/run/attempt/tool identities, native outcome, missing records and limitations. Local native report files may still exist on runners.                        |
| DEC-003  | Retain both evaluation platforms, exact existing test commands, dependency identities, deadlines, events and native consumer validators. Artifact reduction does not establish or change platform qualification.                      |
| DEC-004  | Preserve file products with real consumers: local installable plugin ZIP/provenance, authoritative evaluation records and native CodeQL SARIF. None requires retaining these two Actions diagnostic archives.                         |
| DEC-005  | No archive deletion, retention-setting change, automatic cleanup service, documentation selector, cache transport, job-output encoding, live-model execution or release workflow in this scope. Historical archives expire naturally. |
| DEC-006  | Independently implement the small reporting boundary using the existing Node standard library, current npm entry points and existing YAML parser for workflow tests. Reuse producer behavior, not literal licensed implementation.    |

GitHub documents that logs and job summaries do not consume the artifact allowance and that artifacts/Packages share storage while cache storage is separate. [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
GitHub also describes free standard-hosted-runner use in public repositories; the API visibility observation is therefore material to the user's cost premise.
This draft promises reduced archive creation, not a verified change to the owner's bill or private-repository allowance.
The measured archive total is not billed usage, and deleting records would not undo already accrued usage.

Native command suspension and summaries already exist in GitHub Actions; summaries have a 1 MiB per-step limit. [Workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)
Use the much smaller proposed summary budget below.
Do not add a reporting dependency, protocol shim or independent report validator.
The repository is MPL-2.0; the BBCode package and other producer use AGPL-3.0 boundaries.
No copied producer code or invented cross-license clearance is proposed.
Retain existing third-party notices and reviewed dependencies; a new dependency/adopted implementation requires its own current support/version/rights evidence and exact approval.

## Proposed requirements and acceptance criteria

| Requirement                                            | Acceptance criterion                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-001: remove routine archive storage                | AC-001: both authored YAML files have no upload/download-artifact calls, and hosted runs of each changed workflow report zero Actions artifacts, with every expected lane accounted for.                                                                                                                |
| REQ-002: retain actionable native evidence             | AC-002: available environment/install/build/TAP text, acquisition failure records, consumer command output, receipts, process observations and native failure reports are visible in protected logs; summaries identify unavailable evidence rather than implying completeness.                         |
| REQ-003: preserve qualification meaning and failures   | AC-003: commands, order, revision selection, dependency pins, platform matrix, telemetry settings and exit semantics remain equivalent; a native failure or reporting failure cannot yield a successful verification result. Expected negative-fixture results remain governed by their existing tests. |
| REQ-004: protect runner commands and sensitive records | AC-004: candidate-derived text cannot inject workflow commands through the supported streaming boundary; summaries escape markup; file collection rejects redirected/out-of-root paths and excludes credentials, homes, copied inputs and unrelated records.                                            |
| REQ-005: preserve genuine file and evidence contracts  | AC-005: plugin ZIP/provenance, release ledger and hashes, authoritative evaluation history/runtime records, fake-provider/authorization boundaries and CodeQL file treatment remain unchanged; generated correspondence still passes.                                                                   |
| REQ-006: demonstrate delivery honestly                 | AC-006: final local verification, independent review, hosted platform results, zero-artifact inventories and native handoff reference their actual candidates; partial/cancelled runs cannot satisfy hosted acceptance.                                                                                 |

## Exact proposed configuration scope

The repository's `AGENTS.md` requires exact approval before configuration mutation.
Accepting a concrete revision of this table is the proposed implementation approval; this request to write a plan is not that approval.
Likely source/test paths are predictions and may be refined within the accepted behavior; any materially different setting needs another concrete proposal.

| File and setting                                                                                                                               | Proposed smallest change                                                                                                                                                                                                                                                                                              | Preserved behavior                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/committing-to-git-linux.yml`: command-output handling, environment summary and final `Retain verification output` step      | Route existing candidate-derived text through the protected evidence helper; keep the four native output records; replace the upload step with reporting after failures when `!cancelled()`. Use the checked-out `git rev-parse HEAD`, not just the dispatcher revision string or workflow SHA, as the tested source. | `workflow_dispatch` and required `revision` default `main`; Ubuntu 24.04, Node 24, 30-minute timeout, read-only permissions, exact checkout/setup pins, full Git fetch, disabled credential persistence/cache, npm ci, build:check and existing Linux test targets.                                                       |
| `.github/workflows/evaluation-conformance.yml`: acquisition/check output handling and final `Retain conformance and acquisition evidence` step | Protect existing command stdout/stderr, retain command-stage outcome for reporting, and replace the upload with failure-aware collection of allowlisted native text. Keep the explicit isolated temp root and acquisition failure path.                                                                               | PR/manual events, matrix Windows 2025/Ubuntu 24.04, `fail-fast: false`, 20-minute timeout, PowerShell, read-only permissions, setup action pins, Node 24.21.0/Python 3.14.7, `npm ci --ignore-scripts`, reviewed setup script, telemetry settings, build:check/eval:check and all five existing explicit Node test files. |
| `package.json`: `scripts.ci:evidence`                                                                                                          | Add `node scripts/ci/verificationEvidence.js` as one repository-owned entry point with capture/report operations for the two workflows. It wraps/observes the existing native commands; it is not another evaluator or qualification schema.                                                                          | Existing scripts/verify order, engines, dependencies, private flag and license. No lockfile change, npm pin or version/release advancement.                                                                                                                                                                               |

Predicted implementation seams: `scripts/ci/verificationEvidence.js`, focused reporter tests under `tests/scripts/`, and workflow-contract tests under `tests/scripts/` using existing `yaml`.
Use explicit command arguments and native process execution; no string-built shell evaluation.
CI bookkeeping stays temporary and non-authoritative, outside skill treatment inputs and published plugin content.
Do not edit `src/**/SKILL.md`, generated `skills/`, generated `plugins/`, `evaluation-toolchain.json`, the release ledger, repository policy or HISEW profiles under this approval.
If native gate coverage requires profile changes, prepare a separate exact proposal before changing them.

Local tools currently report Node `v24.21.0` and npm `12.2.0`.
Use those actual installed tools for local/independent review and retain their observations.
Do not substitute an older cached npm merely because it is readily available, and do not silently add a hosted npm pin in this retention amendment.
Hosted logs must state the npm version actually supplied by the existing runtime setup.

## Reporting boundary and native evidence map

The evidence helper owns collection, safe streaming and navigation only.
Git, npm, Node's test runner, `build:check`, `inspectToolchain`, the native `skill-up` consumer and existing contract assertions retain their validation responsibilities.
Never infer all-job success from a report containing `PASS`, from a digest, or from the existence of a receipt.
Never convert `consumer-smoke-passed`, `assured-cutover-blocked`, a test-only qualification override or `observed-matrix-only-not-production-qualification` into production assurance.
The current toolchain manifest marks Linux native qualification `pending`; this plan cannot change that.

Expected native text, mapped to current producers:

| Producer/root                                       | Text to retain remotely                                                                                                                                                                                                                                   | Excluded from collection                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux `$RUNNER_TEMP/committing-to-git-linux/`       | `environment.txt`, `install.txt`, `build-check.txt`, `tests.tap`; individual command identity, status and missing-stage explanation.                                                                                                                      | Any unrelated runner temporary content.                                                                                                                   |
| `.agent-tools/evaluation/acquisition-failures/`     | Current invocation's `failure-*.json`, including stage, expected/observed archive identities and already bounded stdout/stderr; raw traceback/setup output.                                                                                               | Downloaded/extracted executable trees and licenses as redundant CI diagnostic payloads; local acquisition still validates and retains them on the runner. |
| `evaluation-conformance-*` child roots              | `commands.json`, available `receipt.json`, `bridge-transport-fixture.json`, and `skill-up-results/iteration-1/report.json`; native command stdout/stderr when parsing fails.                                                                              | Skill files, binary fixtures, configuration and isolated home contents.                                                                                   |
| `evaluation-workspace-*` child roots                | Available `projection-receipt.json`, `commands.json`, `receipt.json`, and the actual producer-selected `consumer-results/iteration-1/report.json` or `reports/iteration-1/report.json`. Preserve identities, failures and declared transport limitations. | Materialized skill payloads, copied fixtures, authored cases and home/config trees.                                                                       |
| `evaluation-installation-*` child roots             | `receipt.json` plus `process.json` for the four maintained skills in explicit/default/full-depth modes; include failures before an aggregate receipt exists.                                                                                              | Copied `checkout/`, installed `.agents/skills/` and isolated homes. These remain real test inputs and are not deleted early.                              |
| `evaluation-process-matrix-*` child roots           | Aggregate receipt when available; each started scenario's `observation.json`, `consumer.stdout.log`, `consumer.stderr.log` and `reports/iteration-1/report.json`, including unresolved cleanup and negative containment observations.                     | Executables, fixture inputs, arbitrary role/config files and unrelated descendants. Existing observation records own correlation/closure meaning.         |
| Bridge/Windows job fixtures invoked by `eval:check` | Bridge receipt/captured stdout/stderr and started fixture's native host result/closure/readiness records needed to explain the assertion; map exact current filenames and roots during SLICE-002 before upload removal.                                   | Copied `checkout/node_modules`, generated packages, prepared packets/transcripts/authorization material, full fixture homes and compile caches.           |

Only known current-invocation roots and producer-relative files are eligible.
Discover bounded child directories beneath the explicit runner temp parent; do not follow arbitrary paths mentioned by an assertion or native report.
Check ordinary directories/files, resolved ancestry, symlinks and Windows junctions before reads.
Do not implement recursive `**/*.json` or print every JSON/TXT/LOG file in the uploaded tree: names/extensions do not establish a diagnostic or privacy contract.
The discovery implementation must enumerate all eligible invocations, including repeats, not select the last root or first glob match.
Record observed file path, byte length and SHA-256 as navigation/corruption identity, not authentication or native schema acceptance.

Capture child text safely while commands run so cancellation does not erase all available progress.
Protect candidate-derived stdout/stderr and later raw files with a fresh cryptographically unpredictable command-suspension token; keep it out of child environment/arguments and restore command interpretation in `finally`.
Avoid accidental token collisions when streaming stored data; cover the live-stream collision policy too.
Write trusted summary/control output only after interpretation is restored.
Preserve the native exit status/signal and make any recorder/reporter failure independently fatal; do not let tee, a successful parser or a later summary mask a failed command.
Do not claim this wrapper is a sandbox for arbitrary checked-out code.

Proposed bounds: **64 KiB UTF-8 per job summary** and **32 MiB of emitted evidence text per job**, counting captured child output and supplemental records.
The summary gives the checked-out source, workflow source when different, event/revision input, run/attempt/job/OS, actual tool versions, stage status, file identities, expected negatives, missing evidence and qualification limits.
Escape HTML/Markdown-sensitive content and do not copy full reports into summaries.
Raw text exceeding the accepted log budget must yield a visible evidence-limit failure with identities and an explicit omitted-byte count; no silent truncation or automatic archive fallback.
Confirm these bounds against actual Linux/Windows output before accepting the changed hosted candidate; growth beyond them triggers a revised evidence decision.

A malformed, unreadable or missing report must not prevent readable sibling records from appearing.
Emit permitted raw text before an optional native JSON parse, preserve traceback/non-JSON diagnostics, and accumulate failures until available evidence and the summary are written.
Check required records on failed as well as successful paths, while distinguishing stages that never started.
Expected wrong-marker/error fixture runs can intentionally lack a success receipt or have a native report `FAIL`; their existing Node assertions determine whether that test passed.
Report missing evidence honestly without incorrectly treating every negative-fixture receipt as mandatory for job success.
Cancellation can prevent final collection entirely; summaries/logs must never claim cancelled evidence is complete.

## Quality scenarios

| Scenario                                  | Stimulus and required observable response                                                                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-001: routine success                   | Both evaluation lanes and manual Linux verification pass existing native commands; their run artifact inventories are empty. Logs retain actual identities and diagnostics; summaries fit 64 KiB.                                                                             |
| QA-002: setup fails early                 | Dependency install or pinned native acquisition fails before `eval:check`; available command output, acquisition failure record and traceback remain visible, skipped stages are identified and the job stays failed with zero archives.                                      |
| QA-003: native partial/negative execution | A fixture fails before an aggregate receipt or intentionally returns wrong-marker/error. All available siblings and repeated roots appear; expected negatives remain labeled, native test status controls acceptance, and unresolved process cleanup stays a failure.         |
| QA-004: corrupt evidence                  | One middle report is malformed/unreadable while records before and after it are valid. Safe raw text and both valid siblings are emitted, missing required top-level evidence is listed on success and failure, and reporting failure cannot turn the job green.              |
| QA-005: hostile text/path                 | Fixture diagnostics contain `::error::`, output/env commands, HTML, backticks, a redirecting symlink/junction and an out-of-root path. Commands are not interpreted, the summary escapes text, rejected paths are identified and no substituted content/credentials are read. |
| QA-006: repeated/large output             | Multiple native calls create same-prefix roots and one oversized record. No sibling is accidentally replaced; the configured byte cap produces a visible incomplete-evidence failure without an upload fallback.                                                              |
| QA-007: interrupted/cancelled runner      | Final collection cannot finish. Already streamed diagnostics remain useful, partial evidence is not represented as completion, and rerun attempts retain separate identities. No automatic recovery/cleanup is introduced.                                                    |
| QA-008: product/release compatibility     | Generated correspondence and current deterministic contracts pass unchanged; plugin package/ledger/provenance and authoritative evaluation history remain byte/meaning compatible. CI output collection never reads real evaluation homes or calls a provider.                |

## Vertical implementation slices and proof

All slices belong to the same accepted amendment and integration owner.
Each removal ships with its reporting path and focused proof; do not first delete both uploads and leave diagnosis as later work.
SLICE-002 depends on the shared boundary proven in SLICE-001; SLICE-003 integrates both.
Semantically separate evidence inspection can proceed independently, but this draft grants no delegation or review-dispatch authority.

| Slice                                               | Traceability                                                                                     | Independently demonstrable outcome and proof                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Delivery/cleanup implication                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SLICE-001: artifact-free Linux verification         | REQ-001/002/003/004; AC-001/002/003/004; QA-001/004/005/006; DEC-001/002/006                     | Implement the small evidence boundary and proposed npm entry point; integrate it with the existing manual Linux command path and remove that upload. Use real child processes and temporary report files to verify native failure/signal propagation, safe workflow-command streaming, escaped/bounded summaries, missing records on failure, malformed middle records with valid siblings, and path rejection. Workflow contracts prove unchanged revision/event/runtime/tests and no artifact call. | One complete workflow can be reviewed/reverted independently. Existing historical bundles remain retained.                                                                                                                         |
| SLICE-002: artifact-free evaluation conformance     | REQ-001/002/003/004/005; AC-001/002/003/004/005; QA-001/002/003/005/007/008; DEC-001/002/003/004 | Integrate protected acquisition/native checks and the exact allowlist above; resolve bridge/Windows native record mapping, then remove the broad temp/failure upload. Exercise early acquisition failure, repeated roots, failed consumer/process checks, all installation modes, expected negative reports and absent aggregate receipts. Compare the native evidence inventory against a representative former ZIP and failure outputs; no copied dependency/cache/credential tree is printed.      | Keep fixture generation/disposal ownership and evaluation schemas unchanged. Each platform still reports its own limitations; Linux pending assurance is not promoted.                                                             |
| SLICE-003: final qualification and observed rollout | REQ-001..006; AC-001..006; QA-001..008; DEC-001..006                                             | Freeze the integrated candidate; pass applicable focused/affected tests and one final HISEW full `npm run verify`, independent CI/security review and both changed hosted workflows. Read run/job outcomes and per-run artifact inventories, including rerun attempt identities. Confirm zero archives and usable complete evidence, not merely absence of upload syntax.                                                                                                                             | Deliver only with separate authorized Git actions. Observe initial actual PR/manual usage, preserve references before expiry and complete native handoff. Revert reviewed reporting/removal changes if diagnosis or gates regress. |

Focused tests exercise the actual reporter and child-output boundary; do not create tests that merely assert the new implementation's private constants.
Use independent expected outcomes and native parser/consumer assertions.
Existing `yaml` owns local YAML parsing; GitHub owns hosted action/expression semantics, so local structural tests cannot replace hosted verification.
Use fake processes/text/files only at genuine external/failure boundaries; never mock an expected success report as proof that the native consumer succeeded.

Before code review, pass existing `format:check` and `lint`; `build:check` or full `verify` can satisfy them on unchanged relevant inputs.
The existing `test` glob includes new `*.test.mjs` reporter/workflow tests; confirm discovery rather than assuming coverage.
The current full profile runs `npm run verify`, which includes `diff:check`, `build:check`, skill validation/lint, `eval:check` and repository tests.
Use that final candidate evidence and native handoff once; refresh after changed inputs/failure or an actual engine requirement, not solely for commit ceremony.
An `affected` run omits `eval:check` and is insufficient for final acceptance of SLICE-002.
Resolve undeclared profile coverage using native policy before claiming engine coverage; do not fabricate a helper receipt or silently edit profiles.

Independent review receives the frozen exact patch/tree, actual Node/npm/Python identities, native output paths, source/reference hashes and complete relevant diagnostics.
The delivered BBCode review found three defects worth retaining as regression targets: all-or-nothing collection lost valid siblings; required missing records were checked only on success; malformed report/traceback text was lost before parsing failed.
Refresh affected evidence after any review fix and re-freeze the target.
Review completion, local gates, hosted CI, native handoff, protected-main integration and plugin publication remain distinct acceptance boundaries.
No model-based evaluation, provider preflight/login, security scan dispatch or review dispatch is authorized by writing this draft.

## Rollout, observability and recovery

Before implementation, the owner accepts the exact plan/configuration scope and resolves any real external/manual file consumer.
If one exists, record the exact artifact members, consumer, required duration and recovery operation; re-plan that exception rather than introduce a blanket report toggle.
Recheck clean/retained user changes, explicit checkout ownership, baseline, current producers and HISEW execution state before starting the new accepted execution.
Do not reuse an older task's delivery authorization for this repository.

Hosted proof must cover the changed evaluation PR path on both platforms and the manual Linux workflow targeting the exact accepted candidate.
Account for GitHub's PR merge checkout versus PR head and for Linux's separately requested revision; capture both tested source and workflow identity where different.
Acquire explicit dispatch authority if needed; this planning request schedules or runs no remote tests.
Use a disposable qualification failure only through an approved fixture/test route, without broadening public workflow inputs or silently changing policy to manufacture evidence.
Inspect a failed hosted case when available; if no hosted failure path was observed, state that limit and retain local fault-injection proof rather than claiming one occurred.

Acceptance signals: expected job set concluded successfully, native failures still fail, summaries preserve limits, all mapped records are accounted for, required diagnostic logs are readable, and `actions/runs/<run-id>/artifacts` is empty for each changed workflow run.
The integration owner observes the first real PR update and manual qualification after delivery.
No upload should reappear after a failed/rerun attempt; cancellation is a recorded evidence limitation, not a successful negative test.
Do not claim main merges produce savings from a workflow that has no push trigger.

The target is zero newly created diagnostic archive bytes; the inventory is expected to decrease as existing archives expire.
At the latest sample's rate, avoiding one two-platform evaluation upload avoids approximately 46.78 MiB of new compressed archives; this is a sample-based projection, not a guaranteed run size or monetary saving.
No existing archive is deleted by this plan. The 7 Linux records currently expire between 21 October and 4 November; evaluation records expire between 2 and 4 November.
Any deletion/export of historical records requires an exact separate decision.
Logs/summaries follow provider retention; do not invent a 30-day log promise from the removed artifact setting.
Preserve necessary qualification references before provider expiry through the established external evidence procedure, not by adding another CI bundle.

Abort integration if the native command set changes unintentionally, evidence is omitted or unsafe, diagnostics exceed the accepted budget, an external file consumer is discovered, or local/hosted qualification fails.
Retain the failed invocation and partial evidence before forwarding a fix.
A reviewed revert restores these two uploads for future runs, with their original conditions/windows; verify the reverted candidate.
It does not restore expired archives/logs or disposed runner files. Re-execution creates evidence for a new attempt, not a reconstruction of a lost original run.
If the reporter changes product-owned schema/identity, correct the design rather than migrate history under this amendment.

No data backfill is needed: authoritative evaluation records, historical migration manifests, release versions and publication ledgers are untouched.
No source retirement, plugin refresh, host activation, version/tag change or publication is implied.
No configuration, source branch, generated file or credential/home cleanup is part of this draft's completion.

## Unknowns and re-planning conditions

| Question                                                    | Cheapest discriminating evidence                                                                                                                                                                             | Owner/action if unresolved                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Does someone actually download these archives as files?     | Repository search already found no consumer; owner names any external/manual workflow and its exact required members.                                                                                        | Integration owner; stop removal for that consumer and propose a bounded exception with a real recovery purpose.              |
| Are all failure records visible without a recursive upload? | Inspect actual early acquisition, negative fixture, process cleanup and bridge/Windows failure records; compare allowlisted native filenames to existing producer code and representative archive inventory. | Implementer; complete the exact mapping before SLICE-002 removal, without changing qualification semantics.                  |
| Are log limits sufficient on both platforms?                | Measure captured text and summary bytes on representative complete/failure runs.                                                                                                                             | Owner revises bounds or evidence design; no silent truncation/archive fallback.                                              |
| What is the provider's actual log availability/retention?   | Read existing run logs and applicable repository/organization settings without mutation; retain exact candidate references.                                                                                  | Integration owner; record the observed limitation and recovery window rather than assume artifact retention applies to logs. |
| Can configured native profiles admit the changed CI paths?  | Native coverage/input assessment plus actual test discovery and hosted action results.                                                                                                                       | Owner approves any necessary exact profile change separately; undeclared coverage is not assurance.                          |
| Did baseline or archive consumers change before execution?  | Re-read source/remote default-branch identity, workflow definitions and current archive references.                                                                                                          | Re-baseline the plan before implementation if material behavior changed.                                                     |

Re-plan for a genuine binary/file diagnostic consumer, publication/recovery payload, cross-job handoff, new dependency/runtime, provider-authenticated evaluation evidence export, policy/event filtering, changed qualification thresholds, visibility/billing setting or retention requirement.
Do not import the producer's private-runner gating or release windows, BBCode's consumer package, or Google's distribution export design without a consumer in this repository.
The higher outcome is maintainable, reviewable verification whose evidence remains honest while routine Actions runs stop archiving reproducible workspaces.

## Readiness record

This proposed draft supplies the current inventory, real producer/consumer boundaries, exact configuration proposal, requirements/scenarios, three vertical slices and a falsifiable delivery/recovery path.
Implementation prerequisites remain exact owner acceptance, resolved external consumers and native verification coverage for the accepted candidate.
Only this plan is created by the current request. No CI configuration, source/package artifact, remote run, commit, push, merge, visibility setting or historical archive is changed.
