# Skill Build Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate repository validation from generated-artifact construction while preserving one stable repository build command and the current deployable skill layout.

**Architecture:** Directly deployable files remain canonical under `skills/`; `src/` remains optional for implementations that require transformation. Three focused Modules provide repository validation, artifact generation, and top-level orchestration, with scoped selection preserved throughout.

**Tech Stack:** Node.js 24+, ECMAScript modules, esbuild, Node test runner, ESLint, Prettier

**Spec:** `docs/2026-08-26-skill-build-architecture-design.md`

## Global Constraints

- Do not move directly deployable skill content from `skills/` to `src/`.
- Do not add dependencies or modify a lockfile.
- Preserve the behavior of `npm run verify`, `npm run verify:skill`, `npm run build`, and `npm run build:check`.
- Change only the approved `build` and `build:check` settings in `package.json`.
- Preserve selector isolation and no-selector full-repository behavior.
- Do not edit historical implementation plans to rewrite old repository facts.

---

### Task 1: Define the repository-validation Interface

**Files:**
- Create: `scripts/validateSkillRepository.js`
- Create: `tests/scripts/skill-repository-validation.test.mjs`
- Modify: `tests/scripts/build-skill-bundles.test.mjs`

**Interfaces:**
- Consumes: `selectCanonicalSkillNames(skillsRoot, skillNames)` from `scripts/skillSelector.js`
- Produces: `validateCanonicalSkillAscii()`, `validateRepositoryEvaluationLayout()`, and `validateSkillRepository()`

- [ ] **Step 1: Write failing validation Interface tests**

Add imports from `scripts/validateSkillRepository.js` and cover the existing ASCII, evaluation-manifest, maintainer-content, scoped-selection, and full-repository contracts. Add a composition assertion that `validateSkillRepository({ repositoryRoot, skillNames })` returns literal validation counts.

- [ ] **Step 2: Run the validation test and confirm RED**

Run: `node --test tests/scripts/skill-repository-validation.test.mjs`

Expected: FAIL because `scripts/validateSkillRepository.js` does not exist.

- [ ] **Step 3: Move the validation implementation**

Move the existing validation helpers and exports out of `scripts/buildSkillBundles.js`. Implement `validateSkillRepository()` by resolving `skills/` and `evals/` beneath `repositoryRoot`, invoking the two public validators, and returning their combined literal counts.

- [ ] **Step 4: Run the validation test and confirm GREEN**

Run: `node --test tests/scripts/skill-repository-validation.test.mjs`

Expected: PASS.

### Task 2: Define the generated-artifact Interface

**Files:**
- Create: `scripts/buildSkillArtifacts.js`
- Create: `tests/scripts/build-skill-artifacts.test.mjs`

**Interfaces:**
- Consumes: `selectCanonicalSkillNames()` for explicit selector validation and esbuild for the existing JavaScript transformation
- Produces: `buildSkillArtifacts({ checkOnly, repositoryRoot, skillNames })`

- [ ] **Step 1: Write failing artifact tests**

Cover full artifact currency, scoped exclusion of an unrelated artifact, a selected skill without an artifact, stale-output reporting, write mode, and the generated banner naming `scripts/buildSkillArtifacts.js`.

- [ ] **Step 2: Run the artifact test and confirm RED**

Run: `node --test tests/scripts/build-skill-artifacts.test.mjs`

Expected: FAIL because `scripts/buildSkillArtifacts.js` does not exist.

- [ ] **Step 3: Implement the artifact Module**

Create `generatedArtifacts` with the existing `committing-to-git` entry and output. Move bundle generation and stale-file comparison behind `buildSkillArtifacts()`. Return `{ artifactsChecked, staleArtifacts }`; do not introduce unused Adapter kinds.

- [ ] **Step 4: Run the artifact test and confirm GREEN**

Run: `node --test tests/scripts/build-skill-artifacts.test.mjs`

Expected: PASS after the committed generated banner is refreshed in Task 4; focused fixture tests that do not inspect the repository artifact must pass immediately.

### Task 3: Compose the repository build Interface

**Files:**
- Create: `scripts/buildRepository.js`
- Create: `tests/scripts/build-repository.test.mjs`
- Modify: `scripts/verifySkill.js`
- Modify: `tests/scripts/verify-skill.test.mjs`
- Delete: `scripts/buildSkillBundles.js`
- Delete: `tests/scripts/build-skill-bundles.test.mjs`

**Interfaces:**
- Consumes: `validateSkillRepository()` and `buildSkillArtifacts()`
- Produces: `buildRepository({ checkOnly, repositoryRoot, skillNames })` plus the `--check` CLI

- [ ] **Step 1: Write failing orchestration tests**

Assert the combined literal result for a controlled repository and assert that scoped verification still reports canonical ASCII, evaluation contract, and generated artifact stages for only the selected skill.

- [ ] **Step 2: Run orchestration and scoped tests and confirm RED**

Run: `node --test tests/scripts/build-repository.test.mjs tests/scripts/verify-skill.test.mjs`

Expected: FAIL because the new repository build Interface and imports do not exist.

- [ ] **Step 3: Implement composition and migrate callers**

Implement `buildRepository()`, move the CLI there, migrate `verifySkill.js`, and remove the old bundle-specific Module after all live imports are gone. Preserve fail-fast behavior and selector propagation.

- [ ] **Step 4: Run orchestration and scoped tests and confirm GREEN**

Run: `node --test tests/scripts/build-repository.test.mjs tests/scripts/verify-skill.test.mjs`

Expected: PASS.

### Task 4: Migrate configuration, documentation, and generated output

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `skills/committing-to-git/scripts/commitWorkflow.mjs`

**Interfaces:**
- Consumes: `scripts/buildRepository.js` CLI
- Produces: unchanged package command names and an up-to-date generated executable

- [ ] **Step 1: Apply the approved package-script changes**

Set `build` to `node scripts/buildRepository.js` and set `build:check` to `npm run format:check && npm run lint && node scripts/buildRepository.js --check`.

- [ ] **Step 2: Update current repository documentation**

Document the three Modules, state that `skills/` is the canonical deployable tree, state that `src/` is optional transformation source, and replace live references to the old bundle-specific script. Leave historical plans unchanged.

- [ ] **Step 3: Regenerate the artifact**

Run: `node scripts/buildRepository.js`

Expected: the committed workflow bundle is regenerated with the new banner and no unrelated skill payload changes.

- [ ] **Step 4: Check generated currency**

Run: `node scripts/buildRepository.js --check`

Expected: PASS with no stale artifacts.

### Task 5: Verify and review

**Files:**
- Review every changed path in the final Git diff

**Interfaces:**
- Consumes: repository package commands
- Produces: completion evidence for the architectural refactor

- [ ] **Step 1: Run focused script tests**

Run: `node --test tests/scripts/skill-repository-validation.test.mjs tests/scripts/build-skill-artifacts.test.mjs tests/scripts/build-repository.test.mjs tests/scripts/verify-skill.test.mjs`

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run: `npm run verify`

Expected: PASS. If an external or environment-owned tool fails, record its exact failing stage and do not misrepresent the result.

- [ ] **Step 3: Review repository state**

Run `git status --short` and inspect the complete task diff. Confirm that `.codex/config.toml`, `skills-lock.json`, `.claude/`, and any other user-owned unrelated changes remain outside the task diff.

- [ ] **Step 4: Report without committing**

Summarize the Modules, compatibility result, tests, full verification evidence, and remaining unrelated workspace changes. Create a commit only after separate explicit authorization.
