# Defining Concepts: Concept Engineering Design

**Status:** Approved for implementation planning on 2026-08-29.

**Implementation plan:** [`2026-08-29-concept-engineering.md`](../../plans/defining-concepts/2026-08-29-concept-engineering.md)

## Goal

Transform `defining-concepts` from a metadata-only, fixed-template definition generator into a source-grounded concept-engineering skill that can define, revise, audit, compare, map, formalize, and govern concepts while keeping ordinary answers concise and definition-first.

The redesign remains a repository-native instruction skill. It does not create an executable semantic platform, a terminology registry, an ontology service, or a review application.

## Success boundary

Immediate success means measurable improvement over the current canonical skill on a committed, blinded, three-arm evaluation protocol. The redesign does not claim general superiority over expert terminologists and does not use uncalibrated numeric confidence or pseudo-probability formulas.

The implementation can claim that its presentation follows researched information-structure, accessibility, terminology, and provenance guidance. It cannot claim observed human usability because human-participant evaluation is explicitly deferred.

## Research synthesis

This design incorporates the applicable findings from the 34-source deep research report, [From Definition Writing to Concept Engineering: Redesigning the `defining-concepts` AI Skill](https://chatgpt.com/c/6a91e2ee-e2cc-83ed-a65f-f1f29a1cb3f6). The report is treated as research input rather than an implementation specification: every recommendation is reconciled with the decisions already approved for this repository, the capabilities of an instruction skill, licensing constraints, and the one-repetition evaluation boundary.

The central research finding is adopted: the unit of work is a concept entry, not merely a polished definition sentence. A useful entry may need scope, stakeholders, competency questions, concept identity, designations, system position, typed relations, a definition, examples and counterexamples, evidence, mappings, provenance, epistemic status, validation, and maintenance information. These are logical capabilities, not mandatory output sections. A compact request still receives a compact answer.

The research recommendations are dispositioned as follows:

| Research recommendation | Disposition in this iteration | Implementation consequence |
|---|---|---|
| Frame purpose, scope, stakeholders, intended use, and competency questions before drafting | Adopt with proportional depth | Use a compact ConceptBrief internally; expose only fields that help the user. |
| Model the concept system, typed relations, siblings, and near misses | Adopt | Require category and neighbor analysis sufficient to test the proposed boundary. |
| Preserve term records, multilingual designations, mappings, and epistemic authority | Adopt through the core model and conditional profiles | Keep concept identity separate from labels and activate specialist rules only when applicable. |
| Track claim-level evidence, exact source versions, retrieval status, conflicts, and reuse permission | Adopt | Add a dedicated `evidence-and-provenance.md` reference and a licensing gate independent of semantic equivalence. |
| Replace reuse/create with a granular R0-R7 code scale | Adapt | Keep the clearer user-facing dispositions adopt, adapt, formulate, and defer; record semantic relationship and wording permission separately so the same distinctions are not lost. |
| Use standards-neutral core behavior plus composable standards and domain profiles | Adopt with consolidation | Implement the five approved profiles; place OBO, CIDOC CRM, Schema.org, TBX, OntoLex-Lemon, FAIR, CARE, and similar guidance under the applicable profile or representation branch rather than creating overlapping top-level skills. |
| Make validation executable through JSON Schema, SHACL, reasoners, and competency-question runners | Adapt and defer | Always run instruction-level semantic checks. Run tool-dependent checks only when a suitable tool exists and use is authorized. Do not build a schema, reasoner, or validation service in this iteration. |
| Publish a persistent registry with identifiers, releases, monitoring, and change automation | Defer | Preserve supplied identifiers, source versions, status, and change notes in the model; do not mint identifiers or build lifecycle infrastructure. |
| Report numeric confidence and composite quality formulas | Reject until calibrated | Use qualitative status, explicit evidence limitations, and non-compensable critical gates; do not present model self-confidence as probability. |
| Require risk-based expert or affected-community review | Adapt | Make review or co-governance an explicit recommendation or blocker when authority is irreducible; do not build a review workbench or claim that review occurred. |
| Prove superiority through a blinded human-comparison study | Defer | Keep human evaluation as the immediate follow-up, outside this implementation and promotion gate. |
| Benchmark across semantic, provenance, mapping, multilingual, temporal, licensing, and governance failures | Adopt within the approved campaign design | Expand committed regression coverage and stratified critical grading, while retaining one run per arm and honest statistical limits. |

This disposition table is normative for implementation. Report examples and its illustrative JSON Schema may inform field semantics and test cases, but implementers must not copy the schema, numeric scoring formulas, or platform architecture into the repository and call that completion.

## Quality model

Quality is multidimensional and critical failures are non-compensable. The skill must optimize for:

- **conceptual correctness:** the intended concept, category, and extension are captured rather than merely the surface term;
- **boundary discrimination:** essential or delimiting characteristics distinguish positive examples, exclusions, siblings, and near misses;
- **evidence integrity:** material claims are supported by eligible, directly verified sources whose role, version, and reuse permission are represented truthfully;
- **concept-system consistency:** relations have the intended semantics and do not collapse part-whole, broader-narrower, class-instance, or lexical relationships;
- **interoperability:** mappings and representations are conservative, profile-aware, and explicit about unvalidated or partial equivalence;
- **user usefulness:** the definition appears first, the result is proportionate to the request, and the next decision is apparent;
- **governance fitness:** jurisdiction, standpoint, affected communities, and legitimate authority are preserved when material; and
- **maintainability:** another curator can reconstruct the decision from its assumptions, evidence, statuses, and unresolved issues.

An elegant definition cannot compensate for a wrong concept, fabricated citation, false exact mapping, prohibited verbatim reuse, invented conformance result, or illegitimate authority claim. Evaluation and completion criteria therefore use critical gates before qualitative comparison.

## Architectural decision

Use one model-invoked router skill with a lean terminology core and conditionally loaded references:

```text
skills/defining-concepts/
|-- SKILL.md
`-- references/
    |-- concept-entry-model.md
    |-- concept-entry-presentation.md
    |-- concept-entry-serialization.md
    |-- evidence-and-provenance.md
    `-- profiles/
        |-- data-definitions.md
        |-- epistemic-governance.md
        |-- formal-ontology.md
        |-- knowledge-organization-systems.md
        `-- multilingual-terminology.md
```

`SKILL.md` owns universal execution order, routing, integrity rules, capability-aware parallel-work rules, and completion criteria. Detailed concept-entry semantics, evidence and provenance practice, presentation, serialization, and specialist guidance live behind explicit context pointers. Multiple profiles may be active in one request.

A monolithic skill is rejected because it would load every specialist branch into every request and weaken the universal workflow. Multiple separately invoked skills are rejected because overlapping triggers would fragment concept identity, profile composition, and completion behavior.

## Documentation placement

This design and its plan use an artifact-type-first hierarchy:

```text
docs/designs/<skill-name>/YYYY-MM-DD-<topic>.md
docs/plans/<skill-name>/YYYY-MM-DD-<topic>.md
```

The hierarchy separates designs from implementation plans, groups each artifact type by skill, preserves chronological sorting within that scope, and permits paired design and plan documents to share one precise topic stem. Historical documents remain at their existing paths; this decision does not move or rewrite them.

## Trigger boundary

Trigger for deliberate, source-grounded work concerning a concept's meaning, identity, boundaries, designation, definition, reuse, mapping, formalization, multilingual equivalence, or epistemic governance.

Representative positive requests include:

- define or standardize a concept;
- audit or replace an existing definition;
- compare two candidate concepts or determine their relationship;
- prepare a terminology or metadata-registry concept entry;
- map concepts across controlled vocabularies or concept schemes;
- formalize a concept for ontology use;
- assess multilingual designations or equivalence;
- preserve contested, situated, or community-governed meanings.

Do not trigger for casual dictionary lookup, code-symbol naming, product naming, copyediting without semantic concept work, or general implementation requests that do not ask for concept engineering.

A deliberate but otherwise unqualified request such as "define this concept" uses the terminology core and activates the data-definitions profile as the fallback specialist profile. User-provided context or a focused clarification may select a different profile instead, and multiple applicable profiles may compose. The fallback does not extend ISO/IEC 11179 beyond its data-and-metadata scope or permit an unsupported compliance claim.

## Standards model

### Always-active terminology core

The core uses ISO 704:2022 for terminology-work principles and ISO 1087:2019 for terminology vocabulary. It treats a concept as distinct from its designation, the objects in its extension, and the records or representations used to document it.

Useful formulation qualities from other disciplines may inform general review, but the skill must not claim compliance with a standard outside that standard's scope.

### Edition-aware source policy

Every standards-derived rule identifies the exact edition reviewed. Before calling an edition current or claiming current conformance, verify its official status. Published standards, drafts, stable recommendations, domain evidence, and user-provided material have distinct source roles.

Drafts may inform forward-looking commentary but do not silently replace published editions. Proprietary standards are cited and paraphrased; their full protected text and machine-specific local paths are not bundled into the skill.

### Research-derived source allocation

The report surveys more frameworks than this skill should expose as independent profiles. Implementers allocate them by semantic role:

| Source family | Role in the redesigned skill | Boundary |
|---|---|---|
| ISO 704 and ISO 1087 | Always-active concept-oriented terminology principles and vocabulary | Do not convert terminology guidance into a claim about registry, ontology, or KOS conformance. |
| ISO/IEC 11179-4 and Part 5 when naming applies | Data-definition profile and approved fallback discipline | Keep data/metadata scope explicit; verify edition status and never bundle protected text. |
| ISO 25964 and W3C SKOS | KOS relations, labels, concept schemes, and mappings | Do not equate SKOS broader with subclass or label similarity with identity. |
| OWL, SHACL, and OntoClean | Formal commitments, graph constraints, and taxonomic diagnostics | Distinguish proposed semantics, conformance, consistency, satisfiability, and conceptual correctness. |
| OBO and CIDOC CRM practices | Conditional domain evidence for maintained scientific or cultural-heritage ontologies | Do not create separate default profiles or claim domain conformance without applying the relevant rules. |
| METHONTOLOGY, NeOn, and competency-question methods | Workflow, reuse, localization, network, lifecycle, and validation lessons | Adapt them into the instruction workflow; do not build their tooling infrastructure. |
| PROV-O and DCAT provenance/version concepts | Inspiration for claim-level provenance, datasets/distributions, and version-aware records | Keep the internal model format-neutral and use formal terms only when requested and applicable. |
| TBX and OntoLex-Lemon | Conditional multilingual exchange or lexical-ontology representation | Do not treat either as generic machine-output decoration. |
| Schema.org and JSON-LD | Optional web-facing serialization context | Resemblance to their syntax is not conformance. |
| FAIR vocabulary practices | Findability, accessibility, interoperability, reuse, provenance, and maintenance guidance | FAIR quality does not establish epistemic legitimacy. |
| CARE principles and locally applicable governance frameworks | Epistemic-governance questions and affected-community authority | Local authority and context can override a cross-context synthesis. |

Before authoring a standards-derived rule, the implementer must inspect the primary official source or an authorized local copy, record the reviewed edition or recommendation, distinguish normative text from public explanatory material, and phrase the skill instruction no more broadly than the source supports.

## Universal workflow

The universal sequence is:

```text
Route -> Frame -> Research -> Model -> Decide -> Define -> Validate -> Present
```

### 1. Route

Identify the candidate concept, requested task, human renderer, requested machine representation, applicable profiles, and whether ambiguity blocks responsible work.

Ask one focused clarification only when plausible interpretations would produce materially different concepts or when a required user decision cannot be inferred safely. Otherwise state a bounded assumption and mark the result provisional when appropriate.

### 2. Frame

Construct a proportional ConceptBrief before research or drafting. Establish only the fields material to the request:

- target designation or candidate concept and the requested task;
- purpose, intended use, and material non-uses;
- subject field, included and excluded scope, and desired granularity;
- audience, jurisdiction, scheme, language, and time/version context;
- stakeholders, responsible authority, and affected communities when relevant;
- applicable profiles and requested representations;
- qualitative risk class: routine, consequential, or authority-sensitive;
- assumptions, unresolved ambiguities, and competency questions.

Risk changes the rigor of evidence, clarification, validation, and review; it does not produce a numeric score. Routine work is familiar and readily reversible. Consequential work can affect interoperability, policy, legal, safety, scientific, or operational outcomes. Authority-sensitive work is contested, normative, culturally situated, community-governed, or otherwise illegitimate for the agent to settle alone.

Competency questions state what the entry must help a user decide, distinguish, retrieve, or infer. Use only enough questions to expose the intended boundary: commonly one to three internal questions for a compact task and three to twelve explicit questions for a substantive concept package. Treat these as heuristics, not quotas. Mark questions critical when failure would invalidate the concept or its intended use. Do not turn a compact definition request into a full discovery interview or display internal questions that add no user value.

### 3. Research

Research before settling concept identity, reuse, mapping, or definitive wording. Plan evidence lanes from the ConceptBrief rather than searching the target term indiscriminately. Relevant lanes can include governing standards, authoritative registries or vocabularies, domain definitions, neighboring concepts, usage evidence, mapping targets, historical editions, licensing, and community or jurisdictional authority.

Classify retained sources by the claim they are eligible to support, such as normative formulation rule, authoritative vocabulary, exact-definition candidate, constituent semantic evidence, related-concept or boundary evidence, usage evidence, mapping evidence, contradictory evidence, version evidence, licensing evidence, community-authority evidence, or user-supplied assertion. Authority is claim-, field-, jurisdiction-, time-, and community-relative; a single global source hierarchy is prohibited.

A final source is verified only after retrieving the destination that supports its attributed semantic role. A search excerpt, generic homepage, inaccessible authentication wall, or copied citation is not direct verification.

Semantic equivalence and permission to reuse wording are separate questions. An exact concept match does not authorize verbatim copying. Record whether wording can be quoted, must be paraphrased, can only be linked or cited, or has unresolved permission. When permission is unclear, do not reproduce protected wording as an adopted definition.

When the environment can spawn subagents, parallelize only demonstrably independent, bounded work that is likely to save more time than coordination costs. Eligibility requires at least two non-overlapping evidence or validation lanes whose scopes can be fixed before dispatch and whose results are not prerequisites for one another. Prefer batched tool calls for shallow independent lookups; use subagents for multi-step research or validation lanes. Give every worker the same ConceptBrief and evidence contract. Require each worker to return the exact destination, source role, edition or version, retrieval status, supported claim, boundary evidence, licensing information when material, and conflicts or uncertainty. The coordinating agent retains responsibility for concept identity, clarification, profile routing, source eligibility, reuse and mapping decisions, conflict resolution, synthesis, definition drafting, validation, and the final answer. A worker summary is not itself a source; the coordinator reopens or otherwise verifies uncertain and material evidence. Work sequentially when spawning is unavailable, prohibited, too costly, dependent, or overlapping. Output quality and provenance, not whether parallel agents happened to be available, determine completion and evaluation.

Place evidence beside supported claims in concise answers. Use a full claim ledger for audits, concept packages, consequential or authority-sensitive work, conflicting evidence, or an explicit request. The ledger connects each material claim or field to the exact source, source role, version, retrieval event, support or contradiction, authority basis, and reuse constraint. Record a bounded unsuccessful search as negative search evidence, never as proof that no definition exists.

### 4. Model

Separate the concept from its designations, instances, representations, and neighboring categories before drafting. Required distinctions include, when relevant:

- concept versus designation;
- concept versus object;
- class versus individual;
- property versus value;
- process versus result;
- concept versus code, field, datatype, unit, syntax, or value domain;
- conceptual collection versus file, serialization, record, or API response;
- lexical similarity versus concept equivalence.

Polysemous or homonymous designations receive separate concept treatment or explicit disambiguation. A term inventory may distinguish preferred, admitted or alternative, hidden, deprecated, forbidden, and candidate designations, with language, script, jurisdiction, community, and status where material.

Construct only enough concept neighborhood to test identity and boundaries. Identify the immediate superordinate concept or broader context, plausible siblings or coordinate concepts, narrower concepts, parts or wholes, and materially related processes, products, agents, roles, qualities, information objects, carriers, datasets, distributions, value domains, or permissible values. Type each relation according to the active profile; do not treat a generic broader relation as an OWL subclass assertion or a partitive relation as an `is-a` relation.

For a substantive intensional definition, compare the target with plausible siblings in a compact discrimination matrix: candidate, shared superordinate concept, included or excluded status, and decisive characteristic. Positive examples, negative examples, and near misses then test whether the modeled extension follows the intended boundary. The matrix may remain internal unless it helps an audit or concept package.

### 5. Decide

Assess each candidate on independent axes before choosing a local disposition:

- semantic relationship: same, broader, narrower, overlapping, related, constituent-only, conflicting, or unresolved concept;
- scope and granularity fit: subject field, jurisdiction, time, audience, and intended use;
- wording and license action: verbatim reuse allowed, attributed quotation only, paraphrase required, link or citation only, or permission unresolved;
- authority fit: eligible for the material claim and legitimate for the affected context;
- source and version status: directly verified, superseded, draft, inaccessible, or otherwise limited.

Then use one of four meaningful user-facing dispositions:

- **Adopt:** reuse an authoritative definition without semantic change, subject to attribution and licensing.
- **Adapt:** preserve the same concept while revising wording, granularity, context, or formulation.
- **Formulate:** propose a new definition because no sufficiently matching reusable definition was verified.
- **Defer:** do not formulate because concept identity, authority, evidence, or a user decision remains insufficient.

Related, broader, narrower, or constituent sources may inform a formulation but must not be reported as exact reuse. An unresolved or contested candidate can support a provisional synthesis only when the source positions and authority limits remain visible; otherwise defer.

Select a definition strategy from the concept and intended use, not from a universal template:

| Strategy | Use when | Required safeguard |
|---|---|---|
| Intensional, normally immediate superordinate concept plus delimiting characteristics | A stable concept can be distinguished from coordinate concepts | Test every differentia against siblings and near misses. |
| Extensional | The extension is finite, stable, and practical to enumerate | State the governing scope and avoid presenting an illustrative list as exhaustive. |
| Partitive | The whole is most usefully understood through constitutive parts | Do not confuse part-whole with genus-species. |
| Mixed | Intensional boundaries need an exhaustive or illustrative extension for usability | Label the role and completeness of the list. |
| Operational | The concept is intentionally established by a measurement, rule, or procedure, or the user explicitly needs a classification rule | Separate the general concept from jurisdiction- or method-specific thresholds when they are not identical. |
| Formal rule or axiom | A formal-ontology task requires necessary or sufficient machine commitments | Keep the textual definition separate and do not claim validation that was not run. |
| Perspectival or provisional elucidation | Authority, standpoint, or boundaries are legitimately plural or unsettled | Name the standpoint, preserve alternatives, and avoid false universality. |

Intensional definition remains the default, not a dogma. Record why another strategy is better when selected.

### 6. Define

Draft a definition that is appropriate to its strategy, scope, and concept system. Distinguish characteristics that are essential or delimiting from contextual, typical, operational, evidential, or implementation details. Include only characteristics needed to establish the intended extension and discriminate relevant neighbors.

Do not import examples, permissible values, storage details, procedures, units, formulas, governance rules, or implementation decisions merely because they are available. Such material may support the definition outside the definition text. Avoid circularity, hidden secondary definitions, unnecessary negation, unexplained abbreviations, category shifts, and wording that makes the definition true only of a particular database or interface unless that implementation is the intended concept.

### 7. Validate

Validation has non-compensable integrity gates and profile-dependent checks.

Always perform the checks that can be established from the available material:

- concept identity, intended category, scope, granularity, and definition strategy;
- superordinate-concept fit and delimiting-characteristic necessity;
- positive example, negative example or exclusion, and a plausible near miss when the task is substantive;
- sibling discrimination and consistency with broader, narrower, partitive, and associative relations;
- competency-question coverage, especially every question marked critical;
- circularity, hidden definitions, unnecessary negation, unexplained abbreviations, implementation dependence, and excessive breadth or narrowness;
- claim-to-evidence support, direct-source status, edition or version, contradictory evidence, and licensing action;
- conservative mapping semantics and every active profile's critical rules;
- qualitative status, unresolved issues, review need, and presentation order.

Tool-dependent checks can include destination retrieval, registry lookup, syntax parsing, schema validation, SHACL validation, ontology reasoning, machine-executed competency questions, mapping validation, or license inspection. Run them only when the relevant tool exists and its use is authorized. Report each material check as passed, failed, warning, not run, or not applicable, with the evidence needed to interpret that status. An LLM's textual review is not a reasoner, SHACL processor, registry lookup, or legal determination.

Consequential work requires deeper evidence and explicit limitations. Authority-sensitive work must identify the legitimate authority and must not be represented as operationally final when affected-community, jurisdictional, legal, safety, or domain review is still required. Recommend review, co-governance, or deferral; never invent reviewer approval. Never invent a registry identifier, conformance result, release, or version history.

### 8. Present

Render the smallest output that satisfies the task. An optional concept-name heading may precede the answer, but the first substantive block is the definition or revised definition unless clarification or an evidence blocker prevents responsible formulation.

## Concept-entry model

`concept-entry-model.md` defines a format-neutral model, not an executable schema. Fields are populated only when supported and useful. The logical groups are:

1. **Definition:** text, language, strategy, local status, source relationship, and limitations.
2. **Concept identity:** preferred, alternative, hidden, deprecated, forbidden, and candidate designations; language or script; subject field; ontological category; supplied identifiers; and identity assumptions.
3. **ConceptBrief:** requested task, purpose, intended use and non-use, included and excluded scope, audience, jurisdiction or scheme, granularity, time/version context, stakeholders, affected communities, risk class, active profiles, competency questions, and assumptions.
4. **Characteristics and boundaries:** essential, delimiting, contextual, typical, operational, and rejected characteristics; inclusions; exclusions; positive and negative examples; near misses; and counterexamples.
5. **Concept system:** superordinate, broader, narrower, coordinate, partitive, associative, causal, temporal, agent-role, quality-bearer, information-content/carrier, and other typed relations; relation rationale; and profile semantics.
6. **Reuse, formulation, and mapping:** candidate concepts; semantic relationship; scope and granularity fit; wording permission; authority and version fit; adopt/adapt/formulate/defer disposition; definition strategy; mapping predicate; and rationale.
7. **Evidence and provenance:** supported or contradicted claim or field, exact destination, title, publisher, authority basis, source role, edition/version/status, retrieval event and status, relevant passage or locator, licensing action, conflicts, and negative-search limits.
8. **Validation:** competency-question results, boundary and sibling tests, definition lint, mapping checks, profile checks, tool-dependent checks, status of each check, and limitations.
9. **Specialist extensions:** only the data-definition, KOS, ontology, multilingual, and epistemic-governance information required by active profiles.
10. **Governance and maintenance:** unresolved questions, alternative positions, responsible authority, review or co-governance recommendation, local lifecycle status, supplied version, source-review date, change rationale, and deprecation or replacement notes.

Simple answers project only the fields the reader needs. The model must not force every user through a complete form. It preserves the distinctions among absent, unknown, not applicable, contested, intentionally withheld, not checked, and unsupported; these states must never be flattened into an empty string, `null` without semantics, or an invented value.

## Evidence and provenance contract

`evidence-and-provenance.md` contains the detailed research contract that would otherwise overload the router. `SKILL.md` directs the agent to read it when external research, reuse, mapping, audit, consequential use, or authority-sensitive work is required. It specifies:

- evidence-lane planning from the ConceptBrief;
- claim-relative source eligibility rather than a universal prestige ladder;
- source roles and the difference between normative rules, exact candidates, constituent semantics, usage, mapping, contradiction, version, licensing, and user assertions;
- direct destination retrieval and exact edition/version/status checks;
- a claim ledger with support, contradiction, source locator, authority basis, retrieval status, and uncertainty;
- semantic-match, wording-permission, attribution, and licensing decisions as separate fields;
- source-conflict handling, supersession, historical-date questions, and bounded negative-search reporting;
- capability-aware batching and subagent dispatch, the common worker contract, coordinator responsibilities, and sequential fallback;
- evidence placement in compact answers and full provenance only when proportionate; and
- prohibitions against treating snippets, worker summaries, model memory, citation metadata, or inaccessible pages as verified semantic evidence.

The reference provides examples of evidence records and worker returns, but it does not prescribe a storage schema or reproduce proprietary standards text.

## Human presentation

The current universal five-section contract is removed. There is no fixed section count, and empty sections are omitted.

### Definition answer

1. **Definition**
2. **Scope and status**, when needed for interpretation
3. **Boundaries**, using the most useful inclusion, exclusion, example, or near miss
4. **Source basis**, when research or a standard materially supports the result
5. **Open decision**, only when the result remains provisional or requires user action

Do not include a research diary, exhaustive compliance table, or full source ledger by default.

For very short requests, the renderer may be only the definition followed by one sentence of scope, provenance, or limitation. Labels must be descriptive rather than numbered generically. Put warnings before the definition only when proceeding without them would materially mislead the reader. Examples and near misses are visually and verbally distinguished from members of the definition. Citations sit beside the claims they support, and status language is written in plain terms before specialist notation.

### Revision or audit

1. **Revised definition**
2. **Audit verdict**
3. **What changed and why**
4. **Boundary tests**
5. **Evidence and applicable profile checks**
6. **Unresolved issues or required decisions**

The audit identifies defects and their consequences rather than returning an unsupported pass or fail.

### Concept package

1. **Definition**
2. **Identity and designations**
3. **Purpose, scope, stakeholders, and competency questions**
4. **Characteristics, boundaries, examples, and near misses**
5. **Concept relations, reuse decision, and mappings**
6. **Evidence, provenance, and licensing**
7. **Applicable specialist-profile results**
8. **Status, contested matters, maintenance, and next actions**

Sections without meaningful content are omitted. Specialist content uses reader-facing names rather than a generic extension bucket.

Presentation is a projection of one internal entry, not an alternative semantic record. All renderers preserve the same identity, status, disposition, source relationships, and unresolved issues. Moving the definition first must not hide a blocker, manufacture certainty, or detach wording from its evidence.

## Machine serialization

`concept-entry-serialization.md` is loaded only when machine-readable output is explicitly requested.

- Use the requested representation when it is applicable.
- Default an unspecified machine-readable request to versioned plain JSON.
- Preserve distinctions among absent, unknown, inapplicable, contested, and intentionally withheld values.
- Never mint an identifier merely to fill a field.
- Link evidence and provenance to the claims or fields they support.
- State what validation was and was not performed.
- Do not claim TBX, SKOS, RDF, JSON-LD, OWL, SHACL, or other conformance from superficial resemblance.
- Preserve typed relations and language-tagged designations without silently strengthening their semantics during export.
- Preserve source/version/licensing and local-status distinctions needed to interpret the serialized claims.
- Treat JSON Schema, SHACL, reasoner, or parser output as a tool result only when actually produced; otherwise mark the check not run.

No executable serializer, JSON Schema, ontology, SHACL shape, validator, or registry is added by this redesign.

## Specialist profiles

### Data definitions

Activate for data elements, metadata registries, fields, codes, value domains, data constructs, or an explicit ISO/IEC 11179 request. Also activate it as the fallback specialist profile for an otherwise-unqualified deliberate definition request after applying the focused-clarification rule; replace or compose that fallback when the user supplies a more appropriate domain or profile.

Apply ISO/IEC 11179-4:2004 within its scope. Distinguish the semantic concept from its field, code, datatype, syntax, unit, permissible values, value domain, interface control, storage, and transport representation. Use ISO/IEC 11179-5:2015 as the reviewed naming baseline only when naming is in scope, and re-check its official status before implementation because a replacement edition is under development. Report compliance only when every applicable requirement was checked; do not equate definition quality with registry acceptance.

The profile must translate the reviewed Part 4 principles into a checkable drafting and audit sequence: determine the kind of metadata object, identify the relevant concept or data-element concept, select an appropriate superordinate concept, include delimiting characteristics, exclude accidental representational details, avoid circularity and hidden definitions, and test substitutability and boundary fit. Where a value domain, conceptual domain, data element, property, object class, representation class, or permissible value is involved, use the standard's distinctions only within verified scope. The fallback profile supplies disciplined formulation questions; it never converts an ordinary domain concept into a registered metadata item.

### Knowledge organization systems

Activate for thesauri, taxonomies, classifications, controlled vocabularies, concept schemes, or mappings.

Distinguish concepts, schemes, collections, labels, notations, documentation notes, semantic relations, and mappings. Distinguish broader/narrower and associative relations, within-scheme relations and cross-scheme mappings, and exact, close, broad, narrow, and related mappings. Lexical similarity is not sufficient evidence of concept equivalence. A SKOS concept is not silently treated as an OWL class.

Use ISO 25964 and SKOS only for the semantics each actually supplies, after verifying the applicable edition or recommendation. Require a conservative mapping rationale based on scope, extension, intension, concept-system position, and use context. False exact equivalence is a critical failure; leaving a relationship unresolved is preferable to asserting identity without adequate evidence. Preserve collection membership, notation, and label status as distinct from semantic hierarchy.

### Formal ontology

Activate for classes, properties, individuals, axioms, restrictions, competency questions, or machine reasoning.

Start from intended questions and inferences. Determine ontological category before proposing formal commitments. Separate textual definition from necessary or sufficient formal conditions. Make domain, range, disjointness, quantification, cardinality, and identity commitments only when justified. Distinguish proposed axioms from reasoner-validated axioms and never invent namespaces, IRIs, imports, or results.

Use OntoClean-style identity, unity, rigidity, and dependence questions when they materially expose a taxonomic error, without claiming a complete OntoClean analysis when it was not performed. OBO, CIDOC CRM, and other domain ontology practices are conditional domain evidence or specializations, not automatic global requirements. SHACL constraints describe graph conformance, not necessarily conceptual truth; OWL entailment, consistency, and satisfiability claims require an actual reasoner result.

### Multilingual terminology

Activate when multiple languages, language varieties, scripts, translation-oriented terminology, or equivalence are material.

Preserve concept orientation rather than translating isolated words. Record designation language and status. Distinguish full, partial, directional, pragmatic, and absent equivalence. Do not force equivalence where communities conceptualize the subject differently. Machine translation and shared spelling are not validation.

When relevant, distinguish terminology exchange from lexical-ontology representation: TBX, SKOS labels, and OntoLex-Lemon serve different purposes and are loaded or serialized only on request. Record language variety, script, jurisdiction, grammatical information, usage status, and source when these affect equivalence. Native-speaker or community review may be required for consequential use; never imply it occurred merely because a machine translation was available.

### Epistemic governance

Activate for contested, situated, normative, culturally sensitive, community-governed, or authority-dependent knowledge.

Identify whose knowledge is represented and under what authority. Distinguish empirical, terminological, normative, and perspective-dependent disagreement. Preserve materially different positions instead of manufacturing consensus. Record standpoint, jurisdiction, community, provenance, consent, licensing, and authority when relevant. Recommend review or co-governance where the agent is not legitimate to settle the concept.

Use CARE-informed questions when Indigenous or otherwise community-governed data and knowledge are implicated: who has authority, who benefits or bears risk, what responsibilities attach to reuse, and which local principles take precedence. FAIR or technical interoperability is never treated as sufficient evidence of epistemic legitimacy. A cross-context synthesis is labeled provisional and must not displace a locally authoritative concept or designation.

## Qualitative status

Use explicit qualitative status instead of numeric confidence. Relevant statuses include established, adopted, adapted, proposed, provisional, contested, deprecated, and blocked pending clarification or evidence.

Reuse disposition, local lifecycle status, evidence adequacy, source status, validation result, and review need remain distinct. A definition adapted from an established source may still be provisional in the user's registry; a strong source does not erase a material jurisdictional limitation. State concrete limitations rather than collapsing them into a single low/medium/high label.

## Skill-file responsibilities

### `SKILL.md`

Contains the trigger and exclusions, universal workflow, clarification rule, proportional ConceptBrief, qualitative risk routing, terminology-core checks, profile routing, source integrity, capability-aware batching/subagent rule, reuse dispositions, definition-strategy selection, validation layers, renderer selection, and completion criteria. It stays ASCII-only. Canonical paragraphs and list items remain on human-readable physical source lines; automated prose wrapping is prohibited.

### `concept-entry-model.md`

Contains detailed field semantics, status distinctions, evidence relationships, and anti-invention invariants.

### `evidence-and-provenance.md`

Contains evidence-lane planning, claim-relative authority, source roles, exact retrieval/version checks, licensing and wording-permission gates, claim-ledger semantics, conflict and negative-search handling, and the bounded parallel-worker contract. It is loaded for research, reuse, mapping, audits, consequential work, or authority-sensitive work.

### `concept-entry-presentation.md`

Contains the three human renderers, definition-first ordering, optional-section rules, evidence placement, and examples of projecting the internal model.

### `concept-entry-serialization.md`

Contains plain-JSON defaults, representation routing, validation disclosure, and conformance boundaries.

### Profile files

Each profile contains activation conditions, additional questions, required distinctions, evidence requirements, validation, prohibited claims, and completion additions.

### Retired example

Remove `references/judicial_plea_status_definition.md`. Preserve any useful semantic challenge as an evaluation case rather than a stale normative example.

## Evaluation design

### Existing cases

Retain the semantic substance of the eight current cases while removing every assertion tied to five numbered sections or definition placement in section 3. Apply the data-definitions profile only to cases in its actual scope. Preserve critical checks for identity, category, boundaries, direct-source retrieval, source-role honesty, and non-invention.

Historical result directories remain byte-for-byte unchanged and continue to describe their captured cases, arms, skill bytes, and runner schema.

### Additional coverage

Add cases for an otherwise-unqualified definition that exercises the ISO/IEC 11179 fallback without overclaiming compliance, ambiguity requiring one targeted clarification, KOS mapping, formal ontology, multilingual equivalence, epistemic governance, concept-package rendering, explicit machine serialization, false-conformance pressure, and compact-output discipline.

Across committed regression and campaign-selected cases, cover the research report's material failure strata rather than concentrating on easy dictionary concepts:

- homonymy, polysemy, and close lexical similarity without concept identity;
- concept/designation, class/individual, process/result, part/is-a, information/carrier, dataset/distribution, and conceptual-domain/value-domain category traps;
- broader, narrower, close, related, and false exact mappings;
- finite extensional concepts and fuzzy, threshold, or jurisdiction-dependent concepts;
- current, superseded, and historical-date source selection;
- search snippets or secondary citations that conflict with the retrieved destination;
- exact semantic matches whose wording cannot safely be reused verbatim;
- standards or registries that disagree or govern different claims;
- multilingual partial or absent equivalence;
- contested, situated, and affected-community-governed concepts; and
- requests where concision, an evidence blocker, or responsible deferral is the correct outcome.

The committed regression suite is larger than the calibration selection.

### Declarative conversation support

Keep `prompt` as the required initial user turn. Add optional ordered `follow_up_turns`, each with a stable ID and exact user prompt. One-turn cases remain unchanged. The shared evaluation layer binds every follow-up into the authorized transmission and deterministically supplies it after the preceding completed assistant turn. Domain expectations remain in the suite and grade whether the assistant handled clarification correctly.

Shared code owns bounded conversation mechanics only. It does not know definition, Git, or EPUB semantics. Provider adapters that do not support multiple turns reject such a case during preflight rather than truncating it silently.

### Three arms

Every new campaign uses `no-skill`, `current-skill`, and `candidate-skill`. Current and candidate bundles are captured from exact file sets and identified by Git provenance, per-file hashes, and an aggregate SHA-256. The working tree is not rewritten between arms. Grading is blind to arm identity.

### Grading

Critical gates cover concept identity and category, boundaries, source integrity, non-invention, correct profile activation, requested scope, truthful status, and definition-first presentation when a definition can responsibly be supplied.

Critical failures also include fabricated or unresolved citations presented as verified, prohibited verbatim reuse, false exact equivalence, material version error, invented identifier or validation result, and illegitimate universalization of an authority-sensitive concept. No high prose score can compensate for one of these failures.

Qualitative dimensions cover conceptual correctness, category correctness, superordinate and differentia quality, boundary discrimination, competency-question fitness, terminological naturalness, scope fitness, reuse judgment, evidence traceability, concept-system consistency, mapping conservatism, profile correctness, governance fitness, maintainability, economy, readability, and actionability. Only applicable dimensions are graded. Pairwise comparison evaluates candidate against current, with evidence excerpts for each decision. No aggregate is described as a calibrated probability.

Where a case supplies labeled examples or mappings, deterministic or blinded grading may report classification accuracy by relationship type. Exact-equivalence precision is weighted as a safety property, but the one-run campaign does not claim population-level statistical estimates. Readability is evaluated through the rubric only; comprehension time and user success remain reserved for the deferred human study.

Subagent or batched-research use is process evidence, not a quality gate. A run is not penalized because its environment lacks parallel-agent capability, and a run does not pass merely because it spawned workers. Grade the concept result, evidence integrity, and disclosed limitations.

## Compatibility and capability reconciliation

The `compatibility` frontmatter field remains portable Agent Skills prose, not a private capability language. The [Agent Skills specification](https://agentskills.io/specification) defines it as an optional 1-500-character description of environment requirements such as intended products, system packages, and network access; it defines no controlled vocabulary or resolution algorithm. This design was cross-checked on 2026-08-29 against current [OpenAI skill guidance](https://learn.chatgpt.com/docs/build-skills), [Claude Code skill guidance](https://code.claude.com/docs/en/skills), [Google Antigravity skill guidance](https://antigravity.google/docs/skills/), [Antigravity SDK capability guidance](https://www.antigravity.google/docs/sdk/tools/), [GitHub Copilot skill guidance](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills), and the [Agent Plugins 1.0 specification](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md). Those implementations consistently separate descriptive skill compatibility from runtime permissions or provider capability configuration; Claude Code explicitly accepts but does not act on `compatibility`, and current proposals for machine-evaluable Agent Skills dependencies remain unratified.

The canonical field is exactly `compatibility: Requires access to bundled skill files. Tasks that require current external evidence also require web search and URL fetching.` It is product-neutral, names semantic capabilities rather than vendor tool identifiers, and makes live research conditional. Optional machine-validation tools and subagent support stay out of this field because the workflow degrades truthfully when they are unavailable. Do not encode a private grammar in `compatibility`, misuse experimental `allowed-tools` as a dependency declaration, place nested capability data in standard `metadata`, or invent an MCP dependency for provider-native web research.

Deterministic evaluation uses a separate suite-owned interpretation rather than parsing prose heuristically. `evals.json` schema version 3 records the exact compatibility text for every skill-bearing arm, its applicable semantic requirements, per-case `required_capabilities`, and a default-deny campaign capability policy. Any changed or unreviewed compatibility string fails preparation. Requirements do not grant permissions: preparation computes the union of requirements for every selected case and skill-bearing arm, compares it with the explicit campaign policy, resolves each allowed semantic capability through the selected provider adapter, and fails before packet creation when a requirement is unavailable or denied or when the policy enables an undeclared external facility.

The initial semantic capabilities are `bundled-skill-files`, `web-search`, and `url-fetch`. Bundled files are satisfied by immutable skill-bundle capture. Cases 1, 3, and 8 require both web capabilities because their exact prompts demand current-source discovery or destination verification. The campaign uses the union across selected cases and applies the same resolved envelope to `no-skill`, `current-skill`, and `candidate-skill`, preventing capability access from becoming an arm confound. For Codex, `web-search` plus `url-fetch` resolves to native `webSearch: true` while arbitrary process or sandbox network remains `network: false`; general tools, MCP or app calls, provider-default context, image generation, and automatic delegation remain denied.

Persist a canonical capability-reconciliation receipt before any transmission packet, hash, authorization artifact, preflight, or model turn. It binds the extracted compatibility texts and digests, their reviewed interpretations, selected cases and arms, derived requirement union, explicit policy, provider-specific resolution, and resulting runtime capability object. The campaign manifest and every transmission bind this receipt. Runtime enforcement permits native web-search events only when the receipt and packet authorize them, preserves their queries, destinations, and returned evidence in the sealed transcript, and rejects every other unrequested external-capability event.

## Campaign protocol

### Zero-turn campaign gate

Every new OpenAI campaign must pass one deterministic campaign-level preflight after all capability reconciliations and transmissions are prepared and before their hashes are authorized. Select the manifest's unique sequence-1 session, revalidate the frozen executable, runtime, model, effort, managed-home boundary, authentication, requested provider capability availability, disabled hook state, minimal ephemeral thread isolation, cleanup, and confirmed process closure, and start no model turn. Persist one exclusive `preflight.json` containing the complete terminal result, `modelTurns: 0`, the manifest SHA-256, the capability-reconciliation digest, and the selected transmission identity. Execution requires that exact successful record before it reads any of the 30 authorization artifacts.

Provider capability availability is not session activation. Codex may truthfully report broader tools, web-search, or image-generation availability while the reconciled campaign requests only native web research and denies every unrelated facility. The preflight must fail when requested native web research is unavailable, but mere availability of an unrequested facility is not evidence that it was activated. Host-level skill and installed-app inventories have the same availability semantics, expose unrelated operator state, and are therefore neither queried nor retained as isolation evidence. Hook state is inspected separately because an enabled hook can execute without model tool selection: disabled hooks are acceptable, enabled hooks fail closed, and malformed hook metadata is a protocol failure.

The zero-turn thread attests only fields the live protocol actually reports: it is ephemeral, read-only, process-networkless, explicit-request-only, and free of runtime workspace roots and instruction sources. Native web research is a separately reconciled provider facility; because preflight starts no model turn, no web-search item may occur there. The experimental protocol capability is enabled only to make the reviewed runtime-workspace-root fields available; it does not activate tools or provider facilities. Codex binds the reconciled native-web request explicitly as `config.web_search = "live"` at `thread/start`, or `"disabled"` when the capability is denied, while exact model, effort, packet workspace roots, workspace sandbox policy, and input belong to `turn/start`; unrequested runtime events remain fail-closed. The gate can therefore establish exact model availability and provider-web availability, but it cannot truthfully establish model-specific web use without consuming a turn. This phase-specific contract follows the installed App Server schema instead of inventing a stronger attestation, and avoids both false failures from treating inventory as activation and false assurances from asserting response fields App Server does not echo. A missing, failed, malformed, nonzero-turn, or stale preflight closes the campaign to execution. Retain it as diagnostic evidence, repair the harness or environment through a new test-first iteration, and prepare a fresh timestamped campaign rather than retrying or overwriting the record.

Immediately before the first authorized model launch, atomically create an exclusive campaign execution-start record bound to the manifest and authorization-set digests. Its existence consumes the campaign's one execution attempt even if the process is interrupted. Any infrastructure, policy, provider, protocol, or runtime failure writes an immutable terminal execution-failed record and stops the campaign without consuming another authorization or launching another session. Never resume, retry, or overwrite a partly executed one-repetition campaign; retain it as invalid evidence, repair test-first, and prepare a fresh timestamped campaign.

### Calibration

Calibration uses three separately frozen execution profiles so the evidence answers an ordinary-user question, a same-model capability-ceiling question, and a constrained-model portability question without conflating them. The representative profile uses the exact current frontier model at the installed Codex catalog's declared default reasoning effort when the profile is frozen; for the 2026-08-29 iteration, that catalog identifies `gpt-5.6-sol` with default effort `low`. The capability-ceiling profile uses the same exact model at `max`, the catalog's maximum single-agent reasoning-depth setting. Those two Sol profiles isolate effort while holding model identity fixed. The portability-stress profile uses exact model `gpt-5.3-codex-spark` at deliberately constrained effort `low`, below that catalog's declared Spark default of `high`. OpenAI describes Spark as a smaller research-preview model optimized for real-time coding and a lightweight working style, so this profile tests whether the skill remains usable outside the frontier-model regime; it is not another point on the Sol effort axis or a representative default-user condition. All three profiles keep cases, arms, bundles, provider policy, and every other protocol input matched, and each is prepared, preflighted, authorized, executed, graded, and aggregated as a separate campaign. The portability result must remain separate because it changes both model identity and effort. See [OpenAI's GPT-5.3-Codex-Spark announcement](https://openai.com/index/introducing-gpt-5-3-codex-spark/) and [current GPT-5.6 Sol model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

`ultra` is not the ceiling-profile setting even though it appears after `max` in the Sol catalog: its declared behavior adds automatic task delegation, which changes agent topology and provider capabilities rather than only reasoning depth. Testing `ultra` requires a separately preregistered capability-enabled protocol and must not be pooled with any of the three single-agent profiles. The labels are specific to the frozen Codex product surface, not universal API defaults: retain the exact installed catalog evidence, model identifier, and effort for every campaign. If that catalog changes before execution, close the affected prepared campaign and freeze a new exact model/effort identity rather than silently retaining a stale "default", "ceiling", or "stress" label.

```text
10 preregistered scenarios
x 3 blinded arms
x 1 run per arm/scenario
x 3 model-execution profiles
= 90 external-model sessions total
```

Each model-execution profile contains 30 sessions and at most 33 model turns because the three case-10 sessions each include one scripted follow-up; the complete calibration therefore permits at most 99 turns. One run per case/arm/profile cell can describe variation across cases, profile-conditioned behavior, and grader disagreement. It cannot estimate within-cell stochastic variance, per-prompt repeatability, or a stable pass probability. Report and aggregate all three profiles separately before making any bounded cross-profile comparison. Do not attribute a Spark-versus-Sol difference to effort alone, let strong Sol output compensate for a candidate critical failure in the portability profile, or classify a provider/model limitation as a candidate defect without examining the retained evidence.

### Confirmation

After calibration, repair rubric-observability problems before freezing a confirmatory protocol. Add independent preregistered scenarios rather than additional repetitions. Preserve the representative, capability-ceiling, and portability-stress distinctions unless a reviewed design change explicitly narrows the confirmation claim. Freeze candidate bytes, cases, graders, promotion rules, provider, exact model, each effort profile, and transmissions, pass the same zero-turn campaign gate, and only then obtain exact authorization and collect confirmatory results.

### Promotion

Promote only after deterministic gates, calibration, and confirmation. The candidate must have no unresolved critical integrity failure, improve on preregistered primary comparisons, avoid a material capability-stratum regression, preserve negative-trigger precision, and retain complete provenance. A changed candidate begins a new iteration and campaign identity.

## Verification

Use focused tests during implementation and the repository-required `npm run verify` before completion. Focused verification separates task-attributable failures from unrelated repository failures. This design does not modify the shared `verify` command; scoped-verification work remains separate.

## Human usability follow-up

Human-participant evaluation is not part of this implementation or its promotion gate. Record an immediate, non-blocking follow-up protocol for two iterative rounds, each with four ordinary likely users and four terminology, metadata, KOS, or ontology specialists, including relevant accessibility needs. Test whether participants can locate the definition, understand status and boundaries, identify source basis, distinguish examples from near misses, and determine the next action.

Do not create participant data, results, or usability claims during this implementation.

## Explicit non-goals

Do not create:

- a concept registry or terminology database;
- an API, web service, or user interface;
- an RDF store or ontology editor;
- an executable schema, reasoner, or SHACL service;
- automatic identifier minting;
- a review workbench or community-approval mechanism;
- automatic semantic versioning or monitoring;
- a human usability study;
- evidence of general superiority over expert terminologists.

## Repository safety boundaries

- Evaluation manifests are configuration and require explicit approval for the exact proposed fields and cases before modification.
- External model calls require fresh authorization for the exact skill bytes, prompts, provider, model, effort, and transmission digest.
- Historical evaluation evidence is immutable.
- Existing working-tree changes are user-owned and remain untouched.
- Commits and pushes require separate explicit authorization.
