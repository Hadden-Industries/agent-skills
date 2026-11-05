# Markdown Quality root development dependency migration implementation plan

Status: proposed; not implemented.
Prepared 2026-11-05.

## Outcome and authority

Replace the retained Markdown Quality 1.0.3 development archives with a normal root npm development dependency, exactly `"@hadden-industries/markdown-quality": ">=3.0.0"`.
Use the root lockfile, installed public CLI and public SDK exports.
Assume the registry core and matching version 3 native packages are available; there is no release, publication, availability or adoption gate.
No 2.x bridge, Git dependency or persistent tarball fallback is proposed.

This document authorizes no implementation, configuration changes, installation, builds, tests, commits or pushes.
The root `AGENTS.md` requires explicit approval for exact configuration changes; present the per-path settings below for that approval before implementing them.
No nested `AGENTS.md` was found under `docs/` or `docs/plans/`.
The user is unavailable; unresolved choices are recorded with recommendations rather than questions.
Before any future commit, show detailed per-file messages and obtain separate explicit commit authorization; plan approval is not commit approval.

## Baseline and planning inputs

- Repository: `C:/Users/maksy/GitHub/agent-skills`.
- Inspected branch: `main`; HEAD `2d0203eb9d1291805baf8409e52de1712ab8a3bc`.
- Working tree was clean before this new document; preserve any later unrelated changes.
- Root package is private `@hadden-industries/agent-skills`, with Node `>=24` and npm `>=12.2.0` development requirements.
- Existing root `package-lock.json` already owns the repository development graph.
- Markdown tooling is currently a separate private graph under `tooling/markdown/` using local 1.0.3 core, Windows x64 and Linux x64 archives.
- Root verification already includes Markdown plus independent installed-consumer tests through `npm test`.

Refresh observation: HEAD is now `c343447204be35787a5fe8b12911311db5319dbd`; the only working-tree addition observed is this proposed plan.
The baseline observations above remain historical; recheck changed inputs before implementation.

The tested JSON Quality 3.0 reference is local signed commit `9c038b10e01da9ae2ff93d5a009205c92e7eb775` and its current `docs/markdown-quality.md`.
It uses root `>=3.0.0`, npm-owned core and both optional native lock entries, direct explicit-root scripts and `npm ci --ignore-scripts`.
Its Windows root check covered 43 Markdown documents with 12 advisory historical warnings; a disposable native-backed probe verified missing-mode exit 2, zero-write preview, predicted physical write, idempotence and external-cwd npm-prefix root selection.
That evidence does not establish this repository's acceptance or Linux native execution.
Commit `b54b426b60cf9db1a8248b8e57f68ffb13ae998f` remains the historical archive-removal precedent; its older 2.x floor and implicit writes are superseded.
Keep this repository's existing script names instead of importing unrelated JSON Quality script renames.

Upstream planning input is the actively edited `C:/Users/maksy/GitHub/markdown-quality` source candidate and chat `codex://threads/01a1aad3-14cf-78f2-8a37-ced8c85759fb`.
The inspected contracts are `src/cli-admission.js`, `src/quality.js`, `src/result-validation.js`, `src/execution-profile.js`, shipped schemas, `docs/consumer-guide.md` and `docs/migration-guide.md`.
Treat those as design evidence, not published or installed proof; never execute or change that other chat's mutable working tree.
For this refresh, the installed 3.0.0 public package at `C:/Users/maksy/GitHub/json-quality/node_modules/@hadden-industries/markdown-quality` supplies the current package exports, CLI admission, SDK, schemas and shipped guides.
Its shipped consumer guide still calls itself a source candidate; the installed manifest and owning contracts establish the inspected package version.
The future implementation must verify its own installed registry graph.

## Repository boundaries to preserve

