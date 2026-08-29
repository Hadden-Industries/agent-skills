---
name: defining-concepts
description: Engineers source-grounded concepts and definitions, including definition, revision, audit, comparison, mapping, formalization, multilingual equivalence, and epistemic-governance work. Use for deliberate semantic work on a concept's identity, boundary, designation, reuse, relation, or representation. Do NOT use for casual dictionary lookup, code-symbol naming, product or brand naming, copyediting without semantic work, or implementation-only requests.
license: MPL-2.0
compatibility: Requires access to bundled skill files. Tasks that require current external evidence also require web search and URL fetching.
metadata:
  category: research
---

# Defining Concepts

Engineer the intended concept before polishing its words. Produce the smallest useful, source-grounded result while preserving concept identity, boundary, evidence, status, and unresolved decisions.

## Trigger boundary

Use this skill to define, revise, audit, compare, map, formalize, assess multilingual equivalence for, or govern a concept. This includes terminology entries, metadata concepts, controlled-vocabulary mappings, ontology formalization, contested meanings, and community-governed concepts.

Do not use it for a casual dictionary meaning, code or variable naming, product naming, copyediting that does not change or test meaning, or an implementation-only request. If the user asks for implementation and the concept is already settled, follow the implementation task instead.

## Non-negotiable output gates

- An affirmative wording-permission conclusion is forbidden unless the exact permission destination cited in the final answer was directly retrieved and inspected in the current task, and its applicability to the source wording and proposed action was established. Never construct, infer, or cite a likely license URL. When permission is requested, satisfy this gate before optional secondary lookups or repeated source opens; otherwise write `Wording permission: unresolved - do not reuse verbatim`.
- For a concept package where boundary discrimination is material, the final answer must label one concrete positive instance, one concrete negative instance or exclusion, and one near miss. If any required test cannot be supplied responsibly, label it unresolved instead of omitting it.
- Use `Adopt` only when the actual source wording will be used unchanged and its permission is verified; otherwise choose and justify `Adapt`, `Formulate`, or `Defer`. Keep this disposition separate from semantic relationship and wording permission.

## Universal workflow

Follow `Route -> Frame -> Research -> Model -> Decide -> Define -> Validate -> Present`. Scale every step to the request; a routine definition may require only a compact internal record and a one- or two-paragraph answer.

### 1. Route

- Identify the requested task, target concept or candidate designation, intended human renderer, any explicitly requested machine representation, applicable specialist profiles, and any ambiguity that blocks responsible work.
- Ask one focused clarification only when plausible interpretations would yield materially different concepts or a required authority, jurisdiction, threshold, or use decision cannot be inferred safely. Otherwise state a bounded assumption and use provisional status when needed.
- Use `definition-answer` for a direct definition, `revision-audit` for a supplied definition or semantic defect review, and `concept-package` for a reusable, governed, mapped, or formally modeled entry.

### 2. Frame

- Build a proportional ConceptBrief containing only material facts: target and task; purpose and intended use or non-use; subject field; included and excluded scope; desired granularity; audience; jurisdiction, scheme, language, and time or version context; stakeholders, responsible authority, and affected communities; active profiles and requested representations; assumptions; unresolved ambiguities; and competency questions.
- Classify risk as `routine`, `consequential`, or `authority-sensitive`. Routine work is familiar and reversible; consequential work can affect interoperability, policy, legal, safety, scientific, or operational outcomes; authority-sensitive work is contested, normative, situated, or community-governed and may not be legitimate for the agent to settle.
- Use only enough competency questions to expose the intended boundary. Mark a question critical when failure would invalidate the concept or intended use.

### 3. Research

