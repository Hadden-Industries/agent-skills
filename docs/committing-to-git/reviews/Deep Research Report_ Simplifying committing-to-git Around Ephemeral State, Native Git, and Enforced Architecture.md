# Deep Research Report: Simplifying `committing-to-git` Around Ephemeral State, Native Git, and Enforced Architecture

## Executive assessment

The central conclusion of the original architecture review survives validation against the current `main` branch: `committing-to-git` has accumulated a durable transaction system, message journal, snapshot machinery, review packet persistence, check receipts, index-installation journal, recovery coordinator, report persistence and publication recovery around a task whose normal-case semantics can be expressed much more directly in terms of Git's own repository, index, object and reference operations. The review's diagnosis of accidental complexity and dependency disorder was therefore directionally correct, and several of its most important concrete dependency findings are still present today. fileciteturn0file0 citeturn255582view2turn255582view3turn255582view4turn255582view5

The review should not, however, be adopted verbatim. Some quantitative details have already drifted: for example, `transactionWorkspace.js` is now 1,866 lines and `prepareWorkflow.js` 1,775 lines, so the historical line counts are no longer current; the repository layout has also expanded with additional `command/` and `schema/` areas. More importantly, the proposed remedy of inventing an `InMemoryGitAdapter` would itself repeat the not-invented-here problem. Git's behaviour around attributes, filters, pathspecs, index formats, sparse checkout, submodules, signatures and reference updates is sufficiently rich that a home-grown fake Git would be a poor behavioural oracle. The stronger modern design is to keep **workflow state** in memory by default while continuing to exercise the **real Git executable** behind a narrow process boundary. citeturn255582view0turn744792view2

Your new state requirement materially improves the architectural target. The default should no longer be "durable transaction with cleanup"; it should be **ephemeral workflow execution whose intermediate state dies with the process**. If an interruption occurs before the commit has been conclusively created, the normal recovery action is simply to prepare again from current repository state. Durable recovery becomes an explicitly selected capability rather than a universal architectural burden. This is consistent with the repository's own engineering principles: reuse existing capabilities before building new machinery, choose proportionate controls, eliminate duplicated authority, keep names semantically accurate and recheck the higher-level outcome rather than preserving infrastructure merely because it exists. fileciteturn0file1

The supplied ZIP makes the current cost concrete. A single transaction attempt contains such files as `transaction.json`, `snapshot.json`, `evidence-plan.json`, `index-installation.json`, `message/current/message.txt`, message state and validation JSON, process transcript material, and report JSON/text beneath the user's Windows temporary directory. The current source confirms this is intentional rather than incidental: `createTransactionWorkspace()` defaults its `temporaryRoot` to Node's `tmpdir()`, allocates an attempt directory and immediately writes `transaction.json`. citeturn744792view3 Current draft snapshot preparation additionally creates `draft-index` and `draft-objects` under that attempt directory and redirects `GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` there. citeturn744792view4turn744792view5

The recommended end state is therefore:

| Concern | Default `memory` mode | Opt-in `disk` mode |
|---|---|---|
| Workflow state | Process memory only | Programmatically confined directory store |
| OS temporary directory | **Never used** | **Never implicitly used** |
| Transaction JSON | None | Retained/reworked as durable state |
| Message files/journal | None | Durable only where recovery requires it |
| Review packet files | None | Optional durable recovery representation |
| Check transcript files | None; bounded in-memory capture | Durable under configured root if required |
| Prepared temporary Git index | Avoid in normal path | Allowed under configured state root when required |
| Draft Git object directory | Avoid | Allowed under configured state root when required |
| Restart after interruption | Re-run preparation from repository | Resume/recover |
| Caller contract | Small, declarative, stateless/recomputable | Same external contract; recovery is additional capability |
| Git implementation | Real Git | Real Git |

This should be treated as a redesign of the state ownership boundary, not as a boolean branch sprinkled through the existing transaction system. If `memory` merely substitutes an in-memory filesystem beneath today's 1,800-line transaction state machine, most of the accidental complexity and dependency cycles remain. The implementation should instead make the normal workflow *intrinsically stateless between invocations* and place durable state behind an optional adapter used only by `disk` mode.

## What the original review got right, and what should change

### Dependency cycles are still real

The review identified `message ↔ transaction` as one of the primary cycles. Current source still has `canonicalMessageState.js` importing `advanceTransaction`, `readTransaction` and `updateTransaction` from `transactionWorkspace.js`; conversely, `transactionRecovery.js` imports `recoverCanonicalMessageReplacement` from the message subsystem. That is a direct bidirectional dependency between supposedly distinct responsibilities. citeturn255582view3turn255582view4

The larger cycle remains materially intact as well. Current snapshot preparation depends on transaction/index-installation machinery, transaction workspace imports check-receipt logic, and preparation orchestrates checks, snapshots, message state, review catalogues and transaction storage together. The review's objection was not cosmetic: state representation has become the medium through which otherwise independent domains communicate. citeturn255582view2turn255582view5turn255582view7

The workflow/CLI inversion is also validated. `prepareWorkflow.js` directly imports both `executeCommand` and `parseCommandArguments` from the CLI layer, while the CLI command dispatcher dynamically imports workflow implementations such as `prepareWorkflow.js`, `createCommitWorkflow.js`, `publishWorkflow.js` and recovery workflows. The dependency therefore points both ways. citeturn255582view5turn255582view6

The original recommendation to reverse that relationship is sound. CLI parsing, stdout encoding and exit-status mapping should terminate at the delivery boundary. Application operations should take structured values and return structured results. The CLI can then translate `argv` into application inputs and results into protocol output, with no application import back into `cli/`.

