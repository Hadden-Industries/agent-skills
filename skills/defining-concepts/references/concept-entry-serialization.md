# Concept-Entry Serialization

Load this reference only when the user explicitly requests machine-readable output. Serialization is a projection of the shared concept-entry model, never a substitute for concept engineering and never evidence that a representation has been validated or accepted.

## Representation routing

Use the explicitly requested representation only when it fits the active semantics and the available evidence. If machine-readable output is requested without a representation, default to versioned plain JSON with a declared local format version and no invented external conformance claim.

- Use plain JSON for a format-neutral exchange record when no established target model is required.
- Use JSON-LD or RDF only when graph identity, typed relations, vocabularies, and namespaces are justified and supplied or verified.
- Use SKOS for a knowledge-organization-system representation whose concepts, schemes, labels, notes, semantic relations, collections, or mappings fit SKOS semantics.
- Use OWL only for explicit ontology commitments; keep annotations and textual definitions separate from necessary or sufficient axioms.
- Use TBX only for applicable terminology-resource exchange and a declared dialect or profile.
- Use OntoLex-Lemon only for an applicable lexical-ontology representation, not as decoration on a generic term list.
- Use another requested representation only after stating its semantic fit, version, profile, and known limitations.

Do not generate an executable serializer, schema, ontology service, SHACL shape, or registry unless the user separately asks for implementation and that task is in scope.

## Required preservation

Preserve definition text and language, concept identity, supplied identifiers, designation language and status, typed relation direction and semantics, Adopt/Adapt/Formulate/Defer disposition, qualitative lifecycle and evidence status, active profiles, mappings and their strength, exact source and version, retrieval and licensing limits, validation results, review needs, and every material blocker.

Preserve state distinctions explicitly: `absent`, `unknown`, `not applicable`, `contested`, `intentionally withheld`, `not checked`, and `unsupported`. Never flatten them into an unqualified null, empty string, false value, omitted key whose meaning is unclear, or fabricated replacement.

Never mint an identifier, namespace, IRI, registry key, version, language tag, mapping predicate, source status, or validation result to make output look complete. Preserve a user-supplied identifier exactly and label a proposed local identifier as proposed only when the user requested one.

## Plain JSON default

For versioned plain JSON, use a concise top-level object with a local `formatVersion` and only populated concept-entry groups. Encode missing states with an explicit status object or another unambiguous convention documented in the same output. Do not call the shape a JSON Schema or claim compatibility with a standard merely because field names resemble it.

Machine-readable output is a projection, not an exhaustive dump. Put the short human definition preface before the representation, then emit one concise object containing only requested or materially necessary fields. Omit the internal ConceptBrief, audit checklist, repeated state explanations, and full claim or evidence ledger unless the user explicitly requests them or they are necessary to interpret a consequential decision.

Use stable, semantically descriptive lowerCamelCase property names unless the user supplies another naming convention. Keep human-readable definition text separate from machine relationships, and keep source metadata linked to the claims or fields it supports rather than as an undifferentiated bibliography.

## Validation disclosure

For every material parser, schema, SHACL, reasoner, mapping, or registry check, state the exact tool or method, target bytes or graph, applicable profile or version, and whether it was performed, passed, failed, produced a warning, was not run, or was not applicable. A textual model review is not parser execution, schema validation, SHACL conformance, reasoning, registry acceptance, or legal review.

A generated representation is not evidence that a parser ran. If the exact emitted bytes or graph exist only in the final response, or the current-task record contains no invocation and result for the named validator on that exact target, report parser, round-trip, syntax-execution, schema, SHACL, reasoner, mapping, or registry validation as `not run`. Manual structural review may be reported as manual review, but it must not receive a tool-execution pass label.

For OWL, distinguish proposed axioms, syntax parsed, profile or conformance checks, consistency, class satisfiability, and whether intended competency-question inferences were actually tested. For SHACL, distinguish shapes-graph syntax from data-graph conformance and conceptual correctness. For TBX, SKOS, JSON-LD, RDF, or OntoLex-Lemon, identify the exact specification, profile, dialect, context, or vocabulary actually checked.

The output must not claim conformance from superficial resemblance. If no suitable validator is available or authorized, mark the check `not run` and state the resulting limitation without weakening the semantic record.

## Representation-specific integrity

Do not silently strengthen relations during export: a generic broader relation is not automatically `skos:broader` or `rdfs:subClassOf`; a close mapping is not exact identity; a preferred label is not a class; a term translation is not full concept equivalence; and a textual constraint is not an OWL axiom or SHACL result.

Keep provenance, source/version/licensing, and local-status distinctions sufficient to interpret each serialized claim. Preserve proposed versus established, locally adopted versus source-published, and passed versus not-run validation states.

## Cross-projection consistency

Machine and human output must preserve the same definition text, concept identity, disposition, qualitative status, evidence relationships, mapping strength, and unresolved blocker. Representation constraints may omit unsupported optional detail but cannot manufacture certainty, identifiers, evidence, validation, or authority.
