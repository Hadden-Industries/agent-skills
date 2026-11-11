# Markdown quality

Run `npm ci --ignore-scripts` to install the root locked development dependencies.
The root manifest declares `@hadden-industries/markdown-quality` with the `>=3.0.0` minimum; the root lock freezes the core and matching optional Windows/Linux native packages.

## Choose a command

- **Check the repository** with `npm run check:markdown`.
  It reports findings without writing files or acquiring tools.
- **Explain file selection** with `npm run --silent inspect:markdown`.
  It prints tracked inventory decisions as JSON.
- **Apply formatting** with `npm run format:markdown`.
  It writes eligible formatting changes.
- **Verify the integration** with `npm run verify`.
  It runs the shared check and independent installed-consumer tests.

## Which files to edit

The root `.markdown-quality.json` contains only schema-3 ownership exclusions; the installed package supplies its `authored-gfm@2` defaults.
It selects all `.md` files unless explicitly excluded, including package documentation, canonical skill instructions and references.
Git inventory reconciles tracked paths; discovery also includes untracked Markdown files.

Historical plans, reviews, design/assurance records, evaluation inputs, evidence, generated skills/plugins and imported installations retain their original bytes.
Markdown selection does not read ignore files.
Edit source under `src/`, then use the repository build to regenerate distributions.
ASCII-only canonical instructions and source/generated correspondence remain separately enforced; the former custom one-prose-block-per-line validator is retired in favor of shared sentence layout.

## Check or preview one file

For a literal path, run `npm run check:markdown -- -- src/defining-concepts/SKILL.md`.
Use `npm run --silent check:markdown -- --json -- src/defining-concepts/SKILL.md` for one complete schema-5 result on stdout; human diagnostics use stderr.
Warnings are advisory by default; `--strict` makes warnings blocking.

Formatting needs exactly one repair mode: the `format:markdown` script supplies `--write`.
Preview with `npm exec -- markdown-quality format --dry-run --root . -- src/defining-concepts/SKILL.md`; do not append `--dry-run` to the write script.

Preview reports candidate byte counts and hashes without writing; a successful preview, repair or selected check does not establish complete repository cleanliness.
Use the complete `npm run check:markdown` verdict for that claim.
From another working directory, `npm --prefix <absolute-repository-root> run check:markdown` retains this repository's explicit root.

## Toolchain and verification scope

The tool's AGPL-3.0-only licence and native-component notices/source materials ship in the installed development packages.
They are not bundled into the MPL skill/plugin payloads.
The shared producer owns formatting, linting, selection, local-link checks, report validation, staging and resource observation.
This repository owns policy, npm dependency selection, domain ASCII/build checks and representative consumer assertions.

`.markdown-quality-execution.json` retains the existing 30-second execution ceiling using schema 2; other ordinary bounds use finite package defaults.
The shared `.development-runtimes.json` declares Python for independent evaluation and bootstrap consumers, plus uv for Python CI provisioning; `.node-version` selects the exact Node reference for repository workflows.
Markdown checks use the installed supported Node runtime.
CI installs and verifies the exact npm `packageManager` from [the root manifest](../package.json) before installing that lock.
Local npm only needs to support the selected Node runtime and locked tools; it has no separate repository-enforced floor.

The Markdown workflow installs the frozen root graph and runs the complete check plus installed-consumer tests on Windows and Linux.
Its three consumer checks use the root npm commands to verify authored selection, independently expected preserved records, skill metadata and literal bytes, read-only checking and native exit propagation.

Historical qualification records keep their original identities and evidence claims.

The Linux verification and conformance workflows share the Ubuntu release in [the runner policy](../.github/runner-policy.json).
After a policy edit, run `node scripts/ci/syncUbuntuRunners.js --write` to update the workflow selectors.
The workflow tests in `npm run verify` check for drift.
Conformance records the observed runner image and requires the expected GitHub job labels and a passing image check before reusing evidence.
