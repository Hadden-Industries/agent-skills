# Defining Concepts Concept Engineering Implementation Plan

> **For plan implementers:** Execute the repository-change tasks sequentially in the primary agent session. Use `test-driven-development` for behavior changes, `writing-for-agents` and `skill-creator` for the canonical skill, and `verification-before-completion` before any success claim. Do not delegate implementation tasks to subagents, run provider-backed evaluations, change evaluation configuration, commit, or push unless the user separately authorizes the exact action required at that checkpoint. This implementation constraint does not prohibit the finished `defining-concepts` skill from using capability-aware subagents for demonstrably independent research or validation lanes as specified below.

**Goal:** Replace the metadata-only, fixed-five-section `defining-concepts` workflow with a definition-first, source-grounded concept-engineering router; implement a proportional ConceptBrief, competency questions, concept-system and boundary analysis, claim-level evidence and licensing discipline, risk-aware validation, capability-aware parallel research, five composable specialist profiles, and three adaptive renderers; and establish a reproducible three-arm, one-repetition behavioral evaluation protocol with backward-compatible declarative multi-turn support.

**Architecture:** Keep one model-invoked `SKILL.md` as the universal router and execution spine. Disclose the format-neutral concept-entry model, detailed evidence/provenance contract, presentation rules, serialization rules, and five specialist profiles through purpose-specific Markdown references. Extend the shared evaluation layer with deterministic scripted follow-up turns and immutable skill-bundle capture, while keeping definition-specific cases, graders, and campaign policy in `evals/defining-concepts/`.

**Tech stack:** Repository-authored Markdown skills, Node.js 24+ ECMAScript modules, Node's built-in test runner, JSON evaluation manifests, Git object reads, SHA-256 evidence binding, and the existing OpenAI, Anthropic, and Google evaluation adapters. Add no runtime or development dependencies.

**Spec:** [`2026-08-29-concept-engineering.md`](../../designs/defining-concepts/2026-08-29-concept-engineering.md)