Canonical authored skill content lives in `src/<skill>/`; `skills/` and `plugins/` are generated distributions.
Only the established repository build may regenerate distributions.
Canonical `src/**/SKILL.md` and generated `skills/**/SKILL.md` must remain ASCII-only; imported skills are outside that rule.
Markdown formatting must preserve YAML metadata, literal fenced commands and rendered hard breaks.
The build independently validates ASCII, distribution correspondence and plugin release identities.
A tooling-only migration normally needs no independent skill/plugin SemVer bump.
If repair of a canonical shipped skill actually changes published inputs, follow `docs/plugin-releases.md` and existing release-record rules for that separate interface change.
Do not manipulate release digests to conceal changed payloads.

Portable evaluation cases and fixtures under `src/*/evals/`, protocol metadata, assurance policy and historical evidence are semantically significant inputs.
Read `docs/evaluation-runtime.md` before evaluation preparation or execution.
Deterministic build or conformance verification does not authorize model calls.
This migration must not execute model evaluations, prepare provider sessions or reformat portable fixtures and retained records.
Preserve `evaluation-toolchain.json`, evaluation-specific acquisitions and evaluation runtime policy.

## Current consumer map and proposed actions

| Path                                                                                                                                              | Current role                                                                                               | Proposed action                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                                                                                                    | Root scripts delegate through `npm --prefix tooling/markdown`; explicit isolated installer and test script | Add exact root `>=3.0.0` devDependency; replace delegated commands with direct public bins; remove redundant isolated installer; retain meaningful consumer test selector    |
| `package-lock.json`                                                                                                                               | Existing root registry graph                                                                               | Refresh once coherently with manifest; let npm own matching optional native packages and integrity                                                                           |
| `tooling/markdown/package.json`                                                                                                                   | Archive dependency, explicit Windows/Linux optionalDependencies, registryUpgradeTarget and KaTeX override  | Delete after callers migrate; do not transplant its patch override without actual graph evidence                                                                             |
| `tooling/markdown/package-lock.json`                                                                                                              | Redundant archive graph                                                                                    | Delete after root graph and all live references migrate                                                                                                                      |
| `tooling/markdown/source.json`                                                                                                                    | Producer source/tree/lock/archive/workflow identity coupling                                               | Delete archive-specific authority after independent hosted qualification mapping is resolved                                                                                 |
| `tooling/markdown/archives/*.tgz`                                                                                                                 | Three retained 1.0.3 archives                                                                              | Remove all three after reference closure; no replacement archive folder                                                                                                      |
| `.markdown-quality.json`                                                                                                                          | Schema 2 policy, authored-gfm@1, broad exclusions and duplicated defaults                                  | Reduce to justified scope exclusions; use schema 3 only if a version marker is retained                                                                                      |
| `.markdown-quality-execution.json`                                                                                                                | Schema 1 finite qualification bounds and obsolete archive toolchain paths                                  | Translate ordinary finite execution bounds to schema 2; retain shared runtimes; remove archive block and qualification-only fields if no real receipt consumer requires them |
| `.markdown-quality-runtimes.json`                                                                                                                 | Shared exact Node/Python declarations                                                                      | Retain: Python is also read by evaluation and bootstrap consumers                                                                                                            |
| `tests/scripts/markdown-quality.test.mjs`                                                                                                         | Archive identity ceremony plus real inventory, ASCII, metadata, link and write safety assertions           | Remove archive-only assertions; migrate real SDK consumers and current report expectations                                                                                   |
| `.github/workflows/markdown-quality.yml`                                                                                                          | Trusted producer workflow pin and full immutable identities                                                | Inspect required-check/receipt consumers separately; default to root-install/check with preserved required context, retire archive-only controls                             |
| `.github/workflows/evaluation-conformance.yml`                                                                                                    | Root dependency installation and shared Python runtime reader                                              | Confirm root install provides MQ; preserve runtime projection and evaluation behavior                                                                                        |
| `.github/workflows/defining-concepts-linux.yml`                                                                                                   | Scoped skill verification and shared Python runtime reader                                                 | Preserve scope; update only actual Markdown install assumptions                                                                                                              |
| `.github/workflows/committing-to-git-linux.yml`                                                                                                   | Existing deterministic skill CI                                                                            | Inspect root installation and affected workflow assertions; no speculative evaluation expansion                                                                              |
| `tests/scripts/verification-workflows.test.mjs`                                                                                                   | Existing workflow contract tests                                                                           | Update only assertions invalidated by root installation; preserve trust/retention contracts                                                                                  |
| `README.md`, `CONTRIBUTING.md`                                                                                                                    | Authoring setup and verification instructions mention two graphs                                           | Replace isolated installation steps with root `npm ci --ignore-scripts`; retain root registry `>=` policy and authoring sequence                                             |
| `AGENTS.md`                                                                                                                                       | Completion instructions name policy and isolated install                                                   | Propose precise replacement install instruction and source/build boundaries; change only after exact approval                                                                |
| `docs/markdown-quality.md`                                                                                                                        | Local/SDK/policy/qualification/acquisition contract                                                        | Rewrite maintained guidance around root registry graph and 3.0 semantics; remove archive identity claims                                                                     |
| `docs/evaluation-toolchain-status.md`                                                                                                             | Maintained cross-tool status                                                                               | Update actual Markdown acquisition references only; keep evaluation qualification claims separate                                                                            |
| `scripts/_commands.py`, `scripts/evaluation/process-host.js`                                                                                      | Shared Python version readers                                                                              | Retain runtime source and semantics; no rename merely because filename contains Markdown                                                                                     |
| `tests/scripts/evaluation-tools.test.mjs`, `windows-assured-bridge.test.mjs`, `windows-job-host.contract.mjs`, `skill-up-invocation.contract.mjs` | Runtime declaration consumers                                                                              | Preserve existing independent runtime contracts; adjust only genuinely affected paths                                                                                        |
| `docs/plans/`, designs, reviews, assurance cases, research and evidence                                                                           | Historical design/evaluation records                                                                       | Preserve original bytes and claims; do not replace historical archive references globally                                                                                    |

