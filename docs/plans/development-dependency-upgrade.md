# Development dependency upgrade

## Accepted basis and intended outcome

The repository owner requested this plan and its implementation on 10 October 2026 in chat `01a1232e-ecb4-76e0-8136-496501cd4eac`.
The request authorizes the configuration changes specified here, commit messages, signed commits, and pushes on the current local `main`.
Commit this plan alone at the first commit point, consolidate implementation before broad review, use narrow follow-up reviews, and reserve external reviews for the final implementation commit.

The purpose is to let maintainers deliberately refresh current stable development tools while reproducing each selected graph from an exact lockfile and retaining evaluation, packaging, and Markdown trust boundaries.
Local and fetched remote `main` match at `e4bba3a86b996269ebd3ec5a7f7b013dd8644412`; the starting working tree is clean.
Publication preflight observes a viable direct signed push to `origin` / `refs/heads/main`, with no required PR policy.
Recheck live ancestry before publication; never force-push or synchronize by discarding another actor's changes.

The inspected implementation precedents are:

| Reference                                                                                                    | Reused lesson                                                                                                               | Boundary                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [UO: Make npm dependency ranges floating](codex://threads/01a11a9c-1875-7981-8df1-d30176c1b69b)              | Stable `>=` floors, exact lock, native npm eligibility, bootstrap before npm/cache consumers.                               | Its production dependency expansion and publication permissions do not transfer.                 |
| [google: (chrome) Make npm dependency ranges floating](codex://threads/01a11c30-e213-7fb3-b983-cb9b24fd8d23) | Qualify actual consumers and consolidate before final external reviews.                                                     | No browser dependency or runtime-cache campaign is needed here.                                  |
| [BBCODE: Update devDependency version ranges](codex://threads/01a11c48-c8bd-7fd1-9786-3598157e972f)          | Inspect every manifest; select latest registry versions independently; regenerate outputs through their producer.           | Its later runtime, Python, and Actions upgrades are outside this scope.                          |
| [WebVOWL: Implement floating npm dependency versions](codex://threads/01a11e73-3fdf-7e82-8d17-82bf22dbb2ab)  | Commit the plan first; freeze and review the consolidated implementation; test native npm enforcement in isolated fixtures. | Never run a package probe against the home directory or inherit another chat's merge authority.  |
| OwlAPI `docs/plans/development-dependency-upgrade.md`                                                        | Separate range eligibility from exact qualified package identity, retained archive graphs, and actual runtime acceptance.   | This repo already admits Node `>=24`; no Node 26 promotion or new platform promise is requested. |

## Risk route

Risk class: R1.

Decision owner: The requesting repository owner, Maksym Shostak.

Reasoning: Bounded development-tool maintenance with same-major direct upgrades and native setup-policy validation, inferred from the current manifests and registry metadata.
There is no proposed persistent-data migration, public runtime contract change, authentication/privacy change, concurrency redesign, or deployment change.
The existing conformance receipt boundary stays exact and fail closed; an added bootstrap is included in its successful-step inventory.
A material trust-boundary or runtime graph change requires reassessment rather than implicit scope expansion.

Potential blast radius: Developer installs, lint/format/build output, deterministic evaluation consumers, and the three workflows that install root dependencies.

Reversibility: A new reviewed commit can restore the coherent root manifest, lock, evaluation identity, and CI/bootstrap policy; reinstall that complete graph.
Do not rewrite history or restore unrelated changes.

Principal unknowns: Transitive graph changes, newly emitted diagnostics, installer discovery behavior, license/notice changes, native optional binaries, and hosted Windows/Linux execution.

Required artifacts: This accepted brief, live registry selection and before/after graph evidence, HISEW execution/verification/handoff receipts, and final review dispositions.

Required specialist lenses: Selected ordinary OpenAI Review Agent plus scoped dependency license, script, and advisory assessment by the implementer.
No repository-wide security scan or cross-vendor assurance is justified by the observed R1 scope; reroute if a material security boundary change emerges.

Required verification: Governed `focused` (`npm test`), `affected` (`npm run build:check`, `npm test`), and repository completion `full` (`npm run verify`) obligations as resolved by HISEW, plus native install/policy checks.
Use the final candidate for canonical receipts; do not manually duplicate the full gate.
Profile input-order and path-coverage declarations are absent, so passing commands do not prove exhaustive coverage.

Required human approvals: The originating request preauthorizes this plan's changes, messages, commits, and pushes.
It does not authorize an unrelated installation, model evaluation, deployment, release, destructive Git operation, or policy weakening.

Maximum sensible autonomy: Implement, qualify, review, and directly publish the signed plan and implementation commits within these boundaries without repeated phase prompts.

Next lifecycle step: Capture this baseline and start an owned R1 execution, validate and commit the plan, then implement the slices below with HISEW's implementation procedure.

## Exact configuration scope and selection

Registry `/latest` metadata was inspected independently on 10 October 2026.
Installed development runtime: Node `24.21.0`, npm `12.2.0`; selected npm remains the current stable `12.2.0`.
All selected direct packages declare MIT except YAML (ISC), no selected direct package is deprecated, and observed engines/peers admit the current runtime and ESLint 10.
Retain metadata, integrity, distributed terms, scripts, graph deltas, and advisory output externally before final adoption.
Registry versions are selection evidence; actual locked installation and consumer gates own qualification.

| Root development dependency | Existing declaration | Selected declaration |
| --------------------------- | -------------------- | -------------------- |
| `@eslint/js`                | `^10.0.1`            | `>=10.0.1`           |
| `agent-skills-eval`         | `0.1.1`              | `>=0.1.1`            |
| `ajv`                       | `8.20.0`             | `>=8.20.0`           |
| `cross-spawn`               | `^7.0.6`             | `>=7.0.6`            |
| `esbuild`                   | `^0.28.2`            | `>=0.28.2`           |
| `eslint`                    | `^10.8.0`            | `>=10.12.0`          |
| `eslint-config-prettier`    | `^10.1.8`            | `>=10.1.8`           |
| `globals`                   | `^17.8.0`            | `>=17.13.0`          |
| `prettier`                  | `^3.9.6`             | `>=3.9.9`            |
| `skills`                    | `1.7.0`              | `>=1.7.2`            |
| `yaml`                      | `2.9.1`              | `>=2.9.1`            |

The smallest authorized configuration bundle is:

- `package.json`: replace all 11 root registry development declarations with the selected floors; add `devEngines.packageManager` with `name: npm`, `version: >=12.2.0`, and `onFail: error`.
  Preserve `engines.node: >=24`, scripts, and the absence of `packageManager` and of a versioned development runtime declaration.
  Local npm eligibility is a native minimum; CI selects an exact reference.
- `package-lock.json`: refresh the root graph using npm 12.2.0 with lifecycle scripts disabled, preserving exact resolved versions and integrity.
  Use strict peers; do not use force or legacy peer resolution.
- `evaluation-toolchain.json`: update only `packages.skills` to the exact newly qualified locked version `1.7.2`; any other changed listed package must follow its actual selected lock identity.
  Keep native skill-up 0.12.0 archives, executable/license hashes, platform qualification markers, schema/contract/projector versions, and exact installed-version rejection unchanged.
- `.github/workflows/evaluation-conformance.yml`: add an explicit exact npm 12.2.0 bootstrap/version check after setup-node in the `conformance` job, before npm environment recording and frozen install.
  Preserve the Windows/Linux matrix, Node pin, `package-manager-cache: false`, script-disabled acquisition, permissions, timeouts, required gate, and exact reuse proof; the Python revision below supersedes its original pin.
- `.github/workflows/committing-to-git-linux.yml` and `.github/workflows/defining-concepts-linux.yml`: add the same exact npm bootstrap/version check after setup-node, before npm probes/install.
  Preserve the manual triggers, existing script behavior, runtime selections, and evidence capture.

These are all tracked npm manifests; `tooling/markdown/package.json` uses retained `file:` archives with a separate exact lock and explicit future registry target.
Preserve that entire qualified archive/source/workflow identity and optional-platform graph byte for byte.
Also preserve installed/imported skills, `skills-lock.json`, workflow action pins, Markdown policy/profile, package release metadata, and historical evidence.

## Accepted Python scope revision, 10 October 2026

After the app restart, the owner explicitly requested: "Update the repo and every dev dependency to Python >= 3.15.0".
This supersedes the original Python exclusion and runtime selections for development tooling, while retaining the R1 route and all existing evaluation trust boundaries.
Python 3.15.0 is the current stable release, verified against the [official release](https://www.python.org/downloads/release/python-3150/).
The installed base interpreter is already 3.15.0; the old local `.venv` references a removed 3.14.7 interpreter.

SLICE-004 extends REQ-001/AC-001 and QA-001 to current Python development tooling:

- Require Python >=3.15.0 in repository setup entry points, reused virtual environments, and the Windows evaluation process host. Use the existing shared setup module for the common prerequisite; reject older interpreters before acquisition or workload launch. Portable skill scripts and historical observations retain their own compatibility contracts.
- Set `python-version: "3.15.0"` in `.github/workflows/evaluation-conformance.yml` and `.github/workflows/defining-concepts-linux.yml`. Retain pinned Actions, triggers, platform matrices, permissions and exact receipt validation.
- In `scripts/set_up_evaluation_tools.py`, select current Python development tools through native pip floors: `pip>=26.2.1` and `PyYAML>=6.0.3`. Retain official `agentskills/agentskills` main for skills-ref: its current commit is `69ef37e9424c0a7ea9dd2293b559e43ec8176379`, reporting 0.1.0. The attempted PyPI 0.1.1 candidate changes publisher/source identity and exposes `agentskills` instead of the required upstream `skills-ref` command; its real installation failed the consumer prerequisite. A higher number on that distinct publication is not authority to replace the selected upstream. Do not modify third-party package metadata to impose this repository's interpreter policy.
- Refresh every transitive Python development dependency through pip's supported resolver. Current registry selections are click 8.5.0, strictyaml 1.7.3, python-dateutil 2.9.0.post0, and six 1.17.0; these already match the prior installed versions. Retain installed distribution metadata, source/archive identities, actual terms and `pip check` evidence. Existing current-tracking update semantics remain; no new Python lock format is introduced.
- Preserve the broken `.venv` in a declared external recovery group before creating the replacement with Python 3.15.0. Refresh only Python tooling, without invoking unrelated host/MCP/skill installers. Preserve the old environment until the owner releases its recovery consumer.
- Update current README/toolchain guidance and narrow workflow/setup tests. Prove rejection below the new floor and admission at/above it, safe handling of an outdated virtual environment, actual installed validator execution, and current Windows host contracts. Upstream dependencies remain independently licensed; retain MIT, BSD, dual-license and Apache notices as distributed.

Commit this plan revision before implementation. Consolidate SLICE-004 into one implementation candidate after focused proof, then run fresh final HISEW `full` (`npm run verify`) evidence and required native handoff; prior candidate receipts do not qualify changed inputs.
Use a narrowly scoped follow-up review of this Python revision, preserving the completed broad review and npm repair review. Publish authorized signed commits only after the new final gate passes, then observe automatic Windows/Linux conformance and Markdown CI at the published tip.
Abort publication on unsupported Python 3.15 package installation, validator/host regressions, missing hosted runtime support, or unresolved review findings; retain failures and forward-fix within this scope rather than lowering the interpreter floor or weakening checks.

Predicted source seams are `scripts/ci/conformanceReuse.js` and its tests (require the new npm step to have succeeded), focused native npm/workflow tests, and README/toolchain guidance.
The receipt already binds exact workflow and policy Git blobs, so changed bootstrap inputs cannot reuse an older receipt.
Do not weaken the closed receipt validator or manufacture evidence.
Update current claims about development ranges and exact qualified evaluation versions, retaining dated historical observations as historical.
Build any changed generated payload only with `npm run build`; do not hand-edit generated skills/plugins.
No canonical skill instruction behavior is changed, so this plan authorizes deterministic conformance only, not real-model or trigger evaluation calls.

## Requirements and quality scenarios

| IDs              | Requirement and falsifiable acceptance                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-001 / AC-001 | All 11 registry development entries use the selected stable `>=` floors; `npm ls` reports no invalid graph; exact bundled runtime and Markdown boundaries remain intact.                                                  |
| REQ-002 / AC-002 | Script-disabled frozen installation reproduces the selected lock without rewriting it; a disposable inconsistent manifest/lock pair fails with native npm mismatch diagnostics.                                           |
| REQ-003 / AC-003 | Native npm admits the available 12.2.0 reference and fails closed for a deliberately higher minimum before a fixture command runs; semver eligibility admits later stable majors without claiming an unpublished CLI ran. |
| REQ-004 / AC-004 | Every root npm CI consumer selects exact npm first; successful reused conformance includes that bootstrap, and missing/failed/skipped bootstrap proof is rejected.                                                        |
| REQ-005 / AC-005 | Exact evaluation-toolchain validation, portable/static/native fake-consumer tests, installer discovery, ASCII source/generated validation, lint/format/build and Markdown gates pass without weaker oracles.              |
| REQ-006 / AC-006 | Plan is the first commit; broad review covers the frozen consolidated implementation; narrow fixes refresh affected evidence; signed commits reach remote main only after blocking review/local gates pass.               |
| QA-001           | Clean Node 24.21.0/npm 12.2.0 installation retains lock identity and refuses a mismatched fixture.                                                                                                                        |
| QA-002           | The real npm process refuses an impossible minimum with `EBADDEVENGINES` before a literal marker command executes; all fixtures use explicit disposable cwd.                                                              |
| QA-003           | Failed/skipped/missing bootstrap steps cannot establish authenticated reused conformance; workflow/policy identities reject stale proof.                                                                                  |
| QA-004           | Upgraded tools process the actual repository and generated consumers; no fixture, historical evidence, source ASCII rule, license notice, or package identity is silently relaxed.                                        |
| QA-005           | Interrupted or failed work retains the exact graph/candidate and failed receipts; publication stops until meaningful failures are resolved.                                                                               |

## Slices, proof, and commit points

| Slice                                             | Traceability                                   | Falsifiable proof                                                                                                                                                                                        | Delivery and cleanup implication                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| SLICE-000: Record and commit the plan             | REQ-006, QA-005                                | Current applicability/branch/storage, accepted snapshot and R1 route, plan-only diff, Markdown/link inspection.                                                                                          | First signed commit contains this plan alone; keep it local pending consolidated delivery.                                                |
| SLICE-001: Reproduce the selected developer graph | REQ-001/002/005, QA-001/004                    | Refresh with scripts disabled; inspect distributed terms, lifecycle scripts, advisories and exact deltas; clean ci, npm ls, evaluation identity mismatch rejection, actual installer/conformance checks. | Root manifest/lock/evaluation identities form one recovery unit; retain selection and graph evidence.                                     |
| SLICE-002: Enforce native npm policy across CI    | REQ-003/004, QA-002/003                        | Native isolated positive/negative npm behavior; workflow bootstrap/cache ordering; successful-step reuse rejection; focused tests and current docs.                                                      | Consolidate all source/config/docs and rebuild if needed; create the signed implementation commit before external review.                 |
| SLICE-003: Freeze, qualify, review, and publish   | REQ-001 through REQ-006, QA-001 through QA-005 | Final candidate HISEW route-selected profiles including npm run verify, ordinary full-diff review, dependency assessment, narrow repair follow-ups, live ancestry and signature readback.                | Direct signed push; observe automatically triggered hosted checks; native HISEW handoff with retained evidence and resource dispositions. |

One main agent owns integration and all file mutations; the only delegation is the selected final read-only Review Agent required by the HISEW ordinary-review procedure.
No broad agent fan-out, external publication of review comments, or intermediate external review is required.
SLICE-000 precedes all implementation; SLICE-001 and SLICE-002 share the graph and converge before SLICE-003.
Run focused development feedback while editing, then required integration/final checks after formatters, generators, staging, and commit transitions settle.
Do not repeat successful optional helper checks merely to decorate a commit report.

Native npm owns install/eligibility and peer-resolution oracles; literal marker commands establish whether execution occurred.
Existing independent fixture expectations own evaluator/installer/receipt behavior; actual selected tools own diagnostics and generated bytes.
Mock only genuine external GitHub/network failure boundaries; use real local npm and installed packages for positive consumer proof.
Do not change accepted assertions to agree with new output without independent justification.

## Recovery, observation, and reassessment

No application data/schema migration, backfill, telemetry service, deployment, or package release is proposed.
Observe package/lock identities, runtime versions, peer/script/license/advisory deltas, generated payloads, review output, canonical HISEW receipts, and exact hosted job results.
Local deterministic gates do not establish real-provider evaluation, host activation, installed-user acceptance, or release qualification.
Manual-only Linux workflows remain undispatched unless separately requested; automatic conformance and trusted Markdown runs are separate hosted evidence.

Use HISEW's actual external operator evidence destination and native APIs for workflow records.
Declare task resource groups before accumulation, identify tool-managed disposable fixture roots, retain failed/native evidence, and reconcile inventories/dispositions at handoff.
Remove only proven task-owned disposable inputs after their consumers finish; retained material names its owner, next consumer, and reassessment event.
Preserve the existing root installation and native evaluator as developer resources.

Abort dependent publication on unresolved findings, failed blocking gates, unexplained payload/runtime graph changes, identity drift, or rights/security problems.
Replan for a new major/engine incompatibility, unanticipated runtime dependency change, material security boundary change, incompatible evaluator contract, or required broader policy/configuration edits.
Record the smallest discriminating failure and continue independent authorized work.
Recover using a coherent reviewed forward change; never force-push, delete historical receipts, or call pending/skipped evidence a pass.
