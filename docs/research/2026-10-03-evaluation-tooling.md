# Evaluation tooling research and decision record

Checked: 2026-10-03. Repository baseline: `75e952a25901a794a11c14e5ef7f7fca6616d6ad`. Consumers: the [architecture dossier](../designs/2026-10-03-evaluation-architecture.md) and [implementation plan](../plans/2026-10-03-evaluation-modernization.md).

This refresh uses HISEW REU-01, VER-01, LIC-01 and VAL-01: inspect existing supply, identify the current stable target, distinguish rights from technical fit, and use each consumer's supported validator. Read-only repository and upstream research were performed separately and reconciled. No external evaluation tools were installed or executed, and no model sessions were launched. Published source and release metadata are evidence of a contract, not evidence that this repository has integrated it successfully.

## Decision method

For an unsettled choice, first establish the intended outcome, invariants and information that must survive. Then examine maintained engineering practice, verify the applicable authoritative contracts, and consider adopted practice as corroboration. Binding interoperability rules and explicit authorization constraints apply throughout; the ordering is not permission to override a specification. Ask the owner only when this sequence leaves a consequential preference or authority decision that is necessary for the current work.

The design frontier is resolved for documentation. Remaining items are named empirical qualification or adoption gates. They do not require the owner to guess how a published program behaves. The grilling skill was read and retained as the fallback; no new question round was needed.

Research questions included: what is already implemented; what is actually released; whether the custom engine changes authority or process ownership; how three-arm and multi-turn semantics survive; what independent conformance can establish; how installers choose duplicate source/distribution names; how to retain history without digest cycles; and which existing parsers can avoid custom format implementations.

## Refreshed software selection

Versions below are the latest stable or applicable LTS observations at the checked date, not floating instructions. Refresh before incorporation/first deployment and freeze one assessed identity for each run. A new release during a run does not mutate that run's dependency set.