### The durable transaction machinery is genuinely pervasive

This was not an exaggerated reading of a few helper functions. The current transaction module imports low-level filesystem functions including `fsyncSync`, `renameSync`, `openSync`, `realpathSync`, `mkdirSync`, `rmSync` and `writeFileSync`, along with operating-system temporary-directory discovery. It also defines transaction phases, status vocabularies, path validation, UUID rules, review cursor patterns and other domain concerns in the same module. citeturn255582view2

Likewise, canonical message state has its own candidate/current/previous slots, pending journal and filesystem durability operations. citeturn255582view3 Recovery has independent filesystem locks, path-containment validation and recovery coordination, while also reaching into message and reporting modules. citeturn255582view4 The original review's "second-system" characterisation is therefore supported by current implementation evidence even though its historical LOC totals should not be treated as current measurements. fileciteturn0file0

### The interface is still exposing implementation concerns

The repository currently presents `workflow prepare`, `workflow extend`, `workflow review-next`, `workflow resume`, `workflow promote`, `workflow check`, `workflow check-detail`, `workflow commit`, `workflow verify`, `workflow report-detail`, `workflow publish`, `workflow recover`, `workflow cleanup` and message-related routes through the command dispatcher. citeturn255582view6 Some of these may remain useful internal capabilities, but they should not all be part of the agent's conceptual protocol.

The deeper interface proposed by the review should be retained in spirit but adjusted for the new state model. A caller should primarily understand **prepare**, **commit**, and optionally **publish**. Recovery should only be visible when durable storage has deliberately been selected. Internal review paging, message slots, transaction phases, installation journals and packet persistence are implementation details.

A particularly important correction is that a "proposal ID" must not become another hidden durable transaction identifier. In memory mode, the proposal should be a **self-contained, non-authoritative description of what was reviewed**, or the commit operation should recompute it from scope and current repository state. The runtime must independently confirm that the approved state still matches before committing. That gives optimistic concurrency without introducing storage.

### The testing criticism was directionally right but too absolute

The review says unit testing is effectively impossible and proposes an in-memory Git implementation. The current architecture does indeed tie much behaviour to concrete filesystem and Git process operations, but the categorical claim should be softened: parts of the code already expose launch/process seams, and many pure policies can be tested separately. The more important problem is **where the seam sits**, not simply whether one exists. fileciteturn0file0

The appropriate split is:

```text
Application logic
    |
    +-- WorkflowStateStore
    |      +-- MemoryWorkflowStateStore
    |      `-- DirectoryWorkflowStateStore
    |
    `-- GitCommandRunner
           `-- real Git executable
```

`WorkflowStateStore` deserves two adapters because two genuinely different persistence behaviours now exist. `GitCommandRunner` does *not* need a fake Git domain model; tests that depend on Git semantics should run the real Git executable in disposable repositories. Pure command construction and output parsing can be unit-tested with a narrow process spy, but Git itself remains the behavioural authority. This satisfies the repository's consumer-owned-validation principle more faithfully than simulating Git. fileciteturn0file1

### Some machinery should be deleted rather than merely abstracted

The original review was strongest where it applied the deletion test. In the new default mode, there is no reason to preserve message slot rotation, pending replacement journals, transaction recovery phases, `index-installation.json`, recovery lock files, persisted review packet queues or persisted report artefacts merely to make them run against memory. Their complexity does not reappear at the caller if preparation can simply be repeated.

Disk mode is different: some of that machinery represents a real opted-in requirement. Even there, however, native Git should replace custom coordination wherever its semantics are sufficient. The correct outcome is not "delete all recovery under all circumstances"; it is "remove recovery from the normal path, then minimise and isolate the residual durable recovery implementation."

## Target state and configuration model

### Public semantics

The public setting should express *persistence*, not an implementation mechanism. Under NAM-01, names such as `temporaryRoot`, `inProcess`, or a generic `mode` would be misleading once the feature represents a user-visible durability choice. fileciteturn0file1

A precise configuration model would be:

```json
{
  "workflowState": {
    "storage": "memory"
  }
}
```

or:

```json
{
  "workflowState": {
    "storage": "disk",
    "directory": "D:\\agent-state\\committing-to-git"
  }
}
```

The corresponding task-level CLI form can be:

```text
--state-storage memory
```

and:

```text
--state-storage disk --state-directory <absolute-path>
```

`memory` MUST be the default when no setting is supplied. Selecting `disk` without a directory MUST fail rather than falling back to `os.tmpdir()`. Supplying `--state-directory` while storage is `memory` SHOULD also be rejected, because silently ignoring it would conceal a configuration mistake. No code path should call `tmpdir()` as a fallback for workflow state after this migration.

Internally, the names should follow the same semantics:

```text
WorkflowStateStore
MemoryWorkflowStateStore
DirectoryWorkflowStateStore
```

These names denote ownership and persistence without encoding incidental implementation detail. `TransactionWorkspace` should not remain the generic abstraction if memory mode no longer implements a durable transaction workspace; retaining it would violate the repository's semantic-naming rule. fileciteturn0file1

### Configuration precedence and `AGENTS.md`

The robust precedence should be deterministic and small:

```text
explicit task option
    >
repository/tool configuration
    >
