# Implementation Plan: Redesign the `committing-to-git` Workflow

## Plan metadata

- **Status:** Implemented
- **Plan date:** 2026-08-21
- **Target:** `skills/committing-to-git/`, `src/committing-to-git/`, and the repository-level skill build system
- **Canonical source:** The tracked skill under `skills/`, never the installed
  copies under `.agents/skills/` or `.claude/skills/`
- **Filename convention:** Future plans should use
  `docs/implementation-plans/YYYY-MM-DD-topic.md` so that plans remain
  chronologically sortable and distinguishable as the directory grows
- **Decision state:** The product-level questions raised during design are
  resolved. Implementation discoveries may refine internal module boundaries,
  but must not silently change the approved behavior in this plan.

## Behavioral amendment: similarity is not copy provenance

On 2026-08-22, an observed workflow run showed that Git's similarity-based copy detection could label a newly added file as `source -> destination (copied)` merely because an unchanged source file had similar content. That mechanical classification overstated what the staged tree proves, obscured the destination's full added-file patch during inspection, and forced an agent toward a noncanonical hand edit when the user supplied the actual lineage.

This amendment supersedes every later provision in this historical plan that enables copy detection, defines `copied` as a current snapshot kind, renders a copy arrow or label, or reports a copy count. The implemented policy is:

- authoritative snapshot, inspection, and report commands do not enable Git copy detection;
- a new destination whose possible source remains in the tree is an `added` change unit, even when their contents are similar or identical;
- the added destination is inspected as a complete new-file patch and rendered by destination path only;
- known lineage such as "adapted from the KRSS parser" belongs in semantic rationale only when it is grounded in the diff, repository evidence, or user-provided context;
- rename detection remains a navigation aid for a deleted source plus an added destination, but it does not prove that `git mv` or any other particular command was used; and
- legacy manifests containing `kind: copied` may be rerendered destination-only for a message-only revision, without restaging or repeating an already completed inspection.

The snapshot schema is version 2, records `copyDetection: false`, and no longer exposes `copyScore` or accepts `copied`. Regression tests cover snapshot classification even when repository configuration requests copy detection, complete inspection, rendering, report counts, schema rejection, and the legacy message-only compatibility path.

## Behavioral amendment: deletion-aware inspection

On 2026-08-23, an observed 59-change-unit workflow showed that 34 whole-file deletions generated most of 76 mandatory text chunks merely to reproduce 13,474 historical lines with `-` prefixes. This imposed substantial reading cost even though the user and migration evidence already established a grounded reason for retiring the legacy files.

This amendment supersedes every later provision in this historical plan that requires the initial inspection patch to contain every historical body of every whole-file deletion. The implemented policy is:

- every normalized deletion remains mandatory in the exhaustive inventory, with its path, status, full old object ID, old mode, and available line statistics;
- the initial required patch excludes only a tree change whose new mode is absent (`D`), while a retained file modified to empty remains ordinary required patch content;
- an agent must not materialize deleted bodies mechanically, by file count, or merely to observe repeated removed-line markers;
- when rationale, effect, risk, or an explicit audit depends on historical content, `inspection expand-deletion` reads the exact full old blob recorded in the manifest with replacement objects and lazy fetching disabled;
- expansion appends bounded, hash-addressed `deleted-content` units to the same ledger and makes rendering incomplete until every appended unit is read and acknowledged;
- filenames alone never establish why a consequential deletion is safe, so unresolved meaning is escalated to the user; and
- binary objects and gitlinks remain separate evidence classes rather than being coerced into text expansion.

Inspection ledger schema version 2 records the required-patch hash and size, summarized deletion and text-line counts, and each exact-blob expansion. Regression tests cover mixed retained changes and deletions, exact reconstruction, duplicate and invalid expansion, modified-to-empty files, binary objects, and deleted gitlinks. Behavioral cases 32-33 exercise both failure directions: unnecessary bulk expansion and unsupported filename inference.

## Implementation architecture amendment

The workflow behavior below remains authoritative, but the initially proposed physical layout of five executables, seven `scripts/lib/` modules, and six published schemas was superseded during implementation. Shipping eighteen implementation files inside one skill would expose authoring structure to skill users and make the executable surface harder to understand.

The approved implementation therefore uses repository-level authoring infrastructure:

- root `package.json` declares a compatible `esbuild` development range while `package-lock.json` records the reproducible installed graph;
- `scripts/buildSkillBundles.js` is the shared repository ASCII validator, bundler, and drift checker;
- maintainable source lives under semantic domains in `src/committing-to-git/`;
- schemas live under `src/committing-to-git/schema/` as authoring-time contracts; and
- the published skill ships one readable, non-minified `skills/committing-to-git/scripts/commitWorkflow.mjs` bundle with no installation step or third-party runtime dependency.

The single CLI exposes `snapshot`, `inspection`, `message`, `signature`, and `report` command groups. All later references in this plan to the original executable and `scripts/lib/` filenames describe their behavioral responsibilities, not the final published paths.

## Executive summary

Replace the current punitive, after-the-fact commit-message workflow with a
guided staged-snapshot workflow.

For an actual commit, the index must contain the exact intended snapshot
*before* the message is generated. A repository-provided script will derive a
canonical change manifest from that index, prepare a structured worksheet, and
render the final message. The agent supplies the semantic information Git
cannot infer—principally why the change exists, which constraint it preserves,
and which outcome it enables—while the script owns paths, ordering, numbering,
indentation, wrapping, counts, and section structure.

For a draft-only request, the workflow must not mutate the real index. It will
read the real index when the user explicitly wants a draft for its current
staged contents; otherwise it will construct the intended snapshot in a
temporary index outside the worktree. A draft must be regenerated from the real
staged snapshot before a later commit is created.

The redesign also adds:

- complete, chunked inspection for arbitrarily large diffs;
- rename-safe staging and reporting;
- detailed and bulk `File Changes:` modes, with bulk mode starting at 50 file
  change units;
- deterministic handling of additions, modifications, deletions, renames,
  copies, binary files, symlinks, mode changes, and submodules;
- user-controlled signature-verification policy with an explicit recovery path
  when an SSH allowed-signers file cannot be read; and
- a fact-based, non-redundant post-commit report.

The core invariant is:

> One immutable snapshot manifest must drive inspection, message generation,
> validation, commit-tree comparison, signature reporting, and the
> post-commit summary.

## Approved product decisions

### Commit-message generation

1. **Actual commits are staged first.** The exact intended index is the source
   of truth for both the message and the eventual commit.
2. **Draft-only work does not mutate the real index.** It uses either the
   explicitly selected staged index or an isolated temporary index.
3. **The script builds the message structure.** The agent does not hand-format
   file paths, ordinals, indentation, section spacing, domain counts, or line
   wrapping.
4. **The agent supplies semantic rationale.** The content should emphasize
   information a reader cannot recover mechanically from the diff.
5. **A draft is not an approval artifact for a future commit.** Before creating
   a commit, regenerate and reapprove the message against the actual index.

### File inventory presentation

1. Keep the heading exactly `File Changes:`. Do not append the total count to
   the heading.
2. Retain numbered entries as a local usability convention. Numbering helps the
   user see approximate scope and keep their place among similar paths.
3. Do not claim that numbering is a Git-wide best practice. Git's commit-message
   format and Conventional Commits do not prescribe a file inventory at all,
   while Git's own summary formats generally present unnumbered paths. Numbering
   here is a deliberate interface choice for this skill, not a statement about
   universal Git convention.
4. Right-align ordinals to the width of the largest ordinal. In a monospaced
   commit message this aligns decimal positions and keeps every entry body in
   one column.
5. Use zero fixed base indentation. Add only the leading spaces required to
   right-align shorter ordinals.
6. Calculate child and continuation indentation from the ordinal width rather
   than hard-coding spacing for one-digit entries.
7. Use detailed mode for 1–49 file change units.
8. Switch automatically to bulk-domain mode at 50 file change units.
9. Never suggest reducing, splitting, or reconsidering an already approved
   commit scope merely because detailed mode would be long.
10. Do not narrate hundreds or thousands of individual files in the commit
    message. Bulk mode must preserve exact coverage in machine-readable
    artifacts while presenting concise semantic domains to the reader.
11. Call the bulk groupings **domains**, not “logical areas.”
12. Show a generated count in every domain label, for example
    `1. Parser and ingestion (24 files)`.

