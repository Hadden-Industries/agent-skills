# Committing to Git Performance Implementation Plan

This plan reduces avoidable work in the committing-to-git runtime while preserving the exact bytes, ordering, diagnostics, approval boundaries and Git transaction guarantees that consumers depend on. It converts the supplied performance review into measurable implementation hypotheses rather than adopting its patches verbatim.

**Status:** Accepted by the owner for implementation on 2026-10-05 from signed baseline `0a8d7f4532f7ac20be7c19089e6c54b8dbc96c89`, following the separately approved Node target, verification-guidance and whitespace-order prerequisites. HISEW snapshot `0c185a45-a840-4e2a-817e-c4dc226219e8` and R2 execution `a4d1048e-23dd-4584-8904-947e13d78380` retain this accepted scope. The owner authorizes implementation in the existing `main` checkout, bounded independent reviews, commits/messages, direct pushes and configuration changes required by this plan. [Implementation results and mapping reassessment](../committing-to-git/performance-implementation.md) record PERF-02/03/04 adoption and PERF-01/05 deferral under the accepted evidence rules. The draft wording below describes the frozen planning baseline; it no longer denotes missing implementation authority. Installation and newly concrete verification-policy follow-ups remain outside this implementation scope.

## Baseline and authority

- Planning date: 2026-10-05, Europe/Bucharest.
- Source review: [committing-to-git-python-performance-review.md](../committing-to-git/reviews/committing-to-git-python-performance-review.md), SHA-256 `13139896a55ff645bf228aa8d35fd6c94e7ec0a5b76d6446830d81c2096d3636`.
- Inspected repository HEAD: `eaee5e29b657961eacbcc5c545fa0d65b396eb86`. The review directory was already untracked; preserve it as user-owned material.
- Observed tools: Node.js `v24.21.0`; Git `2.56.0.windows.1`. The repository requires Node `>=24`. The helper's esbuild target was `node22` at the inspected HEAD and is now aligned to `node24` by the separately authorized prerequisite below; the supported runtime floor remains unchanged.
- At planning resumption, HISEW `0.1.0.dev17` reported personal applicability active, this repository selected for the current Codex session, no execution in progress and no pending continuations. The old extraction execution was already cleared; this session did not adopt or close it. The subsequently authorized Node target alignment uses a separate R0 execution, not a performance implementation execution.
- Native profile inspection resolves `focused` to `npm run test` (600-second timeout), `affected` to `npm run build:check` then `npm run test` (600 seconds each), and `full` to `npm run verify` (1,200 seconds). HISEW reports their input ordering and coverage as unknown, with no declared covered paths. Refresh these declarations in the implementing session; a profile name does not prove relevant coverage. In particular, the current `focused` profile runs the broad test script rather than the narrowly selected commands below.
- Product documentation belongs in `docs/plans`. Supplemental measurements, profiles, reviews and scratch must use an isolated task directory under the currently selected external evidence root. The observed root is `C:\Users\maksy\.hi\w\e`; use an operator-owned directory, not engine-owned receipt/state namespaces. Rediscover the root in the implementing session.

The HISEW planning procedure requires an accepted or draft dossier, risk route, invariants, quality scenarios and consequential design decisions. This document supplies a coherent draft of those prerequisites. Implementation remains gated on owner acceptance of their exact revision and an actual risk-routing decision. Do not fabricate an acceptance reference, execution ID, reviewer identity or protected snapshot.

## Authorized Node target alignment

On 2026-10-05 the owner authorized changing only `scripts/buildSkillArtifacts.js`, `target: "node22"` to `target: "node24"`, together with this plan update. This reconciles the syntax generation target with the existing package, skill compatibility and Linux CI runtime floor. The accepted task is a reversible R0 alignment; the proposed R2 route below applies to the future performance implementation.

