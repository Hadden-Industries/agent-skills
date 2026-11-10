# Repository skills

Use `repository-skills.pyz` to check a repository's skill declarations, review the files it would install, and apply the changes you approve.

## Check, plan, and apply

Run these commands from the root of a Git checkout that contains `tools/repository-skills.pyz`, `repository-skills.json`, and `skills-lock.json`.
Use the repository's selected Python runtime.
The archive supports Python 3.10 and later and bundles its Python dependencies.

1. **Check the declarations.**
   This read-only check works offline, even before the skills are installed.

   ```text
   python tools/repository-skills.pyz check
   ```

2. **Plan and review the changes.**
   The command stages the exact files it would install and prints a diff and a plan ID.
   Review the diff before continuing.

   ```text
   python tools/repository-skills.pyz plan
   ```

   Plans with remote skills use Node.js and npm to resolve `skills@latest` once per plan.
   Use `plan --local-only` to stage only repository-local skills offline and preserve the native lock file byte for byte.

3. **Apply the reviewed plan.**
   Replace `PLAN_ID` with the ID printed by `plan`.
   A successful apply removes other saved plans and finished runs it found before publication.

   ```text
   python tools/repository-skills.pyz apply PLAN_ID
   ```

   The command publishes the saved files without downloading them again.
   If an input, installed output, or staged file has changed, create a fresh plan and review its diff.

New plan IDs are lowercase, hyphenated UUIDv4 strings.
If you update the archive or change the configuration, create and review a fresh plan before applying it.

## Recover an interrupted apply

If the tool reports `recovery-required` or asks you to recover an interrupted plan, use the plan ID in that message.

```text
python tools/repository-skills.pyz recover PLAN_ID
```

Recovery uses the journal to restore the affected paths to their state before the interrupted apply.
It works even if the configuration has changed.
Legacy compact UUIDv4 IDs still work for recovery.

Keep `.agent-tools/skill-reconciliation/` until recovery succeeds.
If the tool reports a changed link or a conflicting edit, it stops and preserves the affected files.
Inspect the path in the error before trying again.

## Configure skills

Each repository keeps two data files alongside the archive.

- **`skills-lock.json`** selects remote skills and records their source, optional `ref`, and native acquisition metadata.
  The tool supports GitHub sources.
  Use a commit for a fixed source revision, since branches and tags can move.
- **`repository-skills.json`** selects agent targets and optionally declares local sources and invocation policies.
  Keep remote sources and pins in the lock file.

```json
{
  "schemaVersion": 1,
  "targetAgents": ["codex", "claude-code"],
  "localSkillSources": {
    "team-conventions": "./skills/team-conventions"
  },
  "invocationPolicyOverrides": {
    "team-conventions": { "codex": "explicit-only" }
  }
}
```

### Select targets and sources

Set `schemaVersion` to `1` and select one or more `targetAgents` from `codex`, `antigravity`, and `claude-code`.

Use `localSkillSources` to map a skill name to a `./relative/path` inside the checkout.
Its `SKILL.md` must declare the same name and a nonempty description.
Give local and remote skills distinct names.

The tool copies local skills directly and reserves native lock entries and hashes for remote acquisition.
Removing a declaration stops management and leaves the installed files in place.

### Set invocation policy

Use `invocationPolicyOverrides` to choose `explicit-only` or `implicit-allowed` for a declared skill and a selected Codex or Claude Code target.

- **Codex** sets `policy.allow_implicit_invocation` to `false` for `explicit-only` and `true` for `implicit-allowed`.
- **Claude Code** sets `disable-model-invocation` to `true` for `explicit-only` and `false` for `implicit-allowed`.
  It preserves `user-invocable`.
  Choose `explicit-only` only when the skill permits manual invocation.

Omit an override to inherit the source metadata on the next apply.
An empty optional map is equivalent to omitting it.
Provide at least one agent policy when adding a per-skill override.

If validation points to a file and field, correct that field and run `check` again.

The pre-release configuration uses schema version 1.
The CLI, native lock, JSON results, and journals each have their own version.
For older configurations, replace `agents`, `localSkills`, and `invocationPolicies` with `targetAgents`, `localSkillSources`, and `invocationPolicyOverrides`.
Deploy the matching archive and configuration together.

