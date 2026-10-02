# Phase 2: Canonical source, generated distribution and portable EPUB path

Parent: [master plan](../2026-10-03-evaluation-modernization.md). Slice: SLICE-003. Ledger: KEEP-001 through KEEP-008, 017-019, 030-034. Decisions: DEC-001, 002, 006, 008, 011, 012.

## Entry and observable outcome

Use the frozen contracts and qualified consumer tooling from Phase 1. Obtain exact build/policy/dependency approvals before edits. The outcome is a complete conventional workspace assembled from the generated reading-epubs distribution, accepted by pinned consumers with honest coverage, while every current skill retains the same runtime payload and existing Hadden behavior.

Coordinate the source-path and portable-contract cutover for all live callers. This avoids temporary schema guessing, duplicated authored cases and old-path forwarding files. Subsequent suite phases change integration and decoupling, not the initial case/string migration.

## Predicted file changes

| Paths | Required change |
| --- | --- |
| `skills/<each-of-four-skills>/SKILL.md`, `references/**`, runtime `scripts/**`, runtime `assets/**` where present | Move canonical authorship to matching `src/<skill>` paths; regenerate committed `skills` from them. Do not reword instructions or normalize binary inputs as part of moving. |
| Existing `src/committing-to-git/**` | Keep module locations and transform entry. Register all observed build-only roots, including newer diagnostics/evidence/publication/selection. |
| `evals/<skill>/evals.json`, `trigger-evals.json`, README, fixtures and evaluator programs | Move current live inputs under `src/<skill>/evals`; keep common base in `evals.json`, sparse extensions in `extensions/v1/suite.json`, fixtures in `files`, suite-owned runtime programs in `assurance/v1` and analysis scripts in `analysis`. Historical result paths were handled separately. |
| `scripts/validateSkillRepository.js` | Validate canonical source projects and intended/generated payloads separately; switch the portable manifest rule from `expectations` to `assertions`; keep existing trigger/ASCII/no-wrap/path checks. |
| `scripts/buildSkillArtifacts.js`, `buildRepository.js` | Add closed copy/transform projection and exact output inventory; support missing outputs on first build; keep `--check` non-mutating and selected-skill isolation. |
| `scripts/buildPluginPackages.js`, generated `plugins/committing-to-git/**` | Continue consuming `skills`, correct canonical-source text via the generator, retain notices/host manifests/version policy. |
| `scripts/skillSelector.js`, `verifySkill.js`, `validateSkills.js`, `lintSkills.js` | Update source ownership and actual output selection without broadening scoped claims or removing distribution validation. |
| `scripts/evaluation/compile-suite.js`, `project-skill-up.js`, `consumer-workspace.js`, `profile-registry.js`, `schemas/*.schema.json` (new) | One join, strict extensions, source/distribution identity, field coverage, deterministic YAML and isolated workspace assembly. Registry selects trusted code, never data-supplied imports. |
| Current Git/defining/naming suite readers and their tests | Use the compiled portable/extension values and updated paths coherently. Preserve current preparation/execution/controller/grade behavior. Shared capability/conversation APIs remain explicit; do not leave a live old-spelling fallback. |
| `src/reading-epubs/evals/analysis/measure_conversion.py` | Resolve generated runtime paths from the new maintainer location while preserving measurement semantics. |
| Existing build/validation/scoped/plugin/archive tests; `tests/reading-epubs/**` | Preserve tests of installed outputs, source imports and independent fixtures. |
| `tests/scripts/evaluation-suite-compiler.test.mjs`, `evaluation-projection.test.mjs`, `skill-distribution.test.mjs` (new) | Losslessness, deterministic output, path/unknown-field failures, artifact inventory and no installed evaluation leakage. |
| README, `evals/README.md` -> `docs/evaluation-runtime.md`, current suite guides | Move the shared runtime guide outside the retired root eval tree and update all live links. Change authoring instructions only when the cutover is delivered; retain links to historical designs rather than rewriting history. |

## Contract migration rules

Preserve all IDs and gaps. Git next-unused ID is currently 78; retired IDs stay reserved. Rename expectation arrays to assertions mechanically without changing strings or order. Preserve expected output as separate judge context. Fixture-reference relocation changes only the locator; fixture bytes remain equal. Keep current critical indexes zero-based and test their mapping to displayed one-based labels.

The extension has two explicit sections. Protocol holds exact follow-ups and required capabilities. Assurance holds profile/fixture/cost keys, critical indexes, dimensions/strata/renderers, campaigns and exact compatibility interpretations. Apply the architecture's explicit property-disposition table, including the zero-based `critical_expectation_indexes` to `critical_assertion_indexes` rename. Retain notes verbatim in the suite README where they have no machine consumer; document any consumed note instead of discarding it. Every old property gets a reviewed destination or a demonstrated reason it was not an input.

The compiler validates duplicate/orphan IDs, unknown properties/versions, stale portable digests, fixture confinement, registered profiles, case-criticality bounds and retired/next IDs. Its immutable result carries portable and complete-case identities, fixture inventory and distribution provenance. Native JSON syntax and maintained duplicate-key/schema tools own parsing; local checks own semantic relationships. A missing field can never silently choose a provider or grant capability.

Build an expected runtime-file map before writing any output. Include license/notice resources referenced by the skill. Detect unknown categories, conflicting output paths, case collisions and linked inputs. Validate payload Markdown/resources before synchronization. Handle unexpected/local output edits through explicit disposition; do not implement a broad recursive purge. No-op builds must retain every byte and package version except an intentional changed publication file such as the README.

Assemble EPUB workspaces from the actual generated payload plus the portable cases and exact `sample.epub`. Use real native consumer validation and deterministic fake target/judge execution. agent-skills-eval's binary-skipped behavior is recorded as a conformance limitation; real Pandoc conversion remains the installed Python/Lua test surface. Consumer acceptance cannot replace it.

## Proof and falsifiers

Run existing build/static/scoped/plugin/archive tests and EPUB installed-script tests. After the proposed new tests exist:

```powershell
node --test tests/scripts/evaluation-suite-compiler.test.mjs tests/scripts/evaluation-projection.test.mjs tests/scripts/skill-distribution.test.mjs
```

Test all initial strings, follow-ups, assertion indexes and fixture hashes against independent pre-migration literals. Demonstrate byte-identical generation in two roots with the admitted toolchain, clean first build, stale/missing/extra-file detection and read-only check mode. Verify changing source affects only its intended output and package; a consumer must execute generated code rather than an undeclared source import.

Use the pinned skills installer in disposable destinations to inspect explicit `skills/<name>`, default repository discovery and full-depth behavior. Inspect plugin/archive contents independently. Do not install over the user's current skills or update a marketplace pin. Failure to select the intended copy blocks source/distribution cutover for that supported route.

Run existing suite tests after the coordinated reader migration, then `npm run verify`. Real behavior/trigger campaigns are not run in this phase. A Pandoc skip and an unsupported full conversation remain explicit evidence gaps.

## Recovery and exit

Keep the original inventory and complete path map until all live callers, distribution tests and installer consumers reconcile. A rollback is a reviewed reverse change, preserving generated payloads and evidence; do not restore user files or silently resurrect old locations. No provider behavior or existing source feature may be removed to make the coordinated move smaller.

Exit requires one canonical authored owner, complete exact runtime inventories, a meaningful EPUB consumer path, all four suites' authored semantics preserved, coherent live callers and passing existing behavior tests. Review any plugin version change as a published-byte consequence. Update ledger rows with actual evidence before an authorized per-file commit checkpoint.
