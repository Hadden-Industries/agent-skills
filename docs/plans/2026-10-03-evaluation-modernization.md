# Evaluation modernization implementation plan

Date: 2026-10-03. Planning baseline: `75e952a25901a794a11c14e5ef7f7fca6616d6ad`.

Status: executable planning dossier, not an implementation-completion claim. It incorporates the user-selected Approach 1 and the researched decisions in the [architecture](../designs/2026-10-03-evaluation-architecture.md). Read the [preservation ledger](../designs/2026-10-03-evaluation-preservation-ledger.md) and [software selection](../research/2026-10-03-evaluation-tooling.md) before implementation. HISEW's planning procedure is used instead of the obsolete superpowers execution instructions in historical plans.

## Outcome, scope and governing baseline

Deliver one canonical source project per skill, exact generated runtime distributions, conventional portable evaluation bases plus lossless extensions, maintained ordinary evaluation/reporting, independent conformance, and preserved Hadden assurance. This includes all four current skills, shared execution modules, Git plugin/archive packaging and byte-preserved tracked history.

Exclude skill-content optimization, changed assertion meaning, new campaign thresholds, a TypeScript conversion, new providers, automatic WSL migration, unrequested installation/publication, a generic security/process framework, or rewriting historical evidence. No plan step grants an external model call. Assured sessions retain exact packet-bound authorization. Ordinary native target/judge runs require a separately approved frozen experiment and cannot claim or replace that assurance gate.

HISEW route: R2 for the pipeline design, with full relevant verification and independent assurance at implementation. The earlier architecture choice remains accepted; this exact refined dossier is the implementation review target. Bind the chosen revision and exact configuration decisions before starting the corresponding implementation execution. Do not adopt another task's retained HISEW handoff or manufacture an accepted snapshot.

## Ordered slices and traceability

| Slice | Demonstrable result | Requirements / acceptance / quality | Dependency and proof | Delivery/cleanup effect |
| --- | --- | --- | --- | --- |
| SLICE-001 | Frozen current contracts and explicit consumer qualification environment | REQ/AC-003, 006-008, 011; QA-001, 006, 012 | [Phase 1](evaluation-modernization/01-baseline-and-toolchain.md): source/test inventory, golden evidence, exact tool identities, real validators with fake providers | No runtime change or legacy deletion; remove only owned scratch after retained qualification evidence |
| SLICE-002 | Tracked history relocated with complete fixity proof | REQ/AC-005, 012; QA-009, 012 | Phase 1; old/new manifests and reader readback; independent of consumer installation | Isolated path-only migration; ignored naming results remain separately owned |
| SLICE-003 | Complete source/distribution cutover and reading-epubs portable vertical path | REQ/AC-001, 002, 006-008, 010; QA-003, 004, 007, 008, 010 | [Phase 2](evaluation-modernization/02-source-distribution-and-portable-evals.md): exact runtime output, all live case readers migrated, genuine consumer validation | Keep current helper/provider/controller behavior; retire only moved live paths after caller audit |
| SLICE-004 | Fake assured session traverses skill-up into existing Hadden runtime with preserved failure/recovery | REQ/AC-003, 004, 007-009, 011-012; QA-001-006, 012 | [Phase 3](evaluation-modernization/03-assured-consumer-bridge.md): authority, concurrency, timeout and process qualification on each platform | Direct Hadden mode remains until bridge gates pass; failed platform stays unqualified |
| SLICE-005 | Defining-concepts durable campaign works through the qualified boundary | REQ/AC-002-006, 009, 012; QA-001-005, 010-012 | [Phase 4](evaluation-modernization/04-defining-concepts.md): identical schedule, complete turns/capabilities, crash/reconciliation, grading packets and aggregates | Preserve direct diagnostic trials and historical readers; no implicit calibration run |
| SLICE-006 | Naming cases gain supported exact-authority execution and honest grading/trigger separation | REQ/AC-002-004, 006, 009, 011-012; QA-001-006, 010-011 | [Phase 5](evaluation-modernization/05-naming-and-trigger-contracts.md): checker/interface characterization, exact follow-ups, no local hardcoded provider launch | Replace legacy new-run path only after equivalence; retain old diagnostics and ignored evidence |
| SLICE-007 | Git campaign/controller/oracle and all distribution consumers preserve behavior | REQ/AC-001-012; QA-001-012 | [Phase 6](evaluation-modernization/06-git-integration-and-retirement.md): current 81-session matrix, safety fixtures, installed/helper/plugin contracts, distinct host evaluation | No generic controller substitution; no implicit fetch, push or model run |
| SLICE-008 | Integrated deterministic gate and evidence-backed retirement handoff | REQ/AC-007-012; QA-006-012 | Phase 6; full repository gate, independent review, explicit provider/installer/host qualifications | Remove proven duplicate orchestration only in later reviewed changes; no spent evidence deletion |