skill default ("memory")
```

An `AGENTS.md` instruction may tell an agent to invoke the skill with `--state-storage disk --state-directory ...`, but the runtime should **not parse natural-language `AGENTS.md` prose to discover a security-sensitive filesystem boundary**. Agent Skills themselves are instruction packages loaded by compatible agents, while repository agent policy remains instruction context rather than a typed runtime configuration protocol. citeturn305201search8turn744792view2

For a persistent repository default, use a small typed configuration object owned by the skill, validated through the repository's existing JSON-schema/Ajv infrastructure rather than a hand-written parser. The project already has Ajv in its development dependency set, and the engineering principles explicitly require using consumer-supported validators where possible rather than shadow grammars. citeturn255582view1 fileciteturn0file1

An `AGENTS.md` can then carry a human/agent instruction such as "for this repository, use the committed `committing-to-git` state configuration", or directly instruct the agent to pass the explicit task flags. That preserves the desired policy channel without making runtime filesystem confinement depend on an LLM correctly interpreting prose.

### Hard confinement for disk mode

The on-disk implementation should make escape from the selected directory impossible through its public API by construction. Application modules should never receive or manufacture filesystem paths for workflow state. They should manipulate typed logical artefact identifiers, for example:

```text
attempt record
approved message
snapshot record
check receipt
process transcript
commit report
publication observation
```

Only `DirectoryWorkflowStateStore` converts those logical identifiers into paths. It resolves and canonicalises the configured root once, creates a per-attempt child beneath it and rejects any path component that is absolute, contains traversal, or would resolve outside the root. The existing code already contains useful path-containment and reparse/symlink defensive checks; those should be concentrated in this one adapter instead of duplicated across message, transaction and recovery modules. citeturn255582view3turn255582view4

The crucial API rule is:

```text
BAD
store.writeFile(arbitraryPath, bytes)

GOOD
store.writeArtifact(attemptId, ArtifactKind.CHECK_RECEIPT, bytes)
```

There should be no "escape hatch" method that accepts an arbitrary absolute path. Any Git operation requiring scratch material in disk mode receives a child path generated by the store itself. This is what makes the directory policy programmatic rather than reliant on agent judgement.

On POSIX, ownership/mode checks should continue to be applied where meaningful. On Windows, the current implementation already acknowledges that POSIX mode bits do not establish ACL security and uses path/reparse validation instead; that platform distinction remains relevant in the disk adapter. citeturn744792view3 A security review is warranted because this change affects filesystem trust boundaries, which is explicitly a trigger under the supplied engineering principles. fileciteturn0file1

### What "no writes" means in memory mode

The acceptance criterion should be stated precisely: **before the user-authorised commit operation, memory mode performs no skill-owned filesystem writes and creates no temporary files or directories anywhere**. It may read the repository and execute read-only Git commands. During the actual commit operation, Git necessarily writes the requested durable repository state—the object database, index as applicable, reflog/reference locks and resulting commit—because creating a commit is itself the requested filesystem effect. This is not "temporary skill state".

That distinction must be explicit in tests. Otherwise an impossible requirement such as "zero writes anywhere, including `.git`, while creating a commit" could be inferred.

The strongest regression test should run memory-mode preparation with an isolated `TMP`, `TEMP` and `TMPDIR` pointing at an empty sentinel directory and assert that it remains byte-for-byte empty afterwards. It should additionally instrument or snapshot the repository metadata to establish that preparation did not mutate the index, object store, refs or working tree. A successful commit test should then assert that only expected Git-owned repository changes occur and the configured OS temp sentinel remains untouched.

### Cross-process state without persistence

The current command protocol assumes durable state because each CLI invocation is a new Node process. Moving to memory by default means the system must stop pretending that one process can "resume" another without persistence.

The clean solution is **recomputation plus optimistic validation**. `prepare` returns a structured proposal to the caller. That proposal can contain only facts needed to bind approval:

```json
{
  "schema": "commit-proposal/v1",
  "scope": { "kind": "staged" },
  "head": "<full object id>",
  "reviewedSnapshot": "<digest>",
  "message": "<approved bytes or digest>",
  "policy": { "...": "..." }
}
```

The proposal is caller-held data, not runtime durable state and not an authority. On `commit`, the application re-reads the repository, reconstructs the relevant snapshot and rejects the operation if the current facts no longer match the approved proposal. No resume state is needed; if the process disappears before commit, the agent starts over.

For large review output, the same principle should replace durable cursor state. A cursor can identify a deterministic position plus reviewed-snapshot digest, while each request regenerates the relevant bounded view from the repository. If the digest changes, the cursor is stale. This avoids persisting packet queues merely to support pagination.

### Disk mode as an additive capability

Disk mode can preserve a durable attempt ID and recoverable state, but it should implement the same application-facing operations. Callers should not have to learn an entirely separate protocol simply because persistence changed. The only extra operation should be recovery of a durable attempt when explicitly requested.

That yields a deep interface:

```text
prepare(scope, options) -> Proposal
commit(proposal, approvedMessage, options) -> CommitResult
publish(commit, destination, options) -> PublicationResult

