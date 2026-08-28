# Handoff: make zero-packet structured-message authoring convergent

Date: 2026-08-28

## Purpose

Fix the state-machine and authoring-contract problems exposed when a concise,
fully covered transaction is extended only because the user wants a detailed
commit body.

This is a separate defect from the large-change-unit transport failure. The
incident involved only four ordinary changed files. Evidence was already
complete; no file needed another review. The difficulty came from an externally
ambiguous zero-packet state and an insufficiently discoverable `content.json`
contract.

## Real incident

The transaction selected exactly these four files in the `owlapi` repository:

```text
docs/implementation-plan.md
scripts/reference-import-map.mjs
scripts/reference-import-map.test.js
test/consumers/browser/import-map/reference-import-map.json
```

Preparation used:

```text
workflow prepare
  --mode actual
  --scope paths
  --evidence reuse
  --basis authored-current-task
  --path <each of the four paths>
  --allowed-type fix
```

The result was a concise `evidence-ready` transaction with four change units
and no unresolved evidence. The user wanted the already drafted rationale,
user-experience explanation, and change-per-file inventory, so the transaction
was extended with:

```text
workflow extend
  --transaction <transaction.json>
  --reason semantic-structure-required
```

The helper returned the following meaningful state:

```text
phase: review-pending
route: extended
reviewQueue: null
structuredMessageMode: detailed
```

Internally, the extension had correctly created a verified empty review
receipt because all four units were covered by the original
`authored-current-task` evidence. Externally, however, `review-pending` implied
that review work remained and no explicit next action or completed review
progress was returned.

Following the packet-review route produced:

```text
REVIEW_PACKETS_EMPTY: The current review has no packets to deliver.
```

The transaction was not corrupted, but the command classified an expected,
already-complete condition as invalid.

The generated schema-version-3 `content.json` contained only draft sentinels:

```json
{
  "schemaVersion": 3,
  "authoringState": "draft",
  "evidenceGroups": [
    {
      "selection": { "all": true },
      "policy": "reuse",
      "basis": { "kind": "authored-current-task", "note": null }
    }
  ],
  "subject": null,
  "sharedRationales": [],
  "userExperienceChanges": [],
  "mode": "detailed",
  "fileNotes": []
}
```

That scaffold did not reveal the writable shapes. Filling it from the skill
instructions and natural field-name guesses caused four successive failures:

1. `authoringState: "ready"` was rejected; the required terminal value was
   `"complete"`.
2. A canonical subject string was rejected with `Commit subject must be an
   object`; the required shape was `{ "type", "scope", "description" }`.
3. File-note entries using `notes` were rejected; the required member was
   `reasons`.
4. A selection using `includePaths` was rejected with `Unknown change selector
   field includePaths`; the semantic selector name was `destinationPaths`.

The last error is especially predictable because the public scope-file format
does use `includePaths`, while semantic message selections use a different
vocabulary. The agent eventually inspected helper source to discover the
accepted fields, contrary to the canonical skill's instruction not to inspect
helper source during normal operation.

