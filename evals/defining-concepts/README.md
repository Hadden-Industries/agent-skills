# Evaluating `defining-concepts`

This maintainer-only suite evaluates the deployable [`defining-concepts`](../../skills/defining-concepts/SKILL.md) skill as a concept-engineering workflow. It tests whether the skill identifies the intended concept, distinguishes neighboring concepts and representations, makes conservative reuse and mapping decisions, uses evidence honestly, composes only applicable specialist profiles, validates what it can actually validate, and presents the definition before supporting material whenever responsible formulation is possible.

The suite is not installed with the skill. The repository-wide [evaluation runtime](../README.md) owns packet preparation, skill-bundle capture, exact external-call authorization, provider adapters, evidence retention, failure classes, and historical-schema handling. This document owns only the `defining-concepts` cases, campaign policy, semantic grading, promotion rules, and operator procedure. The normative architecture and semantic decisions are in the [concept-engineering design](../../docs/designs/defining-concepts/2026-08-29-concept-engineering.md); the [implementation plan](../../docs/plans/defining-concepts/2026-08-29-concept-engineering.md) records the test-first delivery sequence and campaign checkpoints.

## Status

The 16-case schema, three-arm runner, scripted follow-up controller, immutable bundle capture, blinded grading-packet preparation, aggregation contract, and concept-engineering skill are implemented. Deterministic validation is separate from provider-backed behavioral evidence.

The retained directories [`2026-08-24T092645.127Z`](./results/2026-08-24T092645.127Z/) and [`2026-08-24T141214.748Z`](./results/2026-08-24T141214.748Z/) are immutable legacy evidence from the earlier eight-case, two-arm protocol. Their `with_skill` and `without_skill` arm names, five-section output assumptions, runner behavior, and recorded limitations remain historical facts; they are not rewritten to resemble the current `no-skill`, `current-skill`, and `candidate-skill` protocol. The later legacy run diagnosed critical exact-URL trace failures and did not accept that candidate. Neither legacy run supports a general performance claim.

No current 30-session calibration, confirmatory campaign, trigger study, or participant usability study has been completed merely because the deterministic suite passes. A newly prepared campaign requires exact authorization before any model transmission.

## Goals and non-goals

The suite is designed to expose differences that fluent prose can hide:

- concept identity, ontological category, scope, granularity, and extension;
- discriminating characteristics, siblings, positive instances, negative instances, and near misses;
- source authority, retrieval, edition or version, attributed evidence role, conflict, and negative-search limits;
- the difference between semantic match and permission to reproduce source wording;
- `adopt`, `adapt`, `formulate`, and `defer` decisions;
- exact, close, broad, narrow, related, or unsupported mappings without label-based equivalence;
- appropriate use of the data-definition, formal-ontology, knowledge-organization-system, multilingual-terminology, and epistemic-governance profiles;
- definition-first projection through a compact answer, revision audit, or full concept package;
- honest separation of semantic checks from parser, schema, SHACL, reasoner, registry, or other tool-dependent checks; and
- responsible clarification or deferral when identity, authority, evidence, or operational thresholds are not yet settled.

The suite does not certify ISO, W3C, OBO, CIDOC CRM, FAIR, CARE, TBX, OntoLex-Lemon, registry, ontology, legal, or community-governance conformance. It does not establish universal concept quality, provider-independent performance, expert consensus, calibrated confidence, statistical significance, within-cell variance, or human usability. It does not grade whether a host happened to expose subagents or batched tools; those are optional execution accelerators, not quality criteria.

## Suite surfaces

| File | Responsibility |
| --- | --- |
| [`evals.json`](./evals.json) | Sixteen behavioral cases, renderers, profiles, research strata, applicable qualitative dimensions, critical expectation indexes, and the calibration selection. |
| [`trigger-evals.json`](./trigger-evals.json) | Positive and negative activation prompts for the skill description, separate from behavioral quality. |
| [`evaluation-runner.mjs`](./evaluation-runner.mjs) | Three-arm campaign preparation, deterministic ordering and blinding, all-session authorization precheck, one-shot execution, grading-packet preparation, and aggregation. |
| [`run-evaluation-session.mjs`](./run-evaluation-session.mjs) | One packet-bound provider session with an immutable case, optional skill bundle, exact conversation, runtime fingerprint, evidence directory, and authorization boundary. |
| [`session-controller.mjs`](./session-controller.mjs) | Suite wrapper around the shared scripted-conversation controller; it rejects approval requests and supplies only committed follow-up turns. |
| [`results/`](./results/) | Immutable provider evidence and separate derived grading or aggregation artifacts, versioned by a filesystem-safe UTC start timestamp. |