| Component | Observed selection and source | Fit / supported interface | Restrictions and adoption status |
| --- | --- | --- | --- |
| skill-up | [v0.12.0 release](https://github.com/alibaba/skill-up/releases/tag/v0.12.0), 2026-09-18; source `dd2ff3250074505204b969405bef2cdce4bae428` | Primary ordinary executor/report generator; custom engine; real `validate` command. Supports batch and stateful execution, but assured Hadden profiles select batch. | Apache-2.0 text reviewed. Local integration unverified, especially Windows closure. Technical selection retained; complete dependency-rights and integration qualification remain adoption gates. |
| agent-skills-eval | [npm 0.1.1 metadata](https://registry.npmjs.org/agent-skills-eval/0.1.1); `gitHead` `b60eebe3c6edaa917a284e13b9b0e9fa00f1c957` | Independent consumer through public `discoverSkills`, `loadSkill`, `runEval`, `evaluateSkills`, `createStaticProvider`. No dedicated validate CLI. | MIT text reviewed. Published package has material behavior limits below; select for bounded conformance, not authoritative benchmarks. Windows/Node 24 integration remains unverified. |
| Node.js | [official release index](https://nodejs.org/dist/index.json): `v24.21.0`, Krypton LTS; [release policy](https://nodejs.org/en/about/previous-releases) | Current repository Node 24 ESM/JSDoc approach remains suitable; newest applicable LTS patch is the qualification candidate. | Do not change runtime settings or downgrade to an old LTS for tooling convenience. Repository floor remains `>=24`; no TypeScript migration. |
| `yaml` | [npm 2.9.1](https://registry.npmjs.org/yaml/2.9.1), source `1440ecd3d1bff41e4ac399f8f6839e810328bd16` | [Supported parse/stringify and document APIs](https://eemeli.org/yaml/) for generated YAML and duplicate-key diagnostics; round-trip values, then run the actual consumer validator. | ISC source license identified. Proposed development dependency only. No repository mutation or full transitive/legal clearance claimed. |
| Ajv | [npm 8.20.0](https://registry.npmjs.org/ajv/8.20.0), source `0fba0b8e649909613cfce0999b149cd08f4a4987` | [Supported JSON Schema 2020-12 implementation](https://ajv.js.org/json-schema.html) for repository-owned extension schemas; local schema resolution and strict validation. | MIT source license identified. Proposed development dependency; not a replacement for vendor validators or repository semantic checks. |
| Open skills installer | [npm `skills` 1.7.0](https://registry.npmjs.org/skills/1.7.0), source `7407f3893ad4dceab546ac002c3ef806e4000c73` | Qualification target for explicit generated paths and repository-root discovery. | MIT metadata; installer execution/rights qualification pending. Inspect real installed bytes in a disposable location; do not alter the user's installed skills. |
| Existing Hadden evaluator | Repository baseline above | Exact prepared authority, controller/domain semantics, provider and home lifecycle, durable evidence and campaigns | Reuse is the default. New code is limited to projection, correlation and necessary orchestration seams. |

Current skill-up `main` was observed at `7f1ff9b8e2d7c654728de526867f2f7e7b78ea51`; agent-skills-eval `main` at `f10ae2b3c93055cadd82c02a3b7fe4cfbd9a4645`. Those source heads are not the selected stable releases. In particular, current-main claims about native execution must not be attributed to agent-skills-eval 0.1.1.

### Exact candidate identities

The [skill-up release checksum manifest](https://github.com/alibaba/skill-up/releases/download/v0.12.0/skill-up_0.12.0_checksums.txt) supplies these archive SHA-256 values:

| Platform | SHA-256 |
| --- | --- |
| Windows AMD64 | `21595d0ccfe3bea85ce0047dbb71b13149e8d0b9bccd08e4f0ba6c9e53de53ca` |
| Windows ARM64 | `a839daa4328e886de1d9b5dfbef9b49933c5d12cabe6bfd1c214e5dc340c1ba6` |
| Linux AMD64 | `ec2631e45702d460b69cd700e1847f5562ef2e971f09c23be2efcec4e0f583c6` |

Only a platform actually qualified by the repository becomes supported. These are archive hashes, not extracted-executable hashes. Bootstrap must separately retain executable identity and observed version. The annotated release tag object is `63b93410410a2313c9022268be0a66b5886b29e8`; the observed API verification was unsigned and release metadata did not mark the release immutable. Checksums establish identity relative to the selected manifest, not independent publisher authentication.

agent-skills-eval 0.1.1's tarball is 64,862 bytes, SHA-256 `f21658e88e718f32f9827eec04efd23f3dfcd39cafa0a430319964a5e226e330`. Its npm integrity is `sha512-BfCCps2hUw79GUU0fo+04XX1/swCgNSGCY8kEWUeNqzppXX/Z03UiMl5BQzW9ZHdYggr7sRbM0+Y+eqDHcGZzg==`. Native npm lock generation must retain the actual dependency graph; do not hand-author a transitive lock from this table.

### Rights and operational boundary

The exact selected [skill-up Apache license](https://github.com/alibaba/skill-up/blob/v0.12.0/LICENSE) and [agent-skills-eval MIT license](https://github.com/darkrishabh/agent-skills-eval/blob/b60eebe3c6edaa917a284e13b9b0e9fa00f1c957/LICENSE) were read. Retain applicable copyright/license notices, Apache redistribution/change notices and patent terms. No `NOTICE` appeared in the selected skill-up source tree. This does not audit all bundled or transitive assets. The proposed YAML/Ajv source licenses are [ISC](https://github.com/eemeli/yaml/blob/1440ecd3d1bff41e4ac399f8f6839e810328bd16/LICENSE) and [MIT](https://github.com/ajv-validator/ajv/blob/0fba0b8e649909613cfce0999b149cd08f4a4987/LICENSE).

The consuming repository is MPL-2.0. The [MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) explains its file-level model, but is not an organizational license clearance. Keep external evaluation tools in the development/execution environment, outside shipped skill/plugin runtime payloads. Before acquisition/use, inventory actual packages and notices, review material restrictions and record the accountable adoption decision. Hosted model terms, privacy, cost and authorization remain separate. No paid service is required for the planned deterministic gate.

## Release-specific findings

### skill-up's custom boundary

The selected [custom-engine source](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/agent/custom.go) serializes `case_id`, `variant`, `workspace`, `model`, optional `session_id`, `kwargs`, `messages`, `max_turns` and `timeout_seconds`. Most fields use omitted-empty serialization; `messages` does not. The current website omits `kwargs`. The adapter must test the selected release, including exact omissions, rather than follow the moving website. Keep all correlation metadata public and non-authoritative.

The [versioned custom-engine guide](https://github.com/alibaba/skill-up/blob/v0.12.0/docs/design/custom-engine.md) documents local/HTTP transport and batch/stateful modes. The assured projection selects one batch call, leaving domain turn progression in Hadden. Explicit `exit_code` and `final_message` avoid reliance on lenient response reconstruction. Artifact export is explicit and cannot replace Hadden storage.

The [plan expansion](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/evaluator/plan.go), [runner](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/runner/runner.go) and [retry implementation](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/evaluator/evaluator.go) establish why Hadden must select a single campaign cell before invocation. The conventional outer variants do not express a complete no/old/new experiment, and iterations/retries must not mint additional authority.

### Windows process ownership

The selected [non-Unix process-group implementation](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/runtime/none_exec_other.go) is a no-op. The [Unix implementation](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/runtime/none_exec_unix.go) has group signaling. The [none runtime](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/runtime/none.go) bounds inherited-pipe waits, which is not proof of descendant termination. [Upstream custom-engine E2E tests](https://github.com/alibaba/skill-up/blob/v0.12.0/e2e/custom_engine_test.go) skip local transport coverage on Windows.

The [Windows shell implementation](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/platform/shell_windows.go) can choose Git Bash or fall back to cmd. Therefore the plan requires spaces, Unicode, quoting, cancellation, grandchild lifetime and pipe-retention controls on actual supported Windows configurations. No operating-system substitution is automatic. A failed bridge qualification preserves direct Hadden execution and triggers re-design, not weakened safety checks.

### Offline validation and ambient configuration

The [validate command](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/cli/validate.go) is the supported configuration check. It does not itself call a model. However, [root initialization](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/cli/root.go) and the [configuration loader](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/userconfig/loader.go) run before command dispatch. Explicit configuration overlays other layers rather than automatically excluding them.

The [credential resolver](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/credential/credential.go) loads `.env`, and [native-agent bootstrap](https://github.com/alibaba/skill-up/blob/v0.12.0/internal/agent/node_install.go) can acquire runtime tools. Use a controlled temporary cwd/config environment, explicit binaries, no API credentials, neutralized telemetry exporters and fake custom engine plus deterministic judge. Prove the absence of network/model work. An `agent_judge` remains a model call even when the target is fake.

### Independent consumer limitations

Published agent-skills-eval [SDK exports](https://github.com/darkrishabh/agent-skills-eval/blob/b60eebe3c6edaa917a284e13b9b0e9fa00f1c957/src/index.ts) supply supported loading and static-provider execution; use those instead of inventing a validate subcommand or importing private parser internals.

Its [runner](https://github.com/darkrishabh/agent-skills-eval/blob/b60eebe3c6edaa917a284e13b9b0e9fa00f1c957/src/run-eval.ts) attaches fixture content to the with-skill arm but not the baseline, and does not send `expected_output` to grading when assertions are present. It injects references directly rather than observing progressive skill activation. The [file reader](https://github.com/darkrishabh/agent-skills-eval/blob/b60eebe3c6edaa917a284e13b9b0e9fa00f1c957/src/fs-utils.ts) skips binary content and defaults to bounded text. This limits claims for EPUB and fixture-bearing comparisons.

Conformance receipts must retain these limitations as observed unsupported behavior. Do not patch the consumer, duplicate assertions, omit fixtures or relabel partial behavior to make a benchmark appear conformant. Full-schema discovery and fake-provider execution still provide independent evidence, even though they cannot certify every suite's behavior.

## Ordered decision record

### DEC-001: Complete source projects; explicit generated runtime projection

First principles: a maintainer needs one editable owner for each file, and installation must exclude evidence and test machinery. Maintained practice favors deterministic declared artifacts. The [Agent Skills specification](https://agentskills.io/specification) constrains delivered `SKILL.md` and relative resources, not the repository's source-directory name. Installer behavior is the final consumer check. Retain the user's complete-source choice; use a closed central projection and keep existing Git implementation paths. Do not add a per-skill packaging language.

The [pinned installer discovery implementation](https://github.com/vercel-labs/skills/blob/7407f3893ad4dceab546ac002c3ef806e4000c73/src/skills.ts) prioritizes known skill containers and deduplicates names, with recursive/full-depth behavior available. This reduces but does not eliminate ambiguity when both source and generated copies exist. Qualify default discovery, explicit `skills/<name>`, full-depth behavior and plugin installation. Prefer an explicit generated path in reproducible instructions; never rely solely on first-match order.

### DEC-002: Portable base plus sparse protocol/assurance extension

First principles: no representation change may drop a required turn, fixture, assertion or permission condition. Current code has exact follow-ups and capability requirements. The [evaluation guidance](https://agentskills.io/skill-creation/evaluating-skills) provides conventional initial-prompt/output/file/assertion fields, not a universal conversation/capability language. Use those fields unchanged and one sparse, clearly divided extension. A single compiler performs the join; supported consumers receive full semantics or an explicit unsupported-coverage disposition. This corrects the older all-semantics-in-portable-file claim without duplicating complete case definitions.

### DEC-003: Keep the established assurance owners

Exact authorization and process/evidence lifecycle must have one enforcement owner. Maintained consumer extension points support delegation but do not replace the current Hadden guarantees. Reuse existing runtime, provider, bundle, capability and scripted-controller modules. Custom work is limited to representation and correlation. skill-up is not a fourth provider adapter. The direct assured route remains until the new boundary qualifies.

### DEC-004: Campaign authority remains outside generic plan expansion

The experiment's arms, seed, repetition, order and invalid-attempt accounting are part of its meaning. Hadden already owns them. skill-up's two carrier variants and retry/iteration features are useful for ordinary runs but cannot silently redefine three-arm matched studies. Generate one already-selected session per assured invocation, with zero retries, one iteration and sequential execution. Preserve current suite-specific arm names and blind mappings.

### DEC-005: Use batch mode for assured conversations

First principles: a follow-up is information presented after an earlier response, not extra initial context. Reuse the existing shared or Git state-sensitive controller inside the authorized session. Although current skill-up supports stateful engines, adopting its turn controller would create two owners of transitions and require new evidence. Native multi-turn portability may use a supported consumer protocol only when the complete conversation is qualified separately. agent-skills-eval's single-turn subset cannot count as a full-case pass.

### DEC-006: Separate static determinism from run-local identity

Use stable input inventories and consumer versions for repeatable projections, consistent with [reproducible-build definitions](https://reproducible-builds.org/docs/definition/). Host paths, authorized packet hashes and terminal results belong to subsequent run-local records. Use an acyclic sequence of campaign definition, materialized configuration/receipt, packet, authorization, execution index, final record and derived report. Receipts never list their own hashes. [SLSA provenance](https://slsa.dev/spec/v1.2/provenance) informs input/output identity; this plan does not claim a SLSA level or substitute a checksum for trusted build provenance.

### DEC-007: Preserve historical bytes and distinguish ownership

Paths are locators; retained evidence bytes and schema identities carry observations. The [BagIt specification](https://www.rfc-editor.org/info/rfc8493/) provides a useful inventory/fixity precedent. Apply exact hash/length/path reconciliation without claiming to implement the BagIt format. Move tracked history as one separately verifiable slice; do not include ignored local naming evidence automatically. No normalization, old absolute-path rewriting or retroactive assurance upgrade is allowed.

### DEC-008: Strict repository schemas, supported consumer validation

Use [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) and maintained parsers for authored extensions, with repository semantic checks for joins/indexes/authority. Reuse [RFC 8785](https://www.rfc-editor.org/info/rfc8785/) canonicalization already implemented by the runtime. Use real skill-up validation and the public independent SDK for external contracts. Source-derived tests assert literal expected mappings rather than computing expected results through the same projector.

### DEC-009: Current stable selection and frozen execution coexist

Select latest stable/LTS using primary registries, then pin exact assessed bytes. Keep ordinary authoring-tool refresh behavior independent. Verification never fetches missing execution tools; explicit bootstrap does. New pins require contract/default/privacy/rights re-review and qualification, not just a changed version string. Missing binaries locally do not justify choosing an old release.

### DEC-010: No semantic or assurance inflation

Preserve actual existing observations even when their method is weaker: naming's keyword scores and model-selected trigger labels are diagnostics; defining's trial verification is integrity evidence; deterministic EPUB tests with Pandoc absent are incomplete conversion evidence. [Trigger guidance](https://agentskills.io/skill-creation/optimizing-descriptions) calls for observed client activation, distinct from loaded-body behavior. New semantic grading and actual-host studies need their own protocol and authorization; the migration cannot retrospectively certify them.

### DEC-011: Coherent caller migration, no new legacy shims

HISEW NSH-01 distinguishes a supported adapter between ongoing boundaries from a bridge hiding an obsolete contract. The custom engine is an ongoing external boundary. The direct Hadden operator path has continuing preparation/recovery/assurance responsibilities. Old root eval paths, by contrast, should be updated with all live callers in one slice, without new forwarding files. If a discovered external consumer genuinely needs a transition bridge, record the exact scope, owner approval, tests and removal condition before introducing it.

### DEC-012: Preserve existing downstream contracts

The current plugin and archive consumers already solve distribution, versioning and notices. Reuse them after runtime generation. Keep tests on installed artifacts, no-wrap/ASCII validation and exact scoped-verification behavior. Do not combine this migration with new skill behavior, runtime target changes, source-module reshuffling, marketplace publication, or different grading thresholds merely to simplify implementation.

## Alternatives and residual custom gap

| Option | Assessment |
| --- | --- |
| Replace Hadden wholesale with a general evaluator | Rejected: loses exact prepared authority, domain controller/oracle and managed-home/evidence contracts unless they are rebuilt. No source evidence establishes equivalent native features. |
| Retain the entire bespoke execution/reporting surface indefinitely | Rejected as the target: duplicates ordinary maintained execution/report functionality and leaves portable consumers unqualified. Retaining assured execution while a bridge is unqualified is a bounded gate, not this end state. |
| skill-up native plus supported custom-engine composition | Selected direction: ordinary execution/reporting reuse with a narrow Hadden bridge and explicit platform gates. |
| agent-skills-eval as primary behavior/assurance authority | Rejected for the selected release: fixture asymmetry, grading-context omissions, binary limits and no equivalent prepared authority. Keep independent conformance use. |
| [Promptfoo custom providers](https://www.promptfoo.dev/docs/providers/custom-api/) and [assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/) | Credible general evaluation alternative, but it would still need the Hadden authority adapter and another projection/report contract. The refreshed evidence does not justify replacing the user-selected direction. No Promptfoo adoption/version approval is made. |
| Custom YAML/schema parser or generic execution framework | Rejected: maintained parsers and native consumer validation exist. Domain joins, receipt mapping and exact authority correlation are the actual residual custom work. |

## Required empirical experiments

| Experiment | Discriminating observation | Decision if it fails |
| --- | --- | --- |
| EXP-001: Pinned consumer offline smoke | Real validators and fake target/judge providers run with zero network/model activity and no ambient config effect | Keep integration unqualified; fix isolation/configuration or revise tool choice with evidence |
| EXP-002: Lossless projection | Exact strings, fixtures, IDs, critical indexes and follow-up transitions are preserved; unsupported fields remain visible | Do not migrate that suite or claim conformance; repair the owner or explicit coverage mapping |
| EXP-003: Assured negative authority | Overrides, replay, concurrency, altered packets and extra iterations cannot launch another provider session | Block assured bridge cutover; preserve runtime evidence and direct executor |
| EXP-004: Native Windows/Linux lifecycle | Timeouts, abrupt parent termination, grandchildren and inherited pipes either close safely or leave an explicit non-advancing unsafe state with controlled descendants | Reject affected platform cutover; re-plan lifecycle ownership, without automatic WSL/service substitution |
| EXP-005: Installer/package selection | Actual installed files equal intended generated payload for supported routes; no source/eval leak or duplicate ambiguity | Keep current installation route; revise explicit path/package instructions or supported consumer contract before source cutover |
| EXP-006: History relocation | Full tracked old/new inventories agree in contents, lengths and path mapping; readers work | Stop before source cleanup; recover using exact mapping and preserve both observations |
| EXP-007: Provider/host acceptance | Separately authorized trials confirm packet/controller/evidence equivalence and actual client activation as applicable | Retain limitations and prior qualified mode; deterministic success is not substituted |

These experiments are planned, not performed. A current provider/model/effort or capability change requires its own newly frozen preparation. The published report and prior chat do not authorize those transmissions.