disk-only:
recover(attemptId) -> RecoveryResult
```

The CLI remains an adapter over these operations. Message checking, review details and check execution can remain subordinate capabilities but should not force callers to orchestrate internal transaction phases.

## Native Git reuse and deletion of custom machinery

The repository currently supports Git 2.45 or newer and Node.js 24 or newer. The stated Git floor exists for the helper's `--no-lazy-fetch` boundary, so implementation must not silently depend on a newer Git feature unless the minimum is deliberately raised and that decision is accepted. citeturn744792view0turn744792view1 The right strategy is therefore to use the newest *available APIs whose required semantics exist at the supported floor*, and separately decide whether there is enough value to raise the floor.

### Preparation should become read-only

`git diff`, `git status`, `git ls-files`, `git cat-file` and related inspection commands should supply review data directly. Git's own documentation defines `git diff` as the mechanism for comparing working tree, index and commit/tree states. citeturn167920view4

Where a candidate blob identity is needed without materialising an object, `git hash-object` is particularly useful. It computes an object ID without writing the object database unless `-w` is specified, and `--path` lets Git apply the attributes/filters that would apply at the repository path. citeturn341265view0turn341265view1 This is significantly preferable to either writing draft objects into a private object directory—as the current implementation does—or reimplementing Git's content-cleaning rules in JavaScript. citeturn744792view4

The preparation phase should therefore stop creating `draft-index`, `draft-objects`, `snapshot.json`, review queues and message files in memory mode. It can compute an approval binding from the observable repository state and return it directly.

### Let Git own path semantics

For operations that do stage selected paths at authorised commit time, Git already accepts pathspecs through stdin with `--pathspec-from-file=-`; combining this with `--pathspec-file-nul` makes every other byte literal and supports filenames containing line breaks or quote characters. citeturn341265view2turn341265view3

That means JavaScript should not maintain another path quoting or argument-packing grammar where Git can consume the intended path list directly. The current helper contains its own formatting for alternate object paths and significant path/index machinery; some of that remains necessary for environment handling, but user path selection should defer to Git's native parser wherever possible. citeturn255582view7

The current rule that an explicit path-scope operation is rejected when the real index already contains unrelated staged changes is valuable because it simplifies correctness. Current source already enforces that condition. citeturn744792view4 Keeping that invariant permits the new implementation to use native `git add -A` for the authorised paths at commit time rather than reconstructing and installing a temporary projected index. If the product requirement later changes to support committing a selected subset while preserving unrelated staged entries, that should be treated as a separate accepted capability because it materially changes the state-management problem.

`git commit --only` is also useful for tracked-path cases: Git documents that it can commit the working-tree versions of named paths while disregarding other staged paths, and it supports stdin/NUL pathspec input. citeturn341265view4 It should not, however, be treated as a universal replacement until exact new-file, deletion, filter, hook and signing behaviours are qualified against the repository's accepted scope semantics. The plan should favour native `git add` + normal commit semantics where they directly match requirements, rather than force one clever command to handle every route.

### Let Git own commit-object construction and reference concurrency

If the workflow needs exact control over constructing a commit from a known tree and approved message, `git commit-tree` already creates the commit object, reads its message from standard input and supports signing. citeturn305201search2 This can eliminate a temporary message file and substantial custom commit-object coordination.

For final branch movement, `git update-ref` provides precisely the compare-and-swap property the helper needs: supplying the expected old OID causes Git to update the ref only if it still has that value. Its stdin protocol also supports grouped regular and symbolic-ref operations with explicit `start`, `prepare`, `commit` and `abort` commands. citeturn341265view5turn341265view6 That native mechanism should replace any JavaScript-level attempt to emulate transactional ref mutation.

A target commit path can therefore be structured around native atomicity:

```text
1. Re-read HEAD/index/worktree facts and validate proposal.
2. Materialise the intended index only when authorised.
3. Ask Git to write the resulting tree.
4. Ask Git to create and sign the commit object.
5. Ask Git to update the target ref with expected-old-OID validation.
6. Re-read and verify the resulting commit/signature.
7. Return the report in memory.
```

Steps 3–5 create intended Git durability, not helper scratch state. If the process dies after Git has created an unreachable tree or commit but before the ref update, Git may contain unreachable objects; that is normal Git object-store behaviour and is handled by Git's own reachability/garbage-collection model rather than a bespoke transaction journal. The next execution can inspect the ref and either report the expected commit or prepare afresh.

For users who select disk recovery, the durable store can retain enough facts to distinguish "ref definitely not changed", "expected ref now points to the exact commit", and "state requires inspection". Even there, Git's old-OID conditional update should be the authority for reference races.

### Avoid reproducing Git's database in memory

An `InMemoryGitAdapter` should therefore be explicitly rejected. It would require duplicating Git semantics and would weaken tests exactly where correctness matters most. The correct reusable seam is a `GitCommandRunner` concerned with launching the real executable, controlling environment/network boundaries and capturing bounded output. Most high-level tests should use actual temporary *repository fixtures*; the new "no temp files" requirement applies to the runtime skill's memory-mode state, not to maintainers' disposable test fixtures.

This distinction also resolves the apparent conflict in the original review: filesystem-heavy tests are problematic when they assert private journal layouts, but real-repository integration tests are valuable when they establish real Git behaviour. The goal is to delete tests of obsolete internals, not to eliminate real Git from verification.

## Architecture enforcement with `dependency-cruiser`

Adopting `dependency-cruiser` is strongly justified. As of the research date, the selected stable release is `18.7.1`; its package metadata identifies that version, and its licence is MIT. citeturn167920view0turn167920view1 It directly supports custom forbidden/allowed/required dependency rules, validates its own configuration against its schema, and has first-class circular-dependency matching including restrictions over modules participating in a cycle. citeturn167920view2turn305201search4

This is a good REU-01 fit: it addresses both diagnosis and recurrence prevention, so there is no justification for writing a local AST/import graph analyser. fileciteturn0file1 The repository does not currently list `dependency-cruiser` among its development dependencies, so adoption would be new tooling rather than duplication of an existing package. citeturn255582view1 Its exact selected release and transitive dependency graph should be locked through the existing package lock; licence adoption still requires the repository's normal LIC-01 owner decision even though the upstream licence is MIT. fileciteturn0file1

The key design point is to test **architectural invariants**, not snapshot the complete dependency graph. A full graph snapshot would make harmless refactors fail CI and become another shallow implementation contract. The CI rules should instead state the properties whose violation caused the present failure:

```javascript
// Illustrative shape, not complete production configuration.
forbidden: [
  {
    name: "no-circular-committing-to-git-dependencies",
    severity: "error",
    from: { path: "^src/committing-to-git/" },
    to: { circular: true }
  },
  {
    name: "application-does-not-depend-on-cli",
    severity: "error",
    from: { path: "^src/committing-to-git/(workflow|application)/" },
    to: { path: "^src/committing-to-git/cli/" }
  },
  {
    name: "domain-does-not-depend-on-state-adapters",
    severity: "error",
    from: { path: "^src/committing-to-git/(message|checks|snapshot|report)/" },
    to: { path: "^src/committing-to-git/state/(memory|directory)/" }
  },
  {
    name: "state-store-does-not-import-domain-workflows",
    severity: "error",
    from: { path: "^src/committing-to-git/state/" },
    to: { path: "^src/committing-to-git/(workflow|message|checks|report)/" }
  }
]
```

The final directory names must be reassessed during design under NAM-01 rather than copied blindly from this illustrative configuration. fileciteturn0file1

The desired dependency direction is:

```text
cli / host adapters
        |
        v
