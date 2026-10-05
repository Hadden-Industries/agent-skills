# Committing-to-git performance implementation

## Scope and adoption

The owner accepted [the implementation plan](../plans/2026-10-05-committing-to-git-performance.md) on 2026-10-05. The baseline is signed commit `0a8d7f4532f7ac20be7c19089e6c54b8dbc96c89`; HISEW accepted snapshot `0c185a45-a840-4e2a-817e-c4dc226219e8` and R2 execution `a4d1048e-23dd-4584-8904-947e13d78380` retain the governing scope. Implementation uses the existing `main` checkout.

| Review item | Disposition and proof |
| --- | --- |
| PERF-01 Empty rename-candidate guard | Deferred. A native Git fixture confirms that an ordinary unstaged deletion retains its index OID. A real inter-command index mutation can remove that OID, but makes the deletion observation stale; skipping hashing can suppress a native disappearing-file error. The original I/O and diagnostics remain intact. |
| PERF-02 Message ordering | Implemented. `sortChangeUnitsByRawPath` prepares destination/source/UTF-8 ID keys once per sort and returns the original units in a new array. All three renderer/approval consumers use it. The original standalone comparator still observes current inputs. |
| PERF-03 Capsule sample ordering | Implemented locally. Temporary destination/fallback keys preserve capsule-specific stable ties, sampling and encoded-field precedence. No message tuple tie breaker was introduced. |
| PERF-04 Catalog/finalization/workspace ordering | Implemented with `sortByUtf8Bytes`, including renderer evidence-plan binding. Arbitrary selectors, field names and workspace strings keep UTF-8 ordering. Only regex-filtered ASCII queue filenames use native string sorting. |
| PERF-05 Path/control predicates | Deferred. No measured consumer benefit justifies changing these trust predicates. The distinct C0/DEL and C0/DEL/C1 rules, canonical base64/dot-component checks and their diagnostics remain unchanged. |

No schema, CLI option, permission, persistent cache, rename heuristic, dependency or production telemetry was added. Temporary keys are proportional to participating input bytes and exist only for their sort. Plain canonical manifest data is the caller contract; the original comparator remains available for its wider current-input behavior.

The seven added deterministic tests use explicit byte-order facts, encoded/empty/missing keys, source/ID ties, supplementary Unicode, UTF-8 replacement ties, input identity, reused mutable units, and a 1000-unit key-access counter. They never replace `Buffer.from` globally or add timing assertions to ordinary tests. Existing consumer tests cover canonical bytes, native snapshots, signing, index installation, stale-input refusal and recovery.

## Comparable measurements