The integration owner is the maintainer implementing the accepted slice. That owner updates the ledger and checks downstream consumers before handoff. The repository owner approves changed meaning, exact configuration, real provider calls and delivery effects. An independent verifier owns the final preservation assessment and the relevant security review owner assesses implemented trust-boundary changes.

The broad source cutover is deliberately coordinated: the current validator rejects nested evals and the current suites use `expectations`. Move all live paths/readers and the authored contract together rather than introduce a temporary compatibility grammar or forwarding CLI. The first complete external-consumer path is reading-epubs. Later slices change which executor consumes already-migrated contracts, not case meaning.

Semantically independent inventory/research and history fixity work can proceed separately. Shared registry/compiler/runtime edits cannot be assigned as parallel writes without a single integration owner. This plan does not itself authorize subagent implementation.

## Exact configuration proposals for later approval

No configuration is changed by this documentation work. Existing broad approvals from earlier work packages do not cover these new settings. At implementation, present the exact diff and reuse any approval that actually names it. The smallest initial proposal is the toolchain/dependency subset for SLICE-001; later subsets follow their consumers.

| File | Proposed setting/change | Pipeline effect and boundary |
| --- | --- | --- |
| `package.json` | Add exact development dependencies `yaml: 2.9.1`, `ajv: 8.20.0`, `agent-skills-eval: 0.1.1`, `skills: 1.7.0`, subject to refreshed stable/rights assessment immediately before adoption | Supplies maintained formats and public consumer/installer APIs for deterministic qualification. No runtime bundle import of these packages. Keep Node `>=24`, ESM and existing development dependencies unchanged. |
| `package-lock.json` | Regenerate only the native npm graph required by those approved additions | Captures exact transitive versions/integrity; never hand-edit lock entries or touch unrelated `skills-lock.json`. |
| `evaluation-toolchain.json` (new) | Versioned skill-up `0.12.0` release/source/archive identities for explicitly qualified platforms; selected SDK/installer identities; expected contract/projector versions | Separates explicit installation from frozen execution. Missing/mismatched identity fails before execution; no auto-upgrade or download during verify. Exact reviewed platform asset names and all values belong in the approval diff. |
| `package.json` | Add `eval:check` as `node scripts/evaluation/check-conformance.js`; insert `npm run eval:check` immediately before `npm test` in `verify` | Preserve `diff:check -> build:check -> skills:validate -> skills:lint` order and all existing checks. Adds offline consumer conformance; no live judge or provider. |
| `scripts/buildSkillArtifacts.js` | Extend central artifact/copy registry to all canonical source projects; retain the existing Git entry/output and every esbuild option | Makes `src` authoritative without modifying emitted helper behavior or adopting per-skill manifests. Review as build configuration. |
| `scripts/buildRepository.js`, `scripts/validateSkillRepository.js` | Separate canonical-source and intended-payload validation; preserve build order, scoped selection, read-only check mode, ASCII and no-wrap rules while adopting the portable contract and extension compiler | Enables clean first builds and forbids eval leakage. Submit the exact build/validation-rule diff with the source cutover rather than treating it as incidental code movement. |
| `scripts/skillSelector.js`, `scripts/verifySkill.js`, `scripts/validateSkills.js`, `scripts/lintSkills.js` | Update source/distribution ownership and concrete selected paths only where needed by the cutover | Preserve two-directory test discovery, omission reporting, delivered-skill validation and root Tessl plugin ownership. Do not broaden reported verification implicitly. |
| `scripts/buildPluginPackages.js` | Update only generator assumptions and generated README source-location text needed by the new source/distribution boundary | Plugin still copies `skills`; deliberate README byte changes update its content version. Existing notice list and host settings remain. |
| `AGENTS.md` | Extend canonical SKILL ASCII/no-wrap source ownership to `src/**/SKILL.md` and retain validation of generated `skills/**/SKILL.md`; describe generated runtime files as outputs | Align policy with the new source model. Preserve unrelated configuration safety, verification and Git-authority rules. Submit exact wording, not a general policy rewrite. |
| `.gitignore` | Add generated `evidence/authoritative/` and `evidence/derived/` trees; keep existing `.agent-tools` and old local results exclusions | Prevent accidental publication of new raw/private evidence. Tracked `evidence/historical` and migration manifests remain reviewable. Do not unignore local naming results automatically. |
| `.gitattributes` | Add `evidence/historical/** -text` after the general text rule | Makes preserved evidence bytes immune to later text normalization. Verify stored Git blobs and working bytes before/after; no renormalization command. |
| `.github/workflows/evaluation-conformance.yml` (new, final integration only) | Offline consumer verification on supported Windows/Linux, pull requests and manual dispatch, read-only contents permission, exact action commits and assessed Node/toolchain identities | Proposed automated gate. Bootstrap/dependency acquisition occurs in an explicit preparation step; verification itself stays offline. Present complete pinned workflow for exact approval after local qualification. Do not weaken or replace the existing manual Linux workflow. |

