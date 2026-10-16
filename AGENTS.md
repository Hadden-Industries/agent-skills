# Repository Instructions

## Configuration Safety

- NEVER create, modify, rename, or delete configuration files without the user's explicit approval for the exact change.
- Other approvals do not imply approval to change configuration.
- Configuration files include build, bundler, package, lockfile, lint, formatting, test, CI/CD, container, deployment, hosting, environment, and repository-policy files.
- Before requesting approval, identify the exact file and setting, explain the behavioral and pipeline impact, and propose the smallest change.
- If a task appears to require a configuration change, stop and request approval instead of inferring permission.

## Skill Authoring

- Edit repository-authored skill content in `src/<skill>/`.
  Run `npm run build` to generate the deployable `skills/<skill>/` directory and host packages; never edit generated or installed copies.
- Keep portable cases and fixtures in `src/<skill>/evals/`, protocol and assurance metadata in `evals/extensions/v1/suite.json`, and executable suite policy in `evals/assurance/v1/`.
  Read `docs/evaluation-runtime.md` before preparing or executing an evaluation.
  Build validation does not authorize a model call.

### ASCII-Only Canonical Skill Files

- Every repository-authored `SKILL.md` under `src/` and its generated copy under `skills/` MUST contain ASCII bytes only (`0x00` through `0x7F`).
  Use ASCII punctuation, straight quotes, and ASCII arrows or separators.
- This rule does not apply to imported or upstream skills installed under `.agents/skills/`, `.claude/skills/`, or another generated installation directory.
  Never modify imported skill content solely to make it ASCII-only.
- Both `npm run build` and `npm run build:check` MUST validate every canonical `src/**/SKILL.md` and existing generated `skills/**/SKILL.md` before bundling.
  The build fails with the file, line, column, and offending byte when non-ASCII content is present.
- `npm run verify` includes the ASCII gate through `npm run build:check`.
  Use `rg --text -n "[^\x00-\x7F]" src skills -g SKILL.md` only as a targeted diagnostic when the automated gate reports a violation; exit status 1 with no matches means the diagnostic found none.

### Completion Verification

- Markdown scope and rules live in `.markdown-quality.json`; see `docs/markdown-quality.md`.
  Install the locked toolchain with `npm run install:markdown`, edit canonical source, apply `npm run format:markdown` when needed, then rebuild generated skill/plugin outputs.
  Never format historical evidence or portable evaluation fixtures.

- During implementation, run focused tests for the changed behavior and affected checks at integration.
  Reserve the full completion gate below for the final candidate; it is not required after every edit or intermediate slice.
- Before code review, pass `npm run format:check` and `npm run lint` for the review candidate and resolve failures.
  Passing `npm run build:check` or `npm run verify` satisfies these prerequisites when the relevant inputs are unchanged.
  After a review fix, refresh affected evidence before another review.
- Before completing a change to a repository-authored skill under `skills/`, maintained skill source under `src/`, related tests, or repository authoring/build scripts, run `npm run verify`.
- A HISEW `full` profile run that executes the current `npm run verify` for the final candidate satisfies the same repository gate.
  Keep its evidence and complete the required native handoff; run the command again only when inputs changed, a check failed, or the engine requires a fresh invocation.
- Passing `npm run verify` establishes only deterministic local gates.
  It does not replace behavioral or trigger evaluation when applicable, cross-agent portability checks when applicable, or semantic review of `git status` and the complete diff.

## Git Guidance

### Local Workspace Commits & Pushing

- For commit-message drafts and commits outside the exception below, follow the `committing-to-git` skill; default to its per-file detailed template.

- **Explicit User Authorization**:
  - Development commits and incorporating disposable commits into development history require explicit user authorization.
  - **Disposable test and review repositories:** Repositories created and owned by this task solely for authorized testing or review, including actual candidate snapshots, qualify when working files and Git metadata/object storage are independent of development repositories, all writes stay within the disposable repository, and commits remain test artifacts or retained review evidence.
  - Verify eligibility.
    Linked worktrees and shared Git storage are excluded; temporary paths or detached HEAD alone prove nothing.
    An `origin` remote is allowed.
  - For qualifying repositories, staging task inputs, choosing concise messages and creating local commits have standing authorization.
    Use the test/review procedure or ordinary Git without further staging, message or commit confirmation.
  - Independently required signing, hooks, verification, evidence retention, configuration approval and higher-priority controls still apply.
  - Pushing requires separate explicit authorization; a push request does not authorize staging or committing uncommitted changes.

### Working Tree Safety

Treat all existing working-tree changes as user-owned and potentially valuable.

- Use the current working-tree contents as the authoritative starting point for ordinary file editing.
- Preserve all pre-existing modifications unless the user explicitly requests that they be changed or discarded.
- Treat any change you did not make as deliberate, including content that was present earlier in the session and is now absent.
  Never restore it, and do not assume a regression, a sync artefact, or a tooling bug; raise it and ask if it materially affects work in progress.
- Edit files directly using minimal, targeted changes.
- Never use `git checkout`, `git restore`, `git reset --hard`, or another Git restoration operation to undo edits made during the current task.
- To undo your own changes, reverse only the specific edits you introduced.
- Use Git primarily to inspect repository state and historical content (`git status`, `git diff`, `git show`) during ordinary editing.
- Execute operations that discard working-tree changes only when the user explicitly requests that destructive operation.

## GitHub Platform Guidance

- Avoid executing destructive Git operations (such as force-pushing to protected branches or deleting remote branches) without explicit, case-by-case approval.
