# Handoff: add honest skill-scoped verification without weakening the repository gate

## Mission for the next session

Implement a deterministic verification command that can validate one explicitly named skill, beginning with `defining-concepts`, without building, validating, linting, or testing unrelated skills. Preserve the current repository-wide `npm run verify` behavior as the final integration gate.

The motivating question was: why should verification for a change to `defining-concepts` fail because an untouched skill is checked first? The answer is that the current command was deliberately designed as a whole-repository gate, but the repository lacks a separate, honest skill-scoped inner-loop command. Add that scoped command; do not weaken or duplicate the shared evaluation contract.

## Repository state at handoff

- Repository: the `agent-skills` workspace supplied to the next session (refer to it as `<repo>` in portable notes)
- Branch: `main`
- Observed HEAD and `origin/main`: `3e59e11`
- Date of investigation: 2026-08-26
- No repository files were edited while preparing this handoff.
- The working tree was already dirty and must be treated as user-owned:
  - modified `.codex/config.toml`
  - modified `skills-lock.json`
  - modified `skills/defining-concepts/SKILL.md`
  - untracked `.claude/`
- Do not restore, discard, stage, or include any of those paths merely to make verification pass.

## Existing design and why it checks everything

The root package script is currently:

```json
"verify": "npm run build:check && npm test && npm run skills:validate && npm run skills:lint && npm run diff:check"
```

See `package.json` and the explanation in `README.md` under "Run deterministic local verification" (around lines 1381-1391). The repository policy in `AGENTS.md` also requires `npm run verify` before completing changes to canonical skills, maintained source, related tests, or authoring/build scripts.

The five stages are repository-wide by construction:

| Stage             | Current scope                                                                                                                                              | Cross-skill coupling                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `build:check`     | Runs global Prettier and ESLint, validates every canonical `SKILL.md`, validates every suite under `evals/`, and checks every configured generated bundle. | A failure in an untouched skill, suite, source tree, or bundle prevents all later checks. |
| `npm test`        | Runs `node --test "tests/**/*.test.mjs"`.                                                                                                                  | Executes all skill-specific and shared tests.                                             |
| `skills:validate` | `validateSkills()` recursively discovers every canonical skill and invokes `skills-ref validate` once per skill.                                           | An unrelated invalid skill fails the command.                                             |
| `skills:lint`     | Invokes `tessl skill lint .` at the repository/plugin root.                                                                                                | This is intentionally a plugin-package check, not a bare-skill check.                     |
| `diff:check`      | Runs `git diff --check HEAD`.                                                                                                                              | Checks every current working-tree change, including unrelated user-owned edits.           |

Relevant implementations:

- `scripts/buildSkillBundles.js`
  - `validateRepositoryEvaluationLayout()` obtains all skill and suite names with `childDirectories()` and has no selector.
  - `validateCanonicalSkillAscii()` recursively finds every canonical `SKILL.md` and has no selector.
  - `buildSkillBundles({ checkOnly })` always validates the complete layout and all canonical skill files, then generates/checks every entry in `skillBundles`.
  - The only current generated bundle is for `committing-to-git`, declared near the top of the file.
  - The CLI recognizes only `--check`.
- `scripts/validateSkills.js`
  - `validateSkills()` calls `findCanonicalSkills()` and validates all results.
  - There is no CLI argument parsing or target selector.
- `scripts/lintSkills.js`
  - `lintSkills()` always calls Tessl with `skill lint .` from the repository root.
- `tests/scripts/build-skill-bundles.test.mjs`
  - Holds the repository-level behavioral/trigger manifest contract tests.
- `tests/scripts/repository-verification.test.mjs`
  - Proves that validation currently visits every canonical skill and that Tessl is invoked on the plugin root.

## Why the shared evaluation validator is correct and should remain shared

Commit `019b229` (`test(evals): Add defining-concepts evaluation suite`) deliberately centralized generic evaluation-manifest checks in `scripts/buildSkillBundles.js`. Inspect it with:

```powershell
git show 019b229
```

That commit moved generic checks out of `tests/committing-to-git/eval-fixtures.test.mjs` so every current and future suite receives the same contract:

- behavioral root and case shape;
- positive unique IDs;
- non-empty prompts and expected outputs;
- `expectations` rather than legacy `assertions`;
- non-empty, unique expectations;
- valid, unique, in-suite file references, including realpath escape protection;
- required trigger manifest;
- exact trigger fields and types;
- normalized trigger-query uniqueness;
- at least one should-trigger and one should-not-trigger case.

