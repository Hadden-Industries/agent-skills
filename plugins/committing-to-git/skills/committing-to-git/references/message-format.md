# Message Format

Read this reference when authoring a body or file inventory through either authoring route, or when an unusual repository message policy conflicts with the supported format. It is not required for a concise subject-only message.

## Canonical text

Every message is strict UTF-8 and ends in exactly one LF. It contains no CR, C0/C1 or Unicode format controls, invalid byte sequence, placeholder, or normalized substitute for the approved bytes. Before presenting any subject for approval, apply the supported skill message policy while authoring the first proposal: the description immediately after `: ` must begin with an uppercase Unicode cased letter; optional scope does not change this rule. Examples: valid: `fix: Tolerate unreachable imports`; valid: `fix(owl2vowl): Tolerate unreachable imports`; invalid: `fix: tolerate unreachable imports`; invalid: `fix(owl2vowl): tolerate unreachable imports`. The subject has at most 72 Unicode scalar values and no terminal period. Loaded repository type policy takes precedence. Checked or structured canonical text is approval-ready only after the helper returns `status: message-ready`; formatter errors before approval are private candidate corrections, not approval events. The direct transport-safe subject-only route instead validates those exact approved bytes inside its single commit transition.

A body is optional. Include only sections that add durable information, in this exact order, separated by one blank line:

1. `Rationale:` - shared reasons that are not obvious diff paraphrases.
2. `User Experience Changes:` - externally meaningful effects, including a truthful statement of no intended effect when that fact matters.
3. `File Changes:` - optional detailed paths or structured counted domains.

Narrative entries use two-space bullets (`  - `) with four-space continuations. Omit empty sections. Never force a body or `File Changes:` merely because many files changed. When the user requests a section, preserve it through finalization; do not silently remove it to escape a formatting error. Ask the user only when correcting the error requires a new semantic choice or would change user-supplied exact bytes.

Evidence depth and presentation depth are independent. A packet-reviewed change may still use checked subject-only text after `workflow review-next` reports complete. Conversely, an already understood concise change may use `workflow extend --reason semantic-structure-required` when a requested or useful body needs deterministic rendering. That semantic extension cannot be replaced with checked concise text.

## Returned authoring contract

Treat `reviewRequired`, `reviewProgress`, and `nextAction` as the public state machine. If `reviewRequired` is false, do not call packet traversal merely because `reviewQueue` is null or a prior response mentioned review. `nextAction: author-message` identifies fixed `messagePath` for checked text. `nextAction: author-content` identifies fixed `contentPath` and includes `contentContract`; edit that transaction-local worksheet and no other path. A completed zero-packet review may be queried repeatedly without a cursor and returns the same semantic result without changing its receipt or snapshot anchors.

The version-1 `contentContract` describes schema-version-3 content. Set `authoringState` to `complete`. Set `subject` to an object with exactly `type`, `scope`, and `description`; `scope` may be null. Shared rationales and detailed file notes contain `selection` and `reasons`. User-experience entries are strings. Bulk domains contain `title`, `selection`, and `reasons`. A semantic selection uses `all`, `remaining`, `ids`, `destinationPaths`, `destinationPathPrefixes`, `sourcePaths`, `sourcePathPrefixes`, or `kinds`; `all` and `remaining` are each exclusive. Scope-file `includePaths` selects what enters a commit, while semantic `destinationPaths` assigns already selected change units to message content. Preserve helper-owned `schemaVersion`, `evidenceGroups`, and `mode` exactly.

The structured renderer supports `Rationale:`, `User Experience Changes:`, and `File Changes:` only. Resolve a requested unsupported section before approval. On structural failure, use `details[0].diagnostics.samples` and exact JSON pointers to correct independent problems together; `count`, `truncated`, and `sha256` describe the bounded result. The same diagnostic supplies `contentPath`, `contentContract` and literal recovery arguments. A null pointer explicitly marks an oversized omitted location, not a replacement path. Semantic coverage, overlap, and evidence errors follow only after the worksheet is structurally valid. JSON and `--format text` expose the same facts; see [diagnostics](diagnostics.md).

On `MESSAGE_REQUIRES_CHECKED_FILE`, preserve the requested multiline or nonportable text. Write exact UTF-8 bytes with one terminal LF to `details[0].messagePath`, then execute the supplied `message check` argument vector. For an extended transaction, follow the current authoring state: pending review must finish first, `author-message` uses the fixed checked input, and `author-content` uses structured finalization. Do not choose a finalizer from the route label alone.

## Detailed inventory

When a detailed body or `File Changes:` inventory is known before preparation, use `workflow prepare --message-format detailed` with the ordinary scope and evidence arguments. Preparation preserves that intent through interruption/resumption, returns required evidence or `nextAction: author-content`, and supplies a fresh `contentTemplate` plus `contentContract`. Copy the returned template to `contentPath`, fill its semantic fields and set `authoringState` to `complete`; preserve `schemaVersion`, `evidenceGroups` and `mode`. A template larger than 16 KiB is explicitly omitted: read the fixed `contentPath` once instead. Evidence routing is independent of format; finish all returned review packets first. The detailed size limit is checked before installing an actual index; a larger inventory requires the existing bulk route, not silently changed formatting.