## Where skills are installed

Codex and Antigravity share `.agents/skills/`.
Claude Code uses `.claude/skills/`.
Agent selection controls which installations the tool manages.
Applications that read a shared directory can see the same files.

An existing Claude skill junction or directory symlink can share the matching `.agents/skills/<name>` installation.
Select Claude Code and either Codex or Antigravity to use this layout.
The tool combines their metadata changes in the shared directory and keeps the link in place.

A fresh Claude-only installation uses a physical `.claude/skills/<name>` directory.
To switch an existing shared link to Claude-only, arrange an approved conversion to a physical directory first.
The tool uses the layout it finds.

Keep generated skill directories untracked and Git-ignored.
The matching Claude link is the supported exception to the ordinary directory layout.
The tool rejects linked parents, link chains, and links to external or unexpected targets.
It also rejects nested links, other reparse points, and hard-linked files.

Planning records the shared link's target and identity.
Apply and recovery check both and replace the physical directory.
The link can briefly be dangling during replacement.
Installed skills inherit source metadata and incorporate any requested invocation policies.
The tool normalizes shared resources from the same source revision.

## Saved plans and journals

Candidate files, fingerprints, and recovery journals live in the Git-ignored `.agent-tools/skill-reconciliation/` directory.
Apply and recovery take the same writer lock before checking the repository.
Other readers can see changes before the entire apply finishes.

After a successful apply, the tool keeps the applied plan's journal.
Rerun `apply` with that ID to verify the published result while the journal is retained.
Plans in preparation and interrupted publications keep their records.
Cleanup also recognizes older compact UUIDv4 IDs and reports removal failures as warnings.

Remote acquisition uses normal npm cache and temporary directories.
Run it with the same trust you grant other developer tools that fetch dependencies.

## Command options and exit codes

Pass `-C DIR` or `--directory DIR` to select a checkout.
Pass `--json` to receive one structured result on stdout with `schemaVersion: 1`.
Both options work before or after the subcommand.
Diagnostics and output from underlying tools go to stderr.

`check` and `plan` accept `--config FILE`.
The default is `repository-skills.json` at the root of the checkout.

| Exit code | Meaning                                                                                      |
| --------- | -------------------------------------------------------------------------------------------- |
| `0`       | Success. Read any cleanup warnings for files that still need attention.                      |
| `1`       | Operation failed. Check the diagnostic for the cause.                                        |
| `2`       | Invalid input. Correct the reported argument, file, or path.                                 |
| `3`       | Conflict or drift. Check the diagnostic and create a new plan if the reviewed state changed. |
| `4`       | Recovery required. [Recover the interrupted apply](#recover-an-interrupted-apply).           |
| `130`     | Interrupted before publication or after a safe restore.                                      |

### Export the configuration schema

```text
python tools/repository-skills.pyz print-config-schema
```

This command prints the embedded Draft 7 JSON Schema directly, including when you pass `--json`.
Use the output in an editor or validation tool.
The export works offline and outside a Git checkout.
To run it from another directory, pass the full path to the archive.

Keep the schema's `$schema` declaration in the schema document itself.

## Build and verify the archive

Run these commands from the producer checkout.
Replace `BUILD_WORKSPACE` with an external build directory.
Pip verifies the locked hashes before installing the wheels there.

```text
python -m pip install --no-deps --require-hashes --only-binary=:all: --target BUILD_WORKSPACE/vendor -r packages/repository-skill-reconciliation/requirements.lock
python -B packages/repository-skill-reconciliation/build_archive.py --vendor BUILD_WORKSPACE/vendor
python -B packages/repository-skill-reconciliation/build_archive.py --check
python -B -m unittest discover -s packages/repository-skill-reconciliation/tests -v
```

The build embeds the source and dependency identities, original licenses, and notices with deterministic ZIP metadata.
The test suite exercises both maintained source and the deployed archive.
`npm test` includes the suite and checks that the archive matches the source.

Deploy the same reviewed archive to each consumer checkout and run its offline `check`.
Keep runtime checks with the repository that owns the runtime policy.
Follow the repository's approval rules for configuration changes, commits, and pushes.