Passing trigger cases says nothing about semantic quality. Passing deterministic behavioral-contract tests says nothing about model behavior. A provider run without complete retained evidence cannot establish the claims that its evidence omits.

## Semantic operating protocol

The grader evaluates the observable result of the same workflow the skill directs. The internal work is proportional: a one-sentence glossary request should not expose a registry workbench, while an authority-sensitive concept package should not skip the decisions on which responsible reuse depends.

1. **Route.** Identify the candidate concept, task, requested renderer or machine representation, applicable specialist profiles, and any ambiguity that blocks responsible work. An otherwise-unqualified deliberate request to define a concept uses the terminology core plus the ISO/IEC 11179 data-definitions profile as a disciplined fallback, without pretending that the concept is a registered metadata object or claiming standards compliance.
2. **Frame.** Build a proportional ConceptBrief covering only material purpose, use and non-use, scope, audience, jurisdiction or scheme, granularity, time or version context, stakeholders and affected communities, assumptions, qualitative risk, and competency questions. Ask one focused clarification when a material ambiguity cannot be resolved safely; do not conduct a generic intake interview.
3. **Research.** Plan bounded evidence lanes for governing standards, authoritative registries, domain sources, neighboring concepts, version history, mappings, licensing, and community or jurisdictional authority. Record the exact destination, source role, edition or version, retrieval status, supported claim, boundary evidence, wording permission when material, and conflicts or uncertainty. A search result, worker summary, or topical homepage is not automatically evidence for the claimed proposition.
4. **Model.** Keep concept identity separate from designations, definitions, codes, fields, value domains, permissible values, documents, carriers, datasets, distributions, processes, results, agents, roles, quantities, units, and serializations. Model essential characteristics, positive and negative boundaries, near misses, siblings, and typed relations only to the depth needed to answer the competency questions.
5. **Decide.** Compare candidate sources for intension, extension, scope, granularity, authority, version, system position, intended use, and wording permission. Choose and justify `adopt`, `adapt`, `formulate`, or `defer`. Record semantic relationship separately from mapping predicate and separately again from permission to copy wording.
6. **Define.** Select a suitable strategy rather than forcing genus-and-differentia where operational, extensional, partitive, functional, relational, ostensive, or mixed formulation is better. Keep the wording standalone, positive where possible, non-circular, category-correct, discriminating, and free from accidental implementation details.
7. **Validate.** Always perform the semantic checks available through reasoning: identity, category, scope, substitutability, sibling and boundary discrimination, competency-question coverage, evidence-role fit, mapping conservatism, active-profile rules, cross-renderer consistency, and non-invention. Run parser, JSON Schema, SHACL, reasoner, registry, or other tool checks only when the tool and representation actually exist; report each as `performed`, `passed`, `failed`, or `not run` rather than implying execution.
8. **Present.** Project one internal concept entry through the requested renderer. Put a responsibly available definition first, keep warnings ahead of it only when proceeding would otherwise mislead, distinguish examples from near misses, place citations beside supported claims, expose unresolved issues and next actions, and keep identity, status, disposition, evidence, and blockers consistent across human and machine views.

When a host can spawn subagents, independent multi-step evidence or validation lanes may run in parallel if their scopes do not overlap and coordination is worthwhile. Batched tool calls suit shallow independent lookups. The coordinating agent still owns identity, clarification, profile selection, source eligibility, conflict resolution, reuse and mapping decisions, synthesis, validation, and the final answer. Sequential work is fully valid, and neither subagent nor batching availability is required or graded.

## Case taxonomy and coverage

The committed suite contains 16 distinct semantic pressure tests. `definition-answer`, `revision-audit`, and `concept-package` are presentation projections, not different semantic records. `terminology-core` is always active; the other profiles compose only where listed. `Yes` in the calibration column means the case is in the currently committed 10-case campaign.