First principles: generate for the oldest supported runtime, avoiding an unexplained second compatibility baseline. Modern practice: keep the build target, declared runtime support and CI qualification consistent. Authoritative guidance: [esbuild's target documentation](https://esbuild.github.io/api/#target) says the target governs supported syntax; it does not supply runtime API polyfills. Adopted practice: the repository already declares Node `>=24`, documents Node 24 compatibility and tests the committing-to-git Linux job on Node 24. No source or history evidence established a separate supported Node 22 consumer.

A read-only production-options probe built the helper in memory with both targets: each produced 840,801 bytes, zero warnings and SHA-256 `8b3150c89d28b5df18f2b9ae48bb22e8d0a3adcf79d0a489bb4084a8cc239d35`. The current payload therefore has no byte or content-derived plugin-version change from this setting. Future generated syntax may use Node 24 capabilities, consistent with the existing minimum runtime. Required completion proof is `npm run verify` plus inspection of the complete diff and this untracked plan; actual results are retained in the task evidence. This authorization covers no dependency, runtime floor, CI, plugin manifest or HISEW setting change.

## HISEW verification mapping assessment

The registered project configuration inspected on 2026-10-05 is generation 5, project `1e921097-317d-4215-b006-015719d28c99`, worktree `eeb38605-d009-48da-96f0-9831b53ed0bb`. These permanent mappings remain unchanged. The owner subsequently directed use of the recommended performance-work cadence, explicitly requiring formatting/lint before reviews, and reassessment of mappings and package scripts after the performance work. That direction is recorded below; it does not select exact permanent configuration edits.

| Profile | Actual checks | Correctness and limitations |
| --- | --- | --- |
| `focused` | `npm run test`, 600 seconds | Runs all `tests/**/*.test.mjs` with concurrency 4. Valid broad test feedback, but not focused on a slice or skill; omits formatting, lint, generated correspondence and the other final gates. |
| `affected` | `npm run build:check`, then `npm run test`, 600 seconds each | Cheap static/build checks precede tests, which is sound. Both remain repository-wide; this mapping omits `diff:check`, `skills:validate`, `skills:lint` and `eval:check` from full verification. |
| `full` | `npm run verify`, 1,200 seconds | Correct deterministic completion gate: `diff:check -> build:check -> skills:validate -> skills:lint -> eval:check -> npm test`. This does not establish model behavior, portability, installation or performance acceptance. |

The route policy selects `focused` for R0, `affected` for R1 and `full` for R2/R3. Independently, repository `AGENTS.md` requires `npm run verify` before completing changes to maintained skills, their tests or authoring/build scripts. A narrower route pass cannot discharge that repository obligation. Use slice checks for early feedback and the full gate for final completion; do not inflate the risk class merely to select a command. HISEW declares neither `coveredPaths` nor `inputSemantics` for these mappings, so input ordering and coverage remain unknown to the engine even where source inspection establishes command order.

For PERF work, use the focused, affected and full cadence specified below. The selected test commands provide focused feedback. `npm run verify:skill -- --skill committing-to-git`, supplemented by affected shared build/packaging tests and explicit formatting/lint prerequisites, supplies intermediate evidence. It is not a full-gate substitute: the current script checks scoped generated correspondence and skill-reference validation and runs skill tests, but omits repository-wide Prettier/ESLint, Tessl plugin lint, unrelated tests, repository-wide diff checking and `eval:check`. Following the separately approved prerequisite below, its scoped diff check runs immediately after canonical skill selection and before build validation/tests. Its reported omissions list still does not include `eval:check`; do not interpret that list as exhaustive assurance.

The owner subsequently approved the bounded whitespace-order patch, which is applied: the existing scoped `git diff --check HEAD -- <owned paths>` in `scripts/verifySkill.js` now runs immediately after canonical skill selection and is reported as the first passed stage. `tests/scripts/verify-skill.test.mjs` has updated ordering expectations and a regression proving whitespace failure stops before build/contract validation and later process checks. Whitespace failure takes precedence over build/contract failures for a known skill; unknown skill selection still fails first. The path scope, flags, remaining checks and permanent profiles are unchanged. All eight focused verifier tests passed after application; required final full verification and native handoff results are recorded at task completion. [Git documents the check's nonzero failure status](https://git-scm.com/docs/git-diff#Documentation/git-diff.txt---check); the existing process runner already throws on nonzero status.

A permanent mapping improvement needs supported selection of the actually affected skills and shared consumers across this multi-skill repository. Hard-coding committing-to-git into the project's general profiles would misrepresent other tasks. Literal registered command arguments do not by themselves supply dynamic scope selection. SLICE-008 reassesses the mappings and package scripts after performance qualification. Any resulting edit requires its exact configuration proposal and approval; assessment is authorized, permanent reconfiguration is not yet specified.

## Outcome and scope

The beneficiary is an agent or maintainer preparing, reviewing and creating authorized signed commits. The desired result is less elapsed time and allocation work on the existing consumer journey, without making its safety controls less complete or its outputs less predictable. Improving a synthetic sorting score alone is insufficient evidence of a faster commit journey.

Included scope is PERF-01 through PERF-05 from the review, subject to the discriminating experiments and adoption rules below. Production edits are confined to maintained source under `src/committing-to-git/`, its consumer tests and necessary generated distributions. Extend existing test utilities where practical; any dedicated benchmark driver must serve these exact fixtures and must not become a second general benchmarking framework.

Non-goals are a Python port, custom Git object hashing, a persistent Git service, concurrent Git mutations, new public metrics or schema fields, streaming catalog serialization, changed rename heuristics, new dependencies, changes to approval or evidence requirements, unrelated validator unification, workflow reconfiguration and repository-wide cleanup. Changesets above 1,000 units may be diagnostic experiments, but this plan does not increase any supported limit or turn their size into an evidence-route proxy.

## Corrections to the supplied review

| Review claim or proposal | Current evidence and resulting treatment |
| --- | --- |
| Python performance review | `src/committing-to-git/` has no Python source. Optimize and measure Node.js; the Python comparison harness cannot establish runtime benefit. Preserve the supplied review filename as a historical locator. |
| Git subprocesses dominate the measured workflow | The cost harness records process counts and command elapsed time, but the supplied timings do not partition CPU, child-process time, filesystem work and signing. Treat dominance as a hypothesis until phase measurements and profiles establish it. |
| Empty deleted-OID guard is an immediate zero-risk win | Ordinary unstaged deletions are relative to the index, so absent stage-zero OIDs need a demonstrated state or race. Skipping hashes can also suppress an error that the old path would have emitted. Prove reachability and diagnostic compatibility before adopting the guard. |
| Persistent destination/source WeakMap caches | Source validation does not establish a deep immutable object contract. A cache keyed only by object identity may survive changes to its path fields. Prefer temporary keys per sort operation. |
| Selection values are ASCII identifiers | `normalizeSelection` accepts destination/source paths and prefixes, including Unicode. Restrict direct string comparison to a proven ASCII domain; retain UTF-8 byte comparison elsewhere. |
| All control validators can use C0 plus DEL/C1 | `gitRepository.js::containsControlCharacter` rejects U+0000-U+001F and U+007F. `prepareWorkflow.js::containsUnsafeControl` also rejects U+0080-U+009F. Preserve these separate sets. |
| Dot-component hotspot is `normalizeScopePath` | At the inspected baseline the relevant Buffer comparisons are in `decodeCanonicalBase64Path`. Locate by responsibility and source, not stale review line numbers. |
| A 3x sorting gain is the merge rule | A microbenchmark threshold does not establish practical benefit, diagnostic equivalence, signed transaction safety or package correctness. Use structural proof and the consumer measurements below. |
| O(N log N) comparisons describe every sort | V8 uses an adaptive stable sort; already ordered inputs can require much less work. Measure shuffled, ordered, reversed and tie-heavy inputs separately. [V8 explanation](https://v8.dev/blog/array-sort) |

## Draft risk route and review coverage

**Recommended implementation route: R2**, because ordering affects canonical message and evidence identities, preparation examines mutable Git/filesystem state, and some validation sits at a trust boundary. The change is intended to preserve behavior and introduce no production capability. The maintainer responsible for HISEW routing must assess the final accepted scope; this recommendation is not an engine route record.

| Trigger or lens | Proposed disposition and proof |
| --- | --- |
| Canonical public artifacts and signing | Required: unchanged serialization, digests, message bytes and exact parent/tree/message/signature checks through delivered consumers. |
| Concurrency and filesystem races | Required for PERF-01: controlled inter-command mutation, existing stale-input rejection, error behavior and cleanup. |
| Availability and performance | Required: attributable phase cost, bounded retained keys, small/bulk workload comparisons and failure-path measurements. |
| Input validation and trust boundaries | Required if PERF-05 or rename diagnostics change: scoped native security assessment of the frozen diff through the approved host provider, with its own authority and retained limitations. |
| Architecture and packaging | Required: source ownership, existing import direction, generated standalone helper and plugin payloads. |
| Data migration, authentication, financial or regulatory behavior | Not proposed. Discovery of a change in any of these areas requires rerouting rather than silent expansion. |
| Independent assurance | Required for R2: a verifier independently assesses fixtures, ordering oracles, measurement comparability and safety evidence. Do not count the implementer's own assertions as independent verification. |

Select the installed ordinary reviewer through HISEW's existing discovery procedure. Specialist coverage may be combined into one bounded review when the provider can actually cover it. This plan does not dispatch agents, start scans or authorize paid/hosted calls.

## Requirements and acceptance criteria

All criteria below are draft requirements for the future change, not claims about work already performed.

| Requirement | Acceptance criterion |
| --- | --- |
| REQ-001 Preserve ordering and identity | AC-001: identical ordered unit IDs, canonical message bytes, selection bytes, capsule bytes and content digests for all relevant valid fixtures, including raw non-UTF-8 paths. Compare independently specified outputs and baseline/candidate results. |
| REQ-002 Preserve input and failure contracts | AC-002: identical acceptance/rejection sets, diagnostic codes and transaction outcomes at changed boundaries. Characterize invalid-input behavior before restructuring extraction order; a newly suppressed error blocks that optimization. |
| REQ-003 Remove repeated sort-key work | AC-003: sorting keys are computed at most once per participating unit/string per operation, with no decoding/encoding in the hot comparator, no input mutation and no retained cross-operation cache. The standalone comparator continues to observe its current inputs. |
| REQ-004 Avoid provably fruitless rename hashing | AC-004: on a demonstrated empty-candidate path, zero `hash-object` invocations, with the same candidate/result and failure contracts. If no legitimate state can demonstrate this safely, defer PERF-01 with evidence instead of adding a contrived performance claim. |
| REQ-005 Demonstrate benefit without meaningful regression | AC-005: meet the measurement/adoption rules below on the affected operation; report full-journey results separately. No material regression in 1-unit and 12-unit consumer journeys or supported memory/resource bounds. Inconclusive measurements remain inconclusive. |
| REQ-006 Preserve transaction safety and recovery | AC-006: existing consumer tests establish exact parent/tree/message, verified required signing, hooks, index/worktree preservation, stale-input refusal and unknown-outcome recovery. No extra postapproval command or weakened evidence requirement. |
| REQ-007 Deliver the same source behavior in self-contained artifacts | AC-007: regenerate through the approved build route, verify complete source/distribution correspondence, exercise emitted helper and plugin copies, and pass `npm run verify` for the final candidate. Source-only correctness is insufficient. |
| REQ-008 Keep authority and resources explicit | AC-008: no unapproved configuration, dependency, policy, credential, provider, installation or publication changes; retain raw failures and measurements; dispose only eligible task-owned scratch after producer quiescence. |
| REQ-009 Keep verification complete and proportionate | AC-009: use the owner-directed focused/affected/full cadence; formatting/lint pass before code review; final native full verification satisfies the repository gate without an unnecessary separate duplicate run; after performance qualification, deliver the SLICE-008 assessment of profile mappings and package scripts with explicit gaps and exact proposals. |

## Quality scenarios and invariants

| Scenario | Stimulus and expected response |
| --- | --- |
| QA-001 Ordering across encodings | Units contain ASCII, BMP, supplementary Unicode, non-UTF-8 raw bytes, equal destinations and different sources/IDs. Message ordering remains destination bytes, source bytes, then UTF-8 ID bytes, with missing paths represented as the existing empty key. Capsule sampling retains its own fallback and tie behavior. |
| QA-002 Reused mutable input | A unit's path representation changes between two sorts using the same object. The second operation sees the changed fields; input arrays and objects remain unmodified. Test encoded-field precedence and textual fallback separately. |
| QA-003 Empty rename candidates | An evidenced candidate-discovery/index state produces no deleted OIDs alongside untracked files. Preparation preserves its contract without fruitless hashes; inaccessible/disappearing files and changed indexes retain documented diagnostics or rejection. |
| QA-004 Real rename matching | Deleted blobs have matching/nonmatching untracked contents, duplicate source OIDs, odd filenames, executable modes and supported object formats. Preserve pair multiplicity/order and the existing `--no-filters` behavior. Do not prune matches after the first pair. |
| QA-005 Selection and catalog compatibility | Unicode paths/prefixes and every selector field pass through normalization/finalization. Existing catalog, evidence-plan and message digests remain identical; queue filename ordering uses only the existing validated filename grammar. |
| QA-006 Validation boundaries | Check U+001F/U+0020, U+007E/U+007F/U+0080/U+009F/U+00A0, supplementary characters and lone surrogates against each validator's old behavior. Raw path components include `.`, `..`, empty, dot-prefixed valid names, NUL, separators, noncanonical base64 and non-UTF-8 bytes. |
| QA-007 Small and bulk workloads | 1, 12 and 1,000 units cover cold CLI operation, multiple synopsis groups, long/common path prefixes and different tie frequencies. Key storage grows linearly with input bytes; latency, allocation work and peak memory are reported independently. |
| QA-008 Signed recovery and interruption | Kill or interrupt at already supported transaction boundaries in isolated fixtures. Recovery creates no duplicate commit, preserves uncertain outcomes, and reads retained old transaction artifacts without migration. |
| QA-009 Distribution portability | Run the exact emitted payload on Windows and Linux using supported Node/Git/signing tools. Missing signing or platform facilities are explicit gaps, not a full pass. No source-checkout import can make a broken standalone bundle look healthy. |

Immutable invariants include raw path identity, current selector grammar, byte-for-byte canonical artifacts, rename semantics, signature policy, hook execution, evidence limits, index installation rules, snapshot identity, transaction journal/recovery and existing permissions. No Unicode normalization, locale comparison or filter policy change is part of the optimization.

## Research order and consequential decisions

Research followed the requested sequence: first principles, maintained modern practice, authoritative specifications/guidelines, then adopted practice. Contract and permission requirements constrain every stage. The following decisions are researched recommendations for this draft; empirical claims remain subject to the planned experiments.

### DEC-001 Measure the Node consumer journey

First principles: optimize time spent by the actual consumer, not an analogous Python algorithm. Modern practice: separate cold process cost, hot operation cost and resource use; consume benchmark results so unused work is not optimized away. Authoritative guidance: Node provides [high-resolution performance timing](https://nodejs.org/api/perf_hooks.html), [CPU profiling](https://nodejs.org/api/cli.html#--cpu-prof) and [memory measurements](https://nodejs.org/api/process.html#processmemoryusage). Adopted practice: [Node's own benchmark guidance](https://raw.githubusercontent.com/nodejs/node/v24.x/doc/contributing/writing-and-running-benchmarks.md) compares repeated runs and cautions against conclusions without adequate statistical evidence.

Select the existing `runRecordedWorkflow`, Git Trace2 argument reader and native Node APIs. Add only domain-specific fixture/sample orchestration. Keep profiling separate from uninstrumented acceptance timing. A parent test-process memory reading is not the child CLI's peak memory, and a heap delta is not a count of Buffer allocations.

### DEC-002 Use temporary keys per message sort

First principles: destination, source and ID bytes form the existing ordering tuple; computing them during every comparison repeats invariant work. Modern practice: decorate, sort with native `Array.prototype.sort`, and return the original units. Authoritative contracts: [Buffer comparison](https://nodejs.org/docs/latest-v24.x/api/buffer.html#static-method-buffercomparebuf1-buf2) orders bytes; [ECMAScript string comparison](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-islessthan) orders UTF-16 code units. Adopted practice: retain native stable sorting rather than implementing a custom sort; V8's maintained implementation already handles adaptive runs.

Predict an additive internal helper named `sortChangeUnitsByRawPath` alongside the existing comparator. Precompute the original tuple once per operation, preserve array/object identity semantics, and migrate all three production sort call sites in renderer/approval paths. Keep `compareChangeUnitsByRawPath` available with its existing current-input behavior; it is an independent operation, not a compatibility shim. Do not add cached properties to serialized units or introduce module-global WeakMaps. Eager extraction may alter malformed-input error timing: characterize the supported domain and preserve relevant errors before adoption.

### DEC-003 Preserve capsule-specific semantics

First principles: the capsule comparator is not the message tuple comparator. Its key uses encoded destination bytes, then destination/display/ID fallback; equal keys retain input order. Modern practice: local decoration removes repeated decoding without changing sampling policy. Authoritative constraint: native stable sorting preserves equal-key order. Adopted practice: share only a genuinely identical primitive; do not combine superficially similar comparators.

Optimize `orderedUnits` locally and prove its generated capsule/sample bytes unchanged across groups. Do not add source/ID tie breakers or change other trie/display decoders solely to increase the apparent optimization scope.

### DEC-004 Restrict string shortcuts to proven ASCII

First principles: UTF-16 and UTF-8 order differ for supplementary characters; U+10000 versus U+E000 is a useful discriminating case. Modern practice: pre-encode arbitrary accepted strings once, then byte-sort. Authoritative constraints: existing selector validation accepts Unicode paths; the queue filter explicitly constrains filenames to ASCII. Adopted practice: use a simple native string comparator only where the consuming grammar supplies the proof.

Direct string comparison is eligible for filtered queue filenames. Preserve UTF-8 ordering of selection values, workspace paths and unconstrained IDs at the standalone comparator boundary. Canonical manifest IDs have an ASCII validation contract, but eliminating their encoding is optional and must not narrow another caller's contract. No `localeCompare`, base64 lexicographic sorting, Unicode normalization or undocumented BMP shortcut.

### DEC-005 Make rename guard adoption conditional

First principles: with an empty deleted-OID map no pair can match, but untracked hashing may still have observable errors. Modern practice: prove a reachable state and failure behavior before removing I/O. Authoritative guidance: [Git hash-object](https://git-scm.com/docs/git-hash-object) owns hashing, object-format selection and `--no-filters`; the existing Git wrapper owns argv/environment restrictions. Adopted practice: retain native Git and use Trace2 to identify actual operation removal.

First attempt an ordinary native Git fixture; if it cannot reach the empty map, use a controlled inter-command index mutation through a genuine process boundary. Report whether the final workflow rejects that race. If the only reachable case is rejected anyway, do not sell it as ordinary preparation acceleration. If compatibility cannot be proved, defer PERF-01. Do not introduce a process mock that pretends an impossible steady-state Git response is common evidence.

### DEC-006 Preserve each validation predicate

First principles: removing allocation must preserve the exact accepted set. Modern practice: use a non-global regex or direct byte predicates with the original character range. Authoritative semantics: JavaScript regex/string handling and Git's native argument validation remain separate boundaries. Adopted practice: characterize boundary values rather than merging validators merely because their implementations look similar.

For the preparation validator, an equivalent C0/DEL/C1 test is eligible. For `gitRepository.js`, use only its existing C0/DEL range. Dot components may use direct length/byte checks or immutable module-local sentinels; choose the clearest measured equivalent and keep canonical-base64 and path checks intact. Do not promise zero allocation for a regex engine or count all existing component arrays as removed. PERF-05 is lower priority and may be deferred if its resource benefit is negligible.

### DEC-007 Use structural gates and credible measurements

First principles: reduced redundant work is demonstrable without asserting an arbitrary universal speedup. Modern practice: preregister measured workloads, use independent processes, disclose uncertainty and account for multiple comparisons. Authoritative/adopted guidance: the Node benchmark guide discusses repeated comparisons and false positives; [pyperf's maintainer guidance](https://pyperf.readthedocs.io/en/latest/analyze.html) independently emphasizes unstable distributions and retained samples. Use the latter as methodological evidence, not a Python runtime benchmark.

Adopt the measurable criteria below, not the review's 3x rule or assumed 15-30 ms spawn cost. No hard elapsed-time threshold is added to ordinary tests. Do not claim a memory gain from fewer Buffer constructor calls without measuring retained/peak memory and explaining the new decorated-key storage.

### DEC-008 Preserve native reuse and distribution controls

First principles: bytes and Git semantics are already provided by native supported consumers. Modern practice: compose these with the existing harness; keep production dependencies and emitted contracts stable. Authoritative guidance: the [Node release policy](https://nodejs.org/en/about/previous-releases) lists v24 as the applicable LTS and the inspected official page lists `24.21.0` as its latest patch. Refresh before implementation; freeze actual binary identities per measurement run. Adopted practice: maintained benchmark libraries are alternatives for a future broader measurement service, not a reason to duplicate the domain harness now.

Technical selection is existing Node 24 LTS APIs, Git and repository harnesses. No new production package or external service is selected. Repository-owned changes remain under existing MPL-2.0 terms; existing bundled notices must be preserved. This plan does not assert new third-party legal clearance or permit copying upstream benchmark implementation code.

## Reuse assessment and exclusions

Research checked the actual source contracts, repository timing/Trace2 harness, Node timing/profiling/memory APIs, V8 native sorting, Node's benchmark methods, Git's hashing protocol, Tinybench, Benchmark.js and pyperf maintainer guidance on 2026-10-05. The library pages were inspected as technical alternatives; no version or licence was approved for incorporation.

| Candidate | Requirement fit and decision |
| --- | --- |
| Existing harness plus native Node/Git | Selected. Already runs the consumer CLI, records helper/process/output costs and supports repository fixtures. Residual work is fixture construction, result identity and comparison of domain outputs. Timing statistics must use an available maintained analysis tool or directly auditable descriptive results; do not build an undocumented statistics engine. |
| [Tinybench](https://github.com/tinylibs/tinybench) | Maintainer documentation supplies latency/throughput statistics for benchmark tasks. Does not by itself bind Git fixture state, canonical artifact equivalence, emitted payload identity or signed recovery. Not selected for this bounded change; reconsider if a reusable benchmarking service becomes an accepted requirement. Exact stable release, terms and integration would need assessment before adoption. |
| [Benchmark.js](https://github.com/bestiejs/benchmark.js) | Maintainer documentation supplies statistical benchmarking and identifies a lodash dependency. It does not replace CLI fixture or transaction oracles. Not selected; broad browser benchmarking is outside this change. No claim that its age alone proves unfitness. |
| Node contributor benchmark tooling | Useful maintained method and optional independent analysis. It is tooling in Node's source project, not assumed to be a public API supplied by the installed binary. Do not copy its framework or assume development-branch `node:bench` tooling is available on Node 24. |
| Native multi-file `git hash-object` | Git accepts multiple command-line files; `--stdin-paths` is line-oriented rather than a NUL path protocol. This is a credible future process-reduction option, but argv limits, path encoding, output association and fail-fast behavior require separate work. Deferred; the empty-map guard does not authorize batching. |
| In-process Git hashing, persistent coprocess, streaming catalogs | Excluded. These alter protocol/lifecycle/trust or memory architecture and need separate requirements, measurements and research. `--no-filters` already excludes clean/EOL filters in the current path; do not use filter speculation as the sole objection to hashing. SHA-1/SHA-256, races, file modes, errors and native consumer ownership remain material. |

Research for the bounded native approach is complete enough to plan. Runtime integration/performance proof is unverified. Newly selected packages, copied code, runtime upgrades or external tools require refreshed exact-version/rights evidence and any exact configuration approval before use.

## Measurement protocol and adoption rules

SLICE-001 establishes fresh baseline observations rather than treating the review's historical test timings or `pre-cutover-workflow-cost.json` as current performance data. That frozen fixture has no wall-time field and must not be rewritten to make the optimization appear successful.

Use 1, 12 and 1,000-unit workloads at actual preparation, message rendering/finalization, catalog/capsule and postapproval commit boundaries. Separate modified-only, additions, deletion/untracked matching, multiple groups, duplicate OIDs and source/destination ties. Sort inputs must include ordered, reversed, deterministic shuffled and tie-heavy arrangements. Include Unicode, non-UTF-8 raw-path cases where the OS supports them, long paths and repeated prefixes. A 5,000-unit diagnostic case is optional and cannot establish a larger support contract.

For cold CLI comparisons, use fresh isolated equivalent fixture instances per sample and separate Node processes. For hot operation comparisons, include key extraction, result consumption and realistic object lifetimes; do not warm a persistent cache once and amortize its cost away. Fixture setup and signing-key setup are excluded from operation timing but recorded separately. Signing behavior remains identical in both arms. Alternate baseline/candidate order and run cases serially without unrelated test-suite concurrency.

Artifact byte comparisons use the same bound immutable consumer inputs wherever possible. Fresh full-workflow fixtures can legitimately have different attempt IDs, timestamps, absolute paths or newly created commit identities. Compare their independently specified semantic facts and exact canonical sub-artifacts under controlled matching inputs; identify every genuinely variable field before comparing runs. Do not strip arbitrary fields or normalize away a candidate-induced digest, message, path, ordering or transaction divergence to obtain equality.

Begin with 30 independent observations per primary case and arm on each available required platform. Retain every sample and a documented uncertainty analysis. If precision is inadequate, use one preregistered extension to 60 observations; otherwise report the unresolved gap and investigate the environment. These counts are proposed measurement policy, not a standards requirement. Do not tune system configuration, change priority globally or discard slow samples without a recorded exclusion reason. Cold-process and warmed-operation results remain separate.

Record candidate/source/payload digests, exact Node/Git binaries and versions, OS/architecture, hardware/resource limits, commands/environments, fixture seed/state, elapsed time, stdout/stderr bytes, Git operation argv/counts, relevant output hashes, exit status and skips. Measure child resource use through child-owned measurements or an attributable OS observer. `arrayBuffers` includes Node Buffers and is part of `external`; do not add both and double-count them. CPU/heap profiles and Trace2 may perturb timing, so collect them in separate attribution runs. Set all profiler output destinations explicitly to the task evidence directory.

Proposed adoption rules are:

1. AC-001, AC-002 and AC-006 are mandatory regardless of speed.
2. PERF-01 needs a reachable fixture and removal of all fruitless `hash-object` operations on that path, plus error equivalence. Otherwise defer it.
3. PERF-02/03/04 need linear key preparation and exact output equivalence. Count key-extractor work through a meaningful internal seam or profiling; avoid replacing global `Buffer.from` in the live runtime to manufacture a count.
4. A latency improvement claim needs an appropriate 95% confidence interval excluding no improvement on the preregistered affected operation. Analyze independent process samples, account for multiple claimed primary comparisons, and report absolute time and relative change. The independent verifier reviews the method; absence of available trustworthy analysis blocks that claim, not correctness tests.
5. Small-workload non-regression uses a proposed 5% latency budget relative to baseline. The evidence must bound regression below that budget; an inconclusive interval is not a pass. Resource use must stay within existing limits. Any peak-memory growth from decorating keys must be reported and justified against measured allocation/latency benefit; no fabricated numeric memory limit.
6. Structural work reduction with inconclusive latency may be reported as such, but cannot be presented as a faster consumer journey. Adopt it only when its measured allocation/resource benefit and maintenance cost justify it within the accepted baseline; otherwise defer. PERF-05 must show such a benefit and preserve its boundary predicates.
7. The overall outcome claim names the platforms and phases actually improved. A sorting gain alone never establishes a full-workflow or real-agent gain.

## Implementation slices and traceability

Each slice delivers a complete observable path with its own evidence and deferral condition. Likely files are predictions, not permission to expand scope or commit microscopic implementation steps.

| Slice | Requirements and decisions | Demonstrable proof | Release and cleanup implication |
| --- | --- | --- | --- |
| SLICE-001 Establish a trustworthy consumer baseline | REQ-001/002/005/008; AC-001/002/005/008; QA-001/003/007; DEC-001/005/007/008 | Valid native fixtures, independent expected permutations/artifact facts, current phase/process measurements and reachability disposition for PERF-01 | No production cutover. Retain immutable raw baseline, fixture identities and limitations; release eligible task-owned scratch only after quiescence. |
| SLICE-002 Remove fruitless rename hashing when proved safe | REQ-002/004/006; AC-002/004/006; QA-003/004/008; DEC-005 | Same preparation outcome and errors; zero hashes on demonstrated empty map; matching, duplicate-OID and race regressions | Independently deferrable. No schema or rename-policy migration; preserve exact previous reader and Git boundary contracts. |
| SLICE-003 Optimize canonical message ordering | REQ-001/003/005/006; AC-001/003/005/006; QA-001/002/007; DEC-002/004/007 | Renderer, approval and scaffold outputs match exact expected/baseline bytes; one tuple extraction per unit; reused mutated inputs stay current | No persistent cache or serialized fields. Regenerate the helper through the approved output route; reverse only this slice if rejected. |
| SLICE-004 Optimize synopsis sample ordering | REQ-001/003/005; AC-001/003/005; QA-001/002/007; DEC-003/007 | Identical capsule/group/sample bytes, fallback behavior and stable ties with one local key extraction per unit | Separate from message comparator. Preserve every capsule bound and evidence-route decision. |
| SLICE-005 Optimize catalog, finalization and workspace ordering | REQ-001/002/003/005; AC-001/002/003/005; QA-005/007; DEC-004/007 | Identical catalog/evidence-plan/message/report identities; Unicode selectors correct; validated queue filenames use equivalent ASCII ordering | No catalog/digest schema change, backfill or cache invalidation. Old artifacts remain consumable. |
| SLICE-006 Optimize path and character predicates if justified | REQ-002/005/006; AC-002/005/006; QA-006/008; DEC-006/007 | Boundary matrices preserve each validator's exact set and diagnostics; measured allocation/resource benefit; scoped security review | Lower priority and independently deferrable. Do not unify validators or change publication/ref rules. |
| SLICE-007 Qualify complete delivered runtime | REQ-001/006/007/008; AC-001/006/007/008; QA-008/009; DEC-008 | Current final `npm run verify`, emitted-helper/plugin consumer checks, independent assurance and Windows/Linux evidence | Delivery and installation remain separately authorized. Retain package identities, failed/skipped evidence and rollback/forward-fix instructions. |
| SLICE-008 Reassess verification mappings and scripts | REQ-008/009; AC-008/009; DEC-008 | After SLICE-007, compare actual focused/affected/full coverage, stage order, cost and failure behavior across all canonical skills; retain a coverage matrix, gaps and exact proposed edits or an evidence-backed retain decision | This is an assessment checkpoint. Apply no package, script, policy or HISEW configuration change without exact approval; approved follow-up edits need their own refreshed verification and mapping evidence. |

### Slice seams and focused proof

**SLICE-001:** likely uses `tests/committing-to-git/harness.mjs`, `workflow-cost-contract.test.mjs` and related existing test fixtures. Prefer existing Trace2 argv recording to a second Git wrapper. If a separate driver is necessary, its filename and location must describe a committing-to-git consumer benchmark, remain outside production payloads and fit the existing lint/test discovery rules without configuration changes. It emits task evidence, not product telemetry. No claimed production profile is invented.

**SLICE-002:** the predicted production seam is `workflow/prepareWorkflow.js::exactUnstagedRenamePairs`, after building the deleted-OID map. Cover ordinary real matches, no-deletion/no-untracked cases, duplicate content, supported SHA object formats and native failures. A reduced hash count may still leave `ls-files`/status calls; count them accurately. Preserve existing `runReadOnlyGit` environment, argv restrictions, file-read errors and the later snapshot consistency checks.

**SLICE-003:** predicted source files are `message/changeSelection.js`, `message/commitMessageRenderer.js` and `message/approvedMessage.js`. Tests are `change-selection.test.mjs`, `commit-message-renderer.test.mjs`, `approved-message.test.mjs` and canonical/message snapshot tests. Precompute original fallback keys without changing base64 precedence. Keep destination/source/ID comparisons distinct. Use explicit golden permutations, including missing paths, source ties and supplementary Unicode. Baseline/candidate differential comparison supplements these independent oracles.

**SLICE-004:** predicted source is `inspection/inlineEvidenceCapsule.js::orderedUnits`; prove through its exported capsule consumer. Cover sampled and exact routes, multiple groups, equal keys and destination/display/ID fallbacks. Extend `workflow-cost-contract.test.mjs` or an appropriately named focused capsule test; a new file is a predicted deliverable, not a command that already exists.

**SLICE-005:** predicted sources are `inspection/reviewCatalog.js::normalizedSelection/queuePagesForCatalog`, `workflow/finalizeMessageWorkflow.js::canonicalSelection` and `report/commitReport.js::collectWorkspaceSummary`. Reuse native byte sorting and scope any helper to the actual domain. Test `review-catalog.test.mjs`, `reviewed-preparation.test.mjs`, `semantic-content-contract.test.mjs`, `commit-report.test.mjs` and report artifact tests. Explicitly preserve generic UTF-8 string ordering; the report's existing path decoding is not repaired in this performance change.

**SLICE-006:** predicted sources are `workflow/prepareWorkflow.js::decodeCanonicalBase64Path/containsUnsafeControl` and `git/gitRepository.js::containsControlCharacter`. `command-boundary.test.mjs`, `check-workspace.test.mjs`, `reviewed-preparation.test.mjs` and appropriate preflight tests exercise the real consumers. Prove the predicate without turning permitted input into an unauthorized remote operation. Use a pure exported boundary where available or a genuine Git/process test fixture; production credentials and remotes are excluded.

**SLICE-007:** maintained CLI entry is `src/committing-to-git/cli/commitWorkflow.js`; generated helper is `skills/committing-to-git/scripts/commitWorkflow.mjs`; host packages are under `plugins/committing-to-git/`. Generated files are never edited directly. Existing end-to-end, signing, native snapshot, index installation and public/transaction recovery tests must continue to run against their intended consumer. Build success proves generation consistency, not live host adoption.

**SLICE-008:** assessment inputs are the final performance evidence, `AGENTS.md`, current `package.json` scripts, `scripts/verifySkill.js`, shared verification/build consumers and the installed HISEW project configuration. Inspect these fresh after SLICE-007, using the checkpoint below. Predictions of improved configuration do not authorize writing it or inventing coverage declarations.

## Dependencies and integration ownership

Accept the draft baseline/risk route before SLICE-001 execution. SLICE-001 determines whether SLICE-002 is justified and establishes the oracles and comparable measurements for later slices. SLICE-003 and SLICE-004 may be independently implemented after their shared key-contract questions are settled; SLICE-005 should follow the agreed byte-order pattern. SLICE-006 is conditional on measured value and required trust-boundary review. SLICE-007 integrates only accepted slices, including documented deferrals. SLICE-008 follows performance qualification and reassesses verification infrastructure using the observed results; its assessment is part of completion reporting, and any approved implementation of its proposals is a separately scoped follow-up.

The implementing maintainer owns integration, source/generated correspondence and resource accounting. The repository owner accepts requirements, risk and exact configuration/publication effects. The independent verifier owns review of oracle independence and evidence comparability; the selected native security provider owns any required scoped security assessment. Names for actual people/providers are resolved at execution, never invented here.

Read-only baseline analysis, independent oracle review and literature checks can proceed separately. Do not assign parallel writes to shared comparators, renderer consumers, harnesses or generated packages without a single integration owner and settled semantics. This plan itself authorizes no delegation.

## Verification cadence and commands

The owner selected this cadence on 2026-10-05. These are task-scoped checks for performance implementation; they do not rewrite the registered project profiles. The project's R2 policy selects native `full` verification at completion once the performance scope and route are accepted.

| Stage | Checks and order | Completion criterion |
| --- | --- | --- |
| Focused feedback | Run `npm run diff:check`, `npm run format:check` and `npm run lint`, then the slice-relevant test commands below. Inspect untracked candidate files separately. | Static prerequisites and selected behavior pass for the edited inputs; retain failures and refresh stale coverage. A test-only result is insufficient to dispatch a review. |
| Affected integration | With current passing whitespace/format/lint evidence, run `npm run verify:skill -- --skill committing-to-git`, then the shared build/distribution/package tests whose consumers are affected. | Skill correspondence/validation, skill tests and identified shared regressions pass; record actual omissions. This remains intermediate evidence. |
| Review candidate | Complete approved generation, rerun `npm run build:check` and whitespace inspection for the source/payload candidate, freeze its inventory, then dispatch applicable code/security/independent reviews. | Formatting/lint and generated correspondence are green before review, relevant focused/affected evidence is current, and review findings have dispositions. A repaired candidate needs refreshed affected static/tests and review coverage. |
| Final full gate | After applicable reviews and resource disposition, invoke the installed engine's route-required `full` verification/handoff, which runs `npm run verify` for the frozen final candidate. | Native receipt and handoff pass, the complete repository gate passes, and the candidate identity stays stable. Credit this actual command execution for `AGENTS.md`; avoid a separate identical standalone run without a freshness reason. |
| Reassessment | After SLICE-007, perform SLICE-008's mapping/script checkpoint below. | Report evidence-backed retain/change decisions and exact proposals. No assessment result silently changes the accepted performance candidate or permanent configuration. |

First principles: inexpensive deterministic defects should be resolved before consuming review effort, while final assurance must cover shared consumers omitted by narrow tests. Modern practice: use narrow feedback during edits, affected integration proof and a complete final gate. Authoritative guidance: [Prettier documents its read-only check and failing exit codes](https://prettier.io/docs/cli#--check), [ESLint defines failure exit codes](https://eslint.org/docs/latest/use/command-line-interface#exit-codes), and [Node supports explicit test-file selection](https://nodejs.org/docs/latest-v24.x/api/test.html#running-tests-from-the-command-line). Adopted repository practice already places static checks before tests in `npm run verify`; retain that behavior. The review ordering and completion gate are owner/repository obligations, not claims that those tool specifications mandate this lifecycle.

The following focused commands refer to existing files. Run the relevant subset when associated inputs change; these commands are planned proof, not results from this planning task. Shared-consumer selection follows actual edits rather than running every shared suite after each slice.

```powershell
node --test tests/committing-to-git/change-selection.test.mjs tests/committing-to-git/commit-message-renderer.test.mjs tests/committing-to-git/approved-message.test.mjs
node --test tests/committing-to-git/review-catalog.test.mjs tests/committing-to-git/reviewed-preparation.test.mjs tests/committing-to-git/semantic-content-contract.test.mjs
node --test tests/committing-to-git/command-boundary.test.mjs tests/committing-to-git/check-workspace.test.mjs tests/committing-to-git/commit-report.test.mjs
node --test tests/committing-to-git/workflow-cost-contract.test.mjs
node --test tests/committing-to-git/workflow-e2e.test.mjs tests/committing-to-git/signature-policy.test.mjs tests/committing-to-git/index-installation.test.mjs tests/committing-to-git/native-snapshot.test.mjs tests/committing-to-git/transaction-recovery.test.mjs tests/committing-to-git/public-recovery.test.mjs
```

At affected integration, use the existing scoped skill check after the static prerequisites:

```powershell
npm run verify:skill -- --skill committing-to-git
```

When generated payloads or shared build/distribution/packaging consumers are affected, select their relevant existing suites from:

```powershell
node --test --test-concurrency=4 tests/scripts/build-skill-artifacts.test.mjs tests/scripts/build-plugin-packages.test.mjs tests/scripts/build-repository.test.mjs tests/scripts/skill-distribution.test.mjs tests/scripts/package-plugin-archive.test.mjs
```

`tests/scripts/verify-skill.test.mjs` is relevant to approved verification-script follow-up changes, not automatically to each runtime sorting edit. The full gate still includes these shared suites at final completion.

Finish authorized source formatting and lint fixes, inspect the complete candidate including untracked files, obtain exact generated configuration approval where needed, then run the approved `npm run build` and freeze the final source/payload inventory. The final repository gate is:

```powershell
npm run verify
```

At the inspected baseline it runs `diff:check -> build:check -> skills:validate -> skills:lint -> eval:check -> npm test`. The build check already includes formatting, lint, canonical SKILL ASCII validation and generated correspondence. Preserve that ordering and the complete full gate. The native R2 `full` run executes this command and satisfies the same repository obligation; do not run it once independently and again for handoff merely because two names refer to the same proof. Engine freshness requirements and changed candidate inputs still require a new run. Focused passes do not replace final assurance. Inspect HISEW's actual registered profiles against the accepted execution identity; do not invent profile coverage from this command list.

Correctness tests may remain parallel under the existing runner, but benchmark trials run separately and serially. After a material edit, explicitly assess which frozen verification/review inputs changed and rerun their required proof. Reuse unchanged coverage only for its recorded identity; retain prior failures and observations as history.

Test-oracle ownership belongs to accepted requirements and independent fixture facts, not the candidate generator. Use manually specified raw-byte tuples/permutations and expected artifact bytes, native Git tree/message/signature observations and baseline/candidate comparisons. Mock only genuine external process/provider boundaries to induce a narrowly specified failure; do not mock Buffer comparison, selection semantics or the expected canonical output with the implementation under test.

## Post-performance mapping and script checkpoint

SLICE-008 starts after the qualified performance candidate and its evidence are frozen. Re-examine the verification infrastructure itself, rather than treating current names or successful runs as sufficient design evidence:

1. Build a fresh stage/coverage matrix for `package.json` scripts, `scripts/verifySkill.js` and registered HISEW `focused`, `affected`, `full` mappings. Include whitespace, formatting, ESLint, ASCII/wrapping, generated correspondence, skills-ref, Tessl lint, deterministic conformance, skill/shared tests and declared input semantics/covered paths. Include every canonical skill and shared authoring/build consumers.
2. Check fail-fast order and truthful reports. Verify that the separately approved whitespace-first fix remains effective for the final candidate, using its actual qualified regression evidence. Revisit missing `eval:check` in scoped omissions and the absence of format/lint in scoped verification. Distinguish compiled evaluation-contract validation from deterministic consumer conformance; neither establishes model behavior.
3. Reconcile HISEW route requirements with repository completion policy and native receipt identity/freshness rules. Determine whether duplicated work comes from command composition, profile selection or evidence reuse. A passing ordinary shell command is not automatically an eligible native receipt; identify a supported way to avoid duplication instead of waiving proof or inflating risk.
4. Compare observed command/wall-time cost and actual affected-scope selection. Explicitly assess shared files, multiple skills, untracked files, zero discovered tests, source/generated drift, Windows/Linux command resolution and timeout suitability. Keep benchmark trial timing separate from these verification costs.
5. Deliver a retain/change decision for each mapping and script. For each proposed change identify the exact file or engine configuration field, old/new command order or coverage declaration, behavioral/pipeline impact, smallest diff, evidence basis, approval owner and meaningful qualification. Use isolated deliberate failures to prove that later expensive stages/reviews do not run after an earlier failure. Leave claims unknown when no implementation has been qualified.

The checkpoint is complete when every material gap has a retain/change/defer disposition, the owner has a reviewable exact proposal for each recommended configuration change, and unresolved limitations are carried into completion reporting. If follow-up edits are approved, route them by their actual verification-policy impact, run formatting/lint before review, qualify their fail-fast and coverage behavior, then refresh the full gate and native mappings for that new candidate. Do not claim the earlier performance receipts cover changed verification infrastructure.

## Configuration boundaries

The separately approved prerequisites change one Node build setting, the verification guidance in `AGENTS.md`, and scoped whitespace-check ordering with its regression tests. Drafting PERF-01 through PERF-05 and assessing SLICE-008 authorize no other configuration edit. Future runtime build output may change configuration even though no build setting changes: `scripts/buildPluginPackages.js` derives the plugin version from payload bytes.

| Exact potential file | Smallest possible change and impact | Required treatment |
| --- | --- | --- |
| `plugins/committing-to-git/.claude-plugin/plugin.json` | Generated `version` changes when the runtime payload changes; affects host cache/update identity | Determine the exact old/new value and any other generated difference, present the concrete diff and obtain exact approval before writing. Do not assume generation exempts configuration safety. |
| `plugins/committing-to-git/.codex-plugin/plugin.json` | Same content-derived version mechanism for the Codex host | Same exact approval requirement. Interface/permissions fields are not part of this performance plan. |
| `scripts/buildSkillArtifacts.js` | `target: "node22"` to `target: "node24"`; syntax generation aligned with the existing runtime floor | Exact one-line prerequisite authorized by the owner and applied on 2026-10-05. No other setting approved. |
| `AGENTS.md`, Completion Verification | Clarify focused/affected feedback, require formatting/lint before code review and credit a native full run for the same final repository gate | Owner-directed guidance update applied on 2026-10-05. The final `npm run verify` requirement and exact configuration approval rule remain in force. |
| `scripts/verifySkill.js` and `tests/scripts/verify-skill.test.mjs` | Move existing scoped whitespace checking and its report stage before build/tests; update ordering assertions and add failure regression | Exact bounded patch approved and applied on 2026-10-05. Remaining stage coverage, omissions, command flags, path selection and HISEW mappings are unchanged. |
| `package.json`, `package-lock.json`, other lint/format/test/build settings, CI, marketplace or installation locks, HISEW configuration | No proposed setting change | Leave untouched. Any newly discovered need requires the exact file/setting, behavior/pipeline impact and smallest diff before approval. |

Use an available read-only generation inspection to calculate the proposed manifest values before mutating them. If the current tool cannot expose that exact preview safely, stop the affected generation and resolve the limitation without changing build configuration or writing an unapproved manifest. Approval for source code or for a commit does not authorize these changes.

## Compatibility and recovery

No transaction schema, catalog schema, CLI argument, persisted sort key, backfill or data migration is planned. Existing transactions and review evidence remain readable because keys are temporary and canonical outputs remain identical. Do not regenerate user transactions, rewrite frozen cost fixtures or invalidate retained approvals merely to demonstrate the new implementation.

If interrupted before a slice is integrated, preserve the worktree and record the last candidate/evidence identities. Resume from actual current contents after HISEW ownership inspection; rerun stale proof rather than restoring an old checkout. Unknown commit/publication outcomes use the existing recovery path and must not be retried as an optimization experiment.

Before delivery, abort a slice on any identity/order/diagnostic divergence, skipped mandatory signing proof, unexplained resource growth or unapproved generated manifest change. Reverse only that slice's own edits with a targeted patch, or forward-fix it, preserving all unrelated work. After delivery, use a separately authorized corrective release or scoped reversal rebuilt from source; do not claim that installing an older plugin automatically restores transaction state or consumer caches. No force push, index reset or Git restoration command is part of recovery.

## Rollout and observations

Once implementation, full verification and independent assurance are complete, the integration owner reports accepted and deferred slices, measured phase benefits, full-journey results, platform gaps and exact payload identities. Publication, signed commits, pushing and installation are separate effects requiring their own actual authorization and the committing-to-git/HISEW delivery procedures.

When installation is later authorized, qualify the frozen self-contained payload first and observe comparable local work through existing logs/receipts. Do not add telemetry or persist credentials/repository contents for performance analysis. A real-agent improvement claim requires observed matching host/runtime/task journeys; deterministic CLI fixtures alone do not establish trigger behavior, user acceptance or host interception.

The implementing maintainer is the rollout observer until a named owner accepts that role. Observe latency/resource changes, canonical artifacts, stale-input failures, duplicate/uncertain commit handling, signing and recovery. A first canonical mismatch, unexplained authority change or recovery regression stops promotion and requires a forward-fix/reversal decision. Existing controls supply the observations; no new dashboard, service or automatic cleanup hook is planned.

## Unknowns and replan triggers

| Unknown | Cheapest discriminating evidence and decision |
| --- | --- |
| PERF-01 steady-state reachability | Native Git fixture followed by controlled inter-command mutation if necessary. Defer if only invalid/rejected states exhibit it or diagnostics differ. |
| Allocation versus elapsed-time benefit | Instrumented attribution run plus uninstrumented cold/hot samples with temporary key storage included. Keep resource and timing claims separate. |
| Actual small/bulk workload distribution | Use voluntarily available local task evidence; do not assume the review's 85/15 distribution. Report per-scenario outcomes without a fabricated weighted average. |
| Peak resource cost on long/tie-heavy inputs | Child-owned resource measurements, keys proportional to byte lengths, existing limits and worst relevant fixtures. Do not equate O(N) objects with bounded total bytes. |
| Invalid-input/error extraction order | Characterize currently accepted boundaries and failure cases; redesign if eager extraction changes observable required behavior. |
| Linux/signing availability | Explicit platform qualification with actual supported binaries. Missing tools leave a named gap and block a cross-platform claim. |
| Exact generated plugin versions | Read-only inspection of the final candidate payload before configuration write, followed by exact owner approval. |
| Trustworthy statistical analysis availability | Reuse a maintained available analysis tool with documented method; otherwise retain descriptive samples and defer statistically qualified performance claims. No surprise dependency installation. |

Replan or rebaseline if the review/source identity changes, object mutability is newly constrained, selector/path/schema meaning changes, timings implicate a different bottleneck, the guard changes error semantics, key memory violates existing limits, a new package/tool/protocol is required, configuration cannot remain within the exact approved diff, or a prior host/platform assumption fails. A new runtime patch during frozen trials is a new candidate, not grounds to mutate their recorded inputs. Refresh native version/rights research before adoption or release.

At each material discovery, review and release checkpoint, reassess the purpose anchor: did this make the accepted commit journey cheaper while preserving every safety outcome, or merely reduce a local proxy? A measured reason to defer or simplify a slice is a successful decision outcome, not missing implementation disguised as a pass.

## Decisions remaining after research

No unresolved engineering preference requires a user interview at draft completion. The cache lifetime, byte ordering, native reuse, validator sets and measurement approach have source-backed recommendations; reachability and benefit are empirical questions assigned explicit experiments and stop rules. No external fact is delegated to the user.

Owner acceptance of this draft and the risk route, exact generated configuration approval, implementation authorization, any real provider/model call and eventual publication/installation remain authority decisions. Research cannot manufacture them. If experiments expose a genuine trade-off that the ordered research cannot resolve, use the requested grilling skill: present the currently answerable decision frontier, evidence and recommendation, wait for the owner's choices, and then recompute dependent decisions. Do not use that interview as a substitute for facts still obtainable from source or experiments.