application operations
        |
        +-----------> domain policies
        |
        +-----------> GitCommandRunner port
        |
        `-----------> WorkflowStateStore port
                           ^
                           |
             +-------------+--------------+
             |                            |
      memory adapter                directory adapter
```

No arrow returns from application/domain to CLI. No domain module imports a concrete state backend. No durable recovery module reaches back into message/report internals; recovery becomes an application operation over the disk store and Git.

The rollout of the rule should not institutionalise existing cycles as permanent exceptions. If one all-encompassing `no-circular` error cannot become green in the first slice, use a **temporary, explicit migration baseline owned by the implementation issue**, not a vague allow-list. Every subsequent slice must reduce that baseline, and the migration is complete only when it is empty and the unconditional cycle rule is enabled. This is not a compatibility shim, but it is still technical debt and should carry a removal criterion.

Graph generation is useful as an inspection artefact, not an acceptance oracle. CI should fail on invariant violations; a generated DOT/SVG/JSON graph can be retained in CI evidence to make failures intelligible, but the exact node/edge set should not be asserted.

## Detailed implementation plan

The attached planning skill asks for vertical, independently demonstrable slices with explicit requirements, proof, migration, observability, rollback and replanning conditions rather than horizontal "refactor all modules, then test" batches. fileciteturn0file2 The identifiers below therefore form a **draft change baseline** for owner acceptance before implementation.

### Draft requirements and decisions

| ID | Requirement / acceptance condition |
|---|---|
| **REQ-STATE-01** | Workflow state defaults to `memory` when no explicit configuration is supplied. |
| **AC-STATE-01A** | Memory-mode prepare/check/review/message operations create no files or directories in OS temp locations or elsewhere outside the repository. |
| **AC-STATE-01B** | Memory-mode preparation does not mutate the index, Git object store, refs or working tree. |
| **REQ-STATE-02** | An interrupted memory-mode operation requires no recovery artefact; the next invocation can safely start preparation again. |
| **AC-STATE-02A** | A proposal becomes stale if its relevant repository facts change and commit fails before mutation with a re-prepare diagnostic. |
| **REQ-STATE-03** | A task may opt into `disk` workflow-state persistence. |
| **AC-STATE-03A** | Disk mode without an explicit permitted directory fails; there is no OS-temp fallback. |
| **AC-STATE-03B** | Every disk-mode state artefact is created below the configured root by programmatic path derivation. |
| **AC-STATE-03C** | Traversal, absolute child paths, symlink/reparse escape and root substitution are rejected. |
| **REQ-API-01** | CLI concerns are outside application workflows; workflows take structured inputs and return structured results. |
| **REQ-ARCH-01** | `src/committing-to-git` has no module dependency cycles and architecture boundaries are enforced in CI. |
| **REQ-GIT-01** | Native supported Git facilities replace custom staging/object/reference functionality wherever they satisfy accepted semantics. |
| **REQ-GIT-02** | Real Git, not a simulated Git implementation, remains the behavioural authority in integration tests. |
| **REQ-DUR-01** | Durable recovery remains available only for explicit disk mode and is isolated from the default path. |
| **REQ-UX-01** | The primary agent protocol is reduced to declarative preparation, commit and optional publication; persistence mechanics are hidden. |
| **REQ-CLEAN-01** | Obsolete journals, packet files, temp-index machinery and tests are deleted once no accepted mode consumes them. |

The main draft decisions are: **DEC-STATE-01** memory is the default; **DEC-STATE-02** durable storage has no implicit temp-directory default; **DEC-STATE-03** agent prose does not become a filesystem-path parser; **DEC-GIT-01** real Git is the semantic oracle; **DEC-GIT-02** native Git transaction/reference primitives take precedence over local equivalents; and **DEC-ARCH-01** dependency-cruiser enforces architectural invariants.

### Foundation slice: executable architecture constraints

**SLICE-ARCH** introduces `dependency-cruiser` 18.7.1 as an exact lockfile resolution, records its MIT licence assessment, and adds one repository verification command covering `src/committing-to-git`. It first captures the current graph as diagnostic evidence, then installs rules for new cycles and the CLI/application direction. citeturn167920view0turn167920view1turn167920view2

