# Handoff: make `committing-to-git` scale to thousands of change units

Date: 2026-08-28

## Purpose

Fix the remaining Windows command-line-length failures in the
`committing-to-git` workflow. The incident was not caused by an inherently
oversized Git commit or commit message. It was caused by helper internals that
expanded a manifest-sized collection of repository paths into child-process
arguments.

The intended proportional behavior is already specified in the
[proportional-workflow plan](../../plans/2026-08-23-committing-to-git-proportional-workflow.md):
large scopes retain an exact machine manifest, expose bounded evidence to the
agent, and use counted semantic domains when a file inventory is useful. The
fix should make the implementation satisfy that design without weakening any
scope, evidence, frozen-tree, or check-receipt invariant.

## Real incident

The failing repository snapshot contained 3,150 change units:

- 3,122 additions;
- 28 modifications;
- 3,112 individually retained, content-addressed evidence blobs; and
- 64,555,601 authenticated evidence bytes.

The completed snapshot became public commit
[`b5d047d0d2aec0902ed3c0e424dafefe1abea612`](https://github.com/Hadden-Industries/owlapi/commit/b5d047d0d2aec0902ed3c0e424dafefe1abea612).
That commit is a useful immutable fixture description, but do not depend on
network access to test the helper.

The workflow was asked to commit one coherent Phase 19C scope. A literal scope
file reduced the user-facing selection to a few exact paths plus one directory
prefix. That correctly avoided thousands of `--path` flags at the public CLI
boundary, but the helper later expanded the selected paths again internally.

Observed failures included:

```text
PREPARATION_FAILED: spawn ENAMETOOLONG
```

and, after a transaction and canonical structured-bulk message had been
created:

```text
spawnSync git ENAMETOOLONG
```

The first error occurred while the helper prepared or materialized evidence
for the large selected snapshot. It occurred both after using compact scope
input and after trying a staged-snapshot route, so it was not a defect in the
caller's command construction.

The second error occurred in the check-receipt route while the helper compared
the selected worktree with the prepared 3,150-path tree before and after a
check. The repository checks themselves ran successfully when invoked
directly, but the helper could not witness them. The final signed commit
therefore had to record verification as skipped even though the complete test
set had just passed. This is a material loss of assurance caused solely by the
transport implementation.

Structured bulk message rendering itself worked once a transaction existed:
five exhaustive, non-overlapping domains accounted for all 3,150 units without
a 3,150-entry commit body. Preserve that behavior.

## Current implementation evidence

Start with these files:

- [`src/committing-to-git/workflow/prepareWorkflow.js`](../../../src/committing-to-git/workflow/prepareWorkflow.js)
  - `patchArguments()` appends every selected destination path after `--`.
  - `spoolEvidenceGroup()` passes that array to `streamGit("diff-paths", ...)`.
  - A message or review evidence group covering thousands of units can
    therefore exceed the platform's process argument limit before the
    proportional packet machinery can help.
- [`src/committing-to-git/git/gitRepository.js`](../../../src/committing-to-git/git/gitRepository.js)
  - `selectedWorktreeMatchesPreparedTree()` derives every source and
    destination path, appends `...uniquePaths` to a `git diff` invocation, and
    calls the synchronous process boundary.
  - [`src/committing-to-git/workflow/runCheckWorkflow.js`](../../../src/committing-to-git/workflow/runCheckWorkflow.js)
    invokes that comparison before and after each witnessed check.
  - The same Git module already implements the scalable pattern for
    `add-paths`: `git add --pathspec-from-file=- --pathspec-file-nul` with a
    NUL-delimited stdin payload. That protects index staging, but not the two
    read/evidence paths above.
- [`skills/committing-to-git/references/message-format.md`](../../../skills/committing-to-git/references/message-format.md)
  defines the correct counted-domain behavior at 50 or more units or above the
  detailed-message byte budget.

Search every child-process boundary before declaring the defect fixed. The
required invariant is broader than replacing these two currently known call
sites.

## Root cause

Compact selection and compact presentation were implemented, but scalable
process transport was not applied end to end.

The helper correctly treats a path-prefix selector as a compact description
and stores the expanded scope in an exact manifest. Later phases then convert
that manifest back into an argument per path. Windows imposes a much smaller
process command-line limit than the total bytes a valid Git tree or manifest
may contain. File count alone is also an insufficient guard because path
lengths vary.

The result violates an intended architectural property: workflow cost and
process-argument size should be bounded independently of the number of change
units, except for explicitly streamed or persisted machine data.

## Required design properties

1. No helper-owned child process may receive an argument vector whose size is
   proportional to the number or total byte length of selected paths.
2. Exact scope must remain manifest-bound. Do not truncate paths, reduce the
   commit scope, infer globs, or split one coherent change merely to fit a
   platform limit.
3. Preserve arbitrary valid Git path bytes. Any path transport must be
   NUL-delimited or otherwise unambiguous; newline-delimited transport is not
   sufficient.
4. Use stdin/pathspec-file support wherever the particular Git command
   supports it.
5. Where Git does not support `--pathspec-from-file`, change the algorithm
   rather than recreating a large argv. Suitable designs include:
   - diffing frozen object identities or prepared temporary indices without a
     path list, then filtering or partitioning the NUL-delimited result inside
     the helper;
   - streaming one complete prepared-tree patch and deterministically
     assigning its file records to evidence groups; or
   - constructing bounded temporary group indices/trees through Git plumbing
     that itself consumes records through stdin.
6. Do not treat naive argv chunking as the default fix. Chunking can introduce
   time-of-check gaps, repeated Git startup cost, partial-result semantics, and
   path-count heuristics that still fail for unusually long names. If batching
   is retained anywhere, it must be byte-budgeted, snapshot-bound,
   interruption-safe, and covered by an aggregate completeness proof.
7. A witnessed check must compare only the selected frozen scope while
   tolerating unrelated user-owned workspace changes outside that scope. Any
   replacement for `selectedWorktreeMatchesPreparedTree()` must preserve this
   boundary before and after the child check.
8. A deleted selected path that is recreated, a newly added selected path that
   disappears, renames, symlinks, gitlinks, mode changes, non-UTF-8 names, and
   unrelated untracked files must retain their existing semantics.
9. Do not use the structured-bulk threshold as a transport threshold. Message
   presentation, evidence depth, and process transport are independent.
10. Failures must remain safe: no partial index installation, no lost staged
    work, no ambiguous commit state, and no false check receipt.

## Recommended implementation sequence

1. Add a process-boundary test double that records or rejects the complete
   encoded argv byte length. Set a deliberately small test limit so the
   regression is deterministic on Linux, macOS, and Windows rather than being
   observable only on a Windows host.
2. Reproduce both failures with a generated repository containing thousands
   of paths, including a meaningful subset of long paths.
3. Inventory every helper call that spreads manifest-derived paths into
   `spawn`, `spawnSync`, `execFile`, or an equivalent launcher.
4. Replace the evidence-patch path list with an object/index/stream-based
   operation.
5. Replace the before/after selected-worktree comparison with a bounded
   operation that keeps unrelated paths outside the check subject.
6. Run the complete transaction through preparation, semantic extension,
   canonical bulk finalization, witnessed check, commit, verification, report,
   and publication to a local bare remote.
7. Rebuild the installed skill artifact and run the deterministic
   cross-platform test suite.

## Regression and acceptance criteria

The fix is complete only when an automated end-to-end case proves all of the
following:

- A repository with at least 3,150 selected change units can be prepared on
  every supported operating system.
- The test includes enough aggregate path bytes to exceed a deliberately low
  injected argv budget; it must not merely rely on the host's natural limit.
- Both `--scope-file` with a path prefix and an intentionally staged scope are
  covered.
- A message/review evidence group spanning the large scope is handled without
  an O(paths) child-process argument vector.
- The canonical message uses exhaustive counted domains and does not require
  thousands of authored IDs or a per-file human recital.
- `workflow check` obtains valid before-and-after receipts for the frozen
  selected tree.
- A mutation to one selected path during a check invalidates the receipt.
- A mutation to an unrelated path does not invalidate a scope-limited receipt
  or become part of the commit.
- The signed commit contains the exact approved tree and message.
- `workflow verify` succeeds and the report truthfully includes witnessed
  check evidence; verification does not have to be downgraded or skipped.
- Publication to a local bare remote succeeds without another O(paths)
  argument vector.
- No `ENAMETOOLONG` workaround appears in user guidance because the supported
  workflow itself is scalable.

Also add focused edge cases for one extremely long valid path, non-UTF-8 path
bytes where the harness supports them, deletions, renames, and 10,000 tiny
files. Assertions should be based on byte budgets and semantic outcomes, not a
Windows-only magic file-count threshold.

## Out of scope

- Do not archive or hide the evidence corpus to make the test smaller.
- Do not weaken exact manifest coverage or check-receipt integrity.
- Do not force a concise subject-only message when the user requested a useful
  structured inventory.
- Do not add a documented manual-Git bypass as the normal solution.
- Do not redesign the public commit itself; it is evidence of the failure, not
  a fixture that needs to be recreated byte for byte.

## Suggested skills

Call these skills for the implementation session:

- `diagnosing-bugs` to reproduce and inventory every O(paths) process
  boundary before selecting a remedy.
- `test-driven-development` to establish the low-argv-budget regression before
  changing transport code.
- `verification-before-completion` before claiming the large-scope workflow is
  fixed across preparation, checks, commit, verification, and publication.
- `committing-to-git` only after the fix has passed; exercise the newly built
  local skill rather than an older installed copy.

## Completion handoff

Report:

- the old and new process-boundary algorithms;
- every O(paths) call site found and its disposition;
- the injected argv byte budget used in tests;
- cross-platform test results;
- the end-to-end change-unit count and aggregate path-byte count;
- proof that check receipts are attached rather than skipped; and
- any remaining path-count- or path-byte-dependent operation, with explicit
  justification.

## Resolution

Resolved on 2026-08-28 by the implementation described in the
[large-scope transport plan](../../plans/2026-08-28-committing-to-git-large-scope-transport.md).

### Process-boundary inventory

The complete child-process audit found two manifest-sized argument vectors.
Both have been removed:

| Boundary | Former algorithm | Replacement |
| --- | --- | --- |
| Evidence acquisition | `patchArguments()` appended every eligible destination to `git diff -- ...paths`. | One helper-owned alternate index starts from the parent tree, applies the evidence group's destination entries through `git update-index --replace -z --index-info` on stdin, and runs one fixed-argv `git diff --cached` with no path arguments. `--replace` safely resolves file/directory conflicts; `--diff-filter=d` preserves the established no-deletion-body policy. |
| Check witnessing | `selectedWorktreeMatchesPreparedTree()` appended every source and destination to synchronous `git diff -- ...uniquePaths` before and after a check. | A selected-only alternate index receives prepared destination entries through NUL-delimited stdin, refreshes worktree stat data with fixed arguments, and streams verbatim NUL-delimited names from `git diff-files --name-only -z`. Exact raw-byte `lstat` calls separately witness deletions and rename sources, including ignored recreations. |

The path-bearing `diff-paths` Git operation was removed from the closed
read-only operation allowlist. Existing scope staging remains scalable through
`git add --pathspec-from-file=- --pathspec-file-nul`. Other process-boundary
collections are either fixed-size metadata (for example, operation marker
names) or use stdin (for example, `cat-file --batch-check` object IDs); none
places selected repository paths in child argv.

### Preserved semantics

- Evidence remains bound to the frozen snapshot and the exact evidence-group
  partition. Additions, modifications, rename destinations, mode changes, and
  symlink changes retain patch semantics. Full-file deletions remain
  metadata/on-demand evidence, while known binary files and gitlinks remain
  outside text patch spools.
- The workspace witness considers only selected prepared destinations plus
  selected identities expected to be absent. Unrelated tracked and untracked
  changes neither invalidate the receipt nor enter the prepared commit.
- Raw path identities remain base64 in manifests, bytes in memory, and
  NUL-delimited at Git stream boundaries. Tests cover option-like names, long
  paths, cross-chunk NUL parsing, and platform-conditional non-UTF-8 names.
- Temporary indexes use UUID-suffixed exact paths below the transaction
  directory. Success and failure cleanup remove only the projected index and
  its exact lock path.

### Deterministic regression evidence

- The injected process budget is 1,024 encoded executable-and-argv bytes.
  A synthetic 10,000-entry projected index transfers more than 1 MiB of raw
  index-info records through stdin while every observed child argv remains
  within that budget.
- Public preparation is covered independently for an intentional 3,150-unit
  staged scope and for a schema-version-2 scope file containing one
  `generated/` path prefix.
- The complete path-prefix transaction contains 3,150 change units and
  217,350 selected path bytes. It traverses 253 bounded evidence packets,
  renders one exhaustive counted domain, records passing receipt `C000001`,
  creates the exact signed tree and canonical message, verifies the signature,
  and publishes the exact OID to a local bare remote.
- Git Trace2 observed a maximum Git argv size of 256 encoded bytes throughout
  that transaction, and no generated destination appeared in child argv.
- Focused checks prove that selected drift fails, unrelated drift passes,
  prepared additions disappearing fail, deletion and rename-source
  recreations fail, and gitlink drift fails. POSIX-only tests cover executable
  modes, symbolic links, and non-UTF-8 path bytes.
- The D/F parity fixture covers directory-to-file and file-to-directory
  replacement alongside additions, modifications, renames, deletions, and
  binary exclusions.
- On the implementation host, `npm run verify` completed with 761 tests:
  756 passed, five intentionally platform-specific cases were skipped, and
  none failed. The same gate also passed bundle parity, formatting, ESLint,
  canonical-skill validation, Tessl lint, and `git diff --check HEAD`.

No provider-backed model evaluation is required for this transport defect.
Repository build and deterministic verification remain the completion gates.

### Remaining proportional work

Some work must scale with the selected subject because exactness requires
processing that subject: manifest storage and selection use O(paths) in-process
maps, index construction writes O(selected-present-paths) bytes to stdin,
absence witnessing performs one exact `lstat` per selected path expected to be
absent, and evidence/packet bytes scale with the requested evidence. These are
bounded-memory or explicit machine-data operations rather than process-argv or
human-presentation growth. No user-facing scope reduction, batching heuristic,
or `ENAMETOOLONG` workaround remains.