| ID | Case | Renderer | Specialist profiles beyond the terminology core | Research strata | Calibration |
| ---: | --- | --- | --- | --- | :---: |
| 1 | Dataset versus distribution | Concept package | Data definitions; KOS | Category trap; source integrity; temporal version; licensing | Yes |
| 2 | Contact-preference status versus values, code, and field | Definition answer | Data definitions | Category trap; renderer economy | No |
| 3 | Document-language representation versus language and document | Revision audit | Data definitions; multilingual terminology | Category trap; source integrity; temporal version; multilingual equivalence | Yes |
| 4 | Identity-verification outcome versus process | Revision audit | Data definitions | Category trap | No |
| 5 | Availability status with circular, negative, and abbreviated wording | Revision audit | Data definitions | Category trap; renderer economy | No |
| 6 | Invoice issue date versus neighboring dates | Definition answer | Data definitions | Category trap; renderer economy | No |
| 7 | Electric charge polysemy, quantity, unit, and designation | Definition answer | None | Polysemy; category trap | No |
| 8 | False authoritative-source attribution | Concept package | Data definitions; epistemic governance | Source integrity; responsible deferral; licensing | Yes |
| 9 | Unqualified definition and ISO/IEC 11179 fallback | Definition answer | Data definitions | Category trap; renderer economy | Yes |
| 10 | Ambiguous regulated threshold requiring one clarification | Definition answer | Data definitions | Category trap; temporal version; responsible deferral | Yes |
| 11 | Cross-scheme broad or narrow mapping versus false exact match | Concept package | KOS | Mapping; category trap | Yes |
| 12 | Competency-question-driven ontology formalization without tools | Concept package | Formal ontology | Category trap; responsible deferral | Yes |
| 13 | Partial multilingual equivalence and review need | Concept package | Multilingual terminology | Multilingual equivalence; polysemy; responsible deferral | Yes |
| 14 | Community-governed concept and competing authority | Concept package | Epistemic governance | Epistemic governance; responsible deferral; licensing | Yes |
| 15 | Versioned plain-JSON projection and missing-state distinctions | Concept package | Data definitions | Source integrity; temporal version; licensing; responsible deferral | Yes |
| 16 | One- or two-sentence definition economy | Definition answer | None | Renderer economy; category trap | No |

This map deliberately covers category traps, temporal and edition status, source integrity, wording permission, mapping direction, multilingual non-equivalence, governance and affected-community authority, operational thresholds, machine serialization, and responsible deferral. It does not turn every case into a research-heavy package: cases 2, 6, 9, and 16 help detect unnecessary ceremony and output bloat.

Case 10 declares one `follow_up_turns` item. The first turn must elicit only the focused threshold and jurisdiction clarification. The controller then sends the exact committed follow-up bytes; it neither improvises a response nor allows the model to choose a different branch. All other cases are single-turn conversations.

## Three-arm campaign

The calibration declaration freezes case IDs `1, 3, 8, 9, 10, 11, 12, 13, 14, 15`, canonical arms `no-skill`, `current-skill`, and `candidate-skill`, and exactly one repetition. The arithmetic is therefore 10 cases x 3 arms x 1 repetition = **30 externally executed model sessions**.

The arms answer different questions:

- `no-skill` receives the identical task and harness but no defining-concepts bundle. It estimates what the isolated model does from first principles.
- `current-skill` receives an immutable complete skill-directory bundle captured from the operator-selected baseline Git revision. It represents the deployed comparison point, not whatever happens to be at `HEAD` later.
- `candidate-skill` receives an immutable complete bundle captured from the working tree at preparation time. It represents the exact proposed bytes under evaluation.

Each bundle contains the full deployable skill inventory, per-file byte lengths and SHA-256 values, source identity, and an aggregate SHA-256. The treatment is the rendered bundle, not only `SKILL.md`; otherwise reference-heavy skills would be evaluated incompletely. The campaign manifest captures each case record, prompt and follow-up conversation digest, runtime fingerprint, provider, model, effort, blind alias, arm, repetition, bundle digest, and transmission SHA-256.

The recorded seed deterministically orders cells and creates opaque aliases. The private arm mapping remains under `sealed/`; graders receive aliases and outputs without arm labels. `prepare` refuses an existing destination, a non-timestamp destination, a repeated campaign cell, identical current/candidate bundles, or a campaign other than the declared canonical matrix.