Windows 11 Pro 10.0.26300 x64, Intel Core i9-12900K (16 cores/24 logical processors), approximately 32 GiB RAM; Node `v24.21.0`, Git `2.56.0.windows.1`. Node binary SHA-256 is `ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32`; the selected Git command binary is `7cd588850959546663c81077af076835558c6a6af33506a64a65784743df92a1`. Official [Node release information](https://nodejs.org/en/about/previous-releases) confirmed the selected applicable LTS at execution.

Hot comparisons use 30 independent Node processes per arm, alternating arm order serially. Every process runs 1/12/1000-unit ordered, reversed, deterministically shuffled and tie-heavy cases. Key extraction, sorting and result consumption are timed together. Duplicate destinations are a primitive sorting stress case, excluded from invalid detailed-render inventories. All 46 measured case output hashes match exactly across arms. Warmup and batching are explicit in the opt-in driver; repeated iterations are not counted as independent samples.

The retained pilot exposed expensive existing selector processing (roughly 250 ms catalog/500 ms render work at 1000 units), so the acceptance protocol reduced unnecessary within-process repetitions before its 30-pair run. Pilot observations are retained separately and excluded from acceptance statistics. Final lint/format corrections to the driver preserve its deterministic shuffle and every measured output hash; a separate final-driver comparison confirms equivalence.

The four primary cases are shuffled 1000-unit operations. Installed SciPy `1.18.1` supplies [BCa bootstrap confidence intervals](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html): 20000 resamples of paired log latency ratios, fixed seed, and 98.75% intervals to bound the four comparisons together at 95%. Every observation is retained; other case intervals are descriptive. These are fixture estimates on this host, not guarantees for other workloads.

| Operation | Baseline median ms | Candidate median ms | Geometric candidate/baseline ratio | Adjusted ratio interval | Outcome |
| --- | ---: | ---: | ---: | --- | --- |
| Message sort | 2.106 | 0.641 | 0.304 | 0.294-0.313 | Clear phase improvement, approximately 3.3x |
| Catalog construction | 269.828 | 261.734 | 0.974 | 0.926-0.999 | Small observed phase improvement; selector processing dominates |
| Capsule/synopsis construction | 15.236 | 12.762 | 0.870 | 0.829-0.938 | Clear phase improvement |
| Structured rendering | 538.187 | 531.087 | 0.991 | 0.955-1.046 | Inconclusive improvement; no speedup claim |

Cold comparisons use 30 paired fresh equivalent modified-file fixtures per size. Preparation and postapproval signed commit use separate CLI processes; fixture/key setup is excluded. Every sample observes verified required SSH signing and matching reported tree/message/parent facts, and independently checks native parent ancestry and workspace cleanliness. Three journey comparisons use 98.333% intervals for a combined 95% bound. The final full consumer suite provides the separate native transaction-safety oracles. Cold structured-finalizer or real-agent improvement is not claimed.

| Units | Baseline median ms | Candidate median ms | Geometric ratio | Adjusted ratio interval | 5% non-regression bound |
| --- | ---: | ---: | ---: | --- | --- |
| 1 | 1624.123 | 1613.361 | 0.996 | 0.968-1.029 | Passed |
| 12 | 1652.149 | 1641.809 | 1.002 | 0.986-1.020 | Passed |
| 1000 | 2242.085 | 2229.588 | 0.992 | 0.971-1.010 | Passed |

No cold journey interval establishes a speedup; no extension to 60 observations was needed. The actual change distribution is unknown, so no weighted aggregate or assumed 85/15 workload mix is reported.

Whole hot-driver peak RSS medians were 158624 KiB baseline and 159188 KiB candidate, with maxima 161384/161012 KiB. These include imports, fixtures, warmup and GC; they are not allocation counts or child-CLI peaks. A separate attributable 1000-unit CLI observation measured preparation peaks of 88444/88232 KiB and commit peaks of 82636/82808 KiB. The small variations do not establish a memory improvement; temporary key storage is justified by the measured sort/capsule benefit and remains linear. `external` and `arrayBuffers` are never added together.

Separate native Trace2 attribution records 42 Git process starts in both arms. No subprocess-count reduction is claimed. CPU profiles prominently sample native `spawnSync` waiting; they do not partition parent CPU, child CPU, filesystem and signing time. These profiles are outside acceptance timing. Validation predicates are unchanged, and their deferral is not a claim of zero cost.

Raw samples, methods, failures, profiles and reviewed candidate inventories are retained in the operator-owned task directory under the selected external evidence root: `C:\Users\maksy\.hi\w\e\operator-evidence\2026-10-05-committing-performance`. No engine-owned receipt was manufactured from these measurements.

## Distribution and qualification

`npm run build` generated the standalone helper and plugin copy. Both have SHA-256 `aa2f9b3662839e02d1c827a134a8fd89bb94cf9265b82209a50c1fd41054fc77`. The only generated configuration changes are the two plugin manifests' content-derived `version`, from `0.1.0-dev.g63d6ee032539afd1` to `0.1.0-dev.g3724bdb098f88667`, within the owner's plan configuration authorization. Existing notices and dependencies are unchanged.

Formatting/lint passed before review. Affected `verify:skill` passed 668 tests with 3 skips; all 13 selected shared build/distribution/package tests passed. The native R2 full verification of the frozen signed candidate remains the canonical completion gate. Independent review, final native receipts and the existing Linux workflow's exact-revision result are retained in final task evidence; passing these checks never proves installation or real-agent performance. Windows is the only measured performance platform. Linux runtime qualification uses the existing workflow; no Linux latency estimate is inferred from its test results.

The first native full run caught a stale evaluation-preservation maintenance identity for the regenerated helper (1368 passed, 1 failed, 6 skipped). The correction retains the immutable 57-file migration baseline and all Issue-12 identities, adds one exact performance-maintenance identity linked to the preceding helper digest, and updates the existing preservation oracle to apply that single allowlisted transition. Its comparison uses the existing reversible source-location normalization; production bytes and benchmark samples are unchanged. A targeted test, fresh formatting/lint, one narrow independent follow-up and a fresh final full run qualify this correction.

Reproduce domain measurements explicitly, outside normal tests, using:

```powershell
node tests/committing-to-git/performance-benchmark.mjs <absolute-source-root>
node tests/committing-to-git/performance-workflow-benchmark.mjs <absolute-runtime-root> <1|12|1000>
```

Compare immutable equivalent roots in alternating serial runs. The task's external scripts use the existing repository harness and installed SciPy; the repository drivers implement only these committing-to-git fixtures, not a general benchmark/statistics framework.

## SLICE-008: mapping and package-script reassessment

The four canonical skills are committing-to-git, defining-concepts, naming-objects-in-software-engineering and reading-epubs. `build:check` performs repository-wide format/lint, canonical ASCII/wrapping and evaluation-contract validation, generated correspondence and plugin correspondence. `verify:skill` limits canonical/generated/reference/tests to its selected skill. Only committing-to-git currently has a host plugin. Shared authoring/build/library consumers still require selected integration checks and final full verification.

| Surface | Whitespace | Format/lint | ASCII/wrapping/contract/generated | skills-ref | Tessl | eval conformance | Tests |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `test` / HISEW focused | No | No | No dedicated gates | No | No | No dedicated gate | All repository Node tests, concurrency 4 |
| `build:check` | No | Global | Global, read-only | No | No | No | None |
| HISEW affected | No | Global | Global, read-only | No | No | No dedicated gate | All repository Node tests after build check |
| `verify:skill -- --skill NAME` | Selected existing owned paths first | Separate prerequisite | Selected skill, read-only | Selected | No | No | Selected convention directories; currently default Node concurrency |
| `verify` / HISEW full | Tracked/index changes first | Global | Global, read-only | All four | Existing host package | Deterministic consumer check | All repository Node tests, concurrency 4 |

The sequence of the full package script is still `diff:check -> build:check -> skills:validate -> skills:lint -> eval:check -> test`. Formatting/lint precede tests and reviews. The qualified scoped whitespace regression confirms that a failure stops before build/contract validation and later processes. Unknown skill selection still stops before processes. `git diff --check HEAD` omits untracked contents; the final inventory, formatter/linter and separate whitespace inspection must include them. Zero discovered scoped tests is truthfully reported, not behavioural assurance. Paths spanning multiple skills or shared libraries cannot be qualified by one skill's test convention alone.

Current HISEW mappings still declare neither `coveredPaths` nor `inputSemantics`; the engine therefore reports coverage/order as unknown. Inspection of script order is operator evidence, not an engine-verified coverage declaration. The 600-second focused/affected and 1200-second full timeouts have been adequate for this host's observed runs, but are not portable timing guarantees.

| Decision | Exact proposal or retained control | Impact and qualification |
| --- | --- | --- |
| Retain full | Keep `package.json` `verify` and the full `npm-script: verify` mapping unchanged | Correct final deterministic gate. One native final run satisfies AGENTS and HISEW for the same identity; no separate duplicate manual full run. |
| Retain broad fallback; defer general focused redesign | Keep focused `npm-script: test` and affected `build:check` then `test` pending supported task-scope selection | Their coverage is broader than their names suggest and cost is close to full. Hard-coding committing-to-git or dropping other skills' behavioural tests would be incorrect. Literal mappings do not supply dynamic accepted-scope arguments. Continue explicit task-scoped feedback, then native route-required full proof. |
| Propose truthful scoped omissions | In `scripts/verifySkill.js`, append `"deterministic evaluation consumer conformance (eval:check)"` to `GLOBAL_ONLY_NOT_RUN`; update the matching expected list in `tests/scripts/verify-skill.test.mjs` | Reporting-only correction: compiled contract validation differs from deterministic consumer conformance. Qualify the exact omission output and retain the full gate. This newly concrete follow-up is not silently applied under generated-manifest authorization. |
| Retain explicit pre-review static prerequisites | Keep AGENTS and the performance cadence's `diff:check`, `format:check`, `lint` before affected proof/review | Scoped verification itself does not run global formatting/lint. Automatically adding those gates changes unrelated-skill failure behavior and requires its own exact proposal and deliberate-failure tests. Do not make its existing omission report false through a hidden wrapper. |
| Defer declared coverage/order until qualified | Any future native configuration proposal must name the exact `verificationProfiles` command `coveredPaths` and `inputSemantics` fields and expanded leaf steps | Do not declare blanket `**` coverage: docs, benchmark execution, host adoption and model behavior have separate evidence. Validate order/fail-fast, multi-skill/shared/untracked scope, environment and Windows/Linux command resolution before applying declarations. |

This closes the assessment checkpoint with retain/change/defer dispositions. It makes no permanent mapping, package, CI or policy change. The newly concrete proposals require their own exact accepted scope and refreshed proof; earlier performance receipts cannot qualify changed verification infrastructure.

## Recovery and limits

All production changes are confined to maintained source and generated distributions. Existing transactions and approved messages need no migration. A mismatch in canonical bytes, signing, snapshot identity or recovery stops promotion; correct the source or reverse only this task's specific changes through a separately authorized corrective commit, rebuild and refresh qualification. Never rewrite history, reset user changes or regenerate retained approvals as a performance repair.

Real-agent latency, host installation, production workload frequencies and Linux performance remain unmeasured. The observed gains belong to the stated Windows phases; structural work reduction and small-workload non-regression do not establish a faster complete agent journey.
