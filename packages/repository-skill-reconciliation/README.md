# Repository skills

One independently deployed Python archive reconciles repository-local skills.
Each consumer maintains the archive, additional options in `repository-skills.json`
and native remote declarations in `skills-lock.json`. Agent applications, HISEW, sibling checkouts and per-consumer
pip installs are unnecessary at runtime. Python 3.10+ is the shared library floor;
each repository retains its actual development runtime policy.

## Commands

```text
python tools/repository-skills.pyz check
python tools/repository-skills.pyz plan
python tools/repository-skills.pyz apply PLAN_ID
python tools/repository-skills.pyz recover PLAN_ID
```

`check` is offline/read-only and works without installed outputs. `plan` resolves
`skills@latest` once, stages actual bytes and returns the exact proposed diff and
plan ID. Review it before applying. `apply` never reacquires; stale inputs or
modified candidates fail. `recover` restores an interrupted publication while
preserving conflicting user edits. Apply and recovery share a writer lock acquired
before authoritative checks. They are not globally atomic to other readers.

Use `-C/--directory DIR` and `--json` before or after the subcommand. `check`/`plan`
accept `--config FILE`; default is root `repository-skills.json`. `plan --local-only`
uses configured local source paths without npm/network acquisition. It preserves
remote lock bytes and does not synthesize native hashes for local skills.

## Additional repository options

```json
{
  "schemaVersion": 1,
  "agents": ["codex", "antigravity", "claude-code"],
  "invocationPolicies": {
    "brooks-review": {"codex": "explicit-only"}
  }
}
```

Native lock entries alone select remote skills and supply their source and optional
`ref` (branch, tag or commit). Sources and pins are never repeated in the options
file. The first remote provider is GitHub; unsupported providers fail explicitly.
Optional `localSkills` maps skill names to repository-contained `./relative/path`
sources, which native remote locks cannot describe. A local/native name collision
fails rather than overriding either declaration.

`invocationPolicies` references declared skill names and maps selected agents to
`explicit-only` or `implicit-allowed`; omission preserves upstream behavior.
Dangling policy references fail. Codex and Claude use their
different native fields. Unsupported Antigravity overrides and conflicting Claude
manual-invocation settings fail. Unknown/duplicate JSON keys and unsafe paths fail.

The two data files hold complementary information. The lock owns remote selections,
sources, optional refs and native acquisition metadata; the options file owns agent
targets, invocation policies and optional local paths. Neither duplicates the other's
facts. A floating ref does not guarantee exact replay. Removing a native or local
declaration stops management without pruning installed content. Local-only plans
preserve all remote lock bytes. Generated skills preserve source metadata except
requested policy and same-revision resource normalization.

Managed outputs must be ignored/untracked and free of links/reparse points and
hardlinked files. Existing native junctions are refused rather than silently
replaced. Generated candidate bytes, baselines and recovery records live in ignored
`.agent-tools/skill-reconciliation/`. Retain failed recovery state. Normal external
npm caches/temp are expected; this is ordinary developer-tool trust, not an OS
sandbox against malicious dependencies. No global configuration is changed.

Exit statuses: 0 success, 1 operational failure, 2 invalid input, 3 conflict/drift,
4 recovery required, 130 interrupted with safe repository state. JSON results have
`schemaVersion: 1`; diagnostics and native command chatter go to stderr.

## Build and verify

Use an external build workspace. Native pip verifies the exact approved wheel
hashes; no dependency source is vendored into consumer checkouts:

```text
python -m pip install --no-deps --require-hashes --only-binary=:all: --target BUILD_WORKSPACE/vendor -r packages/repository-skill-reconciliation/requirements.lock
python -B packages/repository-skill-reconciliation/build_archive.py --vendor BUILD_WORKSPACE/vendor
python -B packages/repository-skill-reconciliation/build_archive.py --check
python -B -m unittest discover -s packages/repository-skill-reconciliation/tests -v
```

Tests import bundled dependencies from the deployed archive while exercising the
maintained source. `npm test` includes that source suite and archive/source drift
check through the existing test glob. Builds have deterministic ZIP metadata,
embedded source/dependency identities and original licenses/notices. Deploy the
same reviewed archive independently; there is no automatic cross-repo upgrade.

Runtime wrappers remain only where they enforce a repository's genuine Python
policy. Bootstrap runners check declarations; skill publication always uses an
explicit reviewed plan ID. Configuration approval, commit and push retain their
separate authorization requirements.