Before edits, repeat a tracked-path reference inventory across scripts, workflows, SDK imports, schemas, notices, dependency analysis and test-impact metadata.
Classify every live hit and historical hit; require no active caller to point into the deleted tooling graph.
No maintained local result/comparison schema copy was identified in this bounded scan; verify import sites before deletion rather than assuming none can exist.
Do not introduce a wrapper, an integration framework or private package imports.

## Target commands and 3.0 interface translation

Proposed root script values retain current names:

```json
{
  "check:markdown": "markdown-quality check --root .",
  "format:markdown": "markdown-quality format --write --root .",
  "inspect:markdown": "markdown-quality inspect --root . --json",
  "test:markdown": "node --test tests/scripts/markdown-quality.test.mjs"
}
```

The diagnostic display option is unnecessary by default; if presentation filtering remains justified, spell it `--diagnostic-display-level warning`.
The old `--diagnostic-level warning` did not establish warning failure policy.
Full requests already reconcile tracked Markdown by default in a Git checkout.
Omit a forced inventory flag from the scripts so explicit file requests keep their narrower selection semantics; use explicit reconciliation only for a demonstrated separate inventory obligation.
Recommend ordinary default warning behavior and document `--strict` as the explicit blocking choice; confirm this decision before updating maintained claims.
Use npm's installed PATH; no hardcoded `.bin` path, `cd ../..`, auto-acquiring `npx` or archive lookup.
Remove `install:markdown` and update all callers; do not retain a second install alias without a demonstrated interface consumer.
For an exact-scope check: `npm run check:markdown -- -- src/defining-concepts/SKILL.md`.
For parseable operation JSON: `npm run --silent check:markdown -- --json -- src/defining-concepts/SKILL.md`; the first separator belongs to npm and the second introduces literal CLI paths.
Use `npm run --silent inspect:markdown` for configuration JSON; npm banners otherwise contaminate stdout.
The explicit roots preserve repository scope with `npm --prefix` from an external cwd; verify that behavior without relying on implicit discovery.
For preview from the repository root, use `npm exec -- markdown-quality format --dry-run --root . -- src/defining-concepts/SKILL.md`; do not append `--dry-run` to a script already carrying `--write`.