Do not copy those checks back into `tests/committing-to-git/eval-fixtures.test.mjs`, `tests/reading-epubs/eval-fixture.test.mjs`, or a new `defining-concepts` fixture test. The correct refactor is to let the shared validator accept an explicit skill/suite selector while retaining all-suite behavior when no selector is supplied.

The two existing per-skill fixture tests should continue to contain only domain-specific invariants:

- `tests/committing-to-git/eval-fixtures.test.mjs`
- `tests/reading-epubs/eval-fixture.test.mjs`

## Current reproducible evidence

### Whole-repository command

Command:

```powershell
npm run verify
```

Observed on 2026-08-26:

- Prettier passed.
- ESLint passed.
- The command then failed inside `buildSkillBundles.js` while esbuild checked the untouched `committing-to-git` bundle.
- Reported errors included an access-denied directory read and inability to resolve `src/committing-to-git/cli/commitWorkflow.js`.
- `rg --files src/committing-to-git` confirmed that this entry-point file exists.
- Because the chain is fail-fast, no Node tests, per-skill `skills-ref` validations, Tessl package lint, or diff check ran afterward.

This is not evidence that the `committing-to-git` source is defective; the immediate error is environment/access-related. It is evidence that a `defining-concepts` verification attempt is coupled to an unrelated bundle before its own relevant tests can complete.

### Checks that can already be scoped manually

The canonical target passed:

```powershell
.\.agent-tools\bin\skills-ref.cmd validate ".\skills\defining-concepts"
```

Result: exit 0, `Valid skill: skills\defining-concepts`.

The target-only ASCII diagnostic found no non-ASCII bytes:

```powershell
rg --text -n "[^\x00-\x7F]" "skills/defining-concepts/SKILL.md"
```

Result: exit 1 with no matches, which is the expected successful diagnostic outcome.

The two current `defining-concepts` deterministic test files passed together:

```powershell
node --test "tests/evals/defining-concepts-results.test.mjs" "tests/evals/run-evaluation-session.test.mjs"
```

Result: 14 tests passed, 0 failed, exit 0, approximately 54.9 seconds. The long case is the fake Codex App Server preparation test, not a live model evaluation.

### Tessl cannot simply be pointed at the bare skill

The local Tessl help says `tessl skill lint [<source>]`, but this command:

```powershell
.\.agent-tools\bin\tessl.cmd skill lint ".\skills\defining-concepts"
```

exited 1 because it found `SKILL.md` but no plugin manifest and therefore had no publishable plugin package to lint. It suggested `tessl review run`, but that is a quality/model review, not a deterministic substitute for plugin-package lint. Telemetry flushing also reported blocked network access, which is secondary to the manifest error.

Consequently, an honest scoped verifier should classify Tessl package lint as a global-only gate. It should not claim to have run an equivalent target-only Tessl lint, should not create a synthetic plugin merely to satisfy the command, and should not substitute a model-based review for deterministic validation.

## Recommended product behavior

Keep these two concepts explicit:

1. `npm run verify` remains the complete repository integration gate and retains its present semantics.
2. Add `npm run verify:skill -- --skill <canonical-skill-name>` as the focused developer/evaluation inner loop.

Recommended initial invocation:

```powershell
npm run verify:skill -- --skill defining-concepts
```

Why a separate command is preferable to changing `verify` now:

- it is additive and cannot silently weaken the gate required by `AGENTS.md`;
- CI and maintainers that rely on `npm run verify` keep the same behavior;
- scoped output can explicitly identify global-only checks that were not run;
- the command name makes its evidence boundary obvious;
- it requires only one small package-script addition rather than replacing the trusted chain with a new orchestrator for both modes.

Do not infer the selected skill from Git status or the current diff. This workspace can contain unrelated, user-owned, staged, unstaged, and untracked changes. Require exactly one explicit canonical skill name and reject missing, repeated, unknown, absolute, traversal, or separator-containing selectors. Never fall back to all skills after an invalid selector.

## Proposed implementation

### 1. Add a scoped orchestrator

Add `scripts/verifySkill.js`, with a small exported deep-module interface and a thin CLI:

```text
verifySkill({ repositoryRoot, skillName, run }) -> structured result
```

The CLI should accept exactly:

```text
--skill <canonical-skill-name>
```

Use dependency injection for process execution so unit tests can assert exact commands without launching repository tools. Return a structured summary listing passed stages and deliberately omitted global-only stages. A skipped global gate must never be reported as passed.

### 2. Make the shared validators target-aware

Extend the existing functions with an optional explicit selector while keeping their current no-selector behavior unchanged:

- `validateRepositoryEvaluationLayout({ skillsRoot, evaluationsRoot, skillNames })`
- `validateCanonicalSkillAscii(skillsRoot, { skillNames })`
- `buildSkillBundles({ checkOnly, skillNames })`
- `validateSkills({ repoRoot, skillNames, ... })`

Suggested selector semantics:

- `undefined`: preserve current all-repository behavior;
- a non-empty set/array: validate only those exact canonical names;
- unknown names: hard failure with a clear error;
- no path-like input: canonical names only;
- stable sorted execution order;
- a selected skill with no evaluation suite should preserve current policy and validate zero suites rather than inventing a new requirement;
- if a selected evaluation suite exists, run the complete shared behavioral and trigger contract against it;
- scan maintainer-only children only for selected canonical skills in scoped mode;
- in scoped mode, unrelated malformed suites must not be read or reported.

Add a `skillName` field to each `skillBundles` definition. In scoped mode, generate/check only matching bundle definitions. A valid selected skill with no configured bundle is a normal case. This is the change that prevents a `defining-concepts` check from invoking esbuild on `committing-to-git`.

### 3. Discover target tests by convention

The scoped command should discover tests from explicit, repository-owned conventions rather than maintain a central per-skill file map:

- `tests/<skill-name>/**/*.test.mjs`
- `tests/evals/<skill-name>/**/*.test.mjs`

Move the two current flat `defining-concepts` eval tests into a skill directory so they conform:

- `tests/evals/defining-concepts/results.test.mjs`
- `tests/evals/defining-concepts/run-evaluation-session.test.mjs`

The existing `committing-to-git` and `reading-epubs` tests already follow `tests/<skill-name>/...`.

Resolve discovered paths inside Node and pass explicit paths to `node --test`; do not rely on shell glob expansion, which differs across Windows and POSIX shells. Sort paths for deterministic ordering. A selected skill with no target tests should produce an explicit `0 tests discovered` result, not silently claim test coverage.

Shared tests such as `tests/scripts/build-skill-bundles.test.mjs` remain part of `npm run verify`. They need not run merely because a suite data file changed: scoped mode directly exercises the selected suite through the shared validator. If shared verification code itself changes, run its focused unit test while developing and the full repository gate before completion.

### 4. Scope whitespace checking to owned target paths

For the scoped command, run `git diff --check HEAD --` with only existing target-owned roots, such as:

- `skills/<skill-name>`
- `evals/<skill-name>`
- `src/<skill-name>` when present
- `tests/<skill-name>` when present
- `tests/evals/<skill-name>` when present

Do not include unrelated root lock/configuration files merely because they are dirty. Keep the full `git diff --check HEAD` in `npm run verify`.

### 5. Be explicit about global-only checks

The initial scoped command should report these as not run:

- repository-wide Prettier/ESLint checks outside target-owned maintained code;
- Tessl plugin-package lint;
- all unrelated Node tests;
- all-repository diff whitespace checking.

If target-owned JavaScript is linted/formatted, pass only explicit target paths already covered by the repository's existing formatting/lint policy. Do not broaden formatting to canonical `SKILL.md`, evaluation Markdown, Python, Lua, generated bundles, or lockfiles; `README.md` around line 1391 documents that those are intentionally outside Prettier's current scope.

Do not run `tessl review run` automatically. It is model-based semantic review, can require external access, and is not equivalent to deterministic lint.

### 6. Add the package entry only after exact configuration approval

`package.json` is a configuration file under this repository's `AGENTS.md` policy. Before editing it, obtain explicit approval for this exact setting and its impact:

```json
"verify:skill": "node scripts/verifySkill.js"
```

Impact: adds a non-mutating, explicitly scoped inner-loop command; does not change `npm run verify`, build, test, lint, CI, dependencies, or lockfile behavior.

Do not modify `AGENTS.md` unless the user separately approves the exact policy change. The recommended implementation does not require weakening its full-verification completion rule. No dependency addition should be necessary, so `package-lock.json` should not need a task-related change.

## Required tests, written first

Use TDD. Suggested new test file: `tests/scripts/verify-skill.test.mjs`.

At minimum, cover:

1. Missing `--skill` is rejected.
2. Repeated `--skill`, an unknown skill, traversal, separators, and absolute paths are rejected without running any check.
3. A valid target selects only its canonical skill, suite, bundle definitions, test paths, and diff pathspecs.
4. Scoped `defining-concepts` verification does not invoke the `committing-to-git` esbuild entry point.
5. An invalid selected suite fails with the existing shared contract message.
6. An invalid unrelated suite is ignored by scoped validation.
7. No-selector calls to refactored shared functions still validate all skills/suites and bundles.
8. A selected skill with no configured bundle does not fail.
9. A selected skill with no evaluation suite preserves current behavior and reports zero validated suites.
10. Test discovery is sorted, path-confined, and includes both supported conventions.
11. Zero discovered tests is reported explicitly.
12. Target `skills-ref validate` runs exactly once for the selected canonical path.
13. Tessl is reported as global-only/not run; it is not represented as passing.
14. Scoped `git diff --check` receives only the selected skill's existing path roots.
15. Any failed stage produces a nonzero exit and prevents a success summary.