The 50-file threshold is intentionally a policy value rather than a claim that
25 or 50 is a universal cognitive limit. It preserves detailed wayfinding for
medium-sized commits while preventing pathological messages at larger sizes.
The threshold must be covered by boundary tests and kept as one named constant
so it can be changed deliberately after real usage evidence.

### Signature verification

1. Signed commit creation remains the normal actual-commit path.
2. Trusted verification is **required by default**, but it is a workflow policy,
   not an unoverrideable demand.
3. The user may change verification to `advisory` or `skipped` at any point,
   including after a required verification attempt fails or cannot access its
   trust store. The skill must accept the override without arguing or
   repeatedly insisting.
4. Draft-only requests do not run commit-signature verification because no
   commit exists.
5. Verification policy and push authorization are independent. A push still
   requires separate explicit authorization.
6. A verification failure never authorizes an automatic amend, reset, deletion,
   or replacement of the commit.

### Post-commit reporting

The normal report will be concise, factual, and generated from Git's
machine-readable output. It will report the resulting commit, snapshot match,
change counts, signature disposition, checks actually run, publication status,
and remaining workspace state. It will not repeat the full `File Changes:`
section or add a vague “Includes…” paragraph that merely retells the diff.

## Problems in the current workflow

The current `SKILL.md` and validator have several coupled failure modes:

1. `git diff HEAD` is required as one monolithic inspection command. Large
   output can be truncated by the execution environment, leaving the agent
   unable to prove that every hunk was reviewed.
2. Scope is inferred from either the live working tree or live index. The
   message can therefore be approved before the index contains the exact
   snapshot that will be committed.
3. Actual execution stages again after message approval. That creates a second
   opportunity for scope drift.
4. `git diff --cached --name-only` erases rename source paths and other change
   semantics.
5. Hand-authored `File Changes:` entries invite avoidable mistakes in binary
   sorting, numbering, indentation, wrapping, path coverage, and special path
   quoting.
6. The hard-coded two-space prefix behaves inconsistently once ordinals become
   wider.
7. A per-file narrative does not scale to hundreds or thousands of files.
8. The current instructions reward descriptions of mechanical edits, even
   though the diff already records those edits, and do not sufficiently elicit
   the reason for the change.
9. The validator mixes structural validation with a fresh query of mutable
   repository state, so it can validate against a different snapshot from the
   one the user reviewed.
10. Unconditional `git verify-commit HEAD` can fail in a sandbox that recognizes
    the signature but cannot read the configured SSH allowed-signers file. The
    agent is then forced to invent a recovery path.
11. Post-commit summaries are assembled conversationally and can contain
    unverified claims, duplicated detail, or ambiguous statements about
    signature trust, tests, push state, and excluded files.
12. Renames expose a hidden staging bug. After Git has staged a rename, the old
    path no longer exists in the worktree or index. Blindly restaging both
    display paths can produce:

    `fatal: pathspec '<old-path>' did not match any files`

    The displayed source and destination of a rename are not the same thing as
    the paths that still need staging.

## Goals

- Make the commit tree, rather than mutable conversational state, the authority
  for message scope.
- Guide the agent toward a valid message instead of repeatedly rejecting
  manually formatted output.
- Make complete review possible even when the aggregate patch exceeds terminal
  or tool output limits.
- Preserve partial commits and all unrelated user-owned changes.
- Make rename staging safe and idempotent.
- Give every mechanical formatter rule one implementation.
- Keep the commit message useful at 1, 10, 50, 100, 1,000, and more changed
  files.
- Put purpose, constraint, consequence, and prevention ahead of diff
  paraphrase.
- Distinguish trusted signature verification from untrusted integrity checks.
- Give the user a predictable report containing facts relevant to what happened
  and what remains.
- Preserve the current authorization boundaries for committing and pushing.

## Non-goals

- Do not encourage a smaller commit solely because the inventory is large.
- Do not choose the user's commit scope on their behalf when staged and
  unstaged intent is ambiguous.
- Do not auto-stage every change for a partial commit.
- Do not auto-unstage pre-existing work to manufacture a requested subset.
- Do not replace Git's rename heuristic with a claim that rename identity is
  intrinsic repository data.
- Do not inspect the contents inside a submodule as if they were files in the
  superproject commit.
- Do not attempt to prove semantic truth or imperative mood through a brittle
  keyword blacklist.
- Do not infer that an excluded file is “user-owned” unless that provenance was
  explicitly established. Report it neutrally as excluded or remaining.
- Do not push without explicit push authorization.
- Do not edit repository, build, test, signing, or other configuration as part
  of this implementation.

## Terminology and invariants

### Terms

- **Candidate change:** A staged, unstaged, untracked, deleted, conflicted, or
  special Git status record discovered during preflight.
- **Stageable path:** A path that currently needs to be passed to Git to place
  intended content or deletion state in the index. This is distinct from a
  rename's display paths.
- **Change unit:** One semantic file-level record in the normalized manifest.
  An add, modify, delete, mode change, symlink change, submodule gitlink change,
  or rename is one unit. A detected rename has two path endpoints but counts as
  one changed file.
- **Snapshot:** The complete index tree that an actual commit would record,
  identified by its tree object ID.
- **Snapshot manifest:** The versioned, machine-readable description of the
  snapshot and every normalized change unit relative to its parent.
- **Detailed mode:** One numbered entry per change unit, used for 1–49 units.
- **Bulk mode:** One numbered entry per semantic domain, used for 50 or more
  units.
- **Domain:** A semantic grouping of change units that jointly serve a purpose,
  subsystem, verification concern, migration, or documentation outcome.
- **Trusted verification:** Verification that proves signature integrity and
  evaluates the signer against the configured trust mechanism.
- **Integrity-only check:** A cryptographic consistency diagnostic that does not
  establish that the signer is an authorized identity.

### Required invariants

1. Every actual message is rendered from the exact index tree intended for the
   commit.
2. Every validator invocation used for approval consumes the immutable
   manifest, not a newly inferred live scope.
3. Every change unit appears exactly once in detailed mode or belongs to
   exactly one domain in bulk mode.
4. Domain counts sum exactly to the manifest change-unit count.
5. A detected rename counts once and displays both endpoints.
6. No post-approval staging command runs in the normal path.
7. The index tree immediately before `git commit` equals the approved tree ID.
8. The created commit tree and message are compared with the approved tree and
   message after the commit.
9. Every inspected text-patch byte belongs to a recorded chunk, and every chunk
   is acknowledged before the message can be finalized.
10. Signature status language never implies trusted identity when only an
    integrity-only check succeeded.

## Workflow state machine

Implement the workflow as explicit states. Each state transition must produce a
machine-readable artifact or a Git object ID that the next state verifies.

### Common preflight

1. Resolve the repository root.
2. Record:

   - current `HEAD` object ID, or an explicit unborn-branch state;
   - current branch or detached-HEAD state;
   - current index tree ID;
   - porcelain-v2 status with NUL delimiters;
   - any merge, rebase, cherry-pick, or revert state; and
   - unresolved conflicts.

3. Reject unresolved conflicts. A conflict is not a normal file change and
   cannot be represented as a commit-ready snapshot.
4. If a repository operation is active, identify it explicitly. Do not treat a
   merge or continuation commit as an ordinary one-parent commit without the
   user's intent.
5. Determine whether the request is:

   - a draft for the current staged snapshot;
   - a draft for all current changes;
   - a draft for an explicit subset;
   - an actual commit of the current staged snapshot;
   - an actual full commit; or
   - an actual explicit-path subset.

6. If the index already contains changes and the user's scope could mean either
   the staged subset or a wider set, ask before mutating the index.
7. If an explicit subset conflicts with unrelated pre-existing staged changes,
   stop rather than silently include or unstage them. Continue only when the
   intended treatment of the existing index is explicit.

### Draft-only path

1. Do not modify the real index.
2. When the user explicitly wants a draft for the current staged contents, read
   the real index as a snapshot without staging.
3. Otherwise create a temporary index in the conversation scratch area:

   - initialize it from `HEAD` with `git read-tree HEAD`;
   - use `git read-tree --empty` for an unborn branch;
   - stage the intended full or partial snapshot into that temporary index; and
   - set `GIT_INDEX_FILE` only for child Git processes launched by the helper.

4. Build the manifest, inspect every change, scaffold the semantic worksheet,
   render, and validate the draft from that index.
5. Present the exact rendered commit message as a draft. The label belongs in
   the conversational response, not inside the message.
6. Do not sign, verify, commit, or push.
7. State that a future actual commit requires regeneration from the real staged
   snapshot.
