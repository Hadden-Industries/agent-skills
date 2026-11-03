# Committing-to-git ephemeral workflow state

## 1. Status, authority, and provenance

| Field | Value |
| --- | --- |
| Plan date | 2026-11-03 |
| Status | Owner-directed implementation baseline for the slices marked "this change"; later slices remain draft |
| Inspected repository HEAD | `a6d9ab992492650f550032ab1565056241c0acae` |
| Primary input | `docs/committing-to-git/reviews/Deep Research Report_ Simplifying committing-to-git Around Ephemeral State, Native Git, and Enforced Architecture.md` |
| Input SHA-256 | `976ba52533fd7507f10cefb3d3f4c7ffd0487bc162a9fcf1a6b044c04cf8c22b` |
| Decision owner | Repository owner |

Owner decisions recorded in the implementing session:

- Scope: write this plan, implement `SLICE-ARCH`, `SLICE-BOUNDARY`, `SLICE-MEMORY-PREPARE` and `SLICE-EPHEMERAL-PROPOSAL`, and make memory the default.
- Rollout: memory becomes the default now and covers both `staged` and `full` scope; other routes require explicit disk storage until migrated.
- Configuration approval (exact change): add `dependency-cruiser` to root `devDependencies` as `>=18.7.1`, lock exactly `18.7.1` and its transitive graph in `package-lock.json`.
  No npm script, CI workflow, or root configuration file is added; the architecture rules live in a test.

This document authorizes no model evaluation, development commit, push, or release.
Behavioral evaluation of the changed skill instructions requires separate authorization.

## 2. Validation of the report against current `main`

| Report claim | Current evidence | Disposition |
| --- | --- | --- |
| `message` <-> `transaction` cycle | `message/canonicalMessageState.js` imports `transaction/transactionWorkspace.js`; `transaction/transactionRecovery.js` imports the message module. A file-level strongly-connected-component scan of 66 modules finds **no file-level cycle**. | Corrected: the cycles are between subsystems (directories), not modules. `dependency-cruiser`'s `circular` rule is module-level and already passes; the layering rules must be path rules. |
| Workflow <-> CLI inversion | 24 imports of `cli/commandArguments.js` and `cli/commandExecution.js` from 19 workflow modules; the dispatcher dynamically imports every workflow. | Confirmed. Removed by `SLICE-BOUNDARY`. |
| Implicit OS temp state | `createTransactionWorkspace()` defaults `temporaryRoot` to `os.tmpdir()`; it is the only `tmpdir()` caller. | Confirmed. Removed: disk storage requires an explicit directory. |
| Staged preparation writes | Staged actual preparation copies the real index to `preparation-index`, runs `write-tree` (writes tree objects into the repository object store), writes `snapshot.json`, `evidence-plan.json` and evidence spools. | Confirmed; memory preparation performs none of these. |
| Commit message file | `workflow commit` runs `git commit --cleanup=verbatim -S -F <canonical message file>` against the real index; hooks run. | Memory commit uses the same command with `-F -` (stdin), so hook and signing semantics are unchanged. |
| Line counts | `transactionWorkspace.js` 1,978 and `prepareWorkflow.js` 1,867 lines at inspection. | Historical counts in both reviews are not current measurements. |
| `InMemoryGitAdapter` | Not adopted (`DEC-GIT-01`). | Accepted as stated. |

## 3. Requirements and decisions

| ID | Requirement / decision | This change |
| --- | --- | --- |
| REQ-STATE-01 | Workflow state defaults to `memory`. | Implemented. |
| AC-STATE-01A | Memory-mode prepare/commit create no skill-owned files or directories, including in OS temp. | Implemented for `staged` and `full`; tested with an empty temp sentinel. |
| AC-STATE-01B | Memory preparation does not mutate the index, object store, refs or working tree. | Implemented; tested by snapshotting index bytes, object inventory, refs and status. |
| REQ-STATE-02 | Interruption needs no recovery artifact; re-preparation is the recovery. | Implemented for memory routes. |
| AC-STATE-02A | A stale proposal fails before mutation with a re-prepare diagnostic. | Implemented (`PROPOSAL_STALE`). |
| REQ-STATE-03 | Tasks may opt into `disk`. | Implemented as the existing transaction machinery behind `--state-storage disk`. |
| AC-STATE-03A | Disk without an explicit directory fails; no OS-temp fallback. | Implemented. |
| AC-STATE-03B/C | Disk artifacts are programmatically confined beneath the root; escapes are rejected. | Existing attempt-directory containment retained; the confining `DirectoryWorkflowStateStore` is deferred to `SLICE-DISK-STORE`. |
| REQ-API-01 | Workflows take structured inputs; CLI owns argv, output and exit status. | Implemented for all workflows. |
| REQ-ARCH-01 | No cycles; boundaries enforced. | Module cycles and workflow->CLI are unconditional rules. Remaining subsystem cycles are an explicit migration baseline with a removal criterion (section 6). |
| REQ-GIT-01 | Native Git replaces custom staging/object/reference machinery where semantics match. | Memory routes use `diff`, `ls-files`, `hash-object` without `-w`, `diff --no-index`, `add -A` and `commit -F -`. |
| REQ-GIT-02 | Real Git remains the behavioral authority in tests. | Implemented; every new behavioral test runs real Git. |
| REQ-DUR-01 | Durable recovery is available only for explicit disk mode. | Implemented by routing; isolation of the durable code is deferred. |
| REQ-UX-01 | Primary protocol is prepare, commit, optional publish. | Implemented for the memory route in `SKILL.md`; disk-only guidance moves to a reference. |
| REQ-CLEAN-01 | Delete obsolete machinery once no mode consumes it. | Deferred: every deleted-in-memory mechanism is still consumed by disk mode. |
| DEC-STATE-01..03, DEC-GIT-01..02, DEC-ARCH-01 | As in the report. | Accepted. |