The independently demonstrable outcome is that a fixture import from a workflow to `cli/` fails the architecture check and a deliberately circular pair fails it. The slice should not yet mechanically move half the repository merely to satisfy a graph shape; it establishes the guard that prevents further degradation while later slices remove existing violations.

Likely affected areas are `package.json`, `package-lock.json`, a repository-level dependency-cruiser configuration, verification scripts and focused architecture tests. The configuration should be named for architectural dependency policy, not generically `deps`, under NAM-01. fileciteturn0file1

Rollback is straightforward before later code depends on the policy: revert the dev dependency/configuration. After boundary remediation begins, however, removing the guard would be a regression, not a legitimate rollback strategy.

### Delivery-boundary slice: remove CLI ↔ workflow inversion

**SLICE-BOUNDARY** chooses one complete vertical path—preferably `prepare`—and splits its current exported command handler into a structured application operation plus a CLI adapter. Current `prepareWorkflow.js` imports CLI argument parsing and command execution, while the dispatcher imports it back; this slice breaks that loop for the first path. citeturn255582view5turn255582view6

The application signature should resemble:

```text
prepareCommit({
    repository,
    scope,
    reviewPolicy,
    signingPolicy,
    workflowState
}) -> PrepareResult
```

It must not receive `argv`, output streams or an exit code. The CLI owns argument parsing and result encoding. Existing protocol output can be preserved only where it remains an accepted external contract; no compatibility alias should be created merely to avoid coordinated caller updates unless there is an explicit NSH-01 override. fileciteturn0file1

Proof consists of application-level tests invoking the operation without CLI argument strings, CLI contract tests proving the same public command still maps correctly, and dependency-cruiser proving there is no application-to-CLI edge for the migrated path. Continue one workflow at a time until the rule can become unconditional.

### Ephemeral preparation slice: no writes at all

**SLICE-MEMORY-PREPARE** is the highest-value user-visible slice. It adds `workflowState.storage = memory` as the default and makes `prepare` execute entirely from repository reads plus process memory. It does **not** begin by implementing a general-purpose memory clone of the current transaction record.

This slice replaces current `createTransactionWorkspace()` allocation and draft-index/object creation with a read-only snapshot/proposal calculation. Current code proves both writes exist today. citeturn744792view3turn744792view4 Git-native inspection and `hash-object` without `-w` should supply identities where necessary, allowing Git's filters to remain authoritative without object writes. citeturn341265view0turn341265view1

The memory store initially needs only the state actually required within one running operation. For example, bounded check output, review chunks, generated message candidates and hashes can be normal JavaScript values. If a value is immediately returned to the caller, it need not be put into a "store" at all.

The decisive acceptance harness should:

```text
- create a disposable real Git repository;
- point TMP/TEMP/TMPDIR to a new empty sentinel directory;
- snapshot refs, index bytes, object inventory and working-tree status;
- run memory-mode prepare;
- assert the temp sentinel is still empty;
- assert refs/index/object inventory/working tree are unchanged;
- assert the returned proposal describes the expected change.
```

Run this on Windows and Linux because the reported unwanted path is Windows-specific and current code has platform-specific filesystem behaviour. The repository already has dedicated Linux verification infrastructure, but Windows should become explicit for the new no-temp contract because the current implementation's recovery logic distinguishes Windows rename/reparse behaviour. citeturn744792view2turn255582view2

### Approval-binding slice: restart instead of recovery

**SLICE-EPHEMERAL-PROPOSAL** replaces transaction handles, persisted review state and resume semantics in memory mode with a caller-held proposal and deterministic revalidation.

The proposal schema should contain only durable *facts about approval*, not internal workflow phase. The important anchors are full HEAD identity, scope definition, a digest of the reviewed intended snapshot and the approved message or message digest. The exact fields should be derived from existing safety invariants rather than copied wholesale from `transaction.json`.

Commit recomputes those facts from current repository state. If any approved invariant changed, it returns a single diagnostic whose remedy is "prepare again"; it does not attempt to repair or merge state. This is the explicit implementation of the user's desired failure model.

Tests should cover process termination between prepare and commit, deletion of all process memory, successful fresh re-preparation, HEAD movement, index change, working-tree change, rename/untracked-file changes and altered message bytes. In every stale case, the test must prove **no mutation preceded rejection**.

At this point `workflow resume` is no longer meaningful for memory mode. Its public handling should say that recovery is unavailable for ephemeral state and direct callers to prepare afresh. If the old command itself is no longer an accepted external contract, remove it rather than introduce an alias.

### Native commit slice: delete projected index and message-file dependence from the normal route

**SLICE-NATIVE-COMMIT** migrates one scope at a time to Git-owned commit semantics, beginning with `staged`, which is conceptually simplest because the intended tree already lives in the Git index.

For staged scope, the operation can validate the approved index/tree state, create the commit using native Git, and perform an expected-old-OID ref update. `git commit-tree` can consume the message over stdin, eliminating the need for a temporary message file. citeturn305201search2 `git update-ref` provides the native compare-and-swap and transaction facilities for safe ref movement. citeturn341265view5turn341265view6

For full scope, qualify direct `git add -A` at commit time followed by the same commit/ref flow. For path scope, preserve the current invariant that unrelated staged changes block the operation, then pass paths to Git with stdin/NUL pathspec handling instead of building a temporary projected index. citeturn744792view4turn341265view2