8. Clean up temporary index and patch artifacts at the end of the task when the
   environment's artifact policy permits it. Cleanup must never target the
   repository or its real index.

### Actual-commit path

1. Confirm that creating a commit is explicitly authorized. Push authorization
   remains separate.
2. Capture a pre-stage candidate inventory.
3. Stage exactly the intended scope:

   - use the existing index unchanged when its deliberately staged contents are
     the complete intended scope;
   - use a full `git add -A` operation only for an explicitly full commit;
   - use the NUL-safe partial staging mechanism described below for an explicit
     set of whole paths; and
   - preserve an existing partially staged file by treating the index version
     as authoritative rather than restaging the whole file.

4. Immediately write and record the index tree ID.
5. Generate the snapshot manifest from that index.
6. Run complete chunked inspection.
7. Generate the content worksheet.
8. Have the agent fill only semantic fields: subject, optional overall
   rationale, user-visible outcomes, per-change rationale, or domain rationale.
9. Render the canonical message and validate it against the snapshot manifest.
10. Present only the exact validated message plus a concise approval prompt.
11. If the user requests edits, revise semantic inputs, rerender, and revalidate.
12. After approval, compare the current index tree ID with the approved tree ID.

    - If equal, continue.
    - If different, do not patch the old message. Rebuild the manifest, repeat
      affected inspection, rerender, revalidate, and request approval again.

13. Create the signed commit with the approved message using:

    `git commit --cleanup=verbatim -S -F <commit-message.txt>`

    Do not pass path arguments, bypass hooks, or restage at this point. The
    complete approved index is the input. Resolve and record the resulting
    commit OID immediately rather than depending on a human-formatted command
    summary.
14. Compare the created commit with the approved artifacts:

    - the new commit's first parent must equal the recorded pre-commit `HEAD`
      for an ordinary commit;
    - the new commit tree must equal the approved index tree;
    - the stored message must equal the approved message after one documented
      trailing-newline normalization; and
    - any hook-caused mutation must be reported as a mismatch.

15. Apply the selected signature-verification policy.
16. Push only if separately authorized and the active policy permits proceeding.
17. Generate the post-commit report from recorded facts.

### Failure behavior

- A pre-commit failure leaves the index and working tree intact and creates no
  commit.
- A commit-command failure stops verification and push.
- A post-commit tree or message mismatch leaves the created commit intact,
  reports the anomaly, and prevents an automatic push. Do not amend without
  new, explicit authorization.
- A signature failure leaves the created commit intact and follows the active
  policy. It never triggers an automatic history rewrite.
- A push failure leaves the local commit intact and reports the remote result.

## Scratch artifact layout

All generated workflow artifacts must live outside the repository working tree.
Use stable filenames so an agent can resume without guessing:

```text
<conversation-scratch>/commit-workflow/
  preflight.json
  scope-intent.json
  temporary-index
  snapshot.json
  inventory.md
  inspection/
    ledger.json
    chunks/
      C000001.patch
      C000002.patch
  content.json
  commit-message.txt
  validation.json
  checks.json
  verification.json
  post-commit-report.json
```

Chunk filenames must use generated IDs rather than repository paths, avoiding
filesystem portability and hostile-path problems. Every artifact containing a
repository path must retain a raw, reversible representation.

## Script architecture

Prefer a small number of explicit public entry points backed by shared modules.
The state-mutating command must remain separate from read-only generation so
the skill makes staging visible.

### Public scripts

#### `scripts/stage-commit-scope.mjs`

Responsibilities:

- parse `scope-intent.json`;
- reject conflicts and ambiguous pre-existing staging;
- stage full, staged-only, or explicit whole-path scope;
- preserve existing partial-hunk staging;
- handle rename source/destination state safely;
- feed partial paths to Git over stdin with NUL delimiters;
- record before/after status and index tree IDs; and
- emit `snapshot.json` after staging.

The script must never unstage a path unless a future feature is separately
designed and explicitly authorized.

#### `scripts/inspect-commit-scope.mjs`

Responsibilities:

- derive the per-file size inventory before rendering a patch;
- capture complete staged patch material without external diff drivers or
  textconv filters;
- split the patch into bounded chunks;
- represent binary and submodule changes with inspectable metadata units;
- maintain the review ledger; and
- refuse a “complete” result while any chunk or metadata unit is unacknowledged
  or has changed hash.

#### `scripts/prepare-commit-message.mjs`

Subcommands:

- `scaffold` creates `content.json` from `snapshot.json`;
- `render` validates semantic inputs and writes the canonical
  `commit-message.txt`; and
- `check-canonical` rerenders and byte-compares an existing message.

The script may support stdout for general composability, but the skill should
invoke an explicit `--output` path. This avoids shell pipelines, terminal
truncation, and accidental repository files.

#### `scripts/validate-commit-message.mjs`

Evolve the existing validator to:

- accept `--manifest <snapshot.json>` as the canonical scope;
- validate the rendered message and structured semantic input;
- support detailed and bulk grammars;
- compare a canonical rerender with the supplied message;
- retain its `0`/`1`/`2` exit-code contract; and
- emit schema-versioned JSON.

Retain `--scope auto|staged|worktree` temporarily as a legacy compatibility
path, with an explicit warning in the JSON result. The rewritten skill must
never use the legacy live-scope path.

#### `scripts/report-commit-result.mjs`

Responsibilities:

- compare actual parent, tree, and message with approved artifacts;
- run or ingest the selected signature-verification result;
- calculate normalized change statistics;
- ingest checks that were actually run;
- record push result when applicable;
- inspect the remaining workspace with porcelain v2; and
- render both `post-commit-report.json` and the user-facing report.

### Shared internal modules

Create focused modules under `scripts/lib/`:

- `git.mjs`: `execFile` wrappers, environment isolation, byte-preserving stdout,
  and structured Git errors;
- `paths.mjs`: NUL parsing, raw-byte storage, binary comparison, and reversible
  display quoting;
- `snapshot.mjs`: index-tree fingerprinting, diff record normalization, rename
  and copy policy, and count calculation;
- `inspection.mjs`: size inventory, chunking, hashing, and ledger operations;
- `message-format.mjs`: canonical layout, ordinal indentation, wrapping, and
  path/domain rendering;
- `message-content.mjs`: content-schema validation and exhaustive domain
  assignment;
- `signature.mjs`: verification-policy state machine and trusted versus
  integrity-only results; and
- `report.mjs`: post-commit fact model and text rendering.

Internal boundaries may be collapsed if tests demonstrate that fewer modules
are clearer. The public CLI contracts, output schemas, and behavioral
invariants must remain stable.

### Versioned schemas

Add:

- `scripts/commit-snapshot.schema.json`;
- `scripts/commit-message-content.schema.json`;
- `scripts/inspection-ledger.schema.json`;
- `scripts/signature-verification.schema.json`; and
- `scripts/post-commit-report.schema.json`.

Update `scripts/commit-message-validation.schema.json` to schema version 2.
Continue the existing test that proves every emitted issue code is declared in
the schema.

Runtime workflow logic uses Node.js standard-library functionality. The separately approved repository authoring environment declares esbuild with a compatible caret range in the root package, while the lockfile records the exact verified resolution used to generate the self-contained published bundle. Skill users do not install or run the bundler.

## Snapshot manifest contract

`snapshot.json` should contain at least:

```json
{
  "schemaVersion": 1,
  "workflowMode": "actual",
  "scopeKind": "staged",
  "sourceIndex": "real",
  "repositoryRoot": "<absolute-path>",
  "headOid": "<oid-or-null>",
  "indexTreeOid": "<tree-oid>",
  "diffPolicy": {
    "renameScore": 50,
    "copyScore": 50,
    "renameLimit": 1000,
    "externalDiff": false,
    "textconv": false
  },
  "changeUnitCount": 2,
  "changeUnits": [],
  "statistics": {},
  "warnings": []
}
```

Each change unit must include:

- a stable ID derived from the manifest record, not a display-path index;
- normalized kind: `added`, `modified`, `deleted`, `renamed`, `copied`,
  `mode-changed`, `symlink-changed`, `type-changed`, or `submodule-changed`;
- source and destination raw path bytes where applicable, encoded safely for
  JSON;
- a reversible display string;
- a binary sort key;
- old and new object IDs and file modes;
- similarity score for a detected rename or copy;
- added/deleted line counts, with `null` for unavailable binary counts;
- binary, symlink, and submodule metadata;
- stageable paths captured separately from display paths; and
- inspection unit IDs.