| Old interface                                       | 3.0 target                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Physical `format` with implicit writes              | Exactly one of `--write` or `--dry-run`, even for empty selections                                    |
| `--inventory git`                                   | `--reconcile-inventory git`; SDK option `reconciliationInventory: "git"`                              |
| `--diagnostic-level`                                | `--diagnostic-display-level`; human presentation only                                                 |
| `markdown-quality-qualify profile`                  | `markdown-quality inspect-profile --root . --json`                                                    |
| `markdown-quality-qualify candidate ...`            | `markdown-quality-qualify-git` with explicit qualification flags; not positional mechanical renaming  |
| Configuration/effective schema 2 and authored-gfm@1 | Schema 3 and authored-gfm@2, preferably defaults plus explicit exclusions                             |
| Old result shape, `written`, inventory arrays       | Result schema 5, `documentResults`, candidate identities, `writtenPaths` and reconciliation decisions |
| Schema 1 execution profile                          | Schema 2 with deliberate field translation                                                            |
| Old comparison expectations                         | Comparison schema 3; historical records retain their original version                                 |

`runQuality({ mode: "format", ... })` remains the public physical SDK writer; do not invent a required SDK `write` property.
`processLogicalDocument` is the public logical-content name in the inspected 3.0 source; migrate any old logical alias only at actual callers.
Whole-document `--json` is one complete result on stdout; findings and summaries are stderr.
`--quiet` affects presentation only; never use silence as a success oracle.
Contextual help and version discovery must remain inert.
Literal arguments after `--` are root-relative paths even from nested directories; `--files-json []` deliberately selects nothing.
The nearest verified Git root, then package root, then cwd defines the implicit root.
Raw UTF-8 `--stdin` requires `--stdin-filepath`; raw transforms emit source only and reject `--json` and physical repair flags.
Legacy JSON/base64 `--stdin-request` remains a distinct logical transport; no new editor integration is needed here.
A preview, repair or selected check is not a full repository acceptance receipt.

## Minimum policy and execution decisions

Start from package defaults, then preserve only repository-owned scope boundaries.
Do not copy old empty `lint`, default layout, default root-relative rejection or redundant local-link enablement.
The old `links.localFiles` key is obsolete; `links.checkLocalTargets` is the current spelling if a nondefault is justified.
Do not disable new default rules, add global unlimited resources or reintroduce authored-gfm@1 severities to make the check pass.

| Area                                                                                  | Recommendation and reason                                                                                                   |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `skills/**`, `plugins/**`                                                             | Retain exclusions: derived outputs are generated, not authored formatter inputs                                             |
| `src/*/evals/**`, `evidence/**`                                                       | Retain exclusions: portable prompts, fixtures and results preserve experimental meaning                                     |
| `.agents/**`, `.claude/**`, `.agent-tools/**`                                         | Retain only exclusions not already covered by hard package boundaries; imported/install content is not repository authoring |
| `docs/plans/**`, reviews, designs, assurance cases, research, dated records           | Retain historical exclusions with inventory justification; do not widen to all `docs/**`                                    |
| Maintained `README.md`, `AGENTS.md`, `src/**/SKILL.md`, references and current guides | Select and check; correct real link/layout/NFC defects narrowly                                                             |
| include `**/*.md`                                                                     | Prefer omitted default; replace literal-config tests with semantic inventory assertions                                     |
| Diagnostic budgets in root policy                                                     | Prefer package defaults unless observed authored scale requires a specific finite exception                                 |
| Execution profile                                                                     | Retain qualification bounds, translate units/semantics and verify supported analyzer keys                                   |