Also extend:

- `tests/scripts/build-skill-bundles.test.mjs` for target selection and backward-compatible all-suite behavior;
- `tests/scripts/repository-verification.test.mjs` for selected `skills-ref` validation and unchanged all-skill behavior.

## Acceptance criteria

The implementation is complete only when all of the following are true:

- `npm run verify:skill -- --skill defining-concepts` exercises the target's canonical ASCII gate, shared evaluation-manifest contract, relevant configured bundle check (none currently), `skills-ref` validation, target tests, and target-only diff check.
- The scoped command does not read or validate `evals/committing-to-git`, `evals/reading-epubs`, their canonical skills, their tests, or the `committing-to-git` bundle.
- The command clearly lists global-only checks it did not run.
- The existing `npm run verify` still runs the complete five-stage repository gate.
- Existing domain-specific fixture tests remain domain-specific; generic manifest validation is not duplicated.
- The shared validators retain their current default all-repository behavior.
- Full semantic review of the final diff confirms no user-owned working-tree changes were absorbed.
- Focused tests pass.
- `npm run verify` is attempted before completion as required by `AGENTS.md`; if the existing unrelated environment/access failure recurs, report it precisely rather than misrepresenting the scoped result as a full pass.

## Suggested implementation order

1. Load the required skills listed below and inspect `AGENTS.md`, `package.json`, the shared validators, their tests, and commit `019b229`.
2. Confirm the exact package-script change with the user because configuration approval is mandatory.
3. Write failing selector/backward-compatibility tests for the shared validator functions.
4. Implement optional selectors in `buildSkillBundles.js` and `validateSkills.js` without changing no-selector behavior.
5. Write failing orchestrator tests.
6. Implement `scripts/verifySkill.js` with injected execution and structured reporting.
7. Move the two flat `defining-concepts` tests into the convention-based directory and update any documentation/references.
8. Add the approved `package.json` script.
9. Update `README.md`, `evals/README.md` if appropriate, and `evals/defining-concepts/README.md` to distinguish scoped iteration from full integration.
10. Run focused unit tests, then the new target command, then attempt the unchanged full `npm run verify`.
11. Review `git status` and the complete bounded diff. Do not commit unless separately requested and authorized.

## Relevant references instead of duplicated material

- `AGENTS.md`: configuration-safety rule and mandatory completion verification.
- `package.json`: current script chain.
- `README.md`, lines approximately 1379-1391: exact full-gate behavior and formatting scope.
- `evals/defining-concepts/README.md`, deterministic validation section around lines 475-493.
- `scripts/buildSkillBundles.js`: shared evaluation contract, ASCII gate, and bundle generation.
- `scripts/validateSkills.js`: all-skill `skills-ref` discovery and execution.
- `scripts/lintSkills.js`: plugin-root Tessl invocation.
- `tests/scripts/build-skill-bundles.test.mjs`: generic evaluation-layout tests.
- `tests/scripts/repository-verification.test.mjs`: repository tool invocation tests.
- `tests/committing-to-git/eval-fixtures.test.mjs`: `committing-to-git` domain-specific fixture invariants.
- `tests/reading-epubs/eval-fixture.test.mjs`: `reading-epubs` domain-specific fixture invariants.
- `tests/evals/defining-concepts-results.test.mjs`: current retained-result integrity tests.
- `tests/evals/run-evaluation-session.test.mjs`: current `defining-concepts` session/controller tests.
- Commit `019b229`: rationale and diff for centralizing the shared eval contract.

## Suggested skills

The next agent should load and follow these skills before implementation:

- `brainstorming` - required before changing verification behavior; use the recommendation above as the design baseline and challenge only concrete tradeoffs.
- `codebase-design` - define a deep, narrow selector/orchestrator interface and keep path discovery out of callers.
- `writing-plans` - the change spans CLI behavior, shared validators, test placement, configuration, and documentation.
- `test-driven-development` - write selector, isolation, and backward-compatibility failures before implementation.
- `verification-before-completion` - distinguish scoped evidence from the full repository gate and report the exact failing stage if full verification remains blocked.
- `committing-to-git` - only if the user later requests a commit, message revision, or push; commit and push each require their own authorization.
