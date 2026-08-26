# Skill Build Architecture Design

**Status:** Approved for implementation on 2026-08-26.

## Goal

Make repository build responsibilities explicit without forcing directly deployable skill content through a redundant source-to-distribution copy stage.

## Source-of-truth model

- `skills/<skill-name>/` is the canonical deployable payload.
- Markdown, references, assets, Python, Lua, shell, and other files that already have their deployable form are authored directly under `skills/`.
- `src/<skill-name>/` is optional maintainer source for an implementation that must be transformed before publication.
- Every generated file under `skills/` has one explicit source-to-output definition and is checked for currency.
- Directly authored files have no generated-artifact definition.

## Modules and Interfaces

`scripts/validateSkillRepository.js` owns repository validation. Its public Interface is:

```js
validateCanonicalSkillAscii(skillsRoot, { skillNames } = {})
validateRepositoryEvaluationLayout({ skillsRoot, evaluationsRoot, skillNames })
validateSkillRepository({ repositoryRoot, skillNames })
```

`scripts/buildSkillArtifacts.js` owns generated artifacts. Its public Interface is:

```js
buildSkillArtifacts({ checkOnly = false, repositoryRoot, skillNames } = {})
```

The Module contains a `generatedArtifacts` registry. The only initial transformation is the existing esbuild generation of the `committing-to-git` executable. No no-op copy Adapter or speculative transformation kinds are introduced.

`scripts/buildRepository.js` is the top-level orchestration Module and CLI. Its public Interface is:

```js
buildRepository({ checkOnly = false, repositoryRoot, skillNames } = {})
```

It validates the selected repository scope, builds or checks the selected generated artifacts, and returns one combined result. The CLI accepts only the existing optional `--check` flag.

## Compatibility

- `npm run build` and `npm run build:check` retain their behavior but invoke `scripts/buildRepository.js`.
- `npm run verify` remains unchanged.
- `npm run verify:skill` retains its selector, isolation, stage reporting, and failure behavior while importing the new repository build Interface.
- Scoped selection continues to skip unrelated generated artifacts.
- Full-repository calls continue to validate every canonical skill and evaluation suite and check every generated artifact.
- The old `scripts/buildSkillBundles.js` Module is removed after all live callers migrate. Historical implementation plans remain unchanged because they describe earlier repository states.

## Testing

- Repository-validation behavior is tested through `validateSkillRepository.js`.
- Generated-artifact behavior is tested through `buildSkillArtifacts.js`.
- Composition and return-value behavior is tested through `buildRepository.js`.
- Scoped verification tests prove that the new Interface preserves target isolation.
- Tests are written and observed failing before production Modules are added or callers are migrated.

## Documentation

The README tree and build guidance describe `skills/` as the canonical deployable tree, `src/` as optional generated implementation source, and the generated-artifact registry as the explicit source-to-output map.