The translation below is a compatibility reference, not a requirement to retain every old override.
If archive-only qualification is retired, remove its sample/runtime/toolchain declarations; keep shared runtime files for their independent evaluation/bootstrap readers.
Use no execution profile when ordinary checks need no measured override, or retain only the necessary finite ordinary limits.

Translate `samples` to `requiredConsecutiveSamples` (6), `checkerMs` to `executionTimeoutMs` (30000), `windowMs` to `sampleTimeoutMs` (180000), `memoryBytes` to `maxObservedMemoryBytes` (1073741824), and `nodeOldSpaceMb` to `maxNodeOldGenerationMiB` (256).
Translate `requestBytes` to `maxRequestBytes` (8388608), `reportBytes` to `maxOutputBytes` (16777216), `stagingBytes` to `maxStagedDataBytes` (536870912), and `stagingEntries` to `maxStagedEntries` (100000).
Translate `limits` into supported `analyzerLimits` names, not a blind object rename; old `workerHeapMb` must not survive under an unsupported key.
Retain runtime references and exact qualified runtime declarations independently from the ordinary supported Node range.
Do not raise product/runtime engine requirements just because this dev tool requires Node >=22.13; the existing root >=24 already covers it.

The inspected execution schema still permits an optional archive-oriented `toolchain` block requiring archive fields when present.
Omit that obsolete block from ordinary execution; do not invent registry fields the public schema rejects.
Trusted Git qualification's current archive hash flags and pinned workflow require a separate explicit mapping to registry-backed trusted acquisition.
No concrete product consumer of Markdown qualification receipts was identified in the inspected maintained scripts; evaluation conformance receipts belong to a separate system.
Recommended default: keep the existing workflow entry/check context, replace archive qualification-only gating with root `npm ci --ignore-scripts` and read-only `npm run check:markdown`, and retire `qualify:markdown` plus archive-only manual inputs and receipt claims.
Before changing that boundary, inspect required-check settings and exact receipt readers; a proven consumer of trusted receipts changes only that bounded design choice, never root dependency adoption.
If such a consumer exists, map the exact workflow/profile/shared-qualification reader contract separately; do not invent a generic acquisition adapter or fake archive hashes.
Do not relabel local check success as hosted trusted qualification if this interface is not exercised.

## Coherent implementation slices

1. Reconfirm HEAD, clean baseline and user-owned changes; obtain exact configuration approval for the chosen paths/settings.
   Snapshot the reference map and record the existing historical exclusions without rewriting records.
   Confirm canonical skill changes are unnecessary for acquisition itself.
2. Add root `>=3.0.0`, switch direct scripts and migrate meaningful consumer imports/assertions together.
   Freeze the coherent manifest/script/configuration/SDK/caller batch before one npm-managed root refresh using `npm install --ignore-scripts`; use `npm ci --ignore-scripts` for subsequent reproduction.
   Lock core and both optional native package entries at matching 3.x versions; physical installation selects the host companion.
   npm owns optional native selection; no compiler installation, bootstrap download or explicit native archive override.
3. Reduce policy to exclusions and translate the finite execution profile in the same coherent candidate.
   Inspect inventory before writes; distinguish new default findings from content defects and preserved records.
   Apply approved exact-scope formatting only to maintained authored files.
4. Update live docs, approved AGENTS guidance and root-install workflow assumptions.
   Preserve runtime readers and evaluation setup; remove only archive identity ceremony.
   Inspect required-check and receipt consumers, replace archive-only gating with ordinary root installation/check by default, preserve its check context and unrelated full/release controls.
5. Delete isolated manifest, lock, source record and all three archives after no active consumer needs them.
   Inspect notices and package/build inputs so development-only AGPL/native assets are not bundled into skill/plugin payloads.
   Preserve historical plans and evidence mentioning old transport.
