# Maintainer evaluations

This tree contains repository-maintainer evidence and evaluation tooling. It is intentionally separate from the installable Agent Skills under `skills/`.

The primary installation path is the repository's `main` tree:

```text
npx skills add Hadden-Industries/agent-skills
```

The installer treats each complete `skills/<name>/` directory as that skill's deployable payload. Therefore fixtures, model prompts, retained results, grading notes, and evaluation-only programs belong under `evals/<name>/`, not inside the corresponding skill.

## Directory contract

```text
skills/<name>/             deployable skill
evals/<name>/              maintainer-only evaluation suite
evals/<name>/evals.json    behavioral cases for that skill
```

Each evaluation suite name must match a canonical skill directory. Its `evals.json` must declare the same `skill_name`, and paths in each case's `files` array resolve relative to the suite directory. Evaluation-only programs that exercise shipped code resolve the repository root first and then address `skills/<name>/` explicitly; they do not rely on being nested beneath the skill.

`npm run build`, `npm run build:check`, and therefore `npm run verify` enforce this separation. The build rejects `skills/<name>/evals` and `skills/<name>/.plugin-eval`, an orphaned top-level suite, a mismatched `skill_name`, or a missing/out-of-suite fixture reference.

See each suite's own `README.md` for its model matrix, grading rules, commands, evidence, and known limitations.
