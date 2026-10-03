# Concept-Entry Model

This is the single format-neutral semantic record from which human renderers and machine representations are projected. It is not an executable schema, a mandatory form, or permission to invent missing values. Populate only supported fields that help the task.

## 1. Definition

Retain definition text and language; selected strategy; local lifecycle status; adopt, adapt, formulate, or defer disposition; relationship to any source wording; responsible-authority or standpoint qualifier; and material limitations. If formulation is blocked, retain the blocker and do not create placeholder prose that looks final.

## 2. Identity and designations

Retain the concept's subject field, intended ontological or semantic category, scope key, identity assumptions, and only supplied or verified persistent identifiers. Keep designations as term records that may be preferred, alternative or admitted, hidden, deprecated, forbidden, or candidate, with language, language variety, script, jurisdiction, community, grammatical information, source, and status only when material.

Never treat designation identity as concept identity. Separate homonymous and polysemous senses, and never mint an identifier, namespace, scheme membership, registry record, or status merely to fill the group.

## 3. ConceptBrief

Retain the requested task; purpose; intended use and material non-use; included and excluded scope; desired granularity; audience; subject field; jurisdiction, scheme, language, and time or version context; stakeholders, responsible authority, and affected communities; routine, consequential, or authority-sensitive risk; active profiles; requested representations; assumptions; unresolved ambiguities; and competency questions with criticality.

Keep the brief proportional. It may be a few internal facts for a direct routine definition and a fuller explicit record for an audit, concept package, consequential decision, or authority-sensitive task.

## 4. Characteristics and boundaries

Classify characteristics as essential, delimiting, contextual, typical, operational, or rejected. Retain inclusions and exclusions separately from positive examples, negative examples, counterexamples, and near misses; label each item's role so an illustration is never mistaken for an exhaustive extension.

Record why each decisive characteristic includes intended members and excludes siblings or near misses. For threshold, fuzzy, operational, jurisdiction-dependent, or perspectival concepts, retain the rule, standpoint, uncertainty, and applicability boundary without silently universalizing them.

## 5. Typed concept system

Retain only relations needed to establish identity, boundaries, mappings, or intended inference. Available types include immediate superordinate or genus, generic broader and narrower, coordinate or sibling, partitive whole and part, associative, causal, temporal, agent-role, quality-bearer, information-content/carrier, class-instance, property-value, process-result, and profile-specific relations.

Record relation direction, target identity, rationale, evidence, scope, and profile semantics. Superordinate, broader, narrower, coordinate, partitive, associative, causal, temporal, agent-role, quality-bearer, information-content and carrier relations are not interchangeable, and a human-readable broader relation is not automatically an OWL subclass axiom or SKOS relation.

## 6. Reuse, formulation, and mapping

For every material candidate retain concept identity, semantic relationship (`same`, `broader`, `narrower`, `overlapping`, `related`, `constituent-only`, `conflicting`, or `unresolved`), scope and granularity fit, authority fit, edition or version fit, wording permission, and rationale. Retain the chosen `Adopt`, `Adapt`, `Formulate`, or `Defer` disposition and the intensional, extensional, partitive, mixed, operational, formal, or perspectival or provisional definition strategy.

For a mapping retain source and target scheme or system, direction, predicate or relationship, evidence, intension and extension comparison, scope, system position, use context, version, status, and unresolved limits. Do not infer exact equivalence from shared labels.

## 7. Evidence and provenance

Link each retained evidence item to the claim, field, boundary, mapping, or decision it supports or contradicts. Retain exact destination, title, publisher or responsible body, role, authority basis, edition or version and status, applicable date and jurisdiction or community, retrieval event and status, locator, licensing or wording action, semantic relationship, conflicts, negative-search limits, and coordinator reverification as defined in [Evidence and provenance](evidence-and-provenance.md).

Do not convert discovery evidence, model memory, a worker summary, or an inaccessible destination into a verified source.

## 8. Validation

Retain competency-question results; positive, negative, counterexample, near-miss, sibling, and substitutability tests; definition-quality checks; mapping checks; active-profile checks; governance and authority checks; and any tool-dependent parser, schema, SHACL, reasoner, registry, or retrieval check.

For every check retain its target, method, result (`passed`, `failed`, `warning`, `not run`, or `not applicable`), evidence, and limitation. Keep conceptual correctness distinct from syntax validity, graph conformance, logical consistency, satisfiability, and operational acceptance.

## 9. Active-profile extensions

Retain only information required by active profiles: data-definition object distinctions and audits; KOS scheme, label, notation, note, relation, and mapping semantics; ontology commitments and intended inferences; multilingual designation and equivalence details; or epistemic-authority, standpoint, consent, and co-governance information.

Name profile information for readers when presenting it. Do not create a generic extension bucket in the final answer, force inactive-profile fields, duplicate core facts, or let one profile overwrite another profile's type.

## 10. Governance and maintenance

Retain unresolved questions, contested alternatives, responsible authority, affected parties, review or co-governance need, local lifecycle status, supplied local version, source-review date, change rationale, deprecation reason, replacement relationship, and next action when material.

Preserve supplied identifiers, versions, review dates, and maintenance decisions exactly. Do not imply a release manager, approval body, registry workflow, monitoring service, or version history exists when none was supplied or verified.

## State semantics

Use explicit states rather than ambiguous blanks: `absent` means the field is not present in this projection; `unknown` means it is relevant but not known; `not applicable` means the field does not apply; `contested` means materially different positions remain; `intentionally withheld` means a legitimate decision keeps it undisclosed; `not checked` means a relevant assessment was not performed; and `unsupported` means a value or claim was proposed but lacks adequate evidence.

Keep missing state, local lifecycle status, reuse disposition, source status, validation result, and review need independent. Never collapse absent, unknown, not applicable, contested, intentionally withheld, not checked, and unsupported into an empty string, unqualified null, false, or an invented value.

## Projection invariant

Every renderer and serialization projects this same record. Definition text, concept identity, disposition, qualitative status, evidence relationships, active-profile conclusions, and unresolved blockers must not contradict one another because the presentation or representation changes.
