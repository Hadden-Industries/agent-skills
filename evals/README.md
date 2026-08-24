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
evals/<name>/trigger-evals.json
                           should-trigger and should-not-trigger cases
```

Each evaluation suite name must match a canonical skill directory. Its `evals.json` must declare the same `skill_name`, and paths in each case's `files` array resolve relative to the suite directory. Evaluation-only programs that exercise shipped code resolve the repository root first and then address `skills/<name>/` explicitly; they do not rely on being nested beneath the skill.

## Shared manifest contract

`evals.json` is a JSON object with a matching `skill_name` and a non-empty
`evals` array. Each behavioral case has:

- a unique positive-integer `id`;
- non-empty `prompt` and `expected_output` strings;
- a `files` array with no duplicate entries;
- a non-empty `expectations` array containing unique, non-empty strings.

Use `expectations`, not the retired `assertions` field. File paths are relative
to the suite and must resolve to existing content without escaping directly or
through a symbolic link.

`trigger-evals.json` is a non-empty JSON array. Every entry contains exactly a
non-empty `query` string and a Boolean `should_trigger`. Queries must remain
unique after trimming and case normalization, and every suite includes at
least one should-trigger and one should-not-trigger case. Individual suites may
adopt stronger balance, count, coverage, or metadata rules in their own tools
and tests.

`npm run build`, `npm run build:check`, and therefore `npm run verify` enforce
this structure and the deployable/evaluation separation. The build rejects
maintainer content inside a deployable skill, orphaned or mismatched suites,
malformed behavioral or trigger manifests, invalid case identities, duplicate
content, missing or escaped fixtures, and one-sided trigger sets. These gates
establish mechanical validity only; each suite's README defines its behavioral,
semantic, grading, and evidence requirements.

See each suite's own `README.md` for its model matrix, grading rules, commands, evidence, and known limitations.