After the correct shapes were discovered, `message finalize` succeeded and
the signed commit was created and published as
[`453e3fef808bd936ca8b91f96a619965f6aa588b`](https://github.com/Hadden-Industries/owlapi/commit/453e3fef808bd936ca8b91f96a619965f6aa588b).

There was also an approval-boundary problem. Prose had been approved before
the helper produced canonical structured bytes. The structured renderer owns
section selection, wrapping, and inventory formatting and does not currently
represent a separate `Verification:` section. The canonical result therefore
differed from the earlier prose and required another approval. Current skill
guidance says to finalize before approval, which is correct, but the helper and
tests should make that route easy enough that an agent does not pre-author and
pre-approve an unsupported shape.

## Current implementation evidence

Start with these files:

- [`src/committing-to-git/workflow/extendReviewWorkflow.js`](../../../src/committing-to-git/workflow/extendReviewWorkflow.js)
  - For zero required packets, it creates a valid verified receipt and stores
    `deliveryPacketIds: []`, `queue: null`, and `traversal: null`.
  - It nevertheless advances the transaction to phase and status
    `review-pending`.
  - `extensionResult()` exposes `reviewQueue` but no explicit
    `reviewRequired`, completed progress, or next action.
- [`src/committing-to-git/workflow/reviewNextWorkflow.js`](../../../src/committing-to-git/workflow/reviewNextWorkflow.js)
  - `deliverySelection()` throws `REVIEW_PACKETS_EMPTY` when the delivery set
    is empty, even when the transaction already contains the verified empty
    receipt.
- [`src/committing-to-git/message/commitMessageRenderer.js`](../../../src/committing-to-git/message/commitMessageRenderer.js)
  - `scaffoldContent()` writes `subject: null` and empty semantic arrays, so
    the fixed input is syntactically safe but not self-explanatory.
- [`src/committing-to-git/workflow/finalizeMessageWorkflow.js`](../../../src/committing-to-git/workflow/finalizeMessageWorkflow.js)
  and [`src/committing-to-git/message/changeSelection.js`](../../../src/committing-to-git/message/changeSelection.js)
  enforce the actual object shapes and selector vocabulary, generally one
  discovered error at a time.
- [`src/committing-to-git/schema/commitMessageContent.schema.json`](../../../src/committing-to-git/schema/commitMessageContent.schema.json)
  contains the machine-readable contract, but normal skill operation provides
  no supported bounded command that presents the relevant shape/example to the
  authoring agent.
- [`skills/committing-to-git/SKILL.md`](../../../skills/committing-to-git/SKILL.md)
  and [`skills/committing-to-git/references/message-format.md`](../../../skills/committing-to-git/references/message-format.md)
  direct the agent to fill semantic placeholders and avoid normal source
  inspection, but do not enumerate the required worksheet shapes.
- [`tests/committing-to-git/commit-workflow-cli.test.mjs`](../../../tests/committing-to-git/commit-workflow-cli.test.mjs)
  already has a test named `semantic structure extension rejects stray plan
  input and carries concise evidence without a queue`. It asserts the null
  queue and `review-pending` phase, but it does not test a discoverable next
  action, idempotent zero-packet review, first-attempt worksheet authoring, or
  end-to-end finalization.

## Root causes

### 1. Internal completion and external phase disagree

The transaction has a complete receipt, but its status says review is pending.
The only visible clue is `reviewQueue: null`. That forces the caller to infer a
state-machine transition from absence rather than consume an explicit contract.

### 2. An expected no-op is modelled as invalid

`review-next` treats zero packets as misuse. For a semantic-only extension,
zero packets are the success case: prior evidence is being reused exactly as
designed.

### 3. The fixed authoring input is not self-describing

The scaffold shows where to write but not what to write. The complete JSON
Schema exists only in repository source, while normal skill instructions tell
the agent not to inspect that source. Null and empty-array placeholders conceal
the subject object, rationale/file-note entry shape, accepted authoring-state
value, and selection vocabulary.

### 4. Validation is technically correct but operationally serial

Each invocation revealed one next contract fact. A deterministic local schema
should allow the helper to report all independent structural errors together,
with JSON pointers, expected shapes or enums, and allowed field names.

### 5. Scope selectors and semantic selectors are easy to confuse

`includePaths` is valid in a scope file; `destinationPaths` is valid in a
semantic selection. These concepts need not share a name, but the authoring
contract must make the distinction explicit at the point of use.

### 6. Canonicalization and approval were ordered incorrectly in practice

The intended policy is one approval of helper-produced `displayText`. The
workflow friction encouraged prose to be approved before structured
finalization, after which canonical section support and wrapping changed the
bytes. Guidance has been tightened, but the end-to-end interface needs a
regression that proves the first approval can occur after one successful
authoring pass.

## Required design properties

1. `workflow extend --reason semantic-structure-required` must explicitly
   report that evidence review is complete when no packets are required.
2. The result should expose a stable machine-readable next action, for example
   `nextAction: "author-content"`, plus completed review progress. Do not make
   callers infer the route from `null`.
3. Prefer a phase/status that describes semantic authoring rather than pending
   review. If backward compatibility requires retaining `review-pending`, then
   add unambiguous `reviewRequired: false`, `reviewProgress.complete: true`, and
   next-action fields and document the legacy name.
4. `workflow review-next` on a valid zero-packet transaction must be an
   idempotent success returning complete progress and the authoring next
   action. It must not remove or replace the valid empty receipt. Repeated
   calls should return the same semantic result.
5. A fresh agent using only the installed skill, returned helper data, and
   supported commands must be able to produce valid `content.json` on the
   first attempt. Source inspection must not be required.
6. Expose a bounded, versioned authoring contract. Reasonable implementations
   include:
   - a helper command that returns the transaction-specific schema and one
     valid minimal example;
   - a fixed transaction-local companion guide generated beside
     `content.json`; or
   - a bounded `contentContract` in the extension result containing allowed
     state values, subject shape, entry shapes, and selector fields.
   Whichever design is chosen must remain within the existing serialized
   result budgets and must not accept arbitrary external paths.
7. Keep helper-owned bindings immutable. Do not ask the agent to rewrite
   evidence groups, message mode, review receipts, counts, or manifest IDs.
8. Structural validation should report all independent problems in one result
   where safe. Include exact JSON pointers and allowed values/fields. Semantic
   coverage errors may still be reported after structural validity.
9. Make the distinction between scope selection and semantic change selection
   explicit. Do not silently accept an ambiguous alias unless it has a
   deliberate versioning and canonicalization policy.
10. Produce canonical `displayText` before asking for exact message approval.
    If a requested section cannot be represented by the structured renderer,
    fail clearly before approval or add an explicitly designed representation;
    never silently drop it.
11. Preserve the existing security model: fixed transaction-local inputs,
    immutable manifest/review bindings, strict UTF-8, bounded reads, and no
    arbitrary content-path option.

## Recommended implementation sequence

1. Add an end-to-end failing test for the exact four-file, reuse-evidence,
   semantic-structure route.
2. Make zero-packet completion explicit in the extension result and state.
3. Make `review-next` idempotently successful for that state.
4. Add a supported, bounded way to discover the version-3 content contract.
5. Aggregate structural validation diagnostics.
6. Update the canonical skill and message-format reference to follow the
   helper's explicit next action rather than assume every extended transaction
   has packets.
7. Add an evaluation in which a fresh agent must finalize a detailed four-file
   message without opening source or receiving corrective retries.
8. Verify one exact approval followed by commit creation; do not model approval
   as part of the helper.

## Regression and acceptance criteria

The fix is complete only when automated tests prove all of the following:

- Four current-task-authored files prepare through `reuse` with no unresolved
  evidence.
- Semantic extension returns zero packets, a valid complete receipt, explicit
  completed review progress, and an explicit authoring next action.
- Calling `review-next` with no cursor returns exit status 0 and complete
  progress rather than `REVIEW_PACKETS_EMPTY`.
- Repeating that call is idempotent and leaves the same receipt and snapshot
  anchors intact.
- The supported authoring contract shows:
  - `authoringState: "complete"`;
  - subject keys `type`, `scope`, and `description`;
  - `reasons` for rationale and file-note entries;
  - the accepted semantic selector keys, including `destinationPaths`; and
  - the distinction from scope-file `includePaths`.
- A fresh-agent/evaluation fixture fills the worksheet correctly on its first
  attempt without reading `src/`, the bundled script, or a raw review artifact.
- `message finalize` returns `message-ready` and one canonical `displayText`
  containing every requested supported section and all four changed files.
- Unsupported requested sections are rejected or explicitly handled before
  approval; none disappear during rendering.
- The exact displayed bytes can be approved once and committed without a
  schema-driven reapproval.
- Existing nonempty packet traversal, cursor replay, bounded delta review,
  detailed/bulk thresholds, and receipt validation remain green.

Also add focused validation tests that submit several independent malformed
fields together and assert that one bounded result identifies all of them with
actionable paths and allowed values.

## Out of scope

- Do not re-review the four source files; evidence is already complete.
- Do not weaken structured-message coverage or permit raw unvalidated commit
  bodies as a shortcut.
- Do not expose arbitrary filesystem paths for schemas or content input.
- Do not make source-code inspection part of user or agent guidance.
- Do not merge this with the large-change-unit transport fix; the incidents
  have different causes, fixtures, and acceptance criteria.

## Suggested skills

Call these skills for the implementation session:

- `diagnosing-bugs` to trace the zero-packet state across extension,
  traversal, receipt, and finalization.
- `test-driven-development` to encode the four-file regression and
  first-attempt authoring contract before changing behavior.
- `verification-before-completion` to prove both the zero-packet route and the
  existing nonempty packet routes remain correct.
- `committing-to-git` only after rebuilding the skill; use the fixed local
  implementation to commit its own change and record whether the route is now
  genuinely convergent.

## Completion handoff

Report:

- the new state/next-action contract for zero packets;
- whether `review-pending` was replaced or retained for compatibility;
- the supported way an agent discovers `content.json` shapes;
- an example aggregate structural validation result;
- the fresh-agent first-attempt evaluation result;
- proof that no helper source or raw queue artifact was read; and
- proof that one canonical approval was sufficient.

## Resolution

Implemented on 2026-08-28 as transaction schema version 4 with no version-3 migration or compatibility branch.

- Complete evidence now advances to `authoring-pending`; `review-pending` is reserved for an incomplete delivery round or a newly required evidence delta.
- Zero-packet `workflow review-next` is an idempotent success with `packet: null`, complete progress, and no transaction mutation.
- `reviewRequired` and `nextAction` are the public routing fields. Structured authors receive fixed `contentPath` plus a bounded version-1 `contentContract`; subject-only authors receive fixed `messagePath`.
- The contract enumerates the completion value, subject and entry shapes, helper-owned fields, supported sections, semantic selector vocabulary, and the deliberate `includePaths`/`destinationPaths` distinction.
- Structural finalization collects independent problems before semantic coverage, returns ordinary exact RFC 6901 pointers, allowed values or fields, a fixed sample, total count, truncation flag, and a digest of the complete ordered diagnostic stream.
- The deterministic four-file end-to-end regression authors from the returned contract on its first attempt, produces canonical `displayText`, and creates one signed commit from those exact bytes. It does not open helper source or raw review artifacts as workflow inputs.
- Evaluation ID 77 and its deterministic fixture cover fresh-agent first-pass behavior. Provider-backed evaluation was intentionally not run for this issue, as requested.

Focused transaction, schema, CLI, finalization, rendering, replay, fixture, and signed-commit tests passed during implementation. Repository-wide deterministic verification is the final pre-commit gate, with its result reported alongside the issue commit.