6. Verify changed behavior, then existing final gates once for the final candidate.
   Request one ordinary Review Agent; after repair run affected checks and a narrow repair review.
   Reuse unchanged passing evidence; no duplicate HISEW/evidence packaging or security/external campaign.

## Focused verification and independent oracles

Use existing `node --test tests/scripts/markdown-quality.test.mjs` as the main repository boundary test.
Retain semantic tests for canonical/source selection, generated/eval/history exclusions, literal command/frontmatter preservation, ASCII-only output, rendered hard breaks, idempotence, broken local-link refusal, all-or-nothing preflight refusal and excluded bytes.
Replace the archive hash/source/workflow coupling test with relevant installed registry identity/native/report validation, without re-creating metadata ceremony.
Use public root imports and validate result schema 5 semantics; update stale schema 4 assumptions everywhere they actually occur.
Assert returned candidate input/output digest and byte counts against independently read fixture bytes, not only the producer's own validator.
For excluded SDK documents assert exact original bytes, not merely a successful exit.
For physical formatting assert actual filesystem writes and `writtenPaths`; read-only/preview must have none.

Use tiny disposable fixtures to test installed CLI check, actual preview, write, second-pass unchanged result, invalid options and refused repair.
Assert missing physical repair mode exits 2, preview preserves independently hashed bytes, write matches the preview candidate hash/byte count, and the second format writes nothing before check succeeds.
Capture actual child/native exit codes; when invoking through PowerShell, forward `exit $LASTEXITCODE` rather than treating a wrapper's generic exit 1 as the CLI's exact result.
Check explicit root-relative paths containing spaces and option-looking basenames, nested cwd root discovery, and intentional empty selection.
Capture stdout and stderr independently; parse the complete JSON after cleanup and require final delivery to finish.
If testing a broken pipe, provide resource quotas large enough to reach output; do not mistake preflight refusal for pipe behavior.
Disable or contain runtime compile-cache output when using a scratch root, so the cache does not contaminate selection or cleanup assertions.
Verify exact resolved package version >=3.0.0, schema identities and matching installed native companion on Windows and Linux.
Require an actual native-backed operation; syntax/schema/source-only checks do not establish native proof.
Native Snapper stays unchanged; consume the matching version 3 native companion selected by npm.

Existing workflow/static contract test selector: `node --test tests/scripts/verification-workflows.test.mjs` when its inputs change.
During iteration, select the actual affected test names, for example:

```sh
node --test --test-name-pattern '^installed formatter preserves skill metadata, literal commands and rendered hard breaks and converges$' tests/scripts/markdown-quality.test.mjs
node --test --test-name-pattern '^installed shared checker rejects a broken local link and formatting writes no selected document$' tests/scripts/markdown-quality.test.mjs
```

Retain those semantic case names or update selectors explicitly with any justified rename; remove the archive-acquisition case instead of carrying it into the new graph.
Before review, pass `npm run format:check` and `npm run lint`; `npm run build:check` includes those prerequisites when inputs are unchanged.
Close release-only and tooling callers, including `scripts/packagePluginArchive.js`, build inputs and `CONTRIBUTING.md`, before selecting any expensive integration gate.
The repository's existing authoring/build-script/test instructions name a final `npm run verify` gate.
It runs diff checking, build correspondence/ASCII, Markdown, skill validation/lint, deterministic eval conformance and Node tests.
It does not authorize provider evaluations or establish semantic model behavior.
The user's standing restriction on full-repository campaigns takes precedence: use its affected owning checks for this migration, and record any remaining full-gate requirement as an explicit future authorization decision rather than running it implicitly.
No full suite runs during this planning task.
If dependency-cruiser or affected-test metadata reports a hoisted npm import as `../../ajv`/undetermined, classify by resolved package identity rather than path text; do not widen local path containment.
Reuse registered Windows/Linux workflow paths for required platform observations; a new dispatch file is unavailable until default-branch registration.
No new hosted workflow is needed merely to prove a root package install.

