# Scalable Large-Scope Git Transport Implementation Plan

> **For agentic workers:** Execute this plan sequentially in the primary agent session after the zero-packet issue has been committed. Do not delegate to subagents or run provider-backed model evaluations. Use `test-driven-development` for every behavior change and `verification-before-completion` before the issue commit. Use the freshly rebuilt canonical `committing-to-git` skill for the commit.

**Goal:** Keep every helper-owned child-process argument vector bounded independently of the selected path count while preserving exact evidence groups, frozen-tree witnessed checks, and arbitrary Git path bytes.

**Architecture:** Introduce a focused projected-index module that materializes exact Git views through constant-sized plumbing commands and NUL-delimited stdin. Evidence groups overlay their eligible destinations on the parent tree with `update-index --replace` and diff that projection against HEAD. Witnessed checks project only selected destinations expected to exist, stream raw worktree differences, and use exact absence checks for deletions and rename sources. A low artificial argv budget and large generated repositories enforce the process-boundary property independently of the host limit.

**Tech Stack:** Node.js 24+ ECMAScript modules, Git 2.45+ plumbing, Node's built-in test runner, Git Trace2 test evidence, esbuild, ESLint, and Prettier.

**Spec:** [`2026-08-28-large-change-unit-transport.md`](../committing-to-git/issues/2026-08-28-large-change-unit-transport.md)

## Global Constraints

- Never shrink or split the user-selected commit scope to fit a command line.
- Never carry manifest-sized path lists in `spawn`, `spawnSync`, `execFile`, or another launcher argument vector.
- Preserve path identity through raw bytes and NUL-delimited machine records; newline-delimited path transport is forbidden.
- Preserve evidence-group policy boundaries and the prepared-tree/unrelated-workspace boundary of witnessed checks.
- Do not use naive argv chunking, a Windows magic file count, or structured-message thresholds as transport logic.
- Keep temporary indexes helper-owned, UUID-named, transaction-contained, and removed through exact-path cleanup.
- Do not add dependencies or modify package, build, lint, formatting, evaluation, CI, or repository-policy configuration.
- Keep canonical `skills/**/SKILL.md` ASCII-only and preserve the unrelated `skills-lock.json` modification.

---

### Task 1: Add a platform-neutral argv-budget regression

**Files:**

- Create: `tests/committing-to-git/large-change-unit-transport.test.mjs`
- Modify: `tests/committing-to-git/git-process-transcript.test.mjs`
- Modify: `tests/committing-to-git/check-workspace.test.mjs`

**Interfaces:**

- Produces test launchers that reject an encoded executable-plus-argv payload above 1 KiB.
- Produces synthetic 10,000-unit fixtures and real 3,150-unit repository fixtures.

- [x] **Step 1: Implement only the test-side encoded argv budget**

  Count executable and argument UTF-8 bytes plus one separator byte per token. Wrap both synchronous and asynchronous launchers; record operation, argv bytes, stdin bytes, and status, and throw a deterministic test error above 1,024 bytes.

- [x] **Step 2: Add the 10,000-unit synthetic boundary assertions**

  Generate raw destination paths including long segments. Assert a projected-index update transfers their growth through stdin while every Git argv remains below 1 KiB.

- [x] **Step 3: Add the 3,150-unit preparation and check fixture**

  Generate at least 3,150 selected change units with aggregate path bytes above the artificial budget. Cover a scope file with one path prefix and a separately intentional staged scope. Record Trace2 child arguments and fail if any helper-owned child grows with the manifest.

- [x] **Step 4: Run the focused tests and confirm RED**

  Run:

  ```text
  node --test tests/committing-to-git/large-change-unit-transport.test.mjs tests/committing-to-git/check-workspace.test.mjs
  ```

  Expected: the current evidence diff and worktree comparison exceed the 1 KiB test budget or fail with `ENAMETOOLONG` before the new interface exists.

### Task 2: Add projected-index plumbing with stdin path transport

**Files:**

- Create: `src/committing-to-git/git/projectedIndex.js`
- Modify: `src/committing-to-git/git/gitRepository.js`
- Modify: `tests/committing-to-git/git-process-transcript.test.mjs`
- Modify: `tests/committing-to-git/large-change-unit-transport.test.mjs`

**Interfaces:**

- Produces: `encodeIndexInfoRecords(entries) -> Buffer`.
- Produces: `withProjectedIndex({ root, baselineTreeOid, entries, temporaryDirectory, environment, launchers }, useIndex) -> Promise<T>`.
- Adds closed Git operations `update-index-info`, `refresh-index`, and
  `diff-files-names`.

