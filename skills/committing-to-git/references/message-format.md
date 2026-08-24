# Message Format

Read this reference after the extended route requests structured authorship, or when an unusual repository message policy conflicts with the supported format. It is not required for a concise subject-only message.

## Canonical text

Every message is strict UTF-8 and ends in exactly one LF. It contains no CR, C0/C1 or Unicode format controls, invalid byte sequence, placeholder, or normalized substitute for the approved bytes. The subject is `<type>: <Capitalized outcome>` or `<type>(<scope>): <Capitalized outcome>`, has at most 72 Unicode scalar values, and has no terminal period. Loaded repository type policy takes precedence.

A body is optional. Include only sections that add durable information, in this exact order, separated by one blank line:

1. `Rationale:` - shared reasons that are not obvious diff paraphrases.
2. `User Experience Changes:` - externally meaningful effects, including a truthful statement of no intended effect when that fact matters.
3. `File Changes:` - optional detailed paths or structured counted domains.

Narrative entries use two-space bullets (`  - `) with four-space continuations. Omit empty sections. Never force a body or `File Changes:` merely because many files changed.

## Detailed inventory

Detailed inventory is allowed only below 50 change units and only when complete exact path coverage fits within the 32 KiB projected presentation budget. `File Changes:` has no count. Sort reversible path identities by raw Git bytes. Let `w` be the decimal width of the final item count, from one through four digits. Each title begins with two base spaces, a right-aligned `w`-wide ordinal, `. `, then the path identity. Its notes begin with `w + 4` spaces plus `- `; continuations begin with `w + 6` spaces. Derive width from the final list, never an estimate.

## Structured bulk inventory

Use structured bulk when an inventory is included at 50 or more units, or when projected detailed output exceeds 32 KiB. Build semantic domains in fixed `content.json`; each change unit belongs to exactly one counted domain. Shared rationales may support several domains, but domain membership cannot overlap. The finalizer derives each title as `<domain> (<count> file|files)`, applies the same dynamic ordinal layout, and verifies exhaustive membership. Do not type counts by hand, question a previously selected scope, or use structured bulk as a substitute for missing evidence.

The finalizer may request a bounded evidence delta when a new claim lacks coverage. Read only that delta, preserve unchanged hashes, update the same fixed content input, and invoke `message finalize` again.