## Provider capability preflight

Provider choice is part of the treatment and must be frozen before authorization. Preparation inspects the selected executable, adapter contract, authentication boundary where a zero-turn check exists, working directory, runtime files, and declared capabilities. Unsupported combinations fail before a model turn rather than silently dropping behavior.

The current adapter profiles are materially different:

| Provider option | Transport | Declared network/web capability | Scripted follow-ups | Consequence |
| --- | --- | --- | --- | --- |
| `codex` | Codex App Server | No network, no web search, no tools | Supported | Source retrieval cannot be claimed; the model must use supplied evidence, qualify remembered knowledge, or defer. |
| `claude` | Claude CLI | Network plus `WebSearch` and `WebFetch` | More than one turn rejected | The complete calibration cannot currently include case 10 through this adapter. |
| `antigravity` | Antigravity CLI | No network or web search; no tool or subagent steps permitted | Supported by the shared bounded controller | Useful for isolated reasoning behavior, but not direct-source verification. |

Do not pool or compare provider profiles as though they offered the same evidence opportunities. An independent verifier can establish that a destination is reachable and semantically relevant, but it cannot retroactively prove that a no-web executor retrieved it. Conversely, a tool event does not by itself prove that the returned source supported the claim. Subagent and batched-tool availability are not quality requirements.

### Matched model-effort groups

The 2026-08-29 calibration protocol uses two separately frozen OpenAI groups with identical cases, arms, bundles, and single-agent provider policy:

- the representative group uses exact model `gpt-5.6-sol` at the installed model catalog's declared default effort, `low` when this iteration was designed; and
- the capability-ceiling group uses exact model `gpt-5.6-sol` at `max`, the catalog's maximum reasoning-depth setting that preserves the same single-agent topology.

The catalog also exposes `ultra`, described as maximum reasoning with automatic task delegation. That is a different capability treatment, not merely a higher value on the matched single-agent effort axis. Do not use it as the ceiling group, silently permit delegation in the existing no-tools policy, or pool a future `ultra` campaign with these results. An `ultra` evaluation requires its own preregistered capability declaration, adapter review, authorization, grading, and limitations.

Prepare, authorize, execute, grade, and aggregate the representative and capability-ceiling groups as two campaign directories. Each group has 10 cases x 3 arms x 1 repetition = 30 sessions and at most 33 turns; together they have 60 sessions and at most 66 turns. One repetition is enforced per case/arm/model-effort cell. Effort groups are conditions, not repetitions, and their scores remain separate.

## Prepare, review, authorize, and run

Preparation is local-only and launches zero model turns. Use a new filesystem-safe UTC directory name derived from the same `--started-at` value, for example `2026-08-29T123456.789Z`; the colons are omitted only from the directory name. Use a fresh non-repository `--working-root`. For Codex, bind the reviewed executable and name the initialized managed evaluation-homes root.

```text
node evals/defining-concepts/evaluation-runner.mjs prepare --campaign calibration --destination <absolute-results/UTC-timestamp-directory> --baseline-revision <full-commit-oid> --provider codex --model <exact-model-id> --effort <exact-effort> --seed <reviewed-stable-seed> --started-at <RFC-3339-UTC-timestamp> --working-root <absolute-fresh-working-root> --codex-command <absolute-reviewed-codex-executable> --evaluation-homes-root <absolute-managed-evaluation-homes-root>
```

Provider-specific preparation may additionally use the repeatable prefix arguments accepted by the runner. On Windows, `--codex-command` must resolve directly to a native `.exe` or `.com`; command wrappers and scripts are rejected because closing a wrapper does not prove that its App Server descendant has closed. Do not substitute a mutable label such as `latest` for an exact model identifier when the provider offers a stable exact ID.

Before execution of either group, review and disclose:

1. the campaign destination and `manifest.json`;
2. both bundle inventories, their source identities, every file digest, and both aggregate hashes;
3. all ten exact initial prompts and the exact case-10 follow-up;
4. provider, model, effort, toolchain, runtime fingerprint, isolation, and capability declaration;
5. all 30 transmission SHA-256 values and the intended call and turn count for that group; and
6. the enforced one-repetition limitation.