## 4. Memory-mode contract

Public selection on `workflow prepare`:

```text
--state-storage memory                                   (default)
--state-storage disk --state-directory <absolute-path>
```

`--state-directory` with memory storage, a relative directory, or disk storage without a directory is `invalid-input`.
No repository configuration file is read; `AGENTS.md` prose remains instructions to the agent, never a runtime path source (`DEC-STATE-03`).
A typed repository configuration object is deferred until a consumer needs one.

Memory preparation supports `--mode actual|draft`, `--scope staged|full`, uniform `--evidence message|reuse` or an evidence plan without `review` groups whose single `message` group covers the whole scope, and the concise route.
Every other combination (paths scope, review evidence, partial message groups, an over-budget route that would escalate to packets, `--message-format detailed`, `--correction-from`) is rejected before any write with `STATE_STORAGE_REQUIRES_DISK`, whose recovery names the disk flags.

The large-scope transport rule (no path lists or argv chunking; every Git argv below 1 KiB) is preserved.
Tracked evidence is one scope-wide `git diff` without pathspecs, which is why a message group must cover the whole scope; per-group projections still need a temporary index.
Read-only Git cannot observe an untracked file without naming it, so `diff-no-index` carries exactly one path of at most 512 bytes per child.
Full scope is therefore limited to 128 untracked paths and rejects longer untracked paths, untracked embedded repositories, submodule changes and an untracked path replacing a path the index no longer tracks, with the same code.
Similarity rename detection needs index entries, so memory full scope pairs only exact-object renames and reports the deferred policy in the scope synopsis.

Preparation returns `proposal`, a self-contained `commit-proposal/v1` value (`ctg1.` plus base64url canonical JSON).
It records the repository root, mode, scope, head anchor, `changeSetSha256`, allowed types, verification policy and the evidence-plan digest.
`changeSetSha256` is a SHA-256 over the canonical final state of every changed path (`path bytes`, then `deleted` or `mode` + `object id`).
Staged scope reads it from `diff --cached --raw HEAD`; full scope from `diff HEAD --raw`, `ls-files --others --exclude-standard`, `diff --no-index` and `hash-object --stdin-paths` (which applies path attributes and filters and writes no object).
The proposal is caller-held data and not an authority: every later command recomputes the facts from the repository.

`message check --proposal <proposal>` reads the candidate message from standard input, validates it with the existing approved-message validator against a recomputed manifest, and returns `messageSha256` and `displayText` without writing.
`workflow commit --proposal <proposal>` takes either `--message <transport-safe-subject>` or `--message-stdin` (strict UTF-8, exactly the checked bytes), optionally bound by `--message-sha256`.
Commit then:

1. Recomputes the head anchor and change set; any difference is `PROPOSAL_STALE` before mutation.
2. Full scope only: runs `git add -A`, then requires the staged change set to equal the proposal; a difference stops with the index updated and no commit.
3. Runs `git commit --cleanup=verbatim -S -F -` with the message on standard input; hooks and signing behave as on the disk route.
4. Compares the created commit's parent, its `diff-tree` change set and its raw message bytes with the proposal, verifies the signature by policy, and returns the report in the result.

A draft proposal is never committed; the agent prepares again with `--mode actual`.
Checks, review packets, publication, `workflow resume`, `workflow recover` and `report-detail` remain transaction (disk) operations.

## 5. Slices

