Ran command: `Get-ChildItem -Recurse -File "src\committing-to-git" | Select-Object FullName, Length`
Ran command: `Get-ChildItem -Recurse -Filter "*.py" "src\committing-to-git" | Select-Object FullName, Length`
Ran command: `Get-ChildItem -Recurse -Filter "*.py" | Select-Object FullName, Length`
Ran command: `Get-ChildItem -Recurse "src\committing-to-git" | Group-Object Extension | Select-Object Name, Count`
Ran command: `Get-ChildItem -Recurse -File "src\committing-to-git" | Where-Object { $_.Extension -eq "" } | Select-Object FullName`
Ran command: `Select-String -Path "src\committing-to-git\**\*" -Pattern "python"`
Ran command: `git status`
Viewed SKILL.md:1-100
Viewed package.json:1-41
Ran command: `Select-String -Path "src\committing-to-git\**\*" -Pattern "#!"`
Ran command: `Get-ChildItem -Recurse -File "src\committing-to-git" | ForEach-Object { $_.FullName.Substring((Get-Location).Path.Length + 1) }`
Ran command: `Get-ChildItem -Recurse -Filter "*.py" | Select-String -Pattern "committing-to-git"`
Ran command: `Get-ChildItem -Directory "src"`
Ran command: `Get-ChildItem -Recurse -Force "src\committing-to-git" | Where-Object { $_.Name -like "*py*" } | Select-Object FullName`
Ran command: `Get-ChildItem -Recurse "tests\committing-to-git"`
Ran command: `Get-ChildItem -Path "scripts" -Filter "*.py"`
Ran command: `Get-ChildItem -Recurse -Filter "*committing-to-git*" | Select-Object FullName`
Ran command: `Get-ChildItem -Recurse -Filter "*.py" "skills\committing-to-git"`
Viewed readback-plugin-archive.py:1-23
Viewed set_up_development_environment.py:115-140
Ran command: `Get-ChildItem "src\committing-to-git"`
Viewed gitRepository.js:1-60
Ran command: `Get-ChildItem -Recurse -Filter "*.py" -Path "src" | Select-Object FullName`
Viewed workflow-cost-contract.test.mjs:1-100
Viewed workflow-cost-contract.test.mjs:101-250
Viewed pre-cutover-workflow-cost.json:1-32
Viewed workflow-cost-contract.test.mjs:251-400
Viewed workflow-cost-contract.test.mjs:401-500
Viewed gitRepository.js:40-150
Ran command: `Select-String -Path "src\committing-to-git\git\gitRepository.js" -Pattern "containsControlCharacter"`
Viewed gitRepository.js:420-450
Viewed gitRepository.js:500-600
Viewed gitRepository.js:590-640
Viewed gitRepository.js:640-720
Viewed gitRepository.js:721-800
Viewed gitRepository.js:800-956
Viewed gitRepository.js:350-420
Viewed reviewCatalog.js:1-100
Ran command: `Select-String -Path "src\committing-to-git\**\*" -Pattern "Buffer.compare"`
Viewed inlineEvidenceCapsule.js:330-360
Ran command: `Select-String -Path "src\committing-to-git\inspection\inlineEvidenceCapsule.js" -Pattern "unitPathBytes"`
Viewed inlineEvidenceCapsule.js:114-135
Viewed inlineEvidenceCapsule.js:350-400
Viewed reviewCatalog.js:1490-1580
Viewed changeSelection.js:220-260
Viewed changeSelection.js:1-60
Viewed changeSelection.js:1-60
Ran command: `Select-String -Path "src\committing-to-git\**\*" -Pattern "compareChangeUnitsByRawPath"`
Viewed prepareWorkflow.js:240-280
Viewed commitReport.js:650-670
Viewed finalizeMessageWorkflow.js:315-340
Ran command: `Select-String -Path "src\committing-to-git\workflow\prepareWorkflow.js" -Pattern "(runReadOnlyGit|runGit|streamGit|readOnlyGitText)"`
Viewed prepareWorkflow.js:870-950
Viewed prepareWorkflow.js:950-1030
Viewed prepareWorkflow.js:750-810
Viewed prepareWorkflow.js:810-860
Ran command: `node --test "tests/committing-to-git/workflow-cost-contract.test.mjs"`

The test run has been initiated in the background to verify the existing test harness. Awaiting completion.

Checked task Run test

Waiting for background test execution to complete.

Viewed task-114.log:1-24
Viewed workflow-cost-contract.test.mjs:501-584
Ran command: `node --test "tests/committing-to-git/review-catalog.test.mjs"`
Ran command: `node --test "tests/committing-to-git/commit-message-renderer.test.mjs"`
Viewed changeSelection.js:230-255
Viewed change-selection.test.mjs:1-100
Ran command: `Select-String -Path "tests\committing-to-git\**\*" -Pattern "compareChangeUnitsByRawPath"`

# Executive summary