Preparation, implementation approval, login, an earlier campaign authorization, authorization of the other model-effort group, and authorization of one cell do not authorize any of the 30 transmissions in a group. Obtain an exact authorization artifact for **every** prepared session. `run` verifies all 30 artifacts before the first provider call, so a missing or mismatched authorization cannot create a partial campaign. A single conversational authorization may cover both groups only when it explicitly identifies both manifest digests, both exact efforts, the two disclosed hash lists, the 60-session and 66-turn ceilings, and whether any grading calls are included.

```text
node evals/defining-concepts/evaluation-runner.mjs run --campaign-dir <absolute-campaign-directory> --authorization-dir <absolute-authorization-directory>
```

Execute each authorized cell once. Preserve terminal failures and invalid attempts. Never rerun an unchanged case/arm cell and describe the replacement as part of the same one-repetition campaign. A provider or infrastructure failure is evidence about that attempt, not permission to select a more favorable output.

## Blind grading protocol

### Freeze the evidence before grading

After execution, prepare the packets locally:

```text
node evals/defining-concepts/evaluation-runner.mjs prepare-grading --campaign-dir <absolute-campaign-directory>
```

This writes one critical packet per session and one randomized current-versus-candidate pair per case. It also seals the pairwise side mapping. The no-skill arm receives critical and applicable-dimension grading but is not part of the primary current-versus-candidate pairwise comparison.

If a human grades locally, record the method and reviewer. If an external model grades, freeze the exact grader instructions, model, effort, packets, runtime, and transmission hashes and obtain separate exact authorization for every grader transmission. Authorization of the 30 execution sessions never authorizes grading calls. Do not reveal arm mappings until all blind judgments and disagreement records are frozen.

### Apply critical gates first

Every expectation named by `critical_expectation_indexes` requires a pass/fail judgment, an output or transcript excerpt, and a concise reason. The suite-level critical-failure register is non-compensable:

1. wrong identity, category, scope, or extension;
2. circular or non-discriminating definition;
3. fabricated, inaccessible, superseded, or misattributed evidence;
4. unsupported verbatim reuse;
5. false equivalence or relation confusion;
6. invented identifier, conformance, validation, or history;
7. failed critical competency question or boundary case;
8. inappropriate profile or out-of-scope compliance claim;
9. illegitimate universalization or authority claim; or
10. failure to put a responsibly available definition first.

A fluent answer, favorable pairwise preference, or strong result on another dimension cannot compensate for any applicable critical failure. Report critical outcomes separately and preserve the exact case expectation that triggered each one.

### Grade only applicable qualitative dimensions

The case manifest selects among seven qualitative dimensions:

- `semantic-accuracy`;
- `boundary-discrimination`;
- `evidence-adequacy`;
- `reuse-and-licensing-judgment`;
- `profile-correctness`;
- `validation-honesty`; and
- `presentation-economy`.

Judge each selected dimension qualitatively with cited evidence. Do not force a score for a profile or capability the case does not exercise, convert missing evidence into a middling numeric score, sum dimensions into model confidence, or describe an aggregate as a calibrated probability. Record ambiguity and grader disagreement rather than resolving it through undocumented averaging.

Each `grading/grades/<blind-alias>.json` record must contain the exact frozen critical-expectation IDs and exact applicable dimension IDs for that session. Every judgment needs a nonempty excerpt and reason; critical outcomes are Boolean, while qualitative ratings remain concise labels chosen by the frozen grader protocol. Tokens and duration come from the retained execution evidence and may be `null` only when the provider did not expose them.

```json
{
  "blindAlias": "sample-0123456789abcdef",
  "critical": [
    {
      "expectationId": "expectation-01",
      "passed": true,
      "excerpt": "The exact supporting output excerpt.",
      "reason": "Why the excerpt passes the frozen critical expectation."
    }
  ],
  "dimensions": [
    {
      "id": "semantic-accuracy",
      "rating": "meets",
      "excerpt": "The exact supporting output excerpt.",
      "reason": "Why this qualitative judgment follows."
    }
  ],
  "tokens": 1234,
  "durationMs": 5678
}
```

After blind side judgments are frozen and the sealed map is applied, each `grading/pairwise-grades/<case-id>.json` contains exactly one committed case ID, an outcome of `candidate`, `current`, or `tie`, and a nonempty excerpt and reason. Aggregation rejects missing, duplicate, extra, uncited, or structurally invalid session and pairwise grades.