Every scope migration needs a differential test matrix comparing old accepted semantics and new Git-native semantics across tracked modifications, additions, deletions, renames, unusual filenames, attributes/clean filters, file-mode changes, empty changes, detached HEAD, unborn branches, SHA-1/SHA-256 repositories where supported, signing and hooks where the existing contract includes them. Any mismatch is a design decision, not an invitation to emulate old implementation quirks automatically.

Once all supported memory-mode scopes are native, delete memory-mode use of `indexInstallation.js`, projected temporary indexes, draft object directories and canonical message files. Do not leave dormant writes reachable through a "just in case" branch.

### Durable-store slice: isolate the remaining recovery requirement

**SLICE-DISK-STORE** then introduces `DirectoryWorkflowStateStore` for users who explicitly select `disk`. Doing this *after* the ephemeral path is proven prevents durable requirements from dictating the architecture of the default path.

The store constructor takes only the configured absolute root and deterministic platform/filesystem dependencies. It allocates attempts beneath that root and exposes logical artefact operations. No application module receives the physical attempt directory.

Existing useful durability code—atomic replace, `fsync` where applicable, symlink/reparse checks, bounded retry for documented Windows behaviour—can be moved into this adapter after its necessity is revalidated. Current modules contain those mechanisms today, so this is a relocation and reduction exercise rather than a greenfield rewrite. citeturn255582view2turn255582view3turn255582view4

A key test should set OS temp variables to a *forbidden* directory while configuring disk state elsewhere, run every durable operation, and prove that every created path is a descendant of the supplied root. Negative tests must attempt `..`, absolute paths, root replacement and symlink/reparse escapes. A filesystem write observation hook in tests should fail immediately on any path outside the configured state root plus the explicitly authorised Git repository paths.

This slice also renames concepts. `temporaryRoot` becomes `stateDirectory` or a more precise accepted equivalent. `attemptDirectory` may remain meaningful inside the directory adapter, but it should not leak into shared check/message/report schemas. A transaction record should identify its attempt by logical ID, not teach every domain object about a host pathname.

### Recovery slice: reduce rather than transplant the transaction engine

**SLICE-DURABLE-RECOVERY** maps the remaining durable guarantees onto the new state store and native Git outcomes. It should start from failure scenarios, not from today's transaction schema.

The minimum useful durable states are approximately:

```text
prepared, not committed
commit object known, ref not confirmed
ref confirmed at exact expected commit
publication attempted, result uncertain
terminal report
```

Whether each deserves persisted state must be justified by an actual recovery action. If a field cannot change recovery behaviour, it should not be in the durable schema.

Recovery should first interrogate Git. If the target ref equals the exact expected commit, the commit is complete. If it equals the expected old OID, the ref update did not take effect and the user can safely retry/re-prepare according to the stored state. If neither is true, the workflow reports a concurrent divergence rather than trying to "repair" history. `update-ref`'s expected-old semantics provide the underlying authority. citeturn341265view5

Canonical-message replacement recovery, index-installation recovery and report recovery should be deleted if the new design no longer has those independent mutation stages. The objective is a *smaller durable state machine*, not a one-for-one port of the current one.

### Review/check/report slice: remove filesystem artefacts from ordinary execution

**SLICE-EVIDENCE** removes persisted review queues, check transcript files and report files from memory mode. Review material is generated into bounded process buffers or streamed directly to the caller; check output uses a bounded head/tail/ring buffer plus hashes/byte counts where the current assurance model requires evidence; report data is returned in the final result instead of written to `report.json` and `report.txt`.

If output exceeds the bounded in-memory limit, the API should say so explicitly. It should not secretly spool to disk. A caller needing durable detailed transcripts can choose disk mode before starting the operation.

This is also the point to revisit the original review's criticism of cursor-based review packet machinery. If paging remains necessary, use stateless cursors bound to proposal/snapshot identity and regenerate each page. If evaluation shows the simpler interface can return sufficient bounded evidence without cursors, delete paging altogether.

### Interface-consolidation slice: make the skill deep

**SLICE-UX** rewrites the skill instructions around the three user concepts: prepare, commit, publish. Disk recovery is an optional advanced subsection. Transaction phase vocabulary, message slot mechanics, packet queues and internal evidence storage should disappear from the primary agent instructions.

The repository itself says a good skill should contain only instructions needed at activation time, progressively disclose detailed references and use scripts for deterministic work. citeturn744792view2 This redesign therefore aligns the implementation with the host skill philosophy rather than merely reducing source LOC.

Behavioural evaluation should compare the current and redesigned skills on representative commits and measure: successful completion rate, unnecessary command turns, token/instruction burden, accidental temp writes, stale-state detection, correct commit contents and correct refusal on ambiguous scope. A lower command count is useful only if outcome safety is preserved, per OUT-01. fileciteturn0file1

### Cleanup slice: remove superseded architecture

**SLICE-CLEANUP** is not optional polish. Once both modes are proven, delete dead state fields, obsolete schemas, old transaction phases, unused recovery functions, message replacement journals, packet persistence, projected-index code and tests that assert deleted private layouts. CLEAN-01 requires spent task artefacts to be removed while preserving genuine evidence. fileciteturn0file1

At this point dependency-cruiser's temporary migration baseline must be empty. The final rules become unconditional: no circular dependencies, no application-to-CLI imports and no domain-to-concrete-state-adapter imports.

The test suite should become smaller specifically because internal implementation tests disappear, not because behavioural guarantees are weakened. Retain high-value real-Git integration tests at the public application boundary and focused unit tests for pure policy, schema and storage containment.