- Plan evidence lanes from the ConceptBrief. Read [Evidence and provenance](references/evidence-and-provenance.md) when external research, reuse, mapping, audit, consequential use, authority-sensitive use, source conflict, licensing, or version choice is material.
- Retrieve the exact destination that supports each retained claim and record its role, edition or version, status, scope, retrieval, authority basis, and wording permission. A wording-permission conclusion requires its own retrieved license or permission destination; if that destination was not inspected, record permission as unresolved and do not claim verbatim reuse. A search result, citation record, inaccessible page, model memory, or worker summary is discovery evidence only.
- Before stating that wording may be copied or reused verbatim, directly retrieve the exact license or permission URL that will support and be cited for that statement, inspect whether it applies to the source wording and proposed action, and retain that retrieval. A publisher policy hub, source-page footer, discovered link, search result, or remembered rule is not a substitute. If the exact destination is not retrieved or applicability remains unclear, state `Wording permission: unresolved - do not reuse verbatim`.
- Keep semantic equivalence separate from permission to reuse wording. Do not copy protected wording merely because it defines the same concept.

#### Capability-aware parallel research

Parallel dispatch is optional and allowed only when the environment permits spawning, at least two bounded non-overlapping multi-step lanes can be fixed before dispatch, neither lane depends on the other, and likely time savings exceed coordination overhead. Prefer batched tool calls for shallow independent lookups; use subagents only for multi-step standards or registry, domain, mapping, licensing or version, or governance research.

Give every worker the same ConceptBrief and require the exact destination, source role, edition or version, retrieval status, supported claim, boundary evidence, licensing information when material, conflicts, and uncertainty. The coordinator owns concept identity, clarification, routing, source eligibility, disposition, mapping, synthesis, conflict resolution, definition drafting, final validation, and the final answer; the coordinator must reverify uncertain or material evidence at its destination.

Use sequential fallback when any eligibility condition fails. Completion depends on result quality and evidence integrity, not on whether a subagent was available or used.

### 4. Model

- Separate concept from designation, object from concept, class from individual, property from value, process from result, information content from carrier, and the semantic construct from its code, field, datatype, unit, syntax, value domain, record, file, serialization, or interface.
- Treat polysemous or homonymous designations as separate candidate concepts until disambiguated. Build a term inventory only when useful, distinguishing preferred, alternative or admitted, hidden, deprecated, forbidden, and candidate designations.
- Build only enough typed neighborhood to test identity and boundary: immediate superordinate or broader context, plausible siblings or coordinate concepts, narrower concepts, part-whole relations, and material associative or profile-specific relations. Never turn a generic broader relation into subclass or partitive semantics.
- Test the proposed extension with positive examples, negative examples or exclusions, counterexamples, and near misses as appropriate. For an audit, reusable package, mapping, or other substantive entry, read the format-neutral [Concept-entry model](references/concept-entry-model.md).

### 5. Decide

- Compare each candidate independently on semantic relationship (`same`, `broader`, `narrower`, `overlapping`, `related`, `constituent-only`, `conflicting`, or `unresolved`), scope and granularity fit, authority fit, edition or version status, and wording or license permission.
- Choose one disposition: `Adopt` an authoritative same-concept definition without semantic change when wording use is permitted; `Adapt` the same concept for wording, granularity, context, or formulation; `Formulate` a new definition when no sufficiently matching reusable definition is verified; or `Defer` when identity, authority, evidence, permission, or a user decision is insufficient.
- Choose the definition strategy that fits the concept: intensional, extensional, partitive, mixed, operational, formal rule or axiom, or perspectival or provisional. Intensional immediate-superordinate plus delimiting-characteristics formulation is the default, not a universal requirement.
- For an extensional strategy, ensure the extension is finite and label completeness; for a partitive strategy, do not confuse part with kind; for a mixed strategy, label each list's role; for an operational strategy, separate the concept from a method- or jurisdiction-specific threshold; for a formal strategy, keep textual meaning separate from machine commitments; for a perspectival strategy, name the standpoint and preserve legitimate alternatives.

### 6. Define

- Draft against the chosen strategy, scope, and concept system. Include only essential or delimiting characteristics needed to establish the intended extension and distinguish relevant neighbors.
- Put examples, permissible values, implementation details, rationale, procedures, formulas, units, governance rules, and storage or transport details outside the definition unless one is constitutive of the concept.
- Avoid circularity, hidden secondary definitions, unnecessary negation, unexplained abbreviations, category shifts, accidental implementation dependence, and wording that merely rearranges the designation.

### 7. Validate