```json
{
  "caseId": 1,
  "outcome": "candidate",
  "excerpt": "The difference that determined the comparison.",
  "reason": "Why the candidate is preferred under the frozen criteria."
}
```

### Preserve evidence roles

For every material source claim, distinguish at least these questions:

| Evidence question | What establishes it | What it cannot establish alone |
| --- | --- | --- |
| Did the executor retrieve the exact destination? | A retained completed URL-specific action or equivalent direct retrieval evidence. | Reachability now, semantic support, or wording permission. |
| Is the destination reachable and the asserted edition or version current for the claim? | Independent direct retrieval and status/version inspection. | That the executor retrieved it during the run. |
| Does the content support the attributed semantic role? | Inspection of the term, definition, relationship, scope, or methodological statement actually relied upon. | Permission to copy the wording or universal authority. |
| May source wording be reused verbatim? | A verified license, public-domain rule, permission, or other applicable rights basis. | Semantic equivalence; a license does not make two concepts identical. |

Exact or close semantic fit is a concept judgment. Permission to copy text is a rights judgment. Keep them separate even when both decisions concern the same source. A failed search is bounded evidence about the searched destinations and query; it is not proof that no definition exists.

### Compare current and candidate blindly

For each case, judge the randomized pair as candidate-preferred, current-preferred, or tied only after applying critical gates and the case's applicable dimensions. Cite the output differences that determine the result. Use the sealed mapping only after judgments are frozen. Report exact, close, broad, narrow, related, and unsupported mapping behavior separately where a labeled case permits it; do not collapse all mapping correctness into generic prose quality.

## Aggregate construction and decision rules

Place one complete grade record per blind session in `grading/grades/`, one pairwise outcome per case in `grading/pairwise-grades/`, and any adjudication or unresolved disagreement in `grading/disagreements.json`. Then run:

```text
node evals/defining-concepts/evaluation-runner.mjs aggregate --campaign-dir <absolute-campaign-directory>
```

Each generated aggregate reports critical totals and whether the candidate has any critical failure; dimension-observation counts; coverage by case, skill profile, and research stratum; candidate/current/tie pairwise totals; disagreement records; retained token and elapsed-time totals; and the one-repetition, no-variance, no-human-usability, and no-calibrated-pass-probability limitations. Freeze both group aggregates before producing a bounded cross-profile synthesis. Never pool the scores, treat effort groups as repetitions, or let strong ceiling-group prose compensate for a representative-group critical failure. Raw packets, outputs, transcripts, provider evidence, and individual grades remain authoritative. Each aggregate is a derived index, not a substitute for reading failures.

Calibration is diagnostic. Separate candidate defects from case ambiguity, grader ambiguity, provider failure, and absent evidence. If a critical failure or material design defect requires any candidate skill byte to change, close that iteration: keep its campaign immutable, make the change through a new test-first cycle, capture a new bundle, prepare a new timestamped campaign, and obtain new authorization. Never overwrite or relabel the prior campaign.

Confirmation uses independent scenarios selected only after calibration diagnosis. Freeze its cases, arms, one repetition, graders, critical gates, pairwise rule, provider, model, effort, runtime, and transmission hashes before execution, then obtain new execution and grading authorization. Do not reuse calibration prompts as confirmatory repetitions or borrow calibration authorization.

Promote a candidate only when deterministic gates pass, calibration and confirmation are complete, no unresolved candidate critical failure remains, preregistered primary comparisons improve over `current-skill`, no semantic capability stratum materially regresses, negative-trigger precision is preserved, and the evidence record is complete. Bound any final claim to the tested cases, exact model and provider profile, one repetition, and lack of participant evidence.

## Trigger protocol

`trigger-evals.json` evaluates the frontmatter description, not an already-loaded skill body. Positive cases cover deliberate concept definition, audit, concept-package, mapping, ontology, multilingual, governance, and machine-readable entry requests. Negative near misses cover adjacent explanation, coding, translation, naming-only, formatting, value-domain, and unrelated work.

Record activation decisions and report precision, recall, false-positive rate, and false-negative rate. The current one-repetition behavioral rule does not create a trigger reliability estimate. If activation wording is optimized, keep a separately frozen held-out paraphrase set; selecting and reporting against the same development prompts measures prompt fitting rather than generalization.