## Specific workflow and fixture assertions

`tests/scripts/verification-workflows.test.mjs` currently asserts the literal isolated `install:markdown` command and lists all six Markdown scripts.
Update that expectation to the root installation contract and remove the retired qualification script only after checking actual downstream usage.
Keep its existing assertion that `verify` includes `check:markdown`; scoped verification's declared omission of the global check remains explicit.
The evaluation-conformance reuse receipts in `scripts/ci/conformanceReuse.js` are not Markdown qualification receipts; preserve their authentication, retention and lane semantics.
Do not remove those readers based on generic searches for the word receipt.

For `tests/scripts/markdown-quality.test.mjs`, replace the `createRequire` rooted at the isolated tooling manifest with public root package resolution.
Remove archive-source hashes and coupled workflow/source identity assertions.
Keep representative selected files `README.md`, `AGENTS.md`, `src/defining-concepts/SKILL.md` and `src/reading-epubs/references/conversion-troubleshooting.md`.
Keep representative excluded generated `skills/defining-concepts/SKILL.md`, portable eval README and historical centralization plan.
Migrate the old `selection.inventory` expectations to current reconciliation records while independently deriving tracked paths with Git.
Do not make a semantic selection test require an explicit `include` key if the package default provides the same scope.

The temporary skill fixture independently compares exact YAML frontmatter and literal shell command text before/after format.
Retain its ASCII-byte assertion even though the build also checks ASCII: they guard different boundaries.
A broken local link must leave both the good and broken fixture files unchanged when repair is refused.
Ignore-file fixtures must continue proving `.gitignore` and `.prettierignore` do not override root policy, while excluded ancestor bytes remain untouched.
New native/CLI proof belongs in these bounded fixtures, not a parallel collection of snapshots mirroring producer implementation.

## Completion, rollback and open decisions

Accept when one root lock reproduces the registry graph; direct scripts and real SDK tests use public 3.0 contracts; exclusions preserve generated/eval/history bytes; required deterministic gates pass; maintained guidance has no live isolated/archive instructions; and archive-specific files are gone.
Report ordinary local checks, platform installed proof and trusted hosted qualification as separate claims with their actual evidence.
Preserve historical report/receipt readers by explicit version dispatch if any are discovered; never feed old results into a new validator and rewrite them as current.

Rollback before publication is a reviewed reversal of this migration's own manifest, lock, policy, script, test and documentation edits as one coherent unit.
Retain old archives in Git history for recovery; do not add a runtime fallback or silently undo later user changes.
A released canonical skill content change, if needed, has its own release/recovery rules and is outside tooling-only rollback.
No commits, branch changes or pushes occur under this plan.

| Open decision                           | Recommended resolution                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warning failure policy                  | Keep package default advisory warnings and explicit `--strict`; do not infer strictness from an old display filter                                                                        |
| Legacy `install:markdown` compatibility | Remove and update maintained callers unless an actual external interface requires a temporary root-install alias                                                                          |
| Diagnostic scale exceptions             | Begin with finite defaults; retain only measured, narrowly justified budgets                                                                                                              |
| Exact historical scope classification   | Preserve current historical categories initially, review representative inventory, never exempt maintained guides merely to turn green                                                    |
| Existing qualification boundary         | Recommend ordinary root-install/check workflow with preserved required context unless an actual product receipt consumer is found; separately map exact retained contracts only if needed |
| Existing broad verification gate        | Reconcile the documented `verify` requirement with the user's targeted-only scope in later implementation authorization; preserve affected checks and report any unrun gate honestly      |
| Shipped skill repair changes            | Prefer no payload changes for tooling migration; route genuine content fixes through source/build/release rules                                                                           |

Planning checks: read-only baseline/status, policy, manifests, scripts, consumer tests, workflows, runtime readers and upstream contract inspection only.
No dependency acquisition, build, formatter campaign, evaluation, product/configuration edit, commit or push was performed to prepare this plan.