| Slice | This change | Proof |
| --- | --- | --- |
| SLICE-ARCH | Yes | `tests/committing-to-git/architecture-dependency-policy.test.mjs` runs `dependency-cruiser` over `src/committing-to-git`; injected fixtures for a cycle and a workflow->CLI import fail. |
| SLICE-BOUNDARY | Yes | All `cli/` imports leave `workflow/`; each workflow's argv parser and command runner moves to `cli/<name>Command.js`; existing CLI contract tests pass. |
| SLICE-MEMORY-PREPARE | Yes (`staged`, `full`) | Empty temp sentinel; unchanged index bytes, object inventory, refs and status. |
| SLICE-EPHEMERAL-PROPOSAL | Yes (`staged`, `full`) | Stale HEAD, index, worktree and message cases reject before mutation; re-preparation succeeds. |
| SLICE-NATIVE-COMMIT | Partial | Stdin message, native `add -A`; `commit-tree`/`update-ref` not adopted because hooks are part of the contract. |
| SLICE-DISK-STORE | No | `DirectoryWorkflowStateStore` with logical artifact identifiers. |
| SLICE-DURABLE-RECOVERY | No | Reduce the transaction engine to Git-interrogating recovery states. |
| SLICE-EVIDENCE | No | Stateless review cursors; bounded in-memory check capture; memory paths and checks. |
| SLICE-UX | Partial | `SKILL.md` leads with the memory route; behavioral evaluation not run. |
| SLICE-CLEANUP | No | Requires the three previous slices. |

Replanning triggers from the report remain in force.
Three were exercised: hooks require `git commit` rather than `commit-tree`; full scope needs one native observation per untracked file, hence the bound; and the existing argv transport rule excludes literal-pathspec batches, hence whole-scope message evidence.

New source stays inside the build's registered source categories (`workflow/`, `snapshot/`, `cli/`, `git/`), so `scripts/skillDistribution.js` is unchanged; the report's illustrative `state/` and `proposal/` directories were not created.
`tests/committing-to-git/commit-proposal.test.mjs` is the first differential check: the in-memory full-scope change set must equal what `git add -A` stages (CRLF normalization, Unicode names, exact renames, empty files, and on POSIX executable bits and symbolic links).

## 6. Architecture migration baseline

Unconditional rules: no module cycle in `src/committing-to-git`; no `workflow/` import of `cli/`; only `cli/` and `workflow/` import `workflow/` or `cli/`; `diagnostics/` imports no other subsystem.
The baseline rule lists the current subsystem-cycle edges (`message`->`transaction`, `snapshot`->`transaction`, `snapshot`->`message`, `checks`->`snapshot`, `transaction`->`message|checks|report`) as known violations.
The test fails when a new cross-subsystem edge closes a cycle or when a baseline edge disappears without being removed from the baseline.
The baseline is complete only when it is empty, after `SLICE-DISK-STORE` and `SLICE-DURABLE-RECOVERY`.

## 7. Verification and rollback

Focused tests during implementation; `npm run build` and `npm run verify` for the final candidate.
Linux CI already runs `tests/committing-to-git/**/*.test.mjs`, which includes the new architecture and memory-state tests.
Rollback before later slices is a code revert; selecting `--state-storage disk --state-directory <path>` restores the previous behavior per task without code changes.

## 8. Performance pass

Windows 11, Node 26.13.0, Git 2.56.0.windows.4; median of 3 separate CLI processes per arm (5 for the 128-path case), fresh disposable fixtures, HEAD `a6d9ab9` helper as baseline.
Peak helper RSS stayed at 62-75 MiB in every memory arm.
These are fixture estimates on one host, not guarantees.

| Scenario | HEAD prepare + commit | Memory, first candidate | Memory, final |
| --- | ---: | ---: | ---: |
| Staged, one file | 912 + 690 ms | 469 + 687 ms | 507 + 667 ms |
| Full, one modified and one untracked file | 1,116 + 681 ms | 658 + 846 ms | 568 + 741 ms |
| Full, 40 tracked and 20 untracked files | 1,099 + 654 ms | 2,058 + 1,619 ms | 785 + 1,037 ms |
| Full, 128 untracked files (the memory cap) | 1,306 + 711 ms | 9,609 + 5,423 ms | 2,080 + 2,379 ms |
| Full, one 64 MiB binary | 1,400 + 677 ms | 1,256 + 1,658 ms | 1,149 + 1,325 ms |
| Staged, 20 MB text diff | 5,740 ms (packets) | 564 ms rejection, 99 MiB | 535 ms rejection, 62 MiB |

The disk route matched HEAD in every scenario.
Fixes from the first candidate:

- Untracked paths are observed concurrently (8 at a time; 16 measured slower) and prepare takes each patch from the same `diff --no-index` process, halving its process count (`memory-state.test.mjs` pins one process per path).
- Patch capture reserves a lower bound per file (size plus path framing) and stops once the 32 KiB budget is exceeded; the tracked evidence diff is streamed and aborted at the budget instead of buffered whole.
- Message check and commit recompute the binding without line statistics, which neither the change set nor message validation reads.

Residual costs, accepted: memory full scope re-hashes changed content at each recheck (about +0.6 s for a 64 MiB binary), each untracked path still needs one Git process at prepare, check and commit (about 2.2 times the disk route at the 128-path cap), and a scope whose evidence exceeds the concise budget pays one fast memory rejection (about 0.5 s) before the disk route.
Lowering the untracked cap would trade seconds for asking the user for a state directory, so it stays at 128.
Windows rejects HEAD's transaction paths beneath a long root (more than 260 characters) unless `core.longpaths` is enabled; memory storage creates no such paths.
