# Message Format

Read this reference after the extended route requests structured authorship, or when an unusual repository message policy conflicts with the supported format. It is not required for a concise subject-only message.

## Canonical text

Every message is strict UTF-8 and ends in exactly one LF. It contains no CR, C0/C1 or Unicode format controls, invalid byte sequence, placeholder, or normalized substitute for the approved bytes. Before presenting any subject for approval, apply the supported skill message policy while authoring the first proposal: the description immediately after `: ` must begin with an uppercase Unicode cased letter; optional scope does not change this rule. Examples: valid: `fix: Tolerate unreachable imports`; valid: `fix(owl2vowl): Tolerate unreachable imports`; invalid: `fix: tolerate unreachable imports`; invalid: `fix(owl2vowl): tolerate unreachable imports`. The subject has at most 72 Unicode scalar values and no terminal period. Loaded repository type policy takes precedence. Checked or structured canonical text is approval-ready only after the helper returns `status: message-ready`; formatter errors before approval are private candidate corrections, not approval events. The direct transport-safe subject-only route instead validates those exact approved bytes inside its single commit transition.

A body is optional. Include only sections that add durable information, in this exact order, separated by one blank line:

1. `Rationale:` - shared reasons that are not obvious diff paraphrases.
2. `User Experience Changes:` - externally meaningful effects, including a truthful statement of no intended effect when that fact matters.
3. `File Changes:` - optional detailed paths or structured counted domains.

Narrative entries use two-space bullets (`  - `) with four-space continuations. Omit empty sections. Never force a body or `File Changes:` merely because many files changed. When the user requests a section, preserve it through finalization; do not silently remove it to escape a formatting error. Ask the user only when correcting the error requires a new semantic choice or would change user-supplied exact bytes.

Evidence depth and presentation depth are independent. A packet-reviewed change may still use checked subject-only text after `workflow review-next` reports complete. Conversely, an already understood concise change may use `workflow extend --reason semantic-structure-required` when a requested or useful body needs deterministic rendering. That semantic extension cannot be replaced with checked concise text.

## Detailed inventory

For an agent-authored message with body sections or any requested `File Changes:` inventory, enter the structured finalizer even when the prepared route was concise. Fixed `content.json` is schema-version-3 semantic input only: the helper has already selected `mode` and supplied canonical evidence groups, while review receipt and recommendation state remain in the transaction. Change `authoringState`, fill the semantic placeholders, and do not add or delete helper fields merely to make finalization pass.

Detailed inventory is allowed only below 50 change units and only when complete exact path coverage fits within the 32 KiB projected presentation budget. `File Changes:` has no count. Sort reversible path identities by raw Git bytes. Render an ordinary path as `` `src/parser.js` ``, a rename as `` `old.js` -> `new.js` ``, and an unsafe identity as `` `path-bytes-base64:<base64>` ``. Let `w` be the decimal width of the final item count, from one through four digits. Each title begins with two base spaces, a right-aligned `w`-wide ordinal, `. `, then the path identity. Its notes begin with `w + 4` spaces plus `- `; continuations begin with `w + 6` spaces. Derive width from the final list, never an estimate. Supply semantics and membership in fixed `content.json`; the renderer owns these mechanics and exhaustive coverage. A checked user-supplied exact message may be validated but never silently rewritten.

## Structured bulk inventory

Use structured bulk when an inventory is included at 50 or more units, or when projected detailed output exceeds 32 KiB. Build semantic domains in fixed `content.json`; each change unit belongs to exactly one counted domain. Shared rationales may support several domains, but domain membership cannot overlap. The finalizer derives each title as `<domain> (<count> file|files)`, applies the same dynamic ordinal layout, and verifies exhaustive membership. Do not type counts by hand, question a previously selected scope, or use structured bulk as a substitute for missing evidence.

The finalizer may request a bounded evidence delta when a new claim lacks coverage. Traverse only that delta through `workflow review-next`, preserve unchanged coverage, update the same fixed content input, and invoke `message finalize` again.