- [x] **Step 1: Add closed-allowlist tests**

  Assert `update-index-info` maps only to `git update-index --replace -z --index-info` and receives path records only through stdin. `--replace` is required for directory/file boundary changes and its structural deletions remain outside text evidence. Assert `diff-files-names` maps only to one fixed `--name-only -z --no-renames --ignore-submodules=none --` invocation with external diff, textconv, pager, color, filesystem monitor, optional locks, replacement objects, and lazy fetch disabled as applicable.

- [x] **Step 2: Run process-boundary tests and confirm RED**

  Run:

  ```text
  node --test tests/committing-to-git/git-process-transcript.test.mjs tests/committing-to-git/large-change-unit-transport.test.mjs
  ```

- [x] **Step 3: Encode canonical raw index-info records**

  Validate mode, full object ID, and nonempty NUL-free raw path bytes. Emit exactly:

  ```text
  <mode> SP <oid> TAB <raw-path> NUL
  ```

  Reject duplicate raw paths and retain their byte order deterministically.

- [x] **Step 4: Implement projected-index lifecycle**

  Allocate an exclusive `.projected-index-<purpose>-<uuid>.tmp` path below the caller-supplied transaction directory, load `baselineTreeOid` or `--empty`, apply entries by stdin, invoke the callback with the complete environment, and remove only that index and its exact `.lock` path in `finally`. Detailed comments must explain the snapshot, collision, and cleanup invariants.

- [x] **Step 5: Run the focused projected-index tests and confirm GREEN**

### Task 3: Replace evidence path argv with group projections

**Files:**

- Modify: `src/committing-to-git/workflow/prepareWorkflow.js`
- Modify: `tests/committing-to-git/commit-workflow-cli.test.mjs`
- Modify: `tests/committing-to-git/review-catalog.test.mjs`
- Modify: `tests/committing-to-git/large-change-unit-transport.test.mjs`

**Interfaces:**

- Replaces `patchArguments(manifest, units)` with a constant-size group-index diff.
- Evidence-group index entries derive only from manifest `newMode`, `newOid`, and `destinationPathBytesBase64` for the already-selected text/symlink units.

- [x] **Step 1: Add semantic parity tests**

  For additions, modifications, mode changes, symlink changes, rename destinations, deletions, binaries, and gitlinks, compare the packet/evidence result with the established behavior. Deletion bodies remain metadata/on-demand and binaries/gitlinks remain outside text patch spools.

- [x] **Step 2: Run the parity and large-transport tests and confirm RED**

  Run:

  ```text
  node --test tests/committing-to-git/commit-workflow-cli.test.mjs tests/committing-to-git/review-catalog.test.mjs tests/committing-to-git/large-change-unit-transport.test.mjs
  ```

- [x] **Step 3: Project one exact index per evidence group**

  Build the group index from HEAD or empty, apply only eligible destination entries through NUL stdin, and stream one full index diff with no path arguments. Preserve the existing spool digest, byte count, packet splitting, cleanup, and error classification.

- [x] **Step 4: Prove the old transport is absent**

  Add a source/process test that rejects `...paths` or equivalent manifest-derived expansion at Git launch sites. The assertion must target semantic child-process construction rather than incidental array spreads elsewhere.

- [x] **Step 5: Run focused evidence tests and confirm GREEN**

### Task 4: Replace witnessed-check path argv with streamed membership

**Files:**

- Create: `src/committing-to-git/checks/checkWorkspace.js`
- Modify: `src/committing-to-git/git/gitRepository.js`
- Modify: `src/committing-to-git/workflow/runCheckWorkflow.js`
- Modify: `tests/committing-to-git/check-workspace.test.mjs`
- Modify: `tests/committing-to-git/check-workflow.test.mjs`
- Modify: `tests/committing-to-git/large-change-unit-transport.test.mjs`

**Interfaces:**

- Moves and makes asynchronous: `selectedWorktreeMatchesPreparedTree({ root, manifest, temporaryDirectory, now, launchers }) -> Promise<{ matches, pathCount, observedAt }>`.
- Consumes raw source/destination identities from the manifest only.

- [x] **Step 1: Expand worktree semantic tests**

  Add selected modifications, disappearance, deleted-path recreation, rename-source recreation, mode changes, symlink changes, gitlink changes, hostile option-like names, unrelated tracked/untracked mutation, one very long raw path, and platform-conditional non-UTF-8 names.

- [x] **Step 2: Run check tests and confirm RED**

  Run:

  ```text
  node --test tests/committing-to-git/check-workspace.test.mjs tests/committing-to-git/check-workflow.test.mjs
  ```

- [x] **Step 3: Stream tracked worktree differences**

  Load only prepared destinations expected to exist into a selected-subject projected index, refresh its stat records, stream NUL-delimited `diff-files` names, and parse fields across arbitrary chunk boundaries. Because unrelated index entries are absent, unrelated workspace changes require neither output filtering nor a full-repository scan.

