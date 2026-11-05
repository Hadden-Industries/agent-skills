# Third-party notices

Repository-authored source, documentation, and canonical skills use [MPL-2.0](LICENSE), subject to separately identified material below and notices accompanying individual components.
Third-party licences and copyright notices remain applicable when tools or generated packages are installed or redistributed.

## Code of Conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) adapts the [JSON Quality policy at commit 91a529a0cceb647397792770d6b45c67eb6b4aa7](https://github.com/Hadden-Industries/json-quality/blob/91a529a0cceb647397792770d6b45c67eb6b4aa7/CODE_OF_CONDUCT.md), itself adapted from Contributor Covenant 3.0.
The adaptation identifies Agent Skills and its MPL-2.0 code licence and records this source.
The policy text retains [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) terms, attribution, and the upstream reporting and moderation provisions.
This separate policy-text licence does not relicense the repository's code or skills.

## Bundled components

The generated `committing-to-git` plugin bundles `cross-spawn`, `isexe`, `path-key`, `shebang-command`, `shebang-regex`, and `which`.
Their licence texts accompany the package in [plugins/committing-to-git/notices](plugins/committing-to-git/notices).
The [plugin builder](scripts/buildPluginPackages.js) owns that inventory and copies the notices from the installed dependency graph.

The repository skill-reconciliation archive has its own [component notices](packages/repository-skill-reconciliation/THIRD_PARTY_NOTICES.md) and bundled distribution metadata.
Use those records for its Python dependency versions and redistribution terms.

## Development tools and imported skills

Markdown development tooling uses the separately licensed `@hadden-industries/markdown-quality` package under AGPL-3.0-only.
Its retained archives carry the component notices and source materials described in the [Markdown quality guide](docs/markdown-quality.md).
That development graph is separate from the MPL skill/plugin payloads.

Other development dependencies, external executables, and imported skills retain their upstream licences and notices.
The root and tool-specific lockfiles record installed dependency graphs; component packages carry their own licence texts.
Local imported installations under `.agents/skills/` and `.claude/skills/` are not repository-authored MPL skills.
These notices identify important component boundaries; they do not replace the licences and inventories accompanying a particular distributed artifact.