**Research input:** [From Definition Writing to Concept Engineering: Redesigning the `defining-concepts` AI Skill](https://chatgpt.com/c/6a91e2ee-e2cc-83ed-a65f-f1f29a1cb3f6), synthesized through the design's normative adopt/adapt/defer/reject table. The report is not a license to add its illustrative JSON Schema, numeric confidence formulas, service architecture, registry, workbench, or human-study claims.

## Global constraints

- Preserve the existing user-owned `skills-lock.json` modification and exclude it from every task-specific patch, review scope, and prospective commit.
- Execute every listed shell command as a separate action. Multi-line code blocks group related checks; they do not authorize command chaining or pipelines.
- Keep `skills/defining-concepts/SKILL.md` ASCII-only. Keep every canonical paragraph and list item on a human-readable physical source line; do not apply automated prose wrapping.
- Do not copy proprietary standards or machine-specific `X:` drive paths into the canonical skill.
- Keep historical directories under `evals/defining-concepts/results/` byte-for-byte unchanged.
- Use the terminology core for every deliberate definition request. For an otherwise-unqualified "define this concept" request, activate the data-definitions/ISO/IEC 11179 profile as the fallback specialist profile unless user-provided context or a focused clarification selects another profile. Do not extend the standard's scope or claim compliance for an out-of-scope concept.
- Treat the concept entry, not a definition sentence or fixed renderer, as the internal unit of work. Populate and display only what is proportionate to the request.
- Keep adopt, adapt, formulate, and defer as the user-facing dispositions. Represent candidate semantic relationship, source/version fit, authority, and wording permission separately; do not introduce opaque R0-R7 labels into ordinary output.
- Keep qualitative risk, lifecycle status, evidence adequacy, validation status, and review need separate. Do not add self-reported probability or an uncalibrated composite confidence score.
- In the finished skill, permit subagents only for two or more fixed, independent, non-overlapping research or validation lanes when the expected saving exceeds coordination cost. Prefer batched tool calls for shallow lookups, preserve a sequential fallback, make the coordinator reverify material evidence, and never grade subagent use itself as output quality.
- Put the definition or revised definition first whenever responsible formulation is possible. Do not restore a universal section count.
- Keep human usability evaluation outside this implementation and promotion gate. Document it only as a recommended immediate follow-up.
- Use exactly one run per arm per scenario. Add independent cases for broader evidence; do not add hidden repetitions.
- Treat `evals/defining-concepts/evals.json` and `evals/defining-concepts/trigger-evals.json` as configuration. Do not edit either file until the user explicitly approves the exact proposed fields, case inventory, prompts, expectations, trigger queries, and campaign selection.
- Do not modify `package.json`, lockfiles, build configuration, lint configuration, formatting configuration, CI, environment configuration, or repository policy as part of this work.
- Do not call an external model until the exact skill bundle, every prompt and follow-up turn, provider, model, effort, runtime fingerprint, and transmission SHA-256 have been prepared and explicitly authorized.
- A materially changed candidate is a new iteration. Never reuse a prior candidate's authorization, campaign identity, or result directory.
- Do not claim human usability, general expert superiority, calibrated probability, within-prompt repeatability, or stochastic variance from this campaign.
- Commits require explicit authorization through `committing-to-git`; pushes require a separate explicit authorization.

## Intended final file set

### Canonical skill

- Modify: `skills/defining-concepts/SKILL.md`
- Delete: `skills/defining-concepts/references/judicial_plea_status_definition.md`
- Create: `skills/defining-concepts/references/concept-entry-model.md`
- Create: `skills/defining-concepts/references/concept-entry-presentation.md`
- Create: `skills/defining-concepts/references/concept-entry-serialization.md`
- Create: `skills/defining-concepts/references/evidence-and-provenance.md`
- Create: `skills/defining-concepts/references/profiles/data-definitions.md`
- Create: `skills/defining-concepts/references/profiles/epistemic-governance.md`
- Create: `skills/defining-concepts/references/profiles/formal-ontology.md`
- Create: `skills/defining-concepts/references/profiles/knowledge-organization-systems.md`
- Create: `skills/defining-concepts/references/profiles/multilingual-terminology.md`

### Shared evaluation support

- Create: `scripts/evaluation/scripted-conversation.js`
- Create: `scripts/evaluation/skill-bundle.js`
- Modify: `scripts/validateSkillRepository.js`
- Modify only if contract integration requires it: `scripts/evaluation/runtime.js`
- Create: `tests/scripts/evaluation-scripted-conversation.test.mjs`
- Create: `tests/scripts/evaluation-skill-bundle.test.mjs`
- Modify: `tests/scripts/skill-repository-validation-contracts.test.mjs`
- Modify only if `runtime.js` changes: `tests/scripts/evaluation-runtime.test.mjs`

### Defining-concepts evaluation suite

- Modify after exact configuration approval: `evals/defining-concepts/evals.json`
- Modify after exact configuration approval: `evals/defining-concepts/trigger-evals.json`
- Modify: `evals/defining-concepts/session-controller.mjs`
- Modify: `evals/defining-concepts/run-evaluation-session.mjs`
- Create: `evals/defining-concepts/evaluation-runner.mjs`
- Modify: `evals/defining-concepts/README.md`
- Create: `tests/evals/defining-concepts/eval-definitions.test.mjs`
- Create: `tests/evals/defining-concepts/skill-structure.test.mjs`
- Create: `tests/evals/defining-concepts/evaluation-runner.test.mjs`
- Modify: `tests/evals/defining-concepts/run-evaluation-session.test.mjs`
- Modify: `tests/evals/defining-concepts/results.test.mjs`

### Repository documentation

- Modify: `README.md`
- Modify: `evals/README.md`
- Preserve: `docs/designs/defining-concepts/2026-08-29-concept-engineering.md`
- Preserve: `docs/plans/defining-concepts/2026-08-29-concept-engineering.md`

## Semantic implementation contract

The implementer must be able to trace every instruction and evaluation expectation to one of these work products:

| Work product | Required content | Explicit exclusions |
|---|---|---|
| Universal router | trigger boundary; route-frame-research-model-decide-define-validate-present flow; proportional ConceptBrief; risk class; clarification; profile composition; definition strategy; critical validation; renderer choice; completion | specialist rule duplication; fixed output count; automatic platform claims |
| Evidence/provenance reference | evidence-lane planning; claim-relative authority; exact retrieval/version checks; source roles; conflicts; licensing/wording gate; claim ledger; negative-search limits; parallel worker contract | universal prestige ranking; snippets as evidence; worker summaries as sources; legal advice |
| Concept-entry model | identity; term inventory; ConceptBrief; characteristics; boundary cases; typed relations; reuse and mapping; evidence; validation; specialist data; governance and maintenance states | executable schema; mandatory full form; invented identifiers |
| Presentation reference | definition answer, audit/revision, and concept-package projections; definition-first order; optional sections; evidence proximity; warning and blocker behavior | old five-section template; research diary by default |
| Serialization reference | explicit representation routing; versioned plain-JSON default; state distinctions; validation disclosure; profile-aware semantics | serializer implementation; superficial TBX/SKOS/RDF/OWL/SHACL conformance |
| Five profiles | activation; questions; distinctions; evidence; validation; prohibited claims; completion additions; reviewed standards and recommendations | one profile's rules silently applied outside scope; copied proprietary text |
| Regression cases and graders | critical semantic, provenance, licensing, mapping, temporal, multilingual, governance, renderer, and deferral strata | process grading based on whether subagents were available; human-usability claims |

### Definition-method acceptance table

The skill must select and justify the least misleading strategy:

| Strategy | Minimum acceptance evidence |
|---|---|
| Intensional | appropriate immediate superordinate concept; essential or delimiting characteristics; sibling and near-miss discrimination |
| Extensional | demonstrably finite/stable extension; scope; explicit exhaustive versus illustrative status |
| Partitive | constitutive whole/part rationale; no genus/species conflation |
| Mixed | clear role for both intension and listed members |
| Operational | explicit procedure or threshold context; separation from a broader concept when methods vary |
| Formal rule or axiom | active formal-ontology profile; textual definition kept separate; proposed versus tool-validated status |
| Perspectival or provisional elucidation | named standpoint or authority boundary; alternatives or unresolved matters preserved; no false canonicality |

### Critical-failure register

Any of the following blocks an unqualified completion or campaign pass regardless of prose quality:

- wrong concept identity, ontological category, scope, or extension;
- circular or materially non-discriminating definition;
- fabricated, inaccessible, superseded-for-context, or misattributed evidence presented as verified;
- verbatim reuse without a supported permission basis;
- false exact equivalence or relation-type confusion;
- invented identifier, standard conformance, validator/reasoner result, review, or release history;
- a critical competency question or boundary case that the definition fails;
- inappropriate profile activation or an out-of-scope compliance claim;
- silent universalization of a contested or community-governed concept; or
- failure to put a responsibly available definition first.

---

## Task 1: Establish the pre-change evidence boundary

**Files:** No repository file changes.

**Interfaces:** Establishes the immutable `current-skill` source revision, target-path inventory, focused-test baseline, configuration-approval boundary, and external-model prohibition before implementation begins.

- [ ] **Step 1: Inspect the complete working tree**

  Run:

  ```text
  git status --short
  git diff -- skills/defining-concepts evals/defining-concepts scripts/evaluation scripts/validateSkillRepository.js tests/evals/defining-concepts tests/scripts README.md evals/README.md
  ```

  Confirm that every pre-existing change is identified as user-owned. In the current planning state, `skills-lock.json` is modified and must remain untouched.

- [ ] **Step 2: Capture the committed current-skill identity**

  Record without modifying files:

  ```text
  git rev-parse HEAD
  git rev-parse HEAD^{tree}
  git ls-tree -r --full-tree HEAD -- skills/defining-concepts
  ```

  The recorded commit becomes the prospective `current-skill` source revision. If the target skill differs from that committed tree when implementation starts, stop and resolve the baseline explicitly rather than guessing which bytes are current.

- [ ] **Step 3: Run focused pre-change tests**

  Run:

  ```text
  node --test tests/evals/defining-concepts/run-evaluation-session.test.mjs tests/evals/defining-concepts/results.test.mjs tests/scripts/skill-repository-validation-contracts.test.mjs tests/scripts/evaluation-runtime.test.mjs
  node scripts/verifySkill.js --skill defining-concepts
  ```

  Record exit status and any existing failures. Do not call these commands proof of candidate behavior; they establish only the local deterministic baseline.

- [ ] **Step 4: Prepare the exact configuration proposal**

  Before changing either JSON manifest, present the user with:

  - the exact new top-level fields and their values;
  - the exact rewritten case records for IDs 1-8;
  - the exact new case records and prompts;
  - every `follow_up_turns` entry;
  - the exact calibration ID list, arms, and one-repetition setting;
  - the complete positive and negative trigger-query diff;
  - the behavior and pipeline impact;
  - confirmation that historical result directories remain unchanged.

  Stop until the user explicitly approves those exact changes. Approval of this implementation plan does not satisfy the repository's configuration-safety requirement.

## Task 2: Define and validate the generic declarative conversation shape

**Files:**

- Modify: `scripts/validateSkillRepository.js`
- Modify: `tests/scripts/skill-repository-validation-contracts.test.mjs`

**Interfaces:**

- Existing one-turn case: required non-empty `prompt`, no `follow_up_turns`.
- Multi-turn case: required non-empty `prompt` plus optional `follow_up_turns` array.
- Follow-up item: exact keys `id` and `prompt`, both non-empty strings.
- Maximum: 31 follow-up turns, for 32 total turns matching the existing adapter bound.

- [ ] **Step 1: Add validator tests for backward-compatible one-turn cases**

  Assert that every existing valid behavioral case remains valid without a `follow_up_turns` field. Assert that adding conversation support does not require changes to other skills' manifests.

- [ ] **Step 2: Add validator tests for valid multi-turn cases**

  Add a case with two ordered follow-ups and assert that validation preserves the supplied order and accepts lowercase ASCII kebab-case IDs.

- [ ] **Step 3: Add rejection tests**

  Cover:

  - non-array `follow_up_turns`;
  - empty arrays, which should be omitted instead;
  - null or non-object items;
  - missing, blank, duplicate, or malformed IDs;
  - missing or blank prompts;
  - unknown keys;
  - more than 31 follow-ups.

- [ ] **Step 4: Run the focused validator tests and confirm RED**

  Run:

  ```text
  node --test tests/scripts/skill-repository-validation-contracts.test.mjs
  ```

  Expected: the new invalid examples are not rejected with the required diagnostics, demonstrating the absent contract.

- [ ] **Step 5: Implement the smallest validator extension**

  Keep `prompt`, `expected_output`, `files`, and `expectations` backward compatible. Validate `follow_up_turns` only when present. Do not introduce a required repository-wide schema version merely to support an optional field.

- [ ] **Step 6: Run the focused validator tests and confirm GREEN**

  Run the command from Step 4. Then run:

  ```text
  node scripts/buildRepository.js --check
  ```

  Confirm that unchanged evaluation suites still validate.

## Task 3: Add the shared scripted-conversation controller

**Files:**

- Create: `scripts/evaluation/scripted-conversation.js`
- Create: `tests/scripts/evaluation-scripted-conversation.test.mjs`
- Modify only if required by the final interface: `scripts/evaluation/runtime.js`
- Modify only if `runtime.js` changes: `tests/scripts/evaluation-runtime.test.mjs`

**Interfaces:**

```js
normalizeEvaluationConversation(evaluationCase)
createScriptedConversationController({ conversation, completeResult })
createScriptedContinuationPolicy({ conversation, controllerSha256 })
```

`normalizeEvaluationConversation` returns one immutable ordered sequence whose first item comes from `prompt` and whose later items come from `follow_up_turns`. Every item exposes a stable ID and one frozen text-input record.

The controller returns `continue` with the exact packet-bound next input until the final scripted user turn has received a completed assistant turn, then returns `complete`. It rejects approval requests by default. Domain-specific grading remains outside the shared module.

- [ ] **Step 1: Write one-turn parity tests**

  Assert that a case containing only `prompt` produces `maxTurns: 1`, the same frozen initial input shape as the existing defining-concepts controller, no continuation templates, and the same authoritative final-answer completion behavior.

- [ ] **Step 2: Write deterministic multi-turn tests**

  For a three-turn script, assert:

  - `maxTurns` equals three;
  - the initial prompt is the controller's initial input;
  - turn 1 continues with follow-up 1 and its stable transition ID;
  - turn 2 continues with follow-up 2;
  - turn 3 completes with the final answer;
  - repeated or out-of-order events are rejected;
  - every exposed object and input item is frozen.

- [ ] **Step 3: Write continuation-policy binding tests**

  Assert that every possible follow-up appears exactly once in the policy templates and allowed transitions, its bytes are canonical, and its identity cannot be swapped after preparation without changing the transmission digest.

- [ ] **Step 4: Write provider-capability tests**

  Confirm that the existing Codex and Antigravity adapters accept the bounded controller shape. Confirm that the Claude adapter rejects `maxTurns > 1` before a provider turn rather than silently truncating the script. Do not broaden the Claude adapter in this issue unless a separate design and test demonstrate safe continuation support.

- [ ] **Step 5: Run the new tests and confirm RED**

  Run:

  ```text
  node --test tests/scripts/evaluation-scripted-conversation.test.mjs tests/scripts/evaluation-runtime.test.mjs
  ```

- [ ] **Step 6: Implement the shared module**

  Use canonical, bounded data; no suite names, semantic keywords, regex graders, or provider-specific branches. Keep the module deep: one declarative conversation in, one controller and one policy out.

- [ ] **Step 7: Run focused tests and confirm GREEN**

  Run the command from Step 5 plus the existing provider-adapter tests selected by `tests/scripts/evaluation-runtime.test.mjs`.

## Task 4: Add immutable skill-bundle capture for three-arm evaluation

**Files:**

- Create: `scripts/evaluation/skill-bundle.js`
- Create: `tests/scripts/evaluation-skill-bundle.test.mjs`

**Interfaces:**

```js
captureGitSkillBundle({ repositoryRoot, revision, skillName })
captureWorkingTreeSkillBundle({ repositoryRoot, skillName })
renderSkillBundle(bundle)
```

Each bundle contains:

- schema version;
- skill name;
- source kind and source identity;
- sorted repository-relative paths;
- exact UTF-8 content and byte length per file;
- SHA-256 per file;
- aggregate SHA-256 over canonical bundle metadata and contents.

- [ ] **Step 1: Write committed-versus-working-tree tests**

  Create a disposable Git fixture with a committed skill and a different working-tree candidate. Assert that committed capture returns the old bytes, working-tree capture returns the new bytes, and neither operation modifies the fixture.

- [ ] **Step 2: Write complete-payload tests**

  Assert that `SKILL.md` and every regular file beneath the skill directory are included in stable path order. Reject a missing `SKILL.md`, path escape, unsupported filesystem entry, invalid UTF-8, and empty skill name.

- [ ] **Step 3: Write digest and rendering tests**

  Assert that changing a path, byte, source revision, or file inventory changes the aggregate digest. Assert that rendering preserves every file boundary with a repository-relative heading and does not collapse two files with the same basename.

- [ ] **Step 4: Run the tests and confirm RED**

  Run:

  ```text
  node --test tests/scripts/evaluation-skill-bundle.test.mjs
  ```

- [ ] **Step 5: Implement deterministic capture**

  Use non-interactive Git object reads for committed bundles and direct filesystem reads for candidate bundles. Disable optional fetches and prompts. Do not check out or restore either version. Reject symlinks or other entry types rather than resolving content outside the skill root.

- [ ] **Step 6: Run the tests and confirm GREEN**

  Run the command from Step 4.

## Task 5: Upgrade the defining-concepts session boundary

**Files:**

- Modify: `evals/defining-concepts/session-controller.mjs`
- Modify: `evals/defining-concepts/run-evaluation-session.mjs`
- Modify: `tests/evals/defining-concepts/run-evaluation-session.test.mjs`

**Interfaces:**

- Canonical new arms: `no-skill`, `current-skill`, `candidate-skill`.
- `no-skill` transmits no task-specific skill bundle.
- `current-skill` consumes one previously captured committed bundle.
- `candidate-skill` consumes one previously captured candidate bundle.
- A case may remain one-turn or carry ordered `follow_up_turns`.
- Every prepared session binds initial prompt, every follow-up, complete skill bundle or absence, provider, model, effort, runtime fingerprint, arm, case ID, and repetition 1.

- [ ] **Step 1: Replace the suite-local one-turn tests with shared-controller parity tests**

  Assert that the suite uses the shared scripted controller without changing one-turn final-answer behavior or approval rejection.

- [ ] **Step 2: Add a defining-concepts clarification fixture**

  Prepare a two-turn case whose first prompt is materially ambiguous and whose follow-up selects one sense. Assert that preparation performs no provider turn, packet metadata reports `maxTurns: 2`, and the exact follow-up bytes appear in the continuation policy.

- [ ] **Step 3: Add three-arm input tests**

  Assert:

  - `no-skill` rejects a bundle;
  - each skill arm requires exactly one bundle manifest and matching content;
  - current and candidate aggregate hashes differ when their bytes differ;
  - arm names in packet metadata use canonical hyphenated forms;
  - repetition other than 1 is rejected for a defining-concepts campaign session;
  - mutating source files after preparation does not change retained inputs.

- [ ] **Step 4: Add authorization tests for follow-up and bundle mutation**

  Mutate a follow-up or referenced profile after preparation and assert that the old authorization cannot launch the changed transmission. Preserve the existing absent-authorization and mismatched-digest tests.

- [ ] **Step 5: Run the focused tests and confirm RED**

  Run:

  ```text
  node --test tests/evals/defining-concepts/run-evaluation-session.test.mjs tests/scripts/evaluation-scripted-conversation.test.mjs tests/scripts/evaluation-skill-bundle.test.mjs
  ```

- [ ] **Step 6: Refactor preparation around captured conversations and bundles**

  Replace `with_skill` and `without_skill` preparation with the three canonical arms. Render complete reference-bearing skill bundles rather than only `SKILL.md`. Include new shared modules in the runtime fingerprint. Keep prepared inputs immutable.

- [ ] **Step 7: Preserve transport-specific capability truth**

  Do not claim live web search for a provider configuration that lacks it. Reject unsupported multi-turn/provider combinations before execution. Keep all existing exact authorization and managed-home safeguards.

- [ ] **Step 8: Run focused tests and confirm GREEN**

  Run the command from Step 5 and all existing defining-concepts runner tests.

## Task 6: Add a deterministic campaign orchestrator

**Files:**

- Create: `evals/defining-concepts/evaluation-runner.mjs`
- Create: `tests/evals/defining-concepts/evaluation-runner.test.mjs`

**Interfaces:**

```text
evaluation-runner.mjs prepare --campaign calibration --destination <new-dir> --baseline-revision <oid> ...
evaluation-runner.mjs run --campaign-dir <prepared-dir> --authorization-dir <dir> ...
evaluation-runner.mjs prepare-grading --campaign-dir <completed-dir> ...
evaluation-runner.mjs aggregate --campaign-dir <graded-dir>
```

`prepare` is read-only with respect to the repository and makes no provider calls. It snapshots approved cases, captures the current and candidate skill bundles once, creates all three arm transmissions, assigns blind aliases from a recorded seed, and writes an immutable campaign manifest.

`run` validates every session's exact authorization before executing it. `prepare-grading` creates blind grading packets but does not call a grader. `aggregate` refuses incomplete or structurally invalid grades.

- [ ] **Step 1: Write a 30-session calibration-matrix test**

  Given ten approved IDs, three arms, and one repetition, assert exactly 30 unique sessions with no duplicate case/arm cell and no `repetition-02` path.

- [ ] **Step 2: Write preparation purity tests**

  Use fake providers and assert `prepare` launches zero model turns, creates a new timestamp-compatible destination, records full ISO-style UTC run identity, and leaves the repository tree and index unchanged.

- [ ] **Step 3: Write freeze and randomization tests**

  Assert that one recorded seed deterministically produces the same blind aliases and ordering, while graders cannot infer `current-skill` or `candidate-skill` from packet names. Preserve an internal sealed mapping for aggregation.

- [ ] **Step 4: Write execution authorization tests**

  Assert that `run` stops before the first provider call when any session authorization is absent, malformed, or mismatched. Do not interpret one authorized session as authorization for the remaining 29.

- [ ] **Step 5: Write grading-packet tests**

  Grading packets contain frozen case expectations, critical markers, qualitative dimensions, relevant transcript and final output, but no arm identity. Pairwise packets randomize current/candidate side assignment and retain the sealed mapping.

- [ ] **Step 6: Write aggregate-integrity tests**

  Assert exact expectation totals, critical-gate totals, per-case and per-profile summaries, pairwise outcomes, disagreement records, token/time summaries, and one-repetition limitations. Reject claims or fields for within-cell variance, standard deviation across repetitions, or per-prompt pass probability.

- [ ] **Step 7: Run tests and confirm RED**

  Run:

  ```text
  node --test tests/evals/defining-concepts/evaluation-runner.test.mjs
  ```

- [ ] **Step 8: Implement the smallest campaign state machine**

  Use explicit states such as `prepared`, `executed`, `grading-prepared`, and `graded`. Never overwrite a completed state artifact. Failed or invalid attempts live under a bounded `invalid-attempts/` branch and never count as valid evidence.

- [ ] **Step 9: Run campaign and session tests and confirm GREEN**

  Run:

  ```text
  node --test tests/evals/defining-concepts/evaluation-runner.test.mjs tests/evals/defining-concepts/run-evaluation-session.test.mjs
  ```

## Task 7: Migrate the evaluation definitions after exact approval

**Blocking prerequisite:** The user has approved the exact configuration proposal from Task 1 Step 4. If not, stop here.

**Files:**

- Modify: `evals/defining-concepts/evals.json`
- Modify: `evals/defining-concepts/trigger-evals.json`
- Create: `tests/evals/defining-concepts/eval-definitions.test.mjs`

**Planned behavioral case inventory:**

| ID | Stable intent | Primary renderer/profile coverage |
|---:|---|---|
| 1 | Dataset versus distribution | Concept package; data definitions; KOS adjacency |
| 2 | Customer contact preference status versus codes and values | Definition answer; data definitions |
| 3 | Document language code representation audit | Revision/audit; data definitions; multilingual terminology |
| 4 | Identity verification outcome versus process | Revision/audit; data definitions |
| 5 | Service availability status defects | Revision/audit; data definitions |
| 6 | Invoice issue date versus neighboring dates | Definition answer; data definitions |
| 7 | Electric charge polysemy and unit separation | Definition answer; terminology core |
| 8 | False authoritative-source attribution | Concept package; source integrity; epistemic caution |
| 9 | Otherwise-unqualified deliberate definition request | Compact definition answer; terminology core; fallback data-definitions profile |
| 10 | Material ambiguity resolved by one follow-up | Multi-turn definition answer; clarification behavior |
| 11 | Cross-scheme concept mapping | Concept package; knowledge organization systems |
| 12 | Competency-question-driven formalization | Concept package; formal ontology |
| 13 | Partial multilingual equivalence | Concept package; multilingual terminology |
| 14 | Contested or authority-dependent concept | Concept package; epistemic governance |
| 15 | Explicit machine-readable concept entry | Serialization; plain JSON default or requested format |
| 16 | Compact-answer overproduction resistance | Definition answer; terminology core; presentation economy |

The exact approved prompt and rubric for each ID must collectively exercise the research-derived failure strata without increasing the agreed 16-case inventory:

- ID 1 distinguishes dataset from distribution and tests exact-source/version/licensing handling.
- IDs 2-6 cover code/value, data-element/concept, representation, process/result, status/category, unit/formula, and neighboring-date traps within actual data-definition scope.
- ID 7 separates polysemous concepts, measurement quantity, unit, and designation.
- ID 8 tests citation attribution, destination-page verification, contradictory or inaccessible evidence, and responsible non-invention.
- ID 9 tests proportional fallback use: the Part 4 discipline may improve wording but must not generate a false registry or compliance claim.
- ID 10 uses ambiguity whose resolution materially changes identity, scope, jurisdiction, threshold, or strategy; one focused follow-up must resolve it without a discovery interview.
- ID 11 distinguishes exact/close/broad/narrow/related mapping, lexical similarity, within-scheme relation, partitive relation, and false equivalence.
- ID 12 separates textual definition, class/property/individual category, necessary/sufficient conditions, constraints, proposed axiom, and actual tool validation.
- ID 13 tests concept-first multilingual work, partial or directional equivalence, designation status, and refusal to infer equivalence from spelling or machine translation.
- ID 14 tests contested or community-governed authority, local versus cross-context formulation, CARE/FAIR distinction, provisional status, and review/co-governance recommendation.
- ID 15 tests typed relations, unknown-state semantics, evidence/version/licensing, no invented identifier, and explicit performed/not-run validation status.
- ID 16 ensures internal rigor does not leak into an unnecessary full package, research diary, numeric confidence, or fixed section template.

Where a single case cannot make a research stratum observable without becoming contrived, record that stratum in the confirmatory-scenario backlog rather than weakening the committed case. Temporal source selection, copyright-restricted wording, fuzzy operational thresholds, exact-versus-close mapping, and affected-community authority receive priority in that backlog if not directly observable in IDs 1-16.

**Planned calibration selection:** IDs `1, 3, 8, 9, 10, 11, 12, 13, 14, 15`, arms `no-skill`, `current-skill`, and `candidate-skill`, exactly one repetition.

- [ ] **Step 1: Write manifest contract tests before changing JSON**

  Assert unique IDs and stable names, the complete coverage matrix, allowed renderer and profile names, exactly one calibration repetition, exactly ten calibration IDs, exactly three canonical arms, and valid follow-up declarations.

  Represent each case's applicable critical gates and qualitative dimensions declaratively. Do not force non-applicable dimensions to receive a score, and do not add a field that rewards use of subagents or batched tools.

- [ ] **Step 2: Write legacy-semantic migration tests**

  For IDs 1-8, assert that critical semantic concerns remain represented and that no expectation contains obsolete requirements such as `five-section`, `five numbered`, `section 2`, `section 3`, or definition placement after introductory material.

- [ ] **Step 3: Write standards-scope tests**

  Assert that an otherwise-unqualified deliberate definition activates the fallback data-definitions profile but does not require or permit an ISO/IEC 11179 compliance claim when the concept falls outside the standard's scope. Assert that user-directed terminology-core-only, KOS-only, ontology-only, multilingual-only, and epistemic-only cases do not require ISO/IEC 11179 compliance. Assert that genuine data-definition cases identify that profile explicitly.

- [ ] **Step 4: Write critical-failure and research-stratum tests**

  Assert that the manifest can mark wrong category or extension, fabricated verification, prohibited wording reuse, false exact mapping, material version error, invented identifier/tool result, failed critical competency question, and illegitimate authority claim as non-compensable. Assert explicit case tags for polysemy, category traps, source integrity, licensing, mapping, temporal/version behavior, multilingual equivalence, epistemic governance, renderer economy, and deferral where they apply.

- [ ] **Step 5: Write trigger-coverage tests**

  Require positive coverage for definition, audit, mapping, ontology, multilingual terminology, and governance-sensitive work. Require negative coverage for casual dictionary lookup, code naming, product naming, copyediting, and implementation-only requests. Require at least two independently worded cases for every newly added trigger or exclusion family rather than relying on one keyword-shaped prompt.

- [ ] **Step 6: Run tests and confirm RED**

  Run:

  ```text
  node --test tests/evals/defining-concepts/eval-definitions.test.mjs tests/scripts/skill-repository-validation-contracts.test.mjs
  ```

- [ ] **Step 7: Apply only the exactly approved JSON changes**

  Preserve the semantic purpose of IDs 1-8, replace their presentation assertions, add the approved new cases, and add only the approved trigger queries. Do not adjust prompts or expectations opportunistically after approval.

- [ ] **Step 8: Run focused validation and confirm GREEN**

  Run:

  ```text
  node --test tests/evals/defining-concepts/eval-definitions.test.mjs tests/scripts/skill-repository-validation-contracts.test.mjs
  node scripts/buildRepository.js --check
  ```

## Task 8: Establish the skill structure and universal router

**Files:**

- Modify: `skills/defining-concepts/SKILL.md`
- Delete: `skills/defining-concepts/references/judicial_plea_status_definition.md`
- Create: `tests/evals/defining-concepts/skill-structure.test.mjs`

**Router contract:** `SKILL.md` is the only model-invoked entry point. It contains the universal choices an agent must not miss and points to detail only at the moment that detail becomes applicable.

- [ ] **Step 1: Inspect the current skill and reference graph**

  Read the complete canonical `SKILL.md`, every current reference, the current eval cases, and repository skill-validation conventions. Record which useful current behaviors must survive: concept orientation, exact-source verification, source roles, category checks, adopt/adapt/formulate discipline, and ISO/IEC 11179-4 formulation checks. Do not treat text absence from the new design as permission to discard one of these behaviors.

- [ ] **Step 2: Write structural and routing tests before editing**

  Assert:

  - all nine planned reference files exist at the exact lower-kebab-case paths in this plan;
  - `SKILL.md` points to each reference with a meaningful activation condition rather than an unconditional "read everything" instruction;
  - the stale judicial example is absent and unreferenced;
  - every local Markdown link resolves;
  - `SKILL.md` is ASCII-only and does not contain automated prose wrapping;
  - the old five-section contract and section-3 definition placement are absent;
  - the universal workflow, four dispositions, three renderer choices, five profile routes, fallback rule, qualitative status, and anti-invention boundary remain discoverable;
  - the parallel-work rule contains an eligibility gate, shared brief/return contract, coordinator ownership, material-evidence reverification, and sequential fallback; and
  - no test requires subagents to be available or spawned.

  Prefer structural invariants and stable headings over brittle snapshots of complete prose.

- [ ] **Step 3: Run the structural test and confirm RED**

  Run:

  ```text
  node --test tests/evals/defining-concepts/skill-structure.test.mjs
  ```

- [ ] **Step 4: Rewrite the trigger and routing boundary**

  Cover deliberate definition, audit, comparison, mapping, formalization, multilingual, and epistemic-governance requests. Exclude casual dictionary lookup, code or product naming, copyediting without semantic work, and implementation-only requests. Route an otherwise-unqualified deliberate definition through the terminology core plus the data-definitions fallback while explicitly limiting ISO/IEC 11179 claims to its scope.

- [ ] **Step 5: Author the proportional universal workflow**

  Encode `Route -> Frame -> Research -> Model -> Decide -> Define -> Validate -> Present` with these minimum decisions:

  - Route: task, target concept, human renderer, requested machine form, profiles, and blocking ambiguity.
  - Frame: proportional ConceptBrief, routine/consequential/authority-sensitive risk, assumptions, and only enough competency questions to expose the intended boundary.
  - Research: evidence lanes, exact destination verification, source roles, licensing gate, and conditional read of `evidence-and-provenance.md`.
  - Model: concept/designation and category distinctions, term inventory when needed, typed concept neighborhood, siblings, positive/negative/near-miss tests.
  - Decide: candidate relationship and permission axes followed by adopt/adapt/formulate/defer and a justified definition strategy.
  - Define: essential or delimiting characteristics only; implementation and example material outside the sentence unless constitutive.
  - Validate: critical semantic, evidence, licensing, mapping, profile, and governance checks plus truthful tool-result states.
  - Present: definition answer, revision/audit, or concept-package projection, definition first when responsible formulation is possible.

  Keep the universal instructions executable at first read. Do not hide a mandatory step only in a reference or duplicate detailed specialist checklists in the router.

- [ ] **Step 6: Encode capability-aware parallel research**

  State that parallel dispatch is optional and allowed only when all conditions hold: at least two bounded workstreams; scopes fixed before dispatch; no overlap or dependency; likely savings exceed coordination overhead; and the environment permits spawning. Prefer batched tool calls for shallow independent lookup. Use subagents for multi-step lanes such as independent standards/registry, domain, mapping, licensing/version, or governance research.

  Give workers the ConceptBrief and require exact destination, role, edition/version, retrieval status, supported claim, boundary evidence, licensing information when material, conflicts, and uncertainty. Keep concept identity, clarification, routing, source eligibility, disposition, mapping, synthesis, conflict resolution, drafting, final validation, and final answer with the coordinator. Require coordinator reverification of uncertain or material sources. Preserve sequential execution when the gate fails.

- [ ] **Step 7: Encode definition strategies and critical completion gates**

  Support intensional, extensional, partitive, mixed, operational, formal rule/axiom, and perspectival/provisional strategies using the design's acceptance table. Keep intensional genus-and-differentia as the default but not a universal requirement. Completion fails or becomes explicitly provisional/deferred after a wrong identity/category, failed critical competency question, non-discriminating boundary, unsupported evidence, licensing problem, false exact mapping, invented result, or illegitimate authority claim.

- [ ] **Step 8: Remove the stale example and run focused checks**

  Delete only `skills/defining-concepts/references/judicial_plea_status_definition.md`. Do not touch historical evaluation artifacts. Run:

  ```text
  node --test --test-name-pattern=router tests/evals/defining-concepts/skill-structure.test.mjs
  ```

  The router-pattern subtests must be GREEN. The complete reference-graph subtest and scoped skill verifier are intentionally deferred until Tasks 9-11 create the planned files; do not describe the partial check as full skill verification.

## Task 9: Author the evidence/provenance contract and concept-entry model

**Files:**

- Create: `skills/defining-concepts/references/evidence-and-provenance.md`
- Create: `skills/defining-concepts/references/concept-entry-model.md`
- Modify: `tests/evals/defining-concepts/skill-structure.test.mjs`

- [ ] **Step 1: Add focused reference-contract tests and confirm RED**

  Test resolvable router links and stable section contracts without snapshotting all prose. Require the evidence reference to cover planning, source eligibility, roles, retrieval/version, claims, conflicts, licensing, negative search, parallel worker returns, and coordinator synthesis. Require the model reference to declare itself format-neutral and cover all ten logical groups from the design plus explicit missing-state distinctions.

  Run:

  ```text
  node --test --test-name-pattern="evidence|concept-entry-model" tests/evals/defining-concepts/skill-structure.test.mjs
  ```

- [ ] **Step 2: Write `evidence-and-provenance.md` around a claim contract**

  Define a retained evidence item using human-readable semantics, not JSON Schema:

  - exact destination and source title/publisher;
  - source role and the specific claim or boundary it supports or contradicts;
  - edition, version, recommendation status, jurisdiction, and applicable date;
  - retrieval date/status and a useful passage, section, or record locator;
  - authority basis for this claim and context;
  - semantic relationship to the target concept;
  - wording permission, attribution requirement, and licensing uncertainty;
  - conflicts, limitations, and whether the source was independently reverified.

  Explain that source prestige is not globally transitive: a legal text, terminology standard, registry, domain ontology, professional body, research paper, corpus, and community authority can govern different claims. A search result, citation record, worker summary, or inaccessible page is discovery evidence only. A bounded unsuccessful search records queries/scopes and uncertainty but does not prove absence.

- [ ] **Step 3: Add the research-lane and conflict protocol**

  Give implementers concrete lanes: governing rules; candidate registries/vocabularies; domain and usage evidence; neighbors/boundaries; mappings; current/historical versions; licensing; and jurisdictional or community authority. Define the shallow-batching versus multi-step-subagent choice and the exact worker return contract from Task 8. When sources disagree, compare concept identity, claim type, scope, authority, version, and intended use; preserve a material disagreement rather than averaging it away.

- [ ] **Step 4: Add the separate semantic-reuse and wording-permission gate**

  Represent semantic relationship as same, broader, narrower, overlapping, related, constituent-only, conflicting, or unresolved. Represent wording action separately as permitted verbatim reuse, attributed quotation, paraphrase, link/citation only, or unresolved. Map those axes plus scope, authority, and version fit to adopt/adapt/formulate/defer. Do not expose the report's R0-R7 codes as a second competing decision system.

- [ ] **Step 5: Write `concept-entry-model.md` as the single semantic record**

  Define these ten groups with field purpose, inclusion conditions, status semantics, and anti-invention rules:

  1. definition;
  2. identity and designation inventory;
  3. ConceptBrief;
  4. characteristics and boundaries;
  5. typed concept system;
  6. reuse, formulation, and mapping;
  7. evidence and provenance;
  8. validation;
  9. active-profile extensions; and
  10. governance and maintenance.

  For relations, include superordinate/broader, narrower/coordinate, partitive, associative, causal, temporal, agent-role, quality-bearer, information-content/carrier, and profile-specific relations without pretending they are interchangeable. For boundaries, distinguish positive examples, negative examples, counterexamples, and near misses. For term records, distinguish preferred, alternative/admitted, hidden, deprecated, forbidden, and candidate status when applicable.

- [ ] **Step 6: Define state and maintenance semantics without infrastructure**

  Distinguish absent, unknown, not applicable, contested, intentionally withheld, not checked, and unsupported. Keep local lifecycle status, reuse disposition, source status, validation result, and review need independent. Preserve supplied persistent IDs, source versions, review dates, change rationale, deprecation, and replacement links; never mint IDs or imply a release manager exists.

- [ ] **Step 7: Run focused tests and review for duplicated sources of truth**

  Run:

  ```text
  node --test --test-name-pattern="evidence|concept-entry-model" tests/evals/defining-concepts/skill-structure.test.mjs
  ```

  Confirm that `SKILL.md` owns execution and completion, the evidence reference owns detailed research/provenance method, and the model owns record semantics. Remove accidental duplication rather than letting the three files drift.

## Task 10: Author definition-first presentation and conditional serialization

**Files:**

- Create: `skills/defining-concepts/references/concept-entry-presentation.md`
- Create: `skills/defining-concepts/references/concept-entry-serialization.md`
- Modify: `tests/evals/defining-concepts/skill-structure.test.mjs`

- [ ] **Step 1: Add renderer and serialization contract tests and confirm RED**

  Require three renderer names, definition-first ordering, optional sections, blocker behavior, and prohibition of the old numbered template. Require serialization to load only on explicit machine-output request, default unspecified machine output to versioned plain JSON, preserve unknown-state distinctions, and prohibit invented identifiers and superficial conformance.

  Run:

  ```text
  node --test --test-name-pattern="presentation|serialization" tests/evals/defining-concepts/skill-structure.test.mjs
  ```

- [ ] **Step 2: Write the compact definition-answer renderer**

  The first substantive block is the definition. Add scope/status, one or more useful boundary tests, source basis, and an open decision only when material. Permit a one-definition-plus-one-sentence answer. Put a warning or clarification before the definition only when omission would materially mislead or no responsible definition can yet be supplied. Omit empty sections, generic section numbering, compliance theater, and research diaries.

- [ ] **Step 3: Write the revision/audit renderer**

  Order the revised definition first, then audit verdict, material changes and consequences, boundary tests, evidence/profile checks, and unresolved decisions. Require defect -> consequence -> remedy reasoning. Preserve the original and revised concept identity so a wording edit does not silently change the concept.

- [ ] **Step 4: Write the concept-package renderer**

  Project the model in this order when populated: definition; identity/designations; purpose/scope/stakeholders/competency questions; characteristics/boundaries; typed relations/reuse/mappings; evidence/provenance/licensing; named active-profile results; status/contestation/maintenance/next action. Use reader-facing headings, not a generic extension bucket. Keep citations adjacent to supported claims and clearly label examples versus near misses.

- [ ] **Step 5: Write conditional serialization rules**

  Route explicit JSON, JSON-LD/RDF, SKOS, OWL, TBX, OntoLex-Lemon, or other requests only when the representation fits the active semantics. Preserve typed relations, language and designation status, identifiers, evidence/version/licensing, null-state distinctions, and proposed versus validated status. State exactly which parser, schema, SHACL, reasoner, or mapping checks were performed, failed, were not run, or were not applicable. Never generate an executable serializer or claim conformance from shape resemblance.

- [ ] **Step 6: Test cross-renderer semantic consistency**

  Add fixtures or assertions proving that definition text, concept identity, disposition, qualitative status, evidence relationship, and unresolved blockers cannot contradict one another merely because a different renderer or representation was selected.

- [ ] **Step 7: Run focused tests**

  Run:

  ```text
  node --test --test-name-pattern="presentation|serialization" tests/evals/defining-concepts/skill-structure.test.mjs
  node --test tests/evals/defining-concepts/eval-definitions.test.mjs
  ```

## Task 11: Author and cross-check the five specialist profiles

**Files:**

- Create: `skills/defining-concepts/references/profiles/data-definitions.md`
- Create: `skills/defining-concepts/references/profiles/epistemic-governance.md`
- Create: `skills/defining-concepts/references/profiles/formal-ontology.md`
- Create: `skills/defining-concepts/references/profiles/knowledge-organization-systems.md`
- Create: `skills/defining-concepts/references/profiles/multilingual-terminology.md`
- Modify: `tests/evals/defining-concepts/skill-structure.test.mjs`

- [ ] **Step 1: Verify primary-source status before authoring**

  For every standard or recommendation named as a rule source, inspect the official primary page or an authorized local copy, record the exact edition/recommendation reviewed and its status as of implementation, and separate normative text from public summaries. Re-check ISO/IEC 11179-5 because a replacement edition was under development during planning. Do not silently substitute a draft, copy proprietary text, or embed machine-specific source paths.

- [ ] **Step 2: Add the common profile contract and confirm RED**

  Require each file to have: activation; additional questions; semantic distinctions; evidence; validation; prohibited claims; completion additions; reviewed sources; and composition notes. Test exact router links and lower-kebab-case ASCII paths. Do not require identical rules or a fixed amount of output.

- [ ] **Step 3: Write `data-definitions.md`**

  Apply ISO/IEC 11179-4:2004 as the reviewed formulation baseline within data and metadata scope and Part 5:2015 only when naming is relevant, subject to Step 1 status verification. Cover data-element concept, object class, property, conceptual domain, value domain, permissible value, representation, field/code/datatype/unit/syntax, and registry-record distinctions when applicable. Provide a checkable immediate-superordinate/delimiting-characteristic audit, circularity and substitutability checks, and the fallback rule. Explicitly prohibit treating ordinary fallback use as ISO/IEC 11179 compliance or registry acceptance.

- [ ] **Step 4: Write `knowledge-organization-systems.md`**

  Apply verified ISO 25964/SKOS guidance to concepts, schemes, collections, labels, notations, documentation notes, semantic relations, and cross-scheme mappings. Distinguish broader/narrower from partitive and associative relations; within-scheme relations from mappings; exact, close, broad, narrow, and related mapping; and SKOS concepts from OWL classes. Require conservative exact-match evidence from intension, extension, scope, system position, and use, not labels alone.

- [ ] **Step 5: Write `formal-ontology.md`**

  Start with competency questions and intended inferences. Distinguish class, individual, property, role, quality, process, information object, and carrier as needed. Separate textual definition, necessary conditions, sufficient conditions, constraints, and mappings. Require justification for domain/range, disjointness, identity, quantification, and cardinality. Use OntoClean-style diagnostics proportionately. Treat OBO and CIDOC CRM as conditional domain practices. Distinguish proposed axioms, parser-valid syntax, SHACL conformance, reasoner consistency/satisfiability, and conceptual correctness; never invent any result.

- [ ] **Step 6: Write `multilingual-terminology.md`**

  Keep concept orientation before translation. Record language variety/script/jurisdiction and designation status where material. Distinguish full, partial, directional, pragmatic, and absent equivalence; shared spelling and machine translation are insufficient. Route TBX terminology exchange, SKOS labels, and OntoLex-Lemon representation only on applicable requests. Flag native/community review for consequential use without claiming it occurred.

- [ ] **Step 7: Write `epistemic-governance.md`**

  Identify whose knowledge, which standpoint or jurisdiction, who has authority, who is affected, and whether disagreement is empirical, terminological, normative, or perspective-dependent. Preserve material alternatives. Apply CARE-informed authority, collective-benefit, responsibility, and ethics questions when applicable, while prioritizing locally supplied governance. State that FAIR or interoperability does not establish legitimacy. Require provisional status, review/co-governance, or deferral when the agent cannot legitimately settle the concept.

- [ ] **Step 8: Test profile composition and scope safety**

  Use fixtures for data-definition plus multilingual, KOS plus multilingual, formal ontology plus epistemic governance, and terminology core alone. Assert additive checks without duplicated output or one profile overriding another's semantic type. Assert that the fallback data profile does not force data-specific fields or compliance claims into an out-of-scope ordinary concept.

- [ ] **Step 9: Run complete skill-focused checks**

  Run:

  ```text
  node --test tests/evals/defining-concepts/skill-structure.test.mjs tests/evals/defining-concepts/eval-definitions.test.mjs
  node scripts/verifySkill.js --skill defining-concepts
  ```

  Inspect failures by stage. Do not change an unrelated skill to make a repository-wide diagnostic disappear.

## Task 12: Preserve historical evidence while supporting the new result schema

**Files:**

- Modify: `tests/evals/defining-concepts/results.test.mjs`
- Do not modify: `evals/defining-concepts/results/**`

- [ ] **Step 1: Add explicit legacy-versus-current schema tests**

  Keep the existing assertions for retained two-arm manifests and grades. Add fixture-level tests for a new three-arm manifest without requiring old manifests to grow new fields.

- [ ] **Step 2: Add current-schema integrity tests**

  Assert that a new result manifest records:

  - three canonical arms;
  - one repetition;
  - current and candidate bundle manifests and aggregate hashes;
  - frozen case and conversation bytes;
  - provider/model/effort/runtime identity;
  - blind mapping seal;
  - per-session transmission hashes;
  - valid/invalid attempt disposition;
  - explicit limitation flags for absent repeated sampling and human usability.

- [ ] **Step 3: Run tests and confirm RED**

  Run:

  ```text
  node --test tests/evals/defining-concepts/results.test.mjs
  ```

- [ ] **Step 4: Implement version-branching assertions only**

  Branch on explicit manifest schema version. Do not infer a schema from missing properties and do not retrofit old artifacts.

- [ ] **Step 5: Run tests and confirm GREEN**

  Run the command from Step 3.

## Task 13: Document operation, grading, limitations, and repository presentation

**Files:**

- Modify: `evals/defining-concepts/README.md`
- Modify: `evals/README.md`
- Modify: `README.md`

- [ ] **Step 1: Rewrite the defining-concepts evaluation README**

  Document:

  - suite goals and non-goals;
  - case taxonomy and renderer/profile coverage;
  - declarative follow-up-turn semantics;
  - three arms and immutable bundle capture;
  - calibration IDs and the 30-session arithmetic;
  - preparation before authorization;
  - separate authorization for every external model and grader transmission;
  - blind critical grading, qualitative dimensions, and pairwise comparison;
  - the non-compensable critical-failure register and why aggregate prose quality cannot override it;
  - the 16-case semantic-stratum map, including category traps, version/licensing, mapping, multilingual, governance, and responsible deferral;
  - exact-equivalence conservatism and the distinction between semantic match and permission to reuse wording;
  - that subagent/batched-tool availability is neither required nor graded as quality;
  - aggregate construction;
  - candidate-iteration invalidation;
  - confirmatory freeze and promotion rule;
  - one-repetition statistical limits;
  - explicit absence of human usability evidence;
  - immutable historical results and their legacy arm names.

- [ ] **Step 2: Update the shared evaluation README**

  Add the generic `follow_up_turns` contract, shared scripted-controller boundary, provider capability preflight, skill-bundle semantics, three-arm naming, and schema-version rule for historical artifacts. Keep suite-specific semantics out of the shared document.

- [ ] **Step 3: Update the root README skill description and tree**

  Replace the metadata-only defining-concepts description with accurate concept-engineering scope and exclusions. Update the skill tree to list the model, evidence/provenance, presentation, serialization, and profile references. Update the docs tree to show the artifact-type-first design and plan hierarchy without moving historical documents.

- [ ] **Step 4: Document the semantic operating protocol**

  In the suite README, give an implementer or grader a concise end-to-end account of ConceptBrief framing, competency questions, candidate-source and licensing decisions, concept-neighbor/boundary analysis, strategy selection, profile checks, validation status, and definition-first projection. Link to the design for normative detail instead of copying the complete skill. Explicitly distinguish always-available semantic checks from optional parser/schema/SHACL/reasoner/tool checks.

- [ ] **Step 5: Record the deferred human study**

  Add a clearly non-blocking "Recommended immediate follow-up: formative usability evaluation" section to the suite README. Preserve the two-round, two-audience, accessibility-aware task protocol. State explicitly that no participant study was executed and it is not a promotion gate for this implementation.

- [ ] **Step 6: Check every documentation link**

  Resolve every new relative link manually or through an existing repository link check if available. Confirm that identical plan/design filename stems resolve through their distinct parent directories.

## Task 14: Run deterministic verification and review the complete change

**Files:** All task files; no new scope.

- [ ] **Step 1: Run the focused test set**

  Run:

  ```text
  node --test tests/evals/defining-concepts/skill-structure.test.mjs tests/evals/defining-concepts/eval-definitions.test.mjs tests/evals/defining-concepts/evaluation-runner.test.mjs tests/evals/defining-concepts/run-evaluation-session.test.mjs tests/evals/defining-concepts/results.test.mjs tests/scripts/evaluation-scripted-conversation.test.mjs tests/scripts/evaluation-skill-bundle.test.mjs tests/scripts/skill-repository-validation-contracts.test.mjs tests/scripts/evaluation-runtime.test.mjs
  ```

- [ ] **Step 2: Run the scoped skill verifier**

  Run:

  ```text
  node scripts/verifySkill.js --skill defining-concepts
  ```

  Record stage-by-stage evidence. This is the task-attributable deterministic gate.

- [ ] **Step 3: Run repository-required verification**

  Run:

  ```text
  npm run verify
  ```

  If an unrelated skill fails, preserve the full evidence and report it separately. Do not modify an untouched skill under this plan. Do not describe the repository-wide gate as passing unless it actually exits successfully.

- [ ] **Step 4: Inspect whitespace and ASCII evidence**

  Run:

  ```text
  git diff --check
  rg --text -n "[^\x00-\x7F]" skills/defining-concepts -g SKILL.md
  ```

  For the diagnostic `rg`, exit 1 with no matches means no non-ASCII byte was found.

- [ ] **Step 5: Review repository state and the complete diff**

  Run:

  ```text
  git status --short
  git diff --stat
  git diff -- skills/defining-concepts evals/defining-concepts scripts/evaluation scripts/validateSkillRepository.js tests/evals/defining-concepts tests/scripts README.md evals/README.md docs/designs/defining-concepts docs/plans/defining-concepts
  ```

  Confirm that `skills-lock.json` remains exactly as the user left it and outside the task diff. Confirm that historical results are unchanged and no provider-generated artifact has appeared.

- [ ] **Step 6: Perform a semantic self-review**

  Check every approved design decision against the final files:

  - universal terminology core plus the approved ISO/IEC 11179 fallback profile for otherwise-unqualified definition requests;
  - definition first;
  - three adaptive renderers;
  - five composable profiles;
  - edition-aware sources;
  - adopt/adapt/formulate/defer;
  - qualitative status;
  - exact evidence roles;
  - proportional ConceptBrief and competency questions;
  - claim-relative authority and direct destination/version verification;
  - semantic relationship separated from wording permission and licensing;
  - concept-system, typed-relation, sibling, positive/negative/near-miss checks;
  - strategy selection beyond genus-and-differentia where justified;
  - routine/consequential/authority-sensitive rigor and review boundaries;
  - capability-aware parallel research with coordinator ownership and sequential fallback;
  - no success or grading requirement tied to subagent availability;
  - always-available versus tool-dependent validation with honest not-run states;
  - cross-renderer identity, status, evidence, and blocker consistency;
  - no invented platform or conformance;
  - one repetition;
  - no human usability claim;
  - three blinded arms;
  - immutable legacy evidence.

- [ ] **Step 7: Review the research recommendation disposition**

  Walk every row in the design's adopt/adapt/defer/reject table against the final diff. Confirm that the implementation contains the adopted semantic capabilities, preserves the adapted four-disposition and five-profile architecture, and has not accidentally introduced the deferred JSON Schema, reasoner/service, registry, workbench, monitoring, human study, or numeric confidence formula. Record any intentional difference as a design change requiring user review rather than silently improvising.

## Task 15: Prepare and authorize the 30-session calibration

**Blocking prerequisite:** Tasks 1-14 pass, candidate bytes are frozen, and the user wants provider-backed evaluation to proceed.

- [ ] **Step 1: Prepare without executing**

  Use `evaluation-runner.mjs prepare` to create a new timestamped calibration directory under `evals/defining-concepts/results/`. Capture all ten approved cases, three arms, one repetition, skill bundles, runtime fingerprints, blind mappings, and 30 exact transmission hashes.

- [ ] **Step 2: Review the frozen campaign**

  Present the user with:

  - exact current and candidate bundle inventories and aggregate hashes;
  - exact ten initial prompts and every follow-up turn;
  - provider, model, and effort;
  - 30 transmission hashes;
  - expected external calls and grading calls;
  - output destination;
  - confirmation that one repetition is enforced.

- [ ] **Step 3: Obtain exact authorization**

  Stop until the user explicitly authorizes the exact frozen campaign transmissions. Do not reuse the earlier four-prompt/eight-run authorization or infer authorization from approval of this plan.

- [ ] **Step 4: Execute each session once**

  Run only authorized sessions. Preserve failures and invalid attempts without silently replacing them. Never rerun an unchanged case/arm cell and call it the same one-repetition campaign.

- [ ] **Step 5: Prepare blind grading packets**

  Freeze critical expectations, applicable qualitative dimensions, relationship-specific mapping criteria, and pairwise packets before any grader call. Each critical decision requires a transcript/output excerpt and a concise reason. Do not score a non-applicable profile or infer source verification from fluent wording. Obtain separate exact authorization for external graders if used.

- [ ] **Step 6: Grade and aggregate**

  Produce expectation evidence, critical-gate outcomes, applicable-dimension judgments, per-profile and per-research-stratum summaries, pairwise outcomes, disagreement records, token/time summaries, and limitations. Report exact/close/broad/narrow/related mapping results separately where labeled cases permit it. Treat any candidate critical failure as non-compensable under the preregistered rule. Do not calculate within-cell variance, standard deviation across repetitions, calibrated confidence, or a general pass probability.

- [ ] **Step 7: Apply the iteration rule**

  If a critical failure or material design problem requires a skill change, close this candidate iteration. Modify the skill through a new test-first cycle, freeze new bytes, create a new timestamped campaign, and obtain new authorization. Do not overwrite the prior campaign.

## Task 16: Freeze and run the confirmatory campaign

**Blocking prerequisite:** Calibration is complete and the candidate remains unchanged or a new candidate iteration has completed its own calibration.

- [ ] **Step 1: Diagnose calibration observability**

  Separate candidate defects from grader ambiguity, case ambiguity, provider failure, and missing evidence. Any rubric correction occurs before confirmatory selection and is documented without rewriting calibration grades.

- [ ] **Step 2: Select independent confirmatory scenarios**

  Add breadth where calibration leaves a capability undersampled. Prioritize any unobserved temporal-version, copyright-restricted wording, fuzzy or operational threshold, false exact mapping, relation-type, multilingual false-friend, source-conflict, or affected-community-authority stratum from the research synthesis. Do not add repetitions of calibration prompts. If new committed cases or trigger queries are required, present their exact configuration diff and obtain separate approval before modifying JSON.

- [ ] **Step 3: Freeze the confirmatory protocol**

  Record exact cases, arms, one repetition, graders, critical gates, pairwise decision rule, promotion thresholds, provider, model, effort, runtime, and transmission hashes before execution.

- [ ] **Step 4: Obtain exact authorization and execute**

  Follow the same prepare-review-authorize-run-grade sequence as calibration. A confirmatory run never borrows calibration authorization.

- [ ] **Step 5: Apply the promotion gate**

  Promote only if deterministic gates pass, no unresolved candidate critical failure remains, preregistered primary comparisons improve over `current-skill`, no capability stratum materially regresses, negative trigger precision is preserved, and evidence is complete.

- [ ] **Step 6: Bound the final claim**

  Report exactly what deterministic, calibration, and confirmatory evidence establish. State the one-repetition and no-human-study limits. Do not generalize to all concepts, models, providers, or expert terminologists.

## Suggested commit boundaries

These are planning units, not commit authorization. If the user later requests commits, load `committing-to-git`, inspect the exact staged snapshot, propose a detailed message, and obtain explicit authorization for each commit.

1. Shared declarative conversation and bundle-capture infrastructure with tests.
2. Defining-concepts evaluation runner, manifest migration, and protocol tests.
3. Canonical skill router, concept-entry references, and five profiles.
4. Repository and evaluation documentation plus final deterministic verification evidence.
5. Retained provider-backed campaign evidence, only after exact external-model authorization and successful campaign completion.

Do not combine unrelated `skills-lock.json` content with any of these boundaries.

## Recommended immediate follow-up: formative usability evaluation

This follow-up is deliberately outside implementation and promotion.

- Conduct two iterative rounds.
- Recruit four ordinary likely users and four terminology, metadata, KOS, or ontology specialists per round.
- Include relevant disability or assistive-technology needs where recruitment permits.
- Use no more than five neutral, realistic tasks per participant.
- Test whether users can locate the definition, understand status and scope, distinguish examples from near misses, identify source basis and profile use, and determine the next action.
- Capture informed consent, access needs, task outcomes, observed confusion, severity, and redesign decisions without storing unnecessary personal data in the repository.
- Revise between rounds rather than treating the small qualitative sample as a quantitative benchmark.
- Report observed findings without claiming statistical representativeness.
