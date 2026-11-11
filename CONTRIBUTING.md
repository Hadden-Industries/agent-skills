# Contributing to Agent Skills

Issues, focused proposals, documentation, tests, and pull requests are welcome.
Use [support guidance](SUPPORT.md) to choose the right channel, report suspected vulnerabilities privately through [SECURITY.md](SECURITY.md), and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before starting

Search existing issues and discuss substantial behavior, compatibility, dependency, or evaluation changes before investing in a large implementation.
Explain the problem, intended outcome, affected skill or tool, and evidence that would demonstrate the improvement.

Read [AGENTS.md](AGENTS.md) for repository controls and the [README](README.md#for-developers) for the detailed development workflow.
Repository-policy, dependency, lockfile, build, test, and CI configuration changes require the maintainer's explicit approval for the exact change.

## Development setup

Use a stable Node.js version that meets the minimum in [package.json](package.json) and is supported by the locked authoring tools.
Local development can use the npm bundled with a compatible Node.js installation; the repository does not enforce a separate npm floor.
To reproduce CI, use the exact Node reference in [`.node-version`](.node-version) and the npm selection in [the root manifest](package.json).
The [bootstrap prerequisites](README.md#prerequisites) describe Python and the additional tools needed for complete skill verification.
For an existing development environment, install the committed root dependency graph with:

```sh
npm ci --ignore-scripts
```

The [bootstrap guide](README.md#bootstrap-the-repository) covers acquiring the additional authoring and evaluation tools.
Inspect its effects before running it: setup can download tools and regenerate local agent integrations.
Checks do not authorize tool acquisition, authentication, paid services, or model calls.

## Source and generated files

- Edit maintained skills and their executable source under `src/<skill>/`.
  Run `npm run build` to regenerate `skills/` and the host plugin packages; include the corresponding generated changes.
- Keep portable cases and fixtures in `src/<skill>/evals/`, protocol metadata in `evals/extensions/v1/suite.json`, and executable suite policy in `evals/assurance/v1/`.
  Read the [evaluation runtime guide](docs/evaluation-runtime.md) before preparing or executing evaluations.
- Keep repository-authored `src/**/SKILL.md` and generated `skills/**/SKILL.md` ASCII-only.
  Imported skills retain their upstream bytes and terms.
- Follow the [Markdown quality guide](docs/markdown-quality.md).
  Format selected maintained files when needed; preserve historical evidence and portable evaluation fixtures.
- Preserve existing working-tree changes and keep unrelated edits separate.
  Never edit installed copies under `.agents/skills/` or `.claude/skills/` as a substitute for changing canonical source.

## Verification and review

1. **While editing**, run focused tests for the behavior you changed.
   Run affected checks when you integrate the change.
2. **Before review**, run `npm run format:check` and `npm run lint`.
   Check maintained documentation with `npm run check:markdown`.
   A passing `npm run build:check` or `npm run verify` also satisfies the formatting and lint prerequisites for the same inputs.
3. **For the final candidate**, run `npm run verify` if you changed a skill, a related test, or the repository's authoring or build scripts.

Deterministic verification does not establish behavioral improvement, trigger accuracy, cross-agent portability, or real host activation.
Provide the applicable additional evidence for those claims.
Model-backed evaluations need separate explicit authorization for the actual execution; a build or static check is not that authorization.
Record commands, results, skipped checks, environment limitations, and remaining uncertainty honestly.

In a pull request, explain the user-visible result, compatibility and rights implications, and relevant validation.
Generated changes must be traceable to their maintained source and generator.
Commit and publication permissions are separate; follow the repository's Git guidance and maintained `committing-to-git` skill when an agent prepares a commit.

## Contribution licensing and provenance

Repository-authored source, documentation, and canonical skills use [MPL-2.0](LICENSE), except for material carrying its own licence notice.
Contributions intentionally submitted for inclusion must be available under the applicable file's licence.
Contributors retain their copyright and must have the authority to submit the material, including any required employer, client, or co-author permission.
Submission does not transfer copyright or grant additional relicensing rights.

Identify copied or adapted material and preserve its source, licence, copyright notices, and redistribution requirements.
The [third-party notices](THIRD-PARTY-NOTICES.md) distinguish the Code of Conduct, bundled components, development tools, and imported skills.

Generated or AI-assisted material remains subject to the same correctness, provenance, licensing, and sensitive-data requirements as other contributions.
Do not include credentials, private vulnerability reports, personal data, or material you are not entitled to redistribute in public issues, fixtures, or commits.