Do not decode a Git path, normalize Unicode, then sort it as a JavaScript
string. Parse `-z` output as bytes and use `Buffer.compare` on raw Git path
bytes. Git slash-separated repository paths are the canonical comparison
values.

## Scope selection and rename-safe staging

### Separate three concepts

The implementation must never collapse these into one path list:

1. **Semantic record:** What the reader sees, such as
   `old/name.js → new/name.mjs (renamed)`.
2. **Stageable paths:** Which current pathspecs Git still needs to update.
3. **Approved tree:** The immutable tree ID that ultimately matters.

Git stores snapshots, additions, and deletions. Rename and copy identity is a
comparison-time heuristic, not a persistent “rename object.” The manifest must
record the exact detection policy and must not use a rename label as a staging
instruction.

### Partial staging mechanism

For explicit whole-path subsets, invoke Git directly from Node without a shell:

```text
git add -A --pathspec-from-file=- --pathspec-file-nul
```

Write raw path bytes to the child process's stdin, separated by NUL. This:

- avoids command-line length limits;
- handles spaces, newlines, leading dashes, wildcard characters, and unusual
  path bytes;
- stages deletions when a tracked source path still needs deletion staged; and
- avoids shell quoting and pipelines.

### Rename cases

1. **Unstaged rename:** Include the tracked old path and present destination in
   the initial staging operation when both are needed to transform `HEAD` into
   the intended index.
2. **Already-staged rename:** Do not restage the vanished old path. If the index
   is already the intended snapshot, stage nothing.
3. **Destination edited after rename was staged:** Stage only the destination if
   the user intends those additional edits. Then regenerate the manifest.
4. **Rename plus unrelated changes:** Keep unrelated staged or unstaged paths
   out of the scope unless explicitly selected.
5. **Delete/add pair below the rename threshold:** Treat it as two change units
   unless an explicit semantic mapping establishes a rename. Presentation must
   not alter tree correctness.
6. **Rename detection limit reached:** Record a warning and retain delete/add
   units. Never silently claim complete heuristic rename detection.

### Approval fingerprint

Record `git write-tree` after staging and again immediately before commit. The
second result must equal the approved `indexTreeOid`. This comparison eliminates
the need for a blanket “restage everything and hope” step and fixes the
old-path failure described above.

Changes made only in the working tree after approval do not alter the approved
commit tree. Report them as remaining changes. Any index change invalidates the
approval and triggers regeneration.

## Complete large-diff inspection

### Inventory before patch output

Never begin by dumping one aggregate `git diff HEAD`. After the intended actual
or temporary index is ready, first collect machine-readable:

- porcelain-v2 status with `-z`;
- cached raw diff records with `-z`;
- cached name-status records with `-z`;
- cached numstat records with `-z`;
- summary metadata for creations, deletions, mode changes, symlinks, renames,
  copies, and submodules; and
- object IDs and file modes.

The generated `inventory.md` must show, per change unit:

- display path or rename pair;
- kind;
- added/deleted lines or “binary/unavailable”;
- captured patch byte size;
- expected chunk count; and
- any inspection warning.

This quick inventory lets the agent understand the scale before opening any
content and makes omitted files visible immediately.

### Capture policy

Capture the complete staged patch with:

- external diff drivers disabled;
- textconv disabled;
- explicit, shared rename/copy flags;
- binary payload emission disabled;
- NUL-safe metadata parsing; and
- raw bytes preserved until display.

Binary files receive a metadata inspection unit containing path, kind, modes,
object IDs, size where available, and a content/type probe appropriate to the
environment. A binary file must not be reported as “0 insertions, 0 deletions.”

Submodules receive a gitlink inspection unit with old/new commit IDs and dirty
or unavailable-state caveats. The superproject workflow does not recursively
claim to inspect submodule contents.

### Chunking policy

Use both a line ceiling and byte ceiling. Initial defaults:

- maximum 200 patch lines per chunk; and
- maximum 16 KiB of patch text per chunk.

Whichever limit is reached first closes the chunk. These constants should be
named, tested, and adjusted only with evidence from actual tool-output limits.

Treat each bounded artifact as one tool-response unit. Read exactly one pending
artifact in a dedicated tool action, confirm that its complete contents were
returned, and acknowledge it before requesting the next artifact. Do not infer
an aggregate batch size: tool limits apply to the combined response, vary by
runtime, and do not have a stable byte-to-token conversion.

Preserve file and hunk boundaries whenever they fit. If one hunk exceeds a
limit, split it with explicit continuation metadata:

- change-unit ID;
- chunk ordinal and total;
- original patch byte range;
- original patch line range;
- whether the chunk begins or ends mid-hunk; and
- SHA-256 of the exact chunk bytes.

No content may disappear between chunks or appear twice. Tests must concatenate
chunk payloads and prove byte-for-byte equality with the captured text patch.

### Review ledger

`ledger.json` begins with every text chunk and binary/submodule metadata unit in
`pending` state. The helper should expose `next`, `ack`, and `status` operations:

1. `next` identifies one pending unit and its bounded artifact.
2. The agent reads only that artifact in a dedicated tool action.
3. The agent confirms that the response contains the complete artifact.
4. `ack` records the unit ID and expected hash before another artifact is read.
5. `status` reports coverage and any changed artifact.

Rendering must require complete ledger coverage. The skill must explicitly say
that acknowledgement is a record of completed inspection, not a mechanical
command to run blindly.

If the index tree changes, invalidate the ledger and regenerate only from the
new tree. Do not reuse acknowledgements for changed bytes.

## Commit-message content model

### Section order

The canonical order is:

1. conventional subject;
2. optional `Rationale:` section;
3. optional `User Experience Changes:` section; and
4. required `File Changes:` section.

Separate sections with exactly one blank line. Keep the heading exactly
`File Changes:` with no aggregate count.

Use `Rationale:` only when one shared reason materially improves understanding
and cannot be expressed without duplicating many file/domain bullets. Omit it
for small commits whose rationale is already clear in the subject and file
entries.

### Subject priority

Choose the description in this order:

1. the problem or failure prevented;
2. the user/developer outcome enabled;
3. the invariant, compatibility constraint, or risk addressed; and
4. the mechanical technique, only when it is the most meaningful distinction.

For example, prefer:

```text
build(vite): Prevent native config loader warnings
```

over:

```text
build(vite): Enable native config loading
```

The first subject records why the change exists; the diff already reveals that
the configuration was renamed and converted to ESM.

### Rationale quality

Every semantic bullet should add at least one fact not directly recoverable
from the patch:

- purpose;
- causal reason;
- user or developer consequence;
- invariant preserved;
- compatibility or operational constraint;
- tradeoff selected; or
- regression/warning/failure prevented.

Mechanical detail is allowed when connected to its consequence. Do not force a
false separation between “what” and “why”; require the bullet to explain why
the mechanical action matters.

Permitted sources of rationale:

- the user's request and clarifications;
- an issue, warning, error, failing test, benchmark, or requirement in scope;
- staged code, comments, tests, documentation, or provenance;
- relevant conversation history that agrees with the verified snapshot; and
- the narrowest technical purpose that can be directly inferred.

Do not invent business, security, compatibility, or performance claims. If a
material reason is unavailable, ask the user or state the narrowest verified
technical purpose.

### Canonical rationale fixture

The tests and skill examples must include this approved contrast:

```diff
- build(vite): Enable native config loading
+ build(vite): Prevent native config loader warnings

 File Changes:
   1. `Dockerfile`
-     - Copy the ESM config filename into the Docker build context
+     - Keep container builds aligned with the renamed Vite config
   2. `vite.config.mjs`
-     - Declare the Vite configuration as an ES module
-     - Resolve config-relative paths from `import.meta.url`
+     - Declare the config as ESM to prevent Vite's native-loader warning
+     - Replace CommonJS-only path handling so native loading succeeds
```

The renderer will determine the final indentation; the fixture's semantic
before/after content is the contract.

### Content worksheet

`scaffold` writes `content.json` with immutable manifest IDs and editable
semantic fields.

Detailed-mode shape:

```json
{
  "subject": {
    "type": "build",
    "scope": "vite",
    "description": ""
  },
  "rationale": [],
  "userExperienceChanges": [],
  "mode": "detailed",
  "changeEntries": [
    {
      "changeUnitId": "F000001",
      "reasons": [""]
    }
  ]
}
```

Bulk-mode shape:

```json
{
  "subject": {
    "type": "feat",
    "scope": "parser",
    "description": ""
  },
  "rationale": [],
  "userExperienceChanges": [],
  "mode": "bulk",
  "domains": [
    {
      "title": "Parser and ingestion",
      "changeUnitIds": [],
      "reasons": [""]
    }
  ]
}
```

The agent edits semantic values, not generated paths, ordinals, counts, or
spacing.

In addition to `content.json`, `scaffold` should emit
`commit-message.template.txt` as a human-readable preview:

- detailed mode already contains every generated path in canonical order;
- semantic fields use conspicuous, ID-linked placeholders;
- bulk mode emits a provisional domain worksheet first, then a fully formatted
  preview after exhaustive domain assignment; and
- the template is visibly non-committable while any placeholder remains.

This preview directly gives the agent the correctly structured `File Changes:`
section before prose is written. `render` replaces the preview with a canonical
message generated from structured inputs, so the agent never has to preserve
spacing manually.

## Detailed `File Changes:` mode

### Entry order

Sort normalized change units by raw Git path bytes:

- ordinary changes: path;
- rename: destination path;
- copy: destination path;
- deletion: deleted path; and
- tied display records: stable kind and source-byte tie-breakers.

The renderer, manifest builder, validator, and post-report statistics must use
the same comparison function.

### Ordinal and indentation formula

Let `W` be the number of decimal digits in the total entry count.

- Entry prefix:
  `spaces(W - digits(n)) + n + ". "`
- Nested bullet indentation:
  `W + 2` spaces before `- `
- Wrapped bullet continuation:
  `W + 4` spaces before text

There is no additional base indent.

The generic ordinal formatter must handle one- through four-digit widths even
though detailed mode normally uses only one or two:

| Maximum ordinal width | Entry 1 prefix notation | Child bullet indent | Continuation indent |
| ---: | --- | ---: | ---: |
| 1 | `1. ` | 3 spaces | 5 spaces |
| 2 | `␠1. ` | 4 spaces | 6 spaces |
| 3 | `␠␠1. ` | 5 spaces | 7 spaces |
| 4 | `␠␠␠1. ` | 6 spaces | 8 spaces |

Here `␠` denotes one generated leading space; it is explanatory notation and
must not appear in output. The same formatter is used for bulk-domain ordinals.

For 12 entries:

```text
File Changes:
 1. `first/path.js`
    - Prevent the first failure mode
10. `tenth/path.js`
    - Preserve the shared runtime invariant
```

Right alignment is the defensible layout choice for numeric labels in
monospaced text because it aligns decimal positions while keeping every path
and nested narrative in stable columns. Detailed mode is capped at 49 entries,
so its widest ordinal is two digits. Bulk mode numbers domains, not files, and
therefore does not emit hundreds or thousands of individual ordinal rows.

### Display rules

- Safe ordinary paths use Markdown code spans.
- Rename entries show `source → destination (renamed)` and count once.
- Copy entries show `source → destination (copied)` and count the destination
  once.
- Deleted, binary, mode-only, symlink, type, and submodule changes receive clear
  generated tags where needed to disambiguate them.
- Paths containing backticks, control bytes, invalid UTF-8, or unsafe display
  characters use a deterministic Git-style escaped representation rather than
  an ambiguous code span.
- Line wrapping never splits a path, URL, command, identifier, or other
  indivisible token. The validator reports, but does not automatically reject,
  an unavoidable overlong token.

## Bulk-domain `File Changes:` mode

### Activation

- 1–49 change units: detailed mode.
- 50 or more change units: bulk mode.

The threshold is based on normalized file change units, not raw path endpoints.
A rename therefore counts once; an undetected delete/add pair counts twice.

### Construction

Use a two-pass workflow:

1. Generate the exhaustive manifest and a domain worksheet containing every
   change-unit ID, path, kind, size, and likely repository component.
2. Have the agent assign each ID to one semantically meaningful domain and
   provide domain-level rationale.
3. Validate that the partition is exhaustive, non-overlapping, and count
   correct.
4. Render domain counts from the assignment. The agent never types the counts.

Domain boundaries should follow purpose and system semantics, not arbitrary
alphabetic buckets or fixed file counts. Common domain roles include primary
implementation, integration/adapters, migration/compatibility, verification,
fixtures/benchmarks, and documentation/provenance. Use only roles actually
supported by the snapshot.

Avoid a generic “Miscellaneous” domain. If genuinely unrelated support files
remain, choose a precise shared purpose or use more than one domain.

### Domain order

Use semantic reading order:

1. primary behavior or implementation;
2. integration and registration;
3. compatibility, migration, or operational support;
4. tests, fixtures, and benchmarks; and
5. documentation and provenance.

Only include applicable categories. Preserve the order provided in the
validated domain worksheet; do not alphabetize domains after semantic ordering
has been chosen.

### Rendering

```text
File Changes:
1. Parser and ingestion (24 files)
   - Prevent malformed syntax from bypassing structural validation
2. Integration and registration (8 files)
   - Make the new ingestion path available through existing entry points
3. Verification and fixtures (18 files)
   - Protect cross-format behavior with oracle-backed coverage
```

Use singular `file` for a count of one and `files` otherwise.

The full file-to-domain map remains in `content.json` and `snapshot.json` for
auditability. It is not copied into the commit message merely to satisfy a
mechanical convention.

## Counting and presenting special Git changes

Use these normalized rules consistently in the threshold, domain counts,
validator, and post-commit report:

| Git change | Change-unit count | Paths presented | Line-stat behavior |
| --- | ---: | --- | --- |
| Add | 1 | New path | Numeric when text; unavailable when binary |
| Modify | 1 | Current path | Numeric when text; unavailable when binary |
| Delete | 1 | Deleted path | Numeric when text; unavailable when binary |
| Rename | 1 | Source and destination | Numeric content delta; pure rename may be 0/0 |
| Copy | 1 for the destination | Source and destination | Numeric content delta when available |
| Modified copy source | 1 additional unit | Source path | Counted as its own modification |
| Mode-only change | 1 | Current path plus mode tag | 0/0 is valid with explicit mode metadata |
| Symlink target/type change | 1 | Current path plus symlink/type tag | Use Git's available text/type metadata |
| Submodule gitlink change | 1 | Submodule path and old/new OIDs | Report as a gitlink change, not inner files |
| `.gitmodules` edit | 1 additional unit | `.gitmodules` | Normal text rules |
| Binary change | 1 | Current path plus binary tag | `null`/unavailable, never fabricated zero |
| Conflict | Not commit-ready | All conflict stages | Reject before generation |
| Directory-scale rename | One per detected file rename | Each source/destination pair | Aggregate only in bulk domains |
| Undetected delete/add | 2 | Deleted path and added path | Separate statistics |

Copy detection must not imply that an unchanged source belongs in the commit.
Only the copied destination is the change unit unless the source is independently
modified.

## Deterministic renderer

The renderer owns:

- section presence and order;
- exactly one blank line between sections;
- subject syntax and maximum length;
- generated path display;
- file/domain order;
- ordinal width and alignment;
- nested bullet and continuation indentation;
- singular/plural count labels;
- 72-character wrapping;
- safe preservation of indivisible tokens; and
- one final newline.

Use a deterministic wrapping algorithm that measures Unicode code points in the
same way as the validator. Do not use terminal display width for the existing
72-character policy unless that policy is deliberately redesigned later.

The renderer must fail with actionable structured errors when semantic fields
are empty, a bulk assignment is incomplete, a change unit is duplicated, or a
subject cannot satisfy the constraints. It should return the exact field to
edit, not ask the agent to count spaces or renumber entries.

## Validator redesign

The validator remains a safety net, but no longer asks the agent to recreate
formatter behavior manually.

### Inputs

- required canonical path: `--manifest <snapshot.json>`;
- optional `--content <content.json>` for cross-checking rationale assignments;
- positional rendered message path; and
- legacy `--scope` only for compatibility.

### Mechanically enforced checks

- manifest and content schema validity;
- message canonical byte equivalence to rerendered output;
- subject type, syntax, capitalization, final punctuation, and length;
- section presence, order, and spacing;
- UX-section grammar;
- detailed/bulk mode chosen from the manifest count;
- exact path/change-unit coverage in detailed mode;
- exhaustive, non-overlapping domain assignment in bulk mode;
- generated domain counts;
- raw-byte sort order;
- right-aligned ordinal and derived indentation;
- nested bullet presence;
- line wrapping and indivisible-token exceptions;
- manifest tree ID presence; and
- complete inspection ledger tied to that tree.

### Human semantic review

Keep these as explicit review prompts rather than brittle pass/fail regexes:

- Does the subject lead with the problem or outcome rather than the mechanism?
- Does each rationale add purpose, consequence, constraint, tradeoff, or
  prevention?
- Are claims supported by the user request or inspected snapshot?
- Are UX bullets genuinely user-observable?
- Do bulk domains describe coherent purposes?

The tool may flag likely tautologies such as a bullet that merely repeats a
generated change kind and filename, but such heuristics must be advisory,
explain their evidence, and avoid punitive keyword lists. Unknown rationale
should prompt a narrow factual statement or a question, not fabrication.

### Result contract

- Exit `0`: structurally valid; any advisory review items are reported.
- Exit `1`: invalid user-editable input.
- Exit `2`: execution, Git, schema, or artifact-integrity failure.

Version 2 JSON must distinguish `errors` from `reviews` and include stable issue
codes, manifest tree ID, mode, expected/listed counts, domain coverage, and
canonical-render match.

## Signature-verification policy

### Policy states

#### `required`

- Default for an actual signed commit.
- Run trusted verification.
- A failure or unavailable trust store blocks an automatic push while this
  policy remains active.
- Offer the user the choice to grant the narrowly required read access, change
  policy to `advisory`, or change policy to `skipped`.

#### `advisory`

- Attempt trusted verification.
- Report success, failure, or unavailability precisely.
- Do not treat failure as proof that the commit is unsigned or corrupt.
- Do not block later workflow steps solely because verification did not
  succeed, provided push is separately authorized.

#### `skipped`

- Do not invoke a verifier.
- Report that verification was skipped by user policy.
- Never describe the signature as verified.

The user may select or change these states at any point. Record the initial and
final policy and whether an override occurred.

### Trusted verification path

1. Verify the exact created object ID, not a moving `HEAD` alias:

   `git verify-commit --raw <commit-oid>`

2. Capture exit status, stdout, and stderr without merging trusted Git output
   with conversational interpretation.
3. If successful, extract signer identity, key fingerprint, and signature type
   only from authoritative verifier output.
4. Report “verified” only for this success path.

### Inaccessible SSH allowed-signers file

If trusted verification says that the configured allowed-signers file cannot be
opened:

1. Classify the result as `verification unavailable: trust store unreadable`,
   not `bad signature`.
2. Read the relevant Git configuration origins and resolved allowed-signers
   path without editing configuration.
3. Do not copy the trust file, replace it, change `safe.directory`, or invent a
   different trust source.
4. Under `required` policy, request permission narrowly scoped to reading that
   exact file and rerun the same verifier.
5. If the user changes the policy to `advisory` or `skipped`, accept the
   override and continue according to the new state.
6. Include the unavailable attempt and final policy in the report without
   dumping sandbox internals unless they are needed to act.

### Verification without trust-store access

For SSH signing, a helper may perform an optional `ssh-keygen -Y
check-novalidate`-style integrity check against the exact signed commit payload
and embedded signature. This can show that the payload and embedded public key
are cryptographically self-consistent without reading `allowedSignersFile`.

This is **not** equivalent to trusted verification:

- it does not establish that the signer is an authorized principal;
- it must be labeled `integrity-only`;
- it must never produce “signature verified for <identity>”; and
- it cannot satisfy `required` trusted verification unless the user explicitly
  changes the policy.

Implement this only with fixture-backed byte-level tests for signed payload
extraction. If the platform lacks a suitable SSH verifier, report the
integrity-only check as unavailable rather than improvising another command.

### Skill compatibility text

Revise the skill frontmatter to state that Git and Node.js are required; signed
commit creation requires signing configuration; and trusted SSH verification
requires a readable trust source unless the user overrides verification policy.
Do not continue to claim that readable allowed-signers access is
unconditionally required for every use of the skill.

## Post-commit report

### Normal report template

```text
Created signed commit `<unique-short-oid>` on `<branch-or-detached>`:
`<subject>`

Commit:
- Author: <name> <email>
- Snapshot: Matches the approved staged tree
- Changes: <N files>, <insertions>, <deletions>[, <binary/special caveat>]
- Change types: <normalized kind counts>

Signature:
- Policy: <required|advisory|skipped>[, overridden from ...]
- Result: <trusted verification result or precise non-result>
- Signer: <identity and fingerprint only when trusted>

Checks:
- <check label>: <passed|failed|not run> (<snapshot context>)

Publication:
- <not requested and not attempted | pushed remote/ref | failed>

Workspace:
- <clean | grouped remaining staged, unstaged, untracked, or conflicted state>
```

Use `signed commit` in the opening only when the commit object actually contains
a signature. Use `created commit` otherwise. “Signed” and “trusted-verified” are
separate facts.

### Data sources and rules

1. Use an unambiguous abbreviation of at least 12 hexadecimal characters and
   allow Git to extend it when necessary.
2. Read the actual subject, full message, author, committer, parent IDs, tree ID,
   and signature header from the created commit object.
3. Always show the author. Show the committer only when different.
4. Omit dates in the normal report; add them only when diagnosing a timestamp
   or identity anomaly.
5. Recalculate the actual commit diff relative to its parent, using the same
   normalized change policy. For a root commit, compare with Git's empty tree.
6. For a merge or other multi-parent commit, report the parent shape and avoid
   pretending ordinary one-parent statistics are the whole story.
7. State whether tree and message match approval independently.
8. Show numeric insertion/deletion totals only where Git supplies numeric text
   counts. State binary and special counts separately.
9. Report checks from `checks.json` only. Never infer that a build or test ran
   because related files exist.
10. Label each check's context:

    - approved staged snapshot;
    - current working tree;
    - isolated worktree/container; or
    - external environment.

11. If no checks ran, say `No checks were run in this workflow`.
12. If push was not authorized, say
    `Not requested; not attempted by this workflow`.
13. Parse an attempted push's machine-readable result. Do not infer remote
    success from a zero-looking conversational message.
14. A local tracking comparison is not proof of current remote state unless a
    fetch or push just established it. Label stale/local knowledge.
15. Inspect the remaining workspace using porcelain v2 and group entries as:

    - staged;
    - unstaged;
    - untracked; and
    - conflicted.

16. Collapse an empty workspace to `Clean`.
17. For fewer than 50 remaining changes, list exact paths with generated status
    labels. For 50 or more, provide compact status/domain counts and reference
    the external manifest rather than flooding the response.
18. Never call remaining files “user-owned” unless the workflow recorded that
    fact from explicit user direction.
19. Do not repeat the full commit-message inventory or add an “Includes…”
    synopsis that duplicates it.

### Expanded anomaly reports

Expand the relevant section when:

- actual tree differs from approved tree;
- a hook changed the message;
- the parent is not the recorded pre-commit `HEAD`;
- trusted verification fails or is unavailable;
- the user overrides verification policy;
- push fails or updates an unexpected ref;
- `HEAD` is detached;
- no upstream exists when publication was requested;
- conflicts remain; or
- checks failed.

State what happened, what was and was not attempted, what state remains, and
which next action would require user authorization. Do not silently repair the
history.

## Skill instruction rewrite

Rewrite `skills/committing-to-git/SKILL.md` around the state machine rather than
accumulating more “CRITICAL” prohibitions.

The skill should:

1. identify draft versus actual intent;
2. establish and stage exact scope before composition;
3. call the supplied scripts in order;
4. require complete chunk-ledger inspection;
5. explain that the script supplies mechanical facts and the agent supplies
   verified rationale;
6. show detailed and bulk examples;
7. present the exact canonical message for approval;
8. fingerprint the index before commit;
9. create and compare the actual commit;
10. apply a user-overridable verification policy;
11. preserve separate push authorization; and
12. render the standardized post-commit report.

Use positive, procedural instructions and put essential commands and decision
points near the relevant step. Keep explanatory background in this plan or a
focused reference if the final `SKILL.md` would become too long.

## Proposed repository changes

### Modify

- `skills/committing-to-git/SKILL.md`
- `skills/committing-to-git/scripts/validate-commit-message.mjs`
- `skills/committing-to-git/scripts/commit-message-validation.schema.json`
- `tests/committing-to-git/validate-commit-message.test.mjs`
- `README.md` only if the public script inventory or documented author workflow
  needs updating

### Add