## Result layout and historical immutability

New campaign directories use the filesystem-safe UTC timestamp at which preparation freezes the candidate, formatted `YYYY-MM-DDTHHmmss.SSSZ`. The full RFC 3339 value with punctuation remains in `manifest.json`. The timestamp alone is collision-resistant to milliseconds, portable on Windows, and semantically preferable to repeating mutable provider or purpose labels in the directory name.

Current prepared campaigns use this high-level layout:

```text
results/<UTC-timestamp>/
    manifest.json
    bundles/
        current-skill.json
        candidate-skill.json
    cases/
        case-<id>.json
    sessions/
        sample-<blind-id>/
            case.json
            skill-bundle.json       # absent for no-skill
            packet.json
            prepared/
    sealed/
        blind-mapping.json
        pairwise-mapping.json       # after grading preparation
    executed.json                   # after campaign execution
    grading/
        critical/
        pairwise/
        grades/
        pairwise-grades/
        disagreements.json
    grading-prepared.json
    aggregate.generated.json
    invalid-attempts/
```

Historical result schemas are read by explicit version branches. Do not rename their arms, retrofit new packet guarantees, rewrite raw outputs, recompute old hashes in place, or treat an absent current field as proof that the old run satisfied it. The legacy `2026-08-24T092645.127Z` generated aggregate contains known repetition and token-accounting defects; its retained raw run and timing artifacts remain the authority. Corrections to any campaign create a new derived record naming what it supersedes.

## Deterministic verification

Run the focused suite before repository-wide verification:

```text
node --test tests/evals/defining-concepts/skill-structure.test.mjs tests/evals/defining-concepts/eval-definitions.test.mjs tests/evals/defining-concepts/evaluation-runner.test.mjs tests/evals/defining-concepts/run-evaluation-session.test.mjs tests/evals/defining-concepts/results.test.mjs tests/scripts/evaluation-scripted-conversation.test.mjs tests/scripts/evaluation-skill-bundle.test.mjs tests/scripts/skill-repository-validation-contracts.test.mjs tests/scripts/evaluation-runtime.test.mjs
node scripts/verifySkill.js --skill defining-concepts
npm run verify
```

These commands validate manifests, exact conversations, bundles, runner boundaries, historical fixture compatibility, skill structure, ASCII and physical-line policy, generated-artifact currency, repository tests, lint, and whitespace. They do not call a provider, grade concept quality, verify live sources, estimate trigger reliability, or establish user comprehension.

## Known limitations

- One repetition supplies no within-cell variance, standard deviation, calibrated pass probability, or statistical significance. Pairwise results are observations for the exact frozen sessions.
- Live standards status, vocabulary destinations, licensing, jurisdictional rules, and source content can change. A run is evidence only for its recorded time and retrieval state.
- Provider adapters expose different tools, isolation guarantees, native instructions, model-identity evidence, and transcript detail. Requested model identity is not provider-confirmed identity when the provider does not echo it.
- Many concepts admit multiple defensible formulations. Exact-string grading would reward imitation; semantic expectations and cited qualitative judgments still require expert interpretation.
- The 16 cases are stratified regression examples, not exhaustive coverage of domains, languages, disability access, legal systems, Indigenous governance, ontology formalisms, or metadata registries.
- No human participant evidence currently establishes that ordinary users or specialists can find, understand, trust, or act on the projected entry.

## Recommended immediate follow-up: formative usability evaluation

This study is deliberately non-blocking and was not executed as part of implementation or promotion. Run it as soon as practical after the machine-evaluation protocol is stable:

- conduct two iterative rounds, revising the presentation between rounds;
- recruit four ordinary likely users and four terminology, metadata, KOS, or ontology specialists per round;
- include relevant disability and assistive-technology needs where recruitment permits, and record access needs without unnecessary personal data;
- give each participant no more than five neutral, realistic tasks covering definition discovery, scope and status, examples versus near misses, source/profile interpretation, and the next action;
- capture informed consent, task outcomes, observed confusion, severity, accessibility findings, and redesign decisions; and
- report the small qualitative sample as formative evidence, never as statistically representative usability validation.

Until such a study is completed, every campaign and promotion report must state `humanUsabilityEvaluated: false` and avoid claims about end-user usability.