- **Performance objective understood**: Identify, analyze, and prioritize high-impact optimizations across the production implementation of the `committing-to-git` skill runtime at `C:\Users\maksy\GitHub\agent-skills\src\committing-to-git`. The objective is to reduce execution latency, eliminate unnecessary process creation overhead, minimize memory churn, and improve scaling behavior for change manifests ranging from 1 to 1,000+ change units, while strictly preserving exact ordering semantics, UTF-8 byte integrity, public APIs, and Git transaction safety contracts.
- **Strongest measured bottlenecks**: Measured evidence from the repository test harness (`tests/committing-to-git/workflow-cost-contract.test.mjs` and `fixtures/pre-cutover-workflow-cost.json`) confirms that external Git process execution (`gitProcesses`) and end-to-end command orchestration dominate overall wall-clock latency (the 1,000-unit postapproval commit test measured 3,978.6 ms, and draft promotion measured 3,826.2 ms). In code execution paths, static analysis reveals high-frequency ephemeral allocations ($O(N \log N)$ Buffer allocations and repeated base64 decodings inside sorting comparators) and potential $O(U)$ sequential Git subprocess invocations in untracked rename detection.
- **Top three recommended actions**:
  1. **Short-circuit and guard untracked rename scanning** in [`exactUnstagedRenamePairs`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/workflow/prepareWorkflow.js#L804-L860) to eliminate up to $U$ sequential `git hash-object` child process spawns when no deleted stage-0 blob OIDs exist.
  2. **Eliminate repeated Base64 decoding and Buffer allocations during change-unit sorting** in [`compareChangeUnitsByRawPath`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/message/changeSelection.js#L231-L251) and [`orderedUnits`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/inspection/inlineEvidenceCapsule.js#L343-L347) by caching decoded path buffers or adopting key-extraction / Schwartzian transforms ($O(N)$ allocations instead of $O(N \log N)$).
  3. **Eliminate ephemeral Buffer and array allocations in string sorting and path validation** across [`normalizedSelection`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/inspection/reviewCatalog.js#L79-L91), [`normalizeScopePath`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/workflow/prepareWorkflow.js#L243-L255), and control character validators by hoisting static Buffer sentinels and using regex/code-point index scans instead of character array spreading.
- **Major missing evidence**:
  1. *Primary environment divergence*: The review request specifies Python code, but the directory `src\committing-to-git` contains exactly 0 Python source files (`.py`). The production implementation is entirely JavaScript/Node.js (Node.js >= 24 engine requirement).
  2. No production CPU sampling profiles (e.g., V8 `--cpu-prof` or Linux `perf`) were supplied for live agent runs.
  3. Real-world distribution of repository changesets (proportion of 1-unit micro-commits vs 1,000-unit bulk imports, and average ratio of untracked to deleted files) is unmeasured.
- **Overall confidence**: **Medium** (High regarding code-level algorithmic/allocation bottlenecks and exact filesystem facts; Medium regarding end-to-end wall-clock impact under varied production agent workloads without production CPU sampling profiles).

---

# Environment and assumptions

| Aspect | Supplied fact | Assumption if missing | Why it matters |
| :--- | :--- | :--- | :--- |
| **Python implementation / version / build** | **0 Python files (`.py`) exist** in `src\committing-to-git`. The production runtime is JavaScript ES2024 (`engines.node: ">=24"` per [`package.json`](file:///c:/Users/maksy/GitHub/agent-skills/package.json#L7) and [`SKILL.md`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/SKILL.md#L4)). Broader repo has a `.venv` with Python 3.12 64-bit for external tooling. | If evaluated from a Python perspective (e.g., an agent executing or porting this skill to Python), assume CPython 3.12+ 64-bit; for the existing codebase, evaluate the production Node.js 24 runtime. | Runtime optimization techniques diverge fundamentally (V8 JIT compilation, generational GC, and libuv event loop vs. CPython bytecode interpreter, reference counting + cyclic GC, and GIL). |
| **Operating system** | Windows (`os.name == 'nt'`, local path `C:\Users\maksy\...`); Linux CI workflows exist (`committing-to-git-linux.yml`). | Windows 11 / Server 2025 and Ubuntu 24.04 LTS. | Subprocess creation (`spawnSync`) is ~10–30x more expensive on Windows (Win32 `CreateProcessW`) than Linux (`fork`/`vfork`/`clone`). |
| **Architecture** | x86_64 host architecture. | x86_64 / amd64. | Affects pointer widths, memory footprint, and native hashing SIMD acceleration. |
| **Hardware / container limits** | Not supplied. | Standard developer workstation (>= 16 GB RAM, multi-core CPU) without severe cgroup memory throttling. | Memory pressure and GC thrashing depend on available system headroom. |
| **Dependency versions** | Node.js >= 24; Git >= 2.45 (`--no-lazy-fetch` boundary enforced). No production npm packages; devDependencies: `ajv` 8.20.0, `esbuild` 0.28.2. | Standard Git 2.45+ binary available on `PATH`. | Git command capabilities, flags, and subprocess boundaries depend strictly on the Git version. |
| **Workload** | Test fixtures define three discrete change-unit scales: 1, 12, and 1,000 units ([`workflow-cost-contract.test.mjs`](file:///c:/Users/maksy/GitHub/agent-skills/tests/committing-to-git/workflow-cost-contract.test.mjs#L516)). Max canonical message bytes: 32 KiB. | 85% of agent operations are small (< 20 units); 15% are bulk operations (100–1,000 units). | Determines whether in-process $O(N \log N)$ sorting bottlenecks matter relative to fixed Git process overhead. |
| **Concurrency** | Sequential CLI invocations per step (`workflow prepare`, `message finalize`, `workflow commit`); asynchronous streams in `streamGit`. | Single-threaded synchronous CLI execution per transaction. | Concurrency and thread safety are not bottlenecks; event loop blocking and process execution latency dominate. |
| **Target metric** | Workflow cost contracts: `gitProcesses`, `helperCalls`, `stdoutBytes`, `agentArtifactReads`, `agentArtifactWrites`, and latency `durationMs`. | Primary optimization metric is wall-clock latency (`durationMs`) of helper invocations, followed by peak heap allocation. | Informs trade-offs: eliminating a single Git subprocess outweighs shaving microseconds of CPU time. |
| **Benchmarks** | Integration cost test suite in [`tests/committing-to-git/workflow-cost-contract.test.mjs`](file:///c:/Users/maksy/GitHub/agent-skills/tests/committing-to-git/workflow-cost-contract.test.mjs). No standalone microbenchmarks. | Microbenchmark harness must be constructed using `node:test` / `perf_hooks` or standard-library Python timing. | Necessary to falsify hypotheses and prevent performance regressions. |
| **Profiling method** | Git Trace2 event logs (`GIT_TRACE2_EVENT`) used for Git process counting. No CPU profiler trace supplied. | Profiling must be established via V8 CPU profiler (`--cpu-prof`) or Python `cProfile` on port. | Required to verify exact call frequencies and CPU hot paths under real load. |
| **Risk tolerance** | Conservative production risk: zero tolerance for Git index corruption, tree mismatch, signature failure, or ordering divergence. | Zero breaking changes to public CLI contracts or serialized JSON schema contracts. | Preserves determinism and safety guarantees. |

---

# Evidence and hotspots

| Rank | Location | Evidence | Bottleneck type | Status | Confidence |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | [`src/committing-to-git/workflow/prepareWorkflow.js::exactUnstagedRenamePairs`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/workflow/prepareWorkflow.js#L804-L860) | Loops over all `untracked` files and invokes `runReadOnlyGit(..., "hash-object")` synchronously; fails to return early when `deletedByOid.size === 0`. | Unnecessary subprocess spawning ($O(U)$ child process launches on Windows) | **INFERRED** | High |
| **2** | [`src/committing-to-git/message/changeSelection.js::compareChangeUnitsByRawPath`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/message/changeSelection.js#L231-L251) | Used as comparator in [`commitMessageRenderer.js`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/message/commitMessageRenderer.js#L252) and [`approvedMessage.js`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/message/approvedMessage.js#L266); performs multiple Base64 decodings and allocates new Buffers on every pairwise comparison ($O(N \log N)$ allocations). | Ephemeral memory churn and repeated decoding in hot sort loops | **INFERRED** | High |
| **3** | [`src/committing-to-git/inspection/inlineEvidenceCapsule.js::orderedUnits`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/inspection/inlineEvidenceCapsule.js#L343-L347) | Called per synopsis group; repeatedly calls `unitPathBytes(unit)` which decodes Base64 into new Buffers inside the sort comparator. | Repeated decoding and object allocation in sort loop | **INFERRED** | High |
| **4** | [`src/committing-to-git/inspection/reviewCatalog.js::normalizedSelection`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/inspection/reviewCatalog.js#L86) & [`queuePagesForCatalog`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/inspection/reviewCatalog.js#L1570) & [`commitReport.js::collectWorkspaceSummary`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/report/commitReport.js#L661) | Sorting arrays of strings with `(left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))` allocates two new Buffers on every comparison. | Ephemeral Buffer allocations in string sorting | **INFERRED** | High |
| **5** | [`src/committing-to-git/workflow/prepareWorkflow.js::normalizeScopePath`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/workflow/prepareWorkflow.js#L243-L250) & [`containsUnsafeControl`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/workflow/prepareWorkflow.js#L969-L975) / [`gitRepository.js::containsControlCharacter`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/git/gitRepository.js#L41-L47) | Allocates `Buffer.from(".")` and `Buffer.from("..")` dynamically per path component; uses `[...value]` spread to check control characters. | Allocation churn in validation paths | **INFERRED** | High |

---

# Prioritised findings

## PERF-01 — Short-circuit and guard untracked rename candidate scanning
- **Location**: [`src/committing-to-git/workflow/prepareWorkflow.js::exactUnstagedRenamePairs`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/workflow/prepareWorkflow.js#L804-L860)
- **Status**: **INFERRED**
- **Priority**: High
- **Confidence**: High
- **Evidence**:
  In `exactUnstagedRenamePairs`, when unstaged deletions exist (`deletedPaths.length > 0`) alongside untracked files (`untracked.length > 0`), the code collects `deletedByOid`. If none of the deleted paths had a corresponding stage-0 blob in the index (`deletedByOid.size === 0`), the function currently continues into the loop over `untracked` files. Inside that loop, for every untracked file, it invokes:
  ```javascript
  const oid = runReadOnlyGit(root, "hash-object", ["--no-filters", "--", text]).stdout.toString("ascii").trim();
  ```
  This launches an external Git child process (`spawnSync`) for every single untracked file.
- **Performance mechanism**:
  On Windows, process creation latency is approximately 15–30 ms per invocation. In a repository with 200 untracked files (e.g., untracked build outputs, vendor directories, or scratch files) and 1 deleted tracked file:
  - If `deletedByOid.size === 0`, it executes 200 unnecessary Git child processes, blocking execution for 3–6 seconds without any possibility of producing a rename pair.
  - Furthermore, if `deletedByOid.size > 0`, checking whether `deletedByOid` is empty avoids executing any process when no candidate OIDs exist.
- **Complexity before**: $O(U)$ Git process spawns, where $U$ is the number of untracked files.
- **Complexity after**: $O(0)$ Git process spawns when `deletedByOid.size === 0`.
- **Proposed change**: Insert an immediate early return `if (deletedByOid.size === 0) { return []; }` directly after building `deletedByOid`.
- **Expected impact**: Unknown until benchmarked; completely eliminates up to $U$ subprocess spawns (saving seconds on Windows) in all cases where deleted files do not have index blobs.
- **Risks/trade-offs**: Zero risk. If `deletedByOid` has size 0, `deletedByOid.get(oid)` would always return `undefined`, so `pairs` would remain empty regardless.
- **Patch**: See Patch 1 in `# Patch set`.
- **Benchmark to validate**: Measure `workflow prepare` wall-clock duration in a test repository with 1 unstaged deletion (not in index) and 100 untracked files.
- **Correctness tests**: Run `tests/committing-to-git/workflow-cost-contract.test.mjs` and `tests/committing-to-git/reviewed-preparation.test.mjs`.
- **Decision rule**: Adopt immediately; pure win with zero semantic risk.

---

## PERF-02 — Eliminate repeated Base64 decoding and Buffer churn in change-unit sorting
- **Location**: [`src/committing-to-git/message/changeSelection.js::compareChangeUnitsByRawPath`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/message/changeSelection.js#L231-L251)
- **Status**: **INFERRED**
- **Priority**: High
- **Confidence**: High
- **Evidence**:
  `compareChangeUnitsByRawPath` is used as the comparator in `[...manifest.changeUnits].sort(compareChangeUnitsByRawPath)` in [`approvedMessage.js`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/message/approvedMessage.js#L266) and [`commitMessageRenderer.js`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/message/commitMessageRenderer.js#L252, #L393).
  In each comparison, it calls `changeUnitPathBytes(unit, "destination")`, which calls `Buffer.from(encoded, "base64")` or `Buffer.from(path, "utf8")`. If null, it calls `Buffer.alloc(0)`.
- **Performance mechanism**:
  For $N$ change units, JavaScript's `Array.prototype.sort` invokes the comparator $O(N \log N)$ times (approx. 10,000 comparisons for $N = 1,000$). Each comparison invokes `changeUnitPathBytes` 2 to 4 times, performing thousands of Base64 decodings and allocating 20,000 to 40,000 ephemeral `Buffer` objects. This triggers high V8 garbage collection churn in the young generation (Scavenge).
- **Complexity before**: $O(N \log N)$ Base64 decodings and Buffer allocations.
- **Complexity after**:
  1. Static `EMPTY_BUFFER = Buffer.alloc(0)` eliminates empty buffer allocations.
  2. Cache the decoded `destinationPathBytes` and `sourcePathBytes` on the unit or provide a decorated sort helper (`sortChangeUnitsByRawPath`) that pre-extracts the buffers once ($O(N)$ allocations).
  3. For `left.id` tie-breaking, since change-unit IDs are canonical ASCII (`/^F[0-9]{6}$/`), `left.id < right.id ? -1 : (left.id > right.id ? 1 : 0)` produces the exact same ordering as `Buffer.compare(Buffer.from(left.id), Buffer.from(right.id))` without allocating two Buffers.
- **Proposed change**: Cache path buffers lazily on change units using `Symbol` or private properties, reuse a shared `EMPTY_BUFFER`, and compare IDs directly.
- **Expected impact**: Unknown until benchmarked; eliminates ~20,000–40,000 Buffer allocations and Base64 decodings per 1,000-unit commit render.
- **Risks/trade-offs**: Caching properties on `unit` must use non-enumerable or Symbol keys so they do not leak into JSON serialization or schema validation.
- **Patch**: See Patch 2 in `# Patch set`.
- **Benchmark to validate**: Run benchmark sorting 1,000 change units with `compareChangeUnitsByRawPath` vs baseline.
- **Correctness tests**: `tests/committing-to-git/change-selection.test.mjs` and `tests/committing-to-git/commit-message-renderer.test.mjs`.
- **Decision rule**: If microbenchmark confirms >= 3x speedup in sorting and passes all 15 workflow cost tests, merge.

---

## PERF-03 — Eliminate repeated Base64 decoding in synopsis group sampling
- **Location**: [`src/committing-to-git/inspection/inlineEvidenceCapsule.js::orderedUnits`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/inspection/inlineEvidenceCapsule.js#L343-L347)
- **Status**: **INFERRED**
- **Priority**: Medium
- **Confidence**: High
- **Evidence**:
  In `inlineEvidenceCapsule.js`:
  ```javascript
  function orderedUnits(units) {
    return [...units].sort((left, right) =>
      Buffer.compare(unitPathBytes(left), unitPathBytes(right)),
    );
  }
  ```
  `unitPathBytes(unit)` decodes `unit.destinationPathBytesBase64` via `Buffer.from(..., "base64")`.
  This is called per synopsis group in `countedGroupLines` and per anomaly category in `anomalyLines`.
- **Performance mechanism**:
  In a group containing $U$ units, `.sort(...)` performs $O(U \log U)$ comparisons, each calling `unitPathBytes` twice and decoding Base64.
  Furthermore, the caller immediately does:
  ```javascript
  const samples = orderedUnits(units).slice(0, maximumSamples)...
  ```
  where `maximumSamples` is typically 5. Sorting the entire array repeatedly re-decodes Base64 for all elements.
- **Complexity before**: $O(U \log U)$ Base64 decodings and Buffer allocations per group.
- **Complexity after**: $O(U)$ Base64 decodings and allocations via Schwartzian transform (decorate-sort-undecorate).
- **Proposed change**: Pre-map `units` to `{ unit, pathBytes: unitPathBytes(unit) }`, sort on `pathBytes`, and unwrap.
- **Expected impact**: Unknown until benchmarked; reduces Base64 decoding operations by a factor of $\log_2 U$.
- **Risks/trade-offs**: Negligible. Decorate-sort-undecorate preserves exact ordering.
- **Patch**: See Patch 3 in `# Patch set`.
- **Benchmark to validate**: Measure `createInlineEvidenceCapsule` latency for 1,000 units across multiple synopsis groups.
- **Correctness tests**: `tests/committing-to-git/workflow-cost-contract.test.mjs` ("the proportional route contract never uses change-unit count as an evidence proxy").
- **Decision rule**: Adopt when verified with existing test suite.

---

## PERF-04 — Eliminate ephemeral Buffer allocations in string sorting paths
- **Location**:
  - [`src/committing-to-git/inspection/reviewCatalog.js::normalizedSelection`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/inspection/reviewCatalog.js#L86) (line 86)
  - [`src/committing-to-git/inspection/reviewCatalog.js::queuePagesForCatalog`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/inspection/reviewCatalog.js#L1570) (line 1570)
  - [`src/committing-to-git/report/commitReport.js::collectWorkspaceSummary`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/report/commitReport.js#L661) (line 661)
  - [`src/committing-to-git/workflow/finalizeMessageWorkflow.js::canonicalSelection`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/workflow/finalizeMessageWorkflow.js#L323) (lines 323, 329)
- **Status**: **INFERRED**
- **Priority**: Medium
- **Confidence**: High
- **Evidence**:
  Multiple sorting call-sites use the pattern:
  ```javascript
  array.sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  ```
  In `queuePagesForCatalog`, `left` and `right` are ASCII file names (e.g., `initial-0123456789ab-Q000001.json`). In `normalizedSelection` and `canonicalSelection`, `left` and `right` are JSON field keys or selection identifier strings.
- **Performance mechanism**:
  Calling `Buffer.from(str)` on every pairwise comparison allocates two new Buffer objects per step ($O(N \log N)$ allocations). For ASCII strings and strings within the Basic Multilingual Plane (BMP) without surrogate pairs, JavaScript string comparison (`left < right ? -1 : left > right ? 1 : 0`) produces the exact same byte-order result as UTF-8 `Buffer.compare` with zero memory allocation. For arbitrary UTF-8 strings where exact byte comparison is required, pre-encoding to Buffers once (Schwartzian transform) costs $O(N)$ allocations instead of $O(N \log N)$.
- **Complexity before**: $O(N \log N)$ Buffer allocations.
- **Complexity after**: $O(0)$ allocations for ASCII/direct string comparisons; $O(N)$ for Schwartzian transform.
- **Proposed change**: Use direct string comparison for known ASCII identifiers (filenames and object keys) or pre-encode once.
- **Expected impact**: Unknown until benchmarked; reduces GC overhead during queue creation and selection canonicalization.
- **Risks/trade-offs**: Must ensure no discrepancy occurs on non-ASCII surrogate code points if byte order is strictly mandated by specification.
- **Patch**: See Patch 4 in `# Patch set`.
- **Benchmark to validate**: Microbenchmark sorting 1,000 ASCII queue filenames.
- **Correctness tests**: `tests/committing-to-git/review-catalog.test.mjs`.
- **Decision rule**: Adopt for verified ASCII paths.

---

## PERF-05 — Eliminate repeated dynamic Buffer allocations in path and control-character validation
- **Location**:
  - [`src/committing-to-git/workflow/prepareWorkflow.js::normalizeScopePath`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/workflow/prepareWorkflow.js#L243-L250) (lines 247–248)
  - [`src/committing-to-git/workflow/prepareWorkflow.js::containsUnsafeControl`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/workflow/prepareWorkflow.js#L969-L975) (lines 969–975)
  - [`src/committing-to-git/git/gitRepository.js::containsControlCharacter`](file:///c:/Users/maksy/GitHub/agent-skills/src/committing-to-git/git/gitRepository.js#L41-L47) (lines 41–47)
- **Status**: **INFERRED**
- **Priority**: Low
- **Confidence**: High
- **Evidence**:
  1. In `normalizeScopePath`:
     ```javascript
     component.equals(Buffer.from(".")) || component.equals(Buffer.from(".."))
     ```
     allocates two new Buffers for every path component on every validated path.
  2. In `containsUnsafeControl` and `containsControlCharacter`:
     ```javascript
     return [...value].some((character) => ...)
     ```
     spreads strings into an array of 1-character strings.
- **Performance mechanism**:
  Dynamic allocations in loops trigger avoidable garbage collection churn. Replacing dynamic Buffer allocations with static module-level constants or byte checks (`component.length === 1 && component[0] === 0x2e`), and replacing `[...value]` with a RegExp (`/[\x00-\x1f\x7f-\x9f]/u.test(value)`) or indexed loop avoids all heap allocations.
- **Complexity before**: $O(M)$ allocations per validation call ($M$ = string length).
- **Complexity after**: $O(1)$ allocations.
- **Proposed change**: Hoist `DOT_BUFFER` and `DOT_DOT_BUFFER` constants; replace character array spreads with RegExp tests.
- **Expected impact**: Unknown until benchmarked; eliminates minor young-generation allocation churn.
- **Risks/trade-offs**: Zero risk.
- **Patch**: See Patch 5 in `# Patch set`.
- **Benchmark to validate**: Microbenchmark validating 1,000 candidate repository paths.
- **Correctness tests**: `tests/committing-to-git/check-workspace.test.mjs`.
- **Decision rule**: Adopt alongside other cleanups.

---

# Patch set

### Patch 1: Guard untracked rename candidate scanning (PERF-01)
**File**: `src/committing-to-git/workflow/prepareWorkflow.js`  
**Symbol**: `exactUnstagedRenamePairs`

```diff
--- a/src/committing-to-git/workflow/prepareWorkflow.js
+++ b/src/committing-to-git/workflow/prepareWorkflow.js
@@ -825,6 +825,10 @@ function exactUnstagedRenamePairs(root, unstaged, untracked, environment) {
     }
   }
 
+  if (deletedByOid.size === 0) {
+    return [];
+  }
+
   const pairs = [];
 
   for (const record of untracked) {
```

---

### Patch 2: Eliminate repeated Base64 decoding and Buffer churn in change-unit sorting (PERF-02)
**File**: `src/committing-to-git/message/changeSelection.js`  
**Symbol**: `compareChangeUnitsByRawPath`

```diff
--- a/src/committing-to-git/message/changeSelection.js
+++ b/src/committing-to-git/message/changeSelection.js
@@ -15,6 +15,10 @@ export const MAXIMUM_CANONICAL_MESSAGE_BYTES = 32 * 1024;
 
 const PROHIBITED_RENDERED_PATH_CHARACTER = /[\p{Cc}\p{Cf}`]/u;
+const EMPTY_BUFFER = Buffer.alloc(0);
+const DEST_BYTES_CACHE = new WeakMap();
+const SOURCE_BYTES_CACHE = new WeakMap();
+
+function cachedUnitPathBytes(unit, direction, cache) {
+  let bytes = cache.get(unit);
+  if (bytes === undefined) {
+    bytes = changeUnitPathBytes(unit, direction) ?? EMPTY_BUFFER;
+    cache.set(unit, bytes);
+  }
+  return bytes;
+}
 
 function isPlainObject(value) {
@@ -231,23 +247,25 @@ export function compareChangeUnitsByRawPath(left, right) {
-  const destination = Buffer.compare(
-    changeUnitPathBytes(left, "destination") ?? Buffer.alloc(0),
-    changeUnitPathBytes(right, "destination") ?? Buffer.alloc(0),
-  );
+  const leftDest = cachedUnitPathBytes(left, "destination", DEST_BYTES_CACHE);
+  const rightDest = cachedUnitPathBytes(right, "destination", DEST_BYTES_CACHE);
+  const destination = Buffer.compare(leftDest, rightDest);
 
   if (destination !== 0) {
     return destination;
   }
 
-  const source = Buffer.compare(
-    changeUnitPathBytes(left, "source") ?? Buffer.alloc(0),
-    changeUnitPathBytes(right, "source") ?? Buffer.alloc(0),
-  );
+  const leftSource = cachedUnitPathBytes(left, "source", SOURCE_BYTES_CACHE);
+  const rightSource = cachedUnitPathBytes(right, "source", SOURCE_BYTES_CACHE);
+  const source = Buffer.compare(leftSource, rightSource);
 
   if (source !== 0) {
     return source;
   }
 
-  return Buffer.compare(Buffer.from(left.id), Buffer.from(right.id));
+  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
 }
```

---

### Patch 3: Schwartzian transform in synopsis group sampling (PERF-03)
**File**: `src/committing-to-git/inspection/inlineEvidenceCapsule.js`  
**Symbol**: `orderedUnits`

```diff
--- a/src/committing-to-git/inspection/inlineEvidenceCapsule.js
+++ b/src/committing-to-git/inspection/inlineEvidenceCapsule.js
@@ -343,5 +343,7 @@ function kindSummary(units) {
 function orderedUnits(units) {
-  return [...units].sort((left, right) =>
-    Buffer.compare(unitPathBytes(left), unitPathBytes(right)),
-  );
+  return units
+    .map((unit) => ({ unit, pathBytes: unitPathBytes(unit) }))
+    .sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes))
+    .map(({ unit }) => unit);
 }
```

---

### Patch 4: Eliminate ephemeral Buffer allocations in string sorting paths (PERF-04)
**File**: `src/committing-to-git/inspection/reviewCatalog.js`  
**Symbol**: `normalizedSelection`, `queuePagesForCatalog`

```diff
--- a/src/committing-to-git/inspection/reviewCatalog.js
+++ b/src/committing-to-git/inspection/reviewCatalog.js
@@ -85,3 +85,3 @@ function normalizedSelection(selection) {
         Array.isArray(value)
-          ? [...value].sort((left, right) =>
-              Buffer.compare(Buffer.from(left), Buffer.from(right)),
-            )
+          ? [...value].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
           : value,
@@ -1569,3 +1569,3 @@ function queuePagesForCatalog(outputDirectory, catalogSha256) {
     )
-    .sort((left, right) =>
-      Buffer.compare(Buffer.from(left), Buffer.from(right)),
-    )
+    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
     .flatMap((name) => {
```

---

### Patch 5: Static Buffer sentinels and regex control character checks (PERF-05)
**File**: `src/committing-to-git/workflow/prepareWorkflow.js`  
**Symbol**: `normalizeScopePath`, `containsUnsafeControl`

```diff
--- a/src/committing-to-git/workflow/prepareWorkflow.js
+++ b/src/committing-to-git/workflow/prepareWorkflow.js
@@ -107,2 +107,4 @@ const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
+const DOT_BUFFER = Buffer.from(".");
+const DOT_DOT_BUFFER = Buffer.from("..");
 
 function splitNul(buffer) {
@@ -246,4 +248,4 @@ function normalizeScopePath(scopePath, label, fail) {
     components.some(
       (component) =>
         component.length === 0 ||
-        component.equals(Buffer.from(".")) ||
-        component.equals(Buffer.from("..")),
+        component.equals(DOT_BUFFER) ||
+        component.equals(DOT_DOT_BUFFER),
     )
@@ -969,6 +971,3 @@ function containsUnsafeControl(value) {
-  return [...value].some((character) => {
-    const codePoint = character.codePointAt(0);
-
-    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
-  });
+  return /[\x00-\x1f\x7f-\x9f]/u.test(value);
 }
```

---

# Benchmark plan

### Representative workloads
1. **Micro-workload (1 unit)**: Single modified file commit. Baseline for minimum per-command overhead and process latency.
2. **Standard workload (12 units)**: Mixed changes (modified, added, deleted, renamed). Typical multi-file feature commit.
3. **Bulk workload (1,000 units)**: 1,000 generated units across multiple domains with Base64 path encodings. Stresses sort comparators, Base64 decoders, memory allocation, and JSON serializers.
4. **Adversarial untracked workload**: 1 unstaged deleted file and 200 untracked files (stresses `exactUnstagedRenamePairs`).

### Runnable Node.js benchmark harness (`benchmark-sorting.mjs`)
```javascript
import { performance } from "node:perf_hooks";
import { compareChangeUnitsByRawPath } from "./src/committing-to-git/message/changeSelection.js";

function makeChangeUnits(count) {
  return Array.from({ length: count }, (_, i) => {
    const id = `F${String(i + 1).padStart(6, "0")}`;
    const dest = `src/module_${i % 10}/file_${String(i + 1).padStart(6, "0")}.js`;
    return {
      id,
      kind: "modified",
      destinationPath: dest,
      destinationPathBytesBase64: Buffer.from(dest).toString("base64"),
      sourcePath: null,
      sourcePathBytesBase64: null,
    };
  });
}

function runBenchmark(label, iterations = 100, unitCount = 1000) {
  const units = makeChangeUnits(unitCount);
  // Warmup
  for (let i = 0; i < 10; i++) {
    [...units].sort(compareChangeUnitsByRawPath);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    [...units].sort(compareChangeUnitsByRawPath);
  }
  const elapsed = performance.now() - start;
  console.log(`${label}: ${(elapsed / iterations).toFixed(3)} ms per 1000-unit sort`);
}

runBenchmark("Change-unit sorting benchmark");
```

### Python comparison harness (`benchmark_sorting.py`)
For Python performance engineers testing the equivalent algorithmic pattern under CPython 3.12:
```python
import base64
import timeit

def create_units(n=1000):
    return [
        {
            "id": f"F{i+1:06d}",
            "dest_b64": base64.b64encode(f"src/module_{i%10}/file_{i+1:06d}.js".encode()).decode(),
        }
        for i in range(n)
    ]

units = create_units(1000)

# Uncached: Base64 decode per comparison
def uncached_sort(data):
    # Python sort key vs comparison
    import functools
    def cmp(a, b):
        da = base64.b64decode(a["dest_b64"])
        db = base64.b64decode(b["dest_b64"])
        return (da > db) - (da < db)
    return sorted(data, key=functools.cmp_to_key(cmp))

# Cached / Key extraction (Schwartzian transform)
def cached_sort(data):
    return sorted(data, key=lambda u: base64.b64decode(u["dest_b64"]))

t_uncached = timeit.timeit(lambda: uncached_sort(units), number=50) / 50 * 1000
t_cached = timeit.timeit(lambda: cached_sort(units), number=50) / 50 * 1000
print(f"Python Uncached: {t_uncached:.2f} ms | Python Cached key: {t_cached:.2f} ms")
```

---

# Test and verification plan

### Existing tests to run
- `node --test tests/committing-to-git/workflow-cost-contract.test.mjs`: Verifies helper calls, Git process counts, payload sizes, and postapproval commit contracts for 1, 12, and 1,000 units.
- `node --test tests/committing-to-git/review-catalog.test.mjs`: Verifies catalog digest integrity, packet bounds, and selection normalization.
- `node --test tests/committing-to-git/commit-message-renderer.test.mjs`: Verifies 1,000-file scaffold rendering, path ordering, and bulk message consistency.
- `node --test tests/committing-to-git/change-selection.test.mjs`: Verifies selection resolution and boundary handling.
- `npm run verify`: Full suite check including lint, formatting, and build checks.

### Tests to add
1. **Adversarial untracked rename test**:
   - Create repository fixture with 1 deleted tracked file (not staged or absent from index stage 0) and 50 untracked files.
   - Assert `exactUnstagedRenamePairs` returns `[]` immediately with **0** `git hash-object` calls recorded in Trace2.
2. **Sort stability and Unicode byte-order verification**:
   - Verify that `compareChangeUnitsByRawPath` produces the exact same permutation before and after patch on paths containing multi-byte UTF-8 sequences and identical destination paths (source-path tie break and ID tie break).

---

# Deferred hypotheses

1. **In-process Git blob hashing via `node:crypto` / `hashlib`**:
   - *Hypothesis*: Hashing untracked files in-process via `createHash("sha1").update(\`blob ${size}\0\`).update(content).digest("hex")` would eliminate all remaining Git child processes during rename detection.
   - *Evidence needed*: Verification of whether the repository configuration mandates Git object filters (`clean`/`smudge`) or gitattributes that would cause in-process blob hashing to diverge from `git hash-object --no-filters`.
2. **Persistent bidirectional Git coprocess (`git cat-file --batch-check`)**:
   - *Hypothesis*: Keeping a long-lived Git process open for object queries instead of multiple `spawnSync` calls would eliminate 50–70% of wall-clock latency during commit preparation.
   - *Evidence needed*: Process lifecycle profiling on Windows to measure pipe communication latency vs `spawnSync` overhead, and assurance of clean process termination across CLI crashes.
3. **Streaming JSON serialization for large review catalogs**:
   - *Hypothesis*: Using streaming JSON packet serialization rather than building monolithic in-memory objects in `reviewCatalog.js` will reduce peak memory footprint for changesets exceeding 5,000 units.
   - *Evidence needed*: Heap snapshot showing peak RSS during 5,000+ unit catalog creation.

---

# Final action order

1. **Establish baseline**:
   Execute `node --test tests/committing-to-git/workflow-cost-contract.test.mjs` and capture baseline `durationMs` and memory metrics.
2. **Apply Patch 1 (PERF-01)**:
   Add early return `if (deletedByOid.size === 0) return [];` in `exactUnstagedRenamePairs`.
3. **Validate correctness**:
   Run `tests/committing-to-git/reviewed-preparation.test.mjs` and `workflow-cost-contract.test.mjs`.
4. **Apply Patch 2 (PERF-02) and Patch 3 (PERF-03)**:
   Integrate cached path buffers in `compareChangeUnitsByRawPath` and Schwartzian transform in `orderedUnits`.
5. **Validate correctness**:
   Run `tests/committing-to-git/commit-message-renderer.test.mjs` and `tests/committing-to-git/change-selection.test.mjs`.
6. **Apply Patch 4 (PERF-04) and Patch 5 (PERF-05)**:
   Replace dynamic Buffer allocations and character array spreading.
7. **Run verification & re-benchmark**:
   Execute `npm run verify` followed by the 1,000-unit postapproval commit test to measure the combined wall-clock and GC improvement.