- `skills/committing-to-git/scripts/stage-commit-scope.mjs`
- `skills/committing-to-git/scripts/inspect-commit-scope.mjs`
- `skills/committing-to-git/scripts/prepare-commit-message.mjs`
- `skills/committing-to-git/scripts/report-commit-result.mjs`
- `skills/committing-to-git/scripts/lib/*.mjs` modules described above
- the versioned JSON schemas described above
- `tests/committing-to-git/harness.mjs`
- focused test files for snapshot/staging, inspection, rendering, validation,
  signature policy, and reporting
- `tests/committing-to-git/fixtures/` repositories and signature fixtures
- `evals/committing-to-git/evals.json`

Do not edit installed skill copies under `.agents/` or `.claude/`. Use the
repository's normal bootstrap/install workflow after the canonical tracked skill
passes validation.

## Test-driven implementation sequence

Each behavior phase follows RED → GREEN → REFACTOR. Add one failing test for the
next behavior, observe the expected failure, implement the minimum coherent
behavior, rerun focused tests, then refactor only while green.

### Phase 0: Baseline and evaluation fixtures

1. Preserve the current skill behavior as the baseline.
2. Add representative evaluation prompts before changing `SKILL.md`:

   - a large multi-file diff whose aggregate output would truncate;
   - a staged rename whose old path no longer exists;
   - 9/10 and 49/50 formatting boundaries;
   - a 100- and 1,000-file bulk commit;
   - a warning-driven Vite change requiring rationale;
   - an inaccessible allowed-signers file followed by a user override;
   - unrelated staged and unstaged changes;
   - special Git change types; and
   - post-commit report variants.

3. Run the existing skill against the evals and record baseline failures,
   retries, and formatting variance.
4. Define success criteria without tailoring prompts to reveal the answer.

### Phase 1: Test harness and schemas

RED:

- Add repository-fixture helpers that can create isolated temporary Git
  repositories, commits, indexes, weird paths, and controlled hooks.
- Add schema tests that currently fail because version 2 contracts do not
  exist.

GREEN:

- Create schema skeletons and shared process/path helpers.
- Preserve current validator exit behavior.

REFACTOR:

- Centralize Git invocation and platform-neutral fixture setup.

### Phase 2: Snapshot and staging engine

RED tests:

- actual full scope stages before manifest generation;
- staged-only scope performs no restage;
- draft full scope leaves the real index byte-for-byte unchanged;
- draft staged scope reads the real index without mutation;
- explicit partial paths exclude unrelated work;
- pre-existing partial hunks remain partial;
- paths with spaces, newlines, leading dashes, and wildcard characters stage
  correctly;
- an unstaged rename stages successfully;
- an already-staged rename does not pass the vanished source back to Git;
- index tree drift is detected;
- conflicts are rejected; and
- unborn branches produce a valid snapshot.

GREEN:

- Implement `stage-commit-scope.mjs`, temporary-index isolation, NUL pathspec
  input, tree fingerprinting, and normalized manifest records.

REFACTOR:

- Separate candidate discovery, stageable paths, semantic change units, and
  tree comparison.

### Phase 3: Complete diff inspection

RED tests:

- inventory reports line and byte scale before patch chunks;
- every captured text-patch byte appears exactly once across chunks;
- line and byte ceilings are independently enforced;
- a huge single hunk has correct continuation ranges;
- external diff and textconv configuration cannot hide or rewrite content;
- binary files produce metadata units with unavailable line counts;
- submodules produce gitlink units;
- ledger completion requires every unit;
- changed chunk hashes invalidate acknowledgement; and
- a new index tree invalidates the old ledger.

GREEN:

- Implement capture, inventory, chunking, hashes, and ledger operations.

REFACTOR:

- Make the chunker a pure byte/line transformation with property-style boundary
  tests.

### Phase 4: Scaffold and deterministic renderer

RED tests:

- 1, 9, 10, and 49 detailed entries render with right-aligned ordinals and
  derived indentation;
- the ordinal helper renders widths 1, 2, 3, and 4 with child and continuation
  text in stable columns;
- 50 switches to bulk mode;
- 99/100 and 999/1,000 file manifests remain compact because only domains are
  numbered;
- no count appears in `File Changes:`;
- paths use raw-byte binary ordering;
- Unicode normalization forms are not collapsed;
- unsafe paths receive reversible quoting;
- rename and copy entries render both endpoints once;
- binary, delete, mode, symlink, type, and submodule tags are correct;
- domain counts are generated with correct singular/plural;
- missing, duplicated, or multiply assigned IDs fail with exact field errors;
- wrapping is deterministic at 71, 72, and 73 code points;
- indivisible overlong tokens remain intact; and
- rerendering the same inputs is byte-identical.

GREEN:

- Implement scaffolding, detailed rendering, bulk rendering, ordinal formatting,
  path display, and wrapping.

REFACTOR:

- Keep all layout constants and comparison functions in one module.

### Phase 5: Rationale guidance and validator version 2

RED tests:

- the Vite warning fixture prefers the problem-focused subject and causal
  bullets;
- bug fix, refactor, test-only, docs-only, generated-file, lockfile, and bulk
  examples prompt appropriate rationale without invented claims;
- canonical output validates against its immutable manifest;
- a live working-tree change after rendering does not silently change expected
  scope;
- a different manifest tree fails;
- noncanonical manual spacing fails with a rerender instruction;
- incomplete inspection prevents final validation;
- every issue code exists in the schema; and
- legacy `--scope` still works with a deprecation warning.

GREEN:

- Implement content validation, canonical comparison, bulk grammar, schema
  version 2, and advisory semantic-review prompts.

REFACTOR:

- Remove duplicated parser and formatter rules from the validator.

### Phase 6: Commit comparison and signature policy

RED tests:

- an ordinary signed commit matches the approved parent, tree, and message;
- a pre-commit hook that changes the index produces a tree mismatch;
- a commit-msg hook that edits the message produces a message mismatch;
- required verification succeeds;
- required verification fails and blocks push;
- unreadable allowed-signers is classified as unavailable rather than invalid;
- the user can override required to advisory after failure;
- the user can switch to skipped before an attempt;
- advisory failure does not claim trusted verification;
- integrity-only success never claims signer trust;
- no automatic amend/reset occurs after failure; and
- verification targets the created OID even if `HEAD` moves.

GREEN:

- Implement commit comparison and the signature-policy state machine.
- Add integrity-only SSH verification only if the supported toolchain and
  byte-level fixtures prove it reliable.

REFACTOR:

- Centralize status vocabulary and prohibit ambiguous “verified” strings in
  non-trusted states.

### Phase 7: Post-commit reporting

RED tests:

- clean normal report;
- author/committer difference;
- root commit;
- detached `HEAD`;
- text plus binary statistics;
- renamed/copied/special kind counts;
- required, advisory, overridden, skipped, unavailable, and integrity-only
  signature sections;
- no checks, passed checks, failed checks, and mixed snapshot contexts;
- push not requested, push success, and push failure;
- fewer than 50 exact remaining paths;
- 50 or more compact remaining changes;
- staged/unstaged/untracked/conflicted grouping;
- tree/message mismatch expansion; and
- report contains no duplicate full file inventory or unsupported
  “Includes…” claim.

GREEN:

- Implement structured fact collection and deterministic report rendering.

REFACTOR:

- Keep Git collection separate from presentation so fixtures can test reports
  without a live signer or remote.

### Phase 8: Rewrite the skill and pressure-test behavior

RED:

- Run the baseline evals against the unchanged skill and preserve the recorded
  gaps.

GREEN:

- Rewrite `SKILL.md` to invoke the new flow and scripts.
- Update examples for detailed, bulk, rename, signature override, and
  post-commit reporting.

Pressure tests:

- The agent does not dump a large aggregate diff.
- The agent does not draft against unstaged actual scope.
- The agent does not restage after approval.
- The agent does not pass the old side of an already-staged rename to `git add`.
- The agent does not hand-sort or hand-number paths.
- The agent does not switch to per-file narration at 50+ files.
- The agent does not propose splitting the commit because it is large.
- The agent does not paraphrase only mechanical changes when rationale is
  available.
- The agent does not fabricate rationale when it is unavailable.
- The agent accepts verification-policy overrides.
- The agent does not conflate integrity-only checking with trusted identity.
- The agent does not push without explicit authorization.

REFACTOR:

- Remove obsolete duplicated prohibitions and keep the final skill concise.

## Required test matrix

Beyond phase-specific tests, cover cross-products that often expose integration
bugs:

| Dimension | Required values |
| --- | --- |
| Workflow | Draft staged, draft full, draft partial, actual staged, actual full, actual partial |
| Index state | Empty, fully staged, partially staged file, mixed staged/unstaged, unrelated staged |
| Repository state | Normal, unborn, detached, root commit, active operation, conflict |
| File count | 1, 9, 10, 49, 50, 99, 100, 999, 1,000 |
| Path | ASCII, space, Unicode, normalization variants, newline, dash prefix, backtick, invalid UTF-8 where platform permits |
| Change kind | Add, modify, delete, rename, copy, mode, symlink, type, binary, submodule |
| Diff size | Small, many files, one huge file, one huge hunk, long lines |
| Signature | Trusted success, invalid, unknown signer, unreadable trust file, verifier missing, integrity-only, skipped |
| Hook | None, reject, index mutation, message mutation |
| Publication | Not requested, success, rejection, no upstream, unexpected ref |
| Workspace after | Clean, staged, unstaged, untracked, conflicted, 50+ remaining |

Where Windows cannot create a particular raw byte path or symlink without
privilege, run the parser/renderer case from raw fixtures and keep supported
filesystem integration cases platform-conditional.

## Verification commands

Run commands individually and inspect each exit status before continuing.

Focused tests during development:

```powershell
node --test "tests/committing-to-git/*.test.mjs"
```

Full repository test suite:

```powershell
node --test "tests/**/*.test.mjs"
```

Canonical skill validation:

```powershell
.\.agent-tools\bin\skills-ref.cmd validate .\skills\committing-to-git
```

Whitespace/error check:

```powershell
git diff --check
```

Also run:

- baseline and redesigned skill evaluations;
- an end-to-end draft flow proving the real index is unchanged;
- an end-to-end actual flow in an isolated fixture repository;
- the already-staged rename scenario from the reported failure;
- a 50-file bulk-domain fixture;
- a large-patch ledger inspection;
- trusted SSH verification where the allowed-signers file is readable;
- the unreadable-trust-file classification and override flow; and
- post-commit report snapshots for normal and anomalous outcomes.

Do not create a real commit in the repository merely to test this plan. Use
isolated temporary fixture repositories.

## Acceptance criteria

The redesign is complete only when all of the following are true:

1. An actual message cannot be approved before the exact intended index tree
   exists.
2. Drafting all or partial working-tree changes leaves the real index unchanged.
3. A future commit never reuses a draft without regeneration from the real
   index.
4. The already-staged rename example completes without attempting to restage
   the vanished source path.
5. An index change after approval is detected by tree ID and forces
   regeneration.
6. Large diffs are inventoried first and split into bounded, exhaustive,
   hash-tracked chunks.
7. Rendering cannot complete with an unreviewed chunk.
8. Agents no longer manually create path order, numbering, indentation, counts,
   or line wrapping.
9. Detailed ordinals are right-aligned with zero fixed base indentation.
10. The heading remains exactly `File Changes:` with no total count.
11. Detailed mode is used through 49 change units and bulk mode at 50.
12. Bulk domains show generated file counts and form an exact partition.
13. No workflow prompt suggests reducing an approved scope because it is large.
14. Special Git changes follow the normalized count and display table.
15. Commit prose records rationale that the diff cannot supply when such
    rationale is known.
16. The validator does not rely on a mutable live scope in the canonical path.
17. Actual commit parent, tree, and message are checked after creation.
18. Required signature verification has a prescribed narrow-permission path.
19. The user can override verification to advisory or skipped at any time.
20. Integrity-only checking is never reported as trusted identity verification.
21. Post-commit reports contain sourced facts, actual checks, exact publication
    state, and remaining workspace state without duplicating the full message.
22. Commit creation and push retain separate explicit authorization gates.
23. Existing validator callers retain a documented compatibility path.
24. Focused tests, the full suite, skill validation, evals, and end-to-end
    fixtures pass.
25. No repository configuration or installed skill mirror is modified.

## Rollout and migration

1. Land schemas and tests before rewriting workflow prose.
2. Keep the existing validator CLI operational while adding manifest mode.
3. Switch the canonical skill to manifest mode only after the end-to-end
   fixtures pass.
4. Mark live `--scope` validation as legacy in machine output and documentation.
5. Compare new eval results with baseline for:

   - number of message-revision loops;
   - structural validation failures;
   - missed diff chunks;
   - rename staging failures;
   - unsupported rationale claims;
   - signature-verification improvisation; and
   - post-report factual errors.

6. Update `README.md` only for public user/developer-facing commands that need
   discovery.
7. Validate the canonical skill.
8. Refresh installed copies through the repository's supported bootstrap flow,
   outside the canonical source change and only when requested.

## Risks and mitigations

### Temporary-index leakage

**Risk:** A helper accidentally points `GIT_INDEX_FILE` at the real index or
leaves a temporary lock.

**Mitigation:** Resolve and compare absolute paths, set the variable only in
child-process environments, use unique scratch paths, test cleanup, and never
inherit a workflow-specific index variable into unrelated commands.

### Pre-existing staged work

**Risk:** A partial-scope operation silently includes or removes staged work.

**Mitigation:** Treat ambiguity as a scope decision, never auto-unstage, and
compare before/after candidate and tree manifests.

### Hook mutation

**Risk:** Hooks change the index or commit message after approval.

**Mitigation:** Compare actual parent/tree/message and block automatic push on
mismatch.

### Rename/copy heuristic instability

**Risk:** Configuration or scale changes Git's presentation.

**Mitigation:** Supply explicit shared flags, record limits and warnings, keep
tree correctness independent of labels, and accept explicit semantic mappings.

### Very large commits

**Risk:** Patch files, rename detection, or output overwhelms memory/context.

**Mitigation:** Stream child output and chunk files, use bounded reads, apply a
recorded rename limit, use bulk domains, and keep the exhaustive inventory
outside the commit message. Never translate this mitigation into scope pressure.

### Unsafe paths

**Risk:** String decoding, shell quoting, or scratch filenames corrupt path
identity.

**Mitigation:** NUL-delimited byte parsing, direct `execFile` calls, raw-byte
sort keys, ID-based scratch names, and reversible display quoting.

### Semantic-quality automation

**Risk:** A rigid “why” checker rejects good prose or rewards invented claims.

**Mitigation:** Generate structure mechanically, provide specific positive
prompts, keep semantic heuristics advisory, and ground claims in inspected
evidence.

### Signature trust ambiguity

**Risk:** A cryptographically intact signature is reported as trusted without
access to the configured trust source.

**Mitigation:** Separate trusted, integrity-only, unavailable, failed, waived,
and skipped states in both schema and prose.

### Report drift

**Risk:** The report restates the intended change instead of the actual commit.

**Mitigation:** Collect actual commit facts after creation and compare them with
approved artifacts before rendering.

## Definition of done

Implementation is ready for review when:

- every acceptance criterion is represented by an automated test, evaluation,
  or explicitly documented manual end-to-end check;
- the exact rename and SSH trust-store incidents that motivated the redesign
  have regression fixtures;
- all output schemas are versioned and validated;
- the canonical skill reads as a short guided workflow rather than a list of
  formatting traps;
- no user-owned workspace change is disturbed during fixture runs;
- all repository verification commands pass; and
- the implementation diff contains no configuration change or installed-copy
  edit.

## Reference basis

The implementation should use primary Git interfaces intended for scripting:

- [`git diff`](https://git-scm.com/docs/git-diff) for `--raw`,
  `--name-status`, `--numstat`, `-z`, rename/copy detection, and
  external-diff/textconv controls;
- [`git status`](https://git-scm.com/docs/git-status) for stable porcelain v2
  and NUL-delimited workspace state;
- [`git add`](https://git-scm.com/docs/git-add) for
  `--pathspec-from-file` and `--pathspec-file-nul`;
- [`git write-tree`](https://git-scm.com/docs/git-write-tree) for index-tree
  fingerprinting;
- [`git commit`](https://git-scm.com/docs/git-commit) for signed creation,
  message files, cleanup policy, hooks, and explicit authorization boundaries;
- [`git verify-commit`](https://git-scm.com/docs/git-verify-commit) for trusted
  verification of the exact created object;
- [`git rev-parse`](https://git-scm.com/docs/git-rev-parse) for unambiguous
  object naming and branch/repository discovery;
- [`git push`](https://git-scm.com/docs/git-push) for machine-readable
  publication results; and
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for
  subject/body/footer conventions. Its absence of a prescribed file inventory
  supports treating numbered `File Changes:` entries as this skill's usability
  convention rather than a universal Git norm.

These references define Git mechanics. The 50-file threshold, numbering,
domain presentation, rationale prompts, and report layout are explicit product
decisions documented in this plan.