No changes are planned to the Tessl root manifest, installed skill locks, personal HISEW configuration, provider credentials, existing model pins, marketplace entries or provider access policy. Discovering a need for one is a re-planning/approval event, not implied consent.

## Verification and evidence cadence

During implementation, run each slice's focused tests after meaningful changes. Before completion of source, skill, related test or authoring/build-script changes, run `npm run verify` as required by AGENTS.md. At the current baseline it performs diff/static/build/skills-ref/Tessl checks before all Node tests. A previous turn's result does not prove a changed candidate.

Record exact revision/content identity, Node/Git/tool versions, argv, exit code, complete bounded output, skipped checks and platform. Missing required tools or Pandoc are explicit gaps, not passes. Installed-artifact tests must continue to execute `skills`; future plugin/install experiments read back complete payloads. Temporary roots must be task-owned and isolated from credential/evidence roots.

New test-file names in the phase plans are proposed deliverables; commands containing them become runnable only after those files exist. Existing commands are identified separately. Golden expected packets, schedules, field mappings and fixture facts must be independently specified; they cannot call the production generator to manufacture their expectations.

Independent R2 review covers preservation, naming/contract precision, rights/integration status, path/authority/credential boundaries, failure/cleanup behavior and downstream build/installer consumers. Scoped security assessment is triggered when those boundaries are implemented, subject to its own authority. Documentation source inspection and fake-provider results are not real-provider or organizational assurance.

## Migration, recovery and abort

Each slice retains a before-inventory, exact owned paths, recovery method and removal trigger. A source/layout rollback is a reviewed reverse change retaining evidence, not `git reset`, `git restore` or deletion of user edits. Historical migration reversal uses its verified inverse path map. A consumed packet remains consumed across a rollback; another model attempt needs a fresh prepared session and authorization.

Stop the affected cutover on any hash mismatch, lost input, expanded permission, unknown schema, wrong installed copy, orphaned active child, ambiguous historical reader, invalid source contract or unreviewed tool identity. Preserve the failed record and last qualified mode. Resume only after the responsible boundary is repaired and affected evidence refreshed. A clean consumer report cannot override these conditions.

Observe: which artifact ran; which case/protocol was covered; why a launch was rejected; whether a provider child remains; which lease/evidence owns recovery; whether a grade is missing; which consumer lost a field; and what changed between source and installed artifact. Use existing evidence/diagnostics and a small projection receipt. No new general telemetry service is required.

## Commit and handoff checkpoints

Use one reviewable checkpoint per coherent slice; keep history relocation separate from behavioral changes. Actual commits require explicit authorization and the maintained committing-to-git skill. Every authorized commit message must explain the reason and give a detailed per-file account of changed responsibility/behavior, generated consequences and verification. Renames identify both old and new paths. A long message is not a substitute for exact staging scope. No commits or pushes are authorized by this plan itself.

Final handoff reports AC/QA evidence, each ledger disposition, qualified platform/consumer matrix, independently reviewed gaps, surviving temporary resources, license/adoption status, source/distribution/plugin identities and the precise real-provider/host experiments still pending. It must not declare the migration complete merely because portable JSON parses or a report renders.