## Verification, migration, and traceability

The implementation should be performed as a coordinated migration rather than a compatibility-shim programme. The supplied principles expressly prohibit introducing duplicate old/new entry points or silent compatibility bridges without a prior owner decision. fileciteturn0file1 Where an externally accepted command must remain, keep its contract and migrate its internals; where a command merely exposes obsolete transaction mechanics and has no accepted compatibility obligation, remove it with its consumers in the same slice.

The highest-risk unknown is not dependency-cruiser or the storage abstraction; it is whether every current scope/signing/check/publication invariant can be preserved while deleting temporary indexes and draft object stores. The cheapest discriminating experiments are therefore native-Git spikes run against disposable repositories, especially filtered files, unusual pathnames, selected untracked files, signing, hooks, detached/unborn HEADs and concurrent branch movement. `git hash-object --path` is particularly promising for no-write preparation because Git itself applies path-driven filters while writing no object unless `-w` is requested. citeturn341265view0turn341265view1

A second material unknown is whether publication recovery genuinely requires the same durable transaction object as commit recovery. That should be split conceptually. A successfully created local commit is already durable Git state; publication can record only the exact commit/ref destination information required for an uncertain push. The current repository explicitly treats publication as having durable recovery rules for uncertain transport outcomes, so this requirement should not be discarded without a dedicated behavioural decision. citeturn744792view0 It need not, however, force local commit preparation to be durable.

A third unknown is whether the project's Git 2.45 floor should move. Nothing in the recommended core design requires raising it merely to obtain `hash-object`, stdin pathspecs or expected-old ref updates; these are established Git facilities. The implementation should therefore stay compatible with the current supported floor unless a separately researched newer API offers a material simplification worth a runtime-requirement decision. citeturn744792view0

The resulting traceability matrix is:

| Slice | Requirement / decision | Principal proof | Release / cleanup implication |
|---|---|---|---|
| `SLICE-ARCH` | REQ-ARCH-01, DEC-ARCH-01 | Injected cycle/boundary violations fail CI | Dependency policy becomes permanent verification |
| `SLICE-BOUNDARY` | REQ-API-01 | Application prepare invoked without argv/stdout; no workflow→CLI edge | Enables independent application evolution |
| `SLICE-MEMORY-PREPARE` | REQ-STATE-01, AC-STATE-01A/B | Empty temp sentinel; unchanged index/objects/refs/worktree | Default can switch to memory once cross-platform proof passes |
| `SLICE-EPHEMERAL-PROPOSAL` | REQ-STATE-02 | Kill/restart and stale-proposal tests | Memory mode needs no resume/recover data |
| `SLICE-NATIVE-COMMIT` | REQ-GIT-01/02 | Differential real-Git scope/sign/signature tests | Remove projected/draft index and message temp files from memory path |
| `SLICE-DISK-STORE` | REQ-STATE-03 | Every observed state write is under configured root; escape tests | No `tmpdir()` fallback remains |
| `SLICE-DURABLE-RECOVERY` | REQ-DUR-01 | Fault injection around Git object/ref/publication boundaries | Delete obsolete journal stages as native Git replaces them |
| `SLICE-EVIDENCE` | AC-STATE-01A, REQ-CLEAN-01 | Review/check/report complete without file creation | Remove packet/transcript/report persistence in memory mode |
| `SLICE-UX` | REQ-UX-01 | Representative agent evaluations and protocol tests | Obsolete agent-facing transaction commands can be retired where uncontracted |
| `SLICE-CLEANUP` | REQ-ARCH-01, REQ-CLEAN-01 | Full verification; dependency baseline empty; dead-code/schema search clean | Final deletion of superseded transaction architecture |

Replanning is required if any of the following is established during implementation: a current accepted scope cannot be reproduced without a scratch Git index; a hook/signing requirement inherently needs a file-backed message under the supported Git version; a disk-recovery guarantee depends on an artefact proposed for deletion; a host requires a public command currently assumed internal; a Git 2.45 compatibility result differs materially from current Git; or dependency-cruiser cannot model an architectural invariant without unacceptable false positives. These are factual design boundaries, not reasons to preserve the existing implementation pre-emptively.

The rollback strategy should also differ by slice. Before the default switch, each new memory path can be exercised behind test-only/internal selection while disk remains current behaviour. Once memory mode satisfies its acceptance suite, making it the default is a configuration change and can be reverted if a production defect appears. But after old journal machinery is deleted, "rollback" means reverting the code revision, not supporting two indefinitely maintained implementations. That distinction avoids creating the sort of compatibility shim prohibited by NSH-01. fileciteturn0file1

The principal observability questions after release are deliberately simple: Did memory mode write any non-Git filesystem artefact? How often are proposals rejected as stale? How often do users explicitly choose disk recovery? How often is durable recovery actually invoked and what outcomes does it resolve? Do Git-native operations introduce scope or signing discrepancies? Those signals determine whether the residual durable implementation earns its complexity. They should not become another persisted telemetry subsystem unless the repository already has an approved observation path.

The overall architectural success criterion is consequently stronger than "the existing tests still pass": **the common commit path contains no durable workflow state, no implicit temp-directory use, no cross-layer dependency cycles, no custom substitute for Git semantics, and no requirement for an agent to understand internal transaction mechanics.** Disk recovery remains available as a consciously selected, directory-confined capability whose complexity cannot leak back into the normal path. This retains the valuable safety intent of the original implementation while removing the architectural condition that caused the review's findings in the first place. fileciteturn0file0 fileciteturn0file1 fileciteturn0file2