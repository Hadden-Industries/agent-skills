# Formal-Ontology Profile

This profile adds explicit ontological commitments, constraints, and validation-state distinctions to the terminology core. It does not turn every concept definition into an ontology class.

## Activation

Activate for classes, individuals, object or data properties, roles, qualities, processes, information objects, carriers, axioms, restrictions, ontology mappings, competency questions, intended inferences, graph constraints, SHACL, OWL, or machine reasoning.

## Additional questions

- Which competency questions and intended inferences must the formalization answer, and which are critical?
- Is the target a class, individual, property, role, quality, process, event, state, information object, carrier, collection, relation, or another category in the selected ontology?
- Which conditions are necessary, sufficient, both, or merely typical, and which open-world assumptions apply?
- Which domain, range, identity, disjointness, quantification, cardinality, temporal, or dependence commitments are actually justified?
- Which ontology, profile, namespace, imports, version, constraint language, reasoner, and validation environment are supplied or verified?

## Semantic distinctions

Keep class, individual, property, role, quality, process, information object, and carrier distinct. Separate textual definition from necessary conditions, sufficient conditions, constraints, mappings, annotations, competency questions, and intended inferences.

Distinguish taxonomy from partonomy, class membership from subclassing, identity from equivalence or close mapping, a role from a rigid type, a quality from its measured value, a process from its result, and information content from its physical or digital carrier.

Use OntoClean-style identity, unity, rigidity, and dependence diagnostics only when they expose a likely taxonomic error. Do not label a quick diagnostic a complete OntoClean analysis.

## Evidence

Base formal commitments on the ConceptBrief, verified domain evidence, the target ontology's exact version and documentation, and the competency questions. Retrieve every reused class, property, identifier, namespace, import, and mapping destination that materially affects the proposal.

Use the normative OWL 2 Recommendation-family specifications for OWL commitments and conformance questions; the OWL 2 overview is an informative roadmap. Use SHACL Recommendation 20 July 2017 for claims about SHACL 1.0 validation. SHACL 1.2 Core was a Working Draft dated 16 May 2026 when reviewed and must not silently replace the Recommendation.

Treat OBO Foundry principles as conditional norms for OBO Foundry ontologies, not global ontology law. Treat CIDOC CRM as conditional cultural-heritage practice and use an official or stable release rather than a newer draft unless the task explicitly targets that draft.

## Validation

Begin with competency questions and intended inferences, then test category, identity criteria, superordinate placement, sibling discrimination, part-versus-kind relations, necessary and sufficient conditions, and the justification for domain, range, disjointness, quantification, and cardinality.

Keep result states separate in this order: proposed semantics; parser-valid syntax; applicable OWL profile or other conformance check; SHACL data-graph conformance; reasoner consistency and class satisfiability; competency-question inference result; and conceptual correctness. One passing layer does not establish another.

Run a parser, SHACL processor, reasoner, query, or mapping checker only when the tool, exact ontology bytes, imports, profile, and authorization are available. Record the tool and version, input, check, result, warnings, and limitation. An LLM review is not an execution result.

For OntoClean-style review, ask whether identity criteria are supplied or inherited, whether instances form relevant wholes, whether membership in the class is essential to instances, and whether the class depends on another entity. Use the answers to diagnose category and subsumption errors, not to manufacture metaproperties unsupported by evidence.

## Prohibited claims

- Do not invent an IRI, prefix, namespace, import, class, property, axiom, ontology version, or mapping target.
- Do not claim syntax validity, OWL conformance, SHACL conformance, consistency, satisfiability, entailment, or competency-question success unless the corresponding tool actually ran on identified inputs.
- Do not infer conceptual correctness from parser, SHACL, or reasoner success, or infer graph conformance from conceptual plausibility.
- Do not apply OBO Foundry or CIDOC CRM rules outside their domains and governance, and do not use a draft as an official or stable release without explicit scope.
- Do not collapse textual definitions, axioms, constraints, and mappings into one field or claim that an OWL class is automatically a SKOS concept.

## Completion additions

When material, add competency questions and intended inferences; selected ontological category; textual definition; proposed necessary and sufficient conditions; justified axioms or constraints; mapping semantics; ontology, imports, and version; tool-result states; unresolved modeling choices; and the next validation or domain-review action.

Put the textual definition first in a human concept package unless a blocker prevents it. Label every formal artifact `proposed` until its stated validation has actually occurred.

## Reviewed sources

- [OWL 2 Web Ontology Language Document Overview, Second Edition](https://www.w3.org/TR/owl-overview/) - W3C Recommendation 11 December 2012; reviewed as the non-normative roadmap to the normative OWL 2 Recommendation-family specifications and their separation of structure, semantics, mappings, profiles, syntax, and conformance.
- [OWL 2 Structural Specification and Functional-Style Syntax, Second Edition](https://www.w3.org/TR/owl-syntax/) - W3C Recommendation 11 December 2012; reviewed for the distinction between ontology structures and presentation syntax.
- [Shapes Constraint Language (SHACL)](https://www.w3.org/TR/shacl/) - W3C Recommendation 20 July 2017; reviewed for RDF graph validation and conformance semantics.
- [SHACL 1.2 Core](https://www.w3.org/TR/shacl12-core/) - W3C Working Draft 16 May 2026 when checked on 2026-08-29; treated as an in-development source, not as the latest Recommendation.
- [OBO Foundry Principles](https://obofoundry.org/principles/fp-000-summary.html) - Maintained normative principles for OBO Foundry ontology review when checked on 2026-08-29; applied only conditionally to OBO work.
- [CIDOC CRM versions](https://cidoc-crm.org/versions-of-the-cidoc-crm) - Version 7.1.3, released 2024-02, was listed as Official (ISO Correspondence), while Version 7.3.2, released 2026-03, was Draft when checked on 2026-08-29; use the status appropriate to the task.
- [Towards OntoClean 2.0: A framework for rigidity](https://doi.org/10.3233/APO-2005-000009) - Research source for proportionate rigidity diagnostics, not a conformance standard.

## Composition notes

Compose with epistemic governance when ontology commitments represent contested, situated, community-governed, or authority-dependent knowledge; the governance profile may require alternative models, provisional status, review, co-governance, or deferral even when an axiom is syntactically valid.

Compose with KOS when linking SKOS concepts and ontology entities, but preserve each model's relation semantics. Compose with multilingual terminology for lexicalization or OntoLex-Lemon and with data definitions for metadata constructs; the terminology core owns shared concept identity and definition.
