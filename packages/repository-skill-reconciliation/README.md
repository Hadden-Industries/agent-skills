# Repository skills

One independently deployed Python archive reconciles repository-local skills.
Each consumer maintains the archive, additional options in `repository-skills.json` and native remote declarations in `skills-lock.json`.
Agent applications, HISEW, sibling checkouts and per-consumer pip installs are unnecessary at runtime.
Python 3.10+ is the shared library floor; each repository retains its actual development runtime policy.

## Commands

```text
python tools/repository-skills.pyz print-config-schema
python tools/repository-skills.pyz check
python tools/repository-skills.pyz plan
python tools/repository-skills.pyz apply PLAN_ID
python tools/repository-skills.pyz recover PLAN_ID
```

`check` is offline/read-only and works without installed outputs.
`plan` resolves `skills@latest` once, stages actual bytes and returns the exact proposed diff and plan ID.
Review it before applying.
`apply` never reacquires; stale inputs or modified candidates fail.
`recover` restores an interrupted publication while preserving conflicting user edits.
Apply and recovery share a writer lock acquired before authoritative checks.
They are not globally atomic to other readers.

`print-config-schema` prints the canonical embedded Draft 7 JSON Schema directly to stdout, including descriptions and examples.
It needs no Git checkout, configuration, installed outputs or network.
It uses no result envelope, including with `--json`.
Editors and other tools can consume that export without a fourth maintained consumer file.
No schema URL, editor setting or runtime network validation is required.

Use `-C/--directory DIR` and `--json` before or after the subcommand.
`check`/`plan` accept `--config FILE`; default is root `repository-skills.json`. `plan --local-only` uses configured local source paths without npm/network acquisition.
It preserves remote lock bytes and does not synthesize native hashes for local skills.

## Additional repository options

```json
{
  "schemaVersion": 1,
  "targetAgents": ["codex", "antigravity", "claude-code"],
  "invocationPolicyOverrides": {
    "brooks-review": { "codex": "explicit-only" }
  }
}
```

Native lock entries alone select remote skills and supply their source and optional `ref` (branch, tag or commit).
Sources and pins are never repeated in the options file.
The first remote provider is GitHub; unsupported providers fail explicitly.
Optional `localSkillSources` maps canonical skill names to repository-contained `./relative/path` source directories.
Native locks can represent local sources; this tool deliberately keeps direct local copies outside that acquisition contract.
These declarations neither create native lock entries nor synthesize hashes.
Moving them into native lock authority would require a separate change to declaration, hash and local-only semantics.
A local/native name collision fails rather than overriding either declaration.
The existing source `SKILL.md` must declare the same name and a nonempty description; `check` and planning validate that identity before creating operation state.

```json
{
  "schemaVersion": 1,
  "targetAgents": ["codex", "claude-code"],
  "localSkillSources": {
    "team-conventions": "./skills/team-conventions"
  }
}
```

`invocationPolicyOverrides` references declared skill names and maps selected, supported agents to `explicit-only` or `implicit-allowed`.
Omission inherits source metadata on the next reconciliation; it does not retain a previously installed override.
An empty outer optional map is equivalent to omission; an empty per-skill override is rejected.
There is no static default invocation mode.
Codex maps the values to `policy.allow_implicit_invocation: false/true`.
Claude maps them to `disable-model-invocation: true/false` while preserving `user-invocable`; implicit eligibility does not enable a disabled manual route.
Explicit-only conflicts with `user-invocable: false` and is rejected.
Antigravity remains an installation target but has no supported invocation override.
Dangling skill references, unsupported or unselected targets, unknown/duplicate JSON keys and unsafe paths fail with configuration filename and field-path diagnostics.

`targetAgents` names logical agent applications, not exclusive filesystem consumers.
Codex and Antigravity share `.agents/skills`; Claude uses `.claude/skills`.
Selecting a target does not isolate outputs from other applications reading that tree.

The unreleased configuration contract retains `schemaVersion: 1` for this explicit pre-release revision.
The prior `agents`, `localSkills` and `invocationPolicies` fields are rejected without aliases.
Update each deployed archive and configuration together.
Saved plans bind both exact configuration bytes and the CLI digest, so changed plans must be regenerated; interrupted-publication recovery remains independent of current configuration.
Future breaking changes to a released contract require an explicit version decision.
This configuration version is independent of the CLI, native lock, result and operation-record versions.
The schema's `$schema` identifies its JSON Schema dialect; it is not an accepted instance field.
A `$id` would identify a published schema, but no such publication or URL is required here.

The two data files hold complementary information.
The lock owns remote selections, sources, optional refs and native acquisition metadata; the options file owns agent targets, invocation policies and optional local paths.
Neither duplicates the other's facts.
A floating ref does not guarantee exact replay.
Removing a native or local declaration stops management without pruning installed content.
Local-only plans preserve all remote lock bytes.
Generated skills preserve source metadata except requested policy and same-revision resource normalization.

Managed outputs must be ignored/untracked and free of links/reparse points and hardlinked files.
Existing native junctions are refused rather than silently replaced.
Generated candidate bytes, baselines and recovery records live in ignored `.agent-tools/skill-reconciliation/`.
Retain failed recovery state.
Normal external npm caches/temp are expected; this is ordinary developer-tool trust, not an OS sandbox against malicious dependencies.
No global configuration is changed.

Exit statuses: 0 success, 1 operational failure, 2 invalid input, 3 conflict/drift, 4 recovery required, 130 interrupted with safe repository state.
JSON results have `schemaVersion: 1`; diagnostics and native command chatter go to stderr.

## Build and verify

Use an external build workspace.
Native pip verifies the exact approved wheel hashes; no dependency source is vendored into consumer checkouts:

```text
python -m pip install --no-deps --require-hashes --only-binary=:all: --target BUILD_WORKSPACE/vendor -r packages/repository-skill-reconciliation/requirements.lock
python -B packages/repository-skill-reconciliation/build_archive.py --vendor BUILD_WORKSPACE/vendor
python -B packages/repository-skill-reconciliation/build_archive.py --check
python -B -m unittest discover -s packages/repository-skill-reconciliation/tests -v
```

Producer tests import bundled dependencies while exercising maintained source, then independently execute the deployed archive for conformance.
Consumers run the archive's offline `check`; they do not import a Python test interface.
Repository-specific runtime tests stay with each consumer's runtime tooling.
`npm test` includes that source suite and archive/source drift check through the existing test glob. Builds have deterministic ZIP metadata, embedded source/dependency identities and original licenses/notices.
Deploy the same reviewed archive independently; there is no automatic cross-repo upgrade.

Runtime wrappers remain only where they enforce a repository's genuine Python policy.
Bootstrap runners check declarations; skill publication always uses an explicit reviewed plan ID.
Configuration approval, commit and push retain their separate authorization requirements.