- [x] **Step 4: Check paths expected to be absent**

  Derive expected-present destinations from `newMode !== "000000"`. For every selected identity absent from that set, use an exact raw-byte filesystem path and non-following `lstat` to detect recreation even when Git ignore rules hide it. Treat only not-found/not-a-directory as absence; propagate permission and unexpected I/O failures rather than returning a false match.

- [x] **Step 5: Await the comparison at every check boundary**

  Update prelaunch, synchronous-launch-failure, and completed-child paths in `runCheckWorkflow.js`. Preserve journaling order and ensure no failed comparison creates a passing receipt.

- [x] **Step 6: Run focused check tests and confirm GREEN**

### Task 5: Exercise the full large transaction locally

**Files:**

- Modify: `tests/committing-to-git/large-change-unit-transport.test.mjs`

**Interfaces:**

- Exercises preparation, extended review, structured bulk finalization, witnessed check, signed commit, verification, report, and local-bare-remote publication.

- [x] **Step 1: Complete the 3,150-unit end-to-end case**

  Use exhaustive nonoverlapping semantic domains expressed by path prefixes, never 3,150 authored IDs. Traverse bounded packets programmatically, author one canonical bulk message, and attach a passed helper-witnessed check receipt.

- [x] **Step 2: Assert exact outcome facts**

  Assert the commit tree and raw message equal the prepared/canonical values, the signed header and configured verification succeed, the report contains the witnessed receipt rather than `skipped`, and local publication uses the exact OID/ref without a manifest-sized argv.

- [x] **Step 3: Run the dedicated transport test**

  Run:

  ```text
  node --test tests/committing-to-git/large-change-unit-transport.test.mjs
  ```

  Record change-unit count, aggregate selected path bytes, maximum observed argv bytes, check receipt ID/outcome, commit verification status, and local publication status.

### Task 6: Align documentation and issue evidence

**Files:**

- Modify: `docs/committing-to-git/issues/2026-08-28-large-change-unit-transport.md`
- Review: `skills/committing-to-git/SKILL.md`
- Review: `skills/committing-to-git/references/message-format.md`

- [x] **Step 1: Correct issue-document links**

  Point source links from the issue directory to repository `src/`, `skills/`, `tests/`, and `docs/plans/` paths correctly.

- [x] **Step 2: Append the resolved process-boundary inventory**

  Record each former O(paths) launcher, its replacement, the injected argv budget, large fixture sizes, witnessed-check behavior, and any remaining path-count-dependent in-process or stdin work with justification.

- [x] **Step 3: Confirm no agent workaround is needed**

  If canonical skill guidance already states that scope is never reduced and exposes no `ENAMETOOLONG` workaround, leave it unchanged. Edit it only if a public instruction is necessary to consume a changed helper interface.

### Task 7: Build, verify, review, and commit Issue 2

**Files:**

- Regenerate: `skills/committing-to-git/scripts/commitWorkflow.mjs`
- Review: every Issue 2 source, test, plan, issue-record, optional skill-text, and bundle change

- [x] **Step 1: Run the repository build**

  Run:

  ```text
  npm run build
  ```

- [x] **Step 2: Run complete deterministic verification**

  Run:

  ```text
  npm run verify
  ```

  Expected: build check, lint, deterministic tests including the large transport regression, skill validation/lint, and diff check pass without a provider-backed evaluation.

- [x] **Step 3: Inspect the complete bounded diff and status**

  Confirm the Issue 2 scope contains only its plan, issue record, source, tests, any necessary canonical skill clarification, and rebuilt bundle. Confirm `skills-lock.json` remains unstaged.

- [x] **Step 4: Reload the canonical skill and prepare a detailed issue commit**

  Read `skills/committing-to-git/SKILL.md` completely and use the freshly rebuilt canonical helper. Explain the projected-index transport, streamed raw-path comparison, preserved Git semantics, artificial argv guard, and each changed file or truthful counted domain.

- [ ] **Step 5: Present canonical bytes for exact approval and commit once authorized**

  Create one signed commit and do not push. Verify its full OID, exact tree/message, signature result, and remaining user-owned workspace changes.

## Plan Self-Review

- Spec coverage: every required transport, exact-scope, path-byte, check-receipt, failure-safety, and large-fixture property is assigned to Tasks 1-7.
- Placeholder scan: no deferred implementation placeholder remains.
- Type consistency: `withProjectedIndex`, `encodeIndexInfoRecords`, `diff-files-names`, and the asynchronous comparison signature are stable across producer and consumer tasks.