- Check identity, category, scope, granularity, strategy, superordinate fit, delimiting-characteristic necessity, sibling and boundary discrimination, critical competency questions, typed relations, mapping conservatism, evidence support, exact source and edition status, contradictions, wording permission, active-profile rules, governance authority, qualitative status, blockers, and definition-first presentation.
- Treat a wrong identity or category, circular or non-discriminating definition, failed critical competency question or boundary case, unsupported or misattributed evidence, licensing problem, false exact mapping, invented identifier or tool result, inappropriate profile or out-of-scope compliance claim, or illegitimate authority claim as a critical failure. Repair it, make the result explicitly provisional, or Defer; prose quality cannot compensate.
- Before presenting, compare every final wording-permission claim and cited license or permission URL against the current-task retrieval record; if the exact URL was not directly retrieved or its applicability was not established, mark wording permission unresolved and forbid verbatim reuse.
- Report each material tool-dependent check as `passed`, `failed`, `warning`, `not run`, or `not applicable`, and name the actor or method that actually performed it. An agent semantic check is not human review; use `human review` only when a human actually reviewed this result. Never invent an identifier, registry acceptance, source retrieval, parser result, schema result, SHACL result, reasoner result, conformance finding, review, approval, release, or version history.
- Use qualitative status such as `established`, `adopted`, `adapted`, `proposed`, `provisional`, `contested`, `deprecated`, or `blocked pending clarification or evidence`. Keep lifecycle status, reuse disposition, source status, validation result, and review need independent; do not convert self-assessment into a number.

### 8. Present

- Present the definition first when responsible formulation is possible. A warning, focused clarification, or evidence blocker may precede it only when omission would materially mislead or no responsible definition can yet be supplied.
- Read [Concept-entry presentation](references/concept-entry-presentation.md) when selecting or projecting the `definition-answer`, `revision-audit`, or `concept-package` renderer. Omit empty sections and internal research narration.
- Read [Concept-entry serialization](references/concept-entry-serialization.md) only when the user explicitly requests machine-readable output; default an unspecified machine form to versioned plain JSON and preserve the same semantic record.

## Profile routing

The terminology core is always active: keep concept, designation, extension, object, and record distinct; resolve polysemy; type relations; test boundaries; and preserve evidence and status. An otherwise unqualified deliberate request to "define this concept" uses the terminology core plus the data-definitions fallback unless user context or one focused clarification selects a more appropriate profile.

Multiple profiles may compose. Apply each profile only to its semantic responsibilities and reconcile their checks in the shared concept entry; do not duplicate output or let one profile silently change another profile's semantic type.

| Profile | Activate and read when |
|---|---|
| [Data definitions](references/profiles/data-definitions.md) | The request concerns data elements, metadata registries, fields, codes, value domains, data constructs, naming under ISO/IEC 11179, or the unqualified data-definitions fallback. |
| [Knowledge organization systems](references/profiles/knowledge-organization-systems.md) | The request concerns a thesaurus, taxonomy, classification, controlled vocabulary, concept scheme, semantic relation, or cross-scheme mapping. |
| [Formal ontology](references/profiles/formal-ontology.md) | The request concerns a class, individual, property, role, axiom, restriction, competency question, ontology mapping, constraint, or machine reasoning. |
| [Multilingual terminology](references/profiles/multilingual-terminology.md) | More than one language, language variety, script, translation-oriented term record, or cross-language equivalence is material. |
| [Epistemic governance](references/profiles/epistemic-governance.md) | Meaning is contested, situated, normative, culturally sensitive, community-governed, jurisdiction-dependent, or authority-dependent. |

The data-definitions fallback supplies disciplined formulation questions only. For an ordinary concept outside data and metadata scope, it must not force data-specific fields, turn the concept into a registry item, claim ISO/IEC 11179 compliance, or imply registry acceptance.

## Completion contract

Return the smallest renderer that answers the task and exposes every material limitation or next decision. Definition text, concept identity, disposition, qualitative status, evidence relationship, active profiles, and unresolved blockers must remain consistent across human and machine projections.

Do not claim completion while a critical failure remains hidden. Defer when the missing clarification, evidence, reuse permission, legitimate authority, or affected-community decision cannot be supplied responsibly.
