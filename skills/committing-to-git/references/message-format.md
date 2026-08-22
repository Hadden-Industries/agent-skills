# Commit message format

Read this reference after scaffolding `content.json` and before authoring its semantic fields.

## Authorship boundary

The template is intentionally invalid while placeholders remain. Edit only semantic fields in `content.json`; the renderer owns Markdown, paths, change kinds, counts, ordering, numbering, indentation, and wrapping.

Supply information the inspected diff cannot establish. Every file or domain rationale must add at least one of:

1. the problem or failure prevented;
2. the user or developer outcome enabled;
3. the invariant, compatibility requirement, or risk addressed;
4. the selected tradeoff; or
5. the mechanism, but only when it explains one of the preceding points.

Ground every claim in the request, issue, warning, failing check, repository instruction, or inspected snapshot. Never invent business, security, performance, compatibility, or user-impact claims. Ask when a material reason is unknown; otherwise use the narrowest verified technical purpose.

## Tree facts and provenance

Generated headings describe normalized tree changes, not the commands or editing history that produced them. When an existing source remains and a new destination has similar or identical content, the destination is an addition and its heading contains only that destination path. Git content similarity cannot prove that the author copied, generated, templated, or adapted the file, so the workflow does not use copy detection for snapshot, inspection, or report facts.

One change unit is one normalized tree change. A detected rename counts once; binary units use unavailable line counts rather than fabricated zeroes; and submodules count as gitlink changes rather than their internal files.

When the request or inspected evidence establishes meaningful lineage, express it in the semantic rationale and connect it to an outcome or constraint:

```text
1. `src/parser/krss/lexer.js`
   - Reuse the established bounded-tokenization contracts while keeping
     KRSS dialect semantics independent from the DL parser
```

A detected rename may show source and destination because the source disappeared while the destination appeared. That comparison-time relationship does not assert that `git mv` or any particular filesystem command was used.

For a message-only revision of a completed version 1 attempt, the current renderer treats a legacy `copied` unit as a destination-only addition. Edit the grounded reasons in `content.json`, then rerender and revalidate against the existing manifest and completed ledger. Do not restage, repeat inspection, or hand-edit the generated message.

## Subject

Use `<type>: <description>` or `<type>(<scope>): <description>`.

- `type` is exactly one of `build`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, or `test`.
- `scope` is optional, concise, single-line, and free of parentheses.
- `description` begins with a capitalized imperative verb, targets about 50 characters when practical, never exceeds 72 characters, and has no final period.
- Name the problem prevented or outcome enabled before the mechanism.

The type whitelist, capitalization, and 72-character maximum are this skill's product policy, not requirements imposed by Git or the Conventional Commits specification. If repository policy requires incompatible types, trailers, footers, or casing, stop before staging as directed by `SKILL.md`.

## Body

Use optional `Rationale:`, optional `User Experience Changes:`, then required `File Changes:`. Use `Rationale:` only for a shared cause that would otherwise be repeated. Use `User Experience Changes:` only for observable end-user effects. The renderer wraps narrative lines at 72 characters except indivisible tokens.

Prefer:

```text
build(vite): Prevent native config loader warnings

File Changes:
1. `Dockerfile`
   - Keep container builds aligned with the renamed Vite config
2. `vite.config.mjs`
   - Declare the config as ESM to prevent Vite's native-loader warning
   - Replace CommonJS-only path handling so native loading succeeds
```

Avoid merely restating operations such as "Rename the file" or "Update the config" when the recorded diff already proves them.

## Detailed and bulk modes

The manifest change-unit count selects one mode:

- `1-49`: one detailed numbered entry per change unit; or
- `50` or more: a compact numbered list of semantic domains.

Keep the heading exactly `File Changes:` without a total count. Numbering is this skill's navigation aid, not an assertion about Git-wide practice.

In detailed mode, the renderer sorts raw Git path bytes, starts ordinals at column 1, right-aligns shorter ordinals to the widest ordinal, and derives nested indentation from that width.

In bulk mode, assign every change-unit ID to exactly one domain in `content.json`. A generated label such as `1. Parser and ingestion (24 files)` counts change units, so a rename counts once. Domain ordinals and nested reasons use the same width-derived alignment at any digit count.

Choose the fewest coherent domains that preserve distinct reasons or outcomes. Group by purpose, behavior, or architecture; do not group by directory or extension unless that boundary is semantically meaningful. Do not use `Other`, `Miscellaneous`, arbitrary alphabetical buckets, or fixed-size batches. Order domains by how a reviewer should understand the change.

Never propose shrinking or splitting the user's requested scope because bulk mode applies. Do not narrate hundreds or thousands of individual paths; the manifest and bounded inventory pages remain the exhaustive evidence.

## Validation results

Run the canonical validator with the manifest, semantic content, completed inspection ledger, and rendered message. Always read its emitted JSON.

- Exit `0` means no blocking error, not necessarily that review is complete. When `manualReviewRequired` is `true`, inspect every `review` issue before presenting the message and shorten divisible overlong text.
- Exit `1` is a structured negative result. Correct the named canonical or inspection problem, rerender after any semantic change, and validate again.
- Exit `2` is a command, input, Git, renderer, schema, or artifact failure.

The validator route without all three manifest arguments rereads mutable scope and is not transaction evidence.