For a body or inventory first requested after concise preparation, extend `route: concise`, `phase: evidence-ready` with `semantic-structure-required`. For an already-extended transaction, follow its authoring action without calling `workflow extend`: `author-message` permits full multi-section text at `messagePath` followed by `message check`; a null `contentPath` is expected. `author-content` requires `message finalize`. The fixed `content.json` is schema-version-3 semantic input only: the helper selects `mode` and supplies evidence groups, while review receipt and recommendation state remain in the transaction. A returned template is a fresh draft, not recovery of edits already written to the worksheet. The helper suppresses it unless the worksheet still has its original scaffold bytes; read and edit the existing worksheet in place when the template is null.

Detailed inventory is allowed only below 50 change units and only when complete exact path coverage fits within the 32 KiB projected presentation budget. `File Changes:` has no count. Sort reversible path identities by raw Git bytes. Render an ordinary path as `` `src/parser.js` ``, a rename as `` `old.js` -> `new.js` ``, and an unsafe identity as `` `path-bytes-base64:<base64>` ``. Let `w` be the decimal width of the final item count, from one through four digits. Each title begins with two base spaces, a right-aligned `w`-wide ordinal, `. `, then the path identity. Its notes begin with `w + 4` spaces plus `- `; continuations begin with `w + 6` spaces. Derive width from the final list, never an estimate. On `author-content`, supply semantics and membership in fixed `content.json`; the renderer owns layout and exhaustive coverage. On `author-message`, write canonical text using the examples below. A checked user-supplied exact message may be validated but never silently rewritten.

## Complete canonical examples

Each block is a complete message, ending with exactly one LF. Use the selected paths and supported claims from your transaction, not these illustrative identities. On `author-message`, write text at the returned `messagePath` and run `message check --transaction <opaque-transaction>`. On `author-content`, these show the final output shape; author semantic input in `contentPath` and run `message finalize` instead.

Subject only:

```text
fix(parser): Preserve quoted delimiters
```

Body without an inventory:

```text
fix(parser): Preserve quoted delimiters

Rationale:
  - Quoted delimiters belong to values rather than record boundaries.

User Experience Changes:
  - Imports preserve delimiter characters inside quoted fields.
```

Two selected paths, with five spaces before note bullets and seven before continuations:

```text
fix(parser): Preserve quoted delimiters

Rationale:
  - Quoted delimiters belong to values rather than record boundaries.

User Experience Changes:
  - Imports preserve delimiter characters inside quoted fields.

File Changes:
  1. `src/parser.js`
     - Keep quoted delimiters in field values while preserving the
       existing handling of unquoted separators.
  2. `tests/parser.test.js`
     - Cover quoted delimiters beside unquoted separators.
```

Ten selected paths: single-digit ordinals have three leading spaces, `10` has two; notes have six spaces before `- ` and continuations have eight. Every selected path appears once, in raw-byte order:

```text
fix(parser): Preserve quoted delimiters across import formats

Rationale:
  - Shared quote handling keeps each format consistent.

User Experience Changes:
  - Imports preserve quoted delimiters across supported formats.

File Changes:
   1. `src/csv.js`
      - Preserve quoted commas while retaining the existing rules for
        separators outside quoted values.
   2. `src/fields.js`
      - Keep quoted fields intact.
   3. `src/import.js`
      - Apply quote handling during import.
   4. `src/parser.js`
      - Track quoted field boundaries.
   5. `src/quotes.js`
      - Preserve escaped quote characters.
   6. `src/records.js`
      - Retain record boundaries outside quoted fields.
   7. `src/tsv.js`
      - Preserve quoted tab characters.
   8. `tests/csv.test.js`
      - Cover quoted commas.
   9. `tests/parser.test.js`
      - Cover quoted field boundaries.
  10. `tests/tsv.test.js`
      - Cover quoted tabs.
```

Wrap prose to at most 72 Unicode scalar values per line, counting indentation. Narrative continuations use four spaces; inventory continuations align with note text as above. Keep each path identity on one line, even when its title exceeds 72 characters. An indivisible token may also exceed the limit; ordinary prose that could wrap is rejected with `BODY_LINE_AVOIDABLY_OVERLONG`. The checker reports permitted presentation overruns rather than splitting identities. On `FILE_INVENTORY_FORMAT_INVALID`, check ordinal width, indentation, ordering, and exact selected-path coverage before submitting the same requested sections again.

## Structured bulk inventory

Use structured bulk when an inventory is included at 50 or more units, or when projected detailed output exceeds 32 KiB. Build semantic domains in fixed `content.json`; each change unit belongs to exactly one counted domain. Shared rationales may support several domains, but domain membership cannot overlap. The finalizer derives each title as `<domain> (<count> file|files)`, applies the same dynamic ordinal layout, and verifies exhaustive membership. Do not type counts by hand, question a previously selected scope, or use structured bulk as a substitute for missing evidence.

An existing `author-message` transaction cannot check a counted bulk inventory or extend into `author-content`. If a requested inventory exceeds the detailed limits in that state, report this unsupported authoring transition; retain the requested section rather than dropping it or repeatedly calling `workflow extend`.

The finalizer may request a bounded evidence delta when a new claim lacks coverage. Traverse only that delta through `workflow review-next`, preserve unchanged coverage, update the same fixed content input, and invoke `message finalize` again.
