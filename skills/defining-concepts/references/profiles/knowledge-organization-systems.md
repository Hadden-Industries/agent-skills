# Knowledge-Organization-Systems Profile

This profile adds thesaurus, taxonomy, classification, controlled-vocabulary, concept-scheme, and mapping semantics to the terminology core.

## Activation

Activate for thesauri, taxonomies, classifications, subject-heading systems, authority files, controlled vocabularies, concept schemes, collections, labels, notations, semantic relations, or cross-scheme mappings. Do not activate merely because an ordinary answer uses a list of related terms.

## Additional questions

- Which concept scheme or vocabulary, version, language, jurisdiction, and use context is authoritative for each side?
- Is the target a concept, concept scheme, collection, label, notation, documentation note, semantic relation, or mapping assertion?
- Is the relationship within one scheme or across schemes, and is its intended use retrieval expansion, navigation, data integration, migration, or editorial alignment?
- What evidence establishes intension, extension, scope, system position, and actual use for each candidate concept?
- Would a proposed broader, narrower, partitive, associative, exact, close, broad, narrow, or related relation behave safely for the intended application?

## Semantic distinctions

Keep concepts distinct from their preferred, alternative, or hidden labels; notations distinct from labels; documentation notes distinct from definitions; concept schemes distinct from concepts and collections; collection membership distinct from hierarchy; and within-scheme semantic relations distinct from cross-scheme mappings.

Type generic broader and narrower, partitive, and associative relations according to the governing scheme. Do not treat every broader relation as genus-species, every hierarchy as transitive for every application, a part-whole relation as `is-a`, or collection membership as a semantic parent.

For SKOS, distinguish `skos:broader`, `skos:narrower`, and `skos:related` from `skos:broadMatch`, `skos:narrowMatch`, `skos:relatedMatch`, `skos:closeMatch`, and `skos:exactMatch`. A SKOS concept is not an OWL class, and a label is neither a concept nor evidence of identity.

## Evidence

Use the maintained scheme's exact records, scope notes, definitions, labels, relations, version history, and governance documentation as primary evidence for its own assertions. For a mapping, retrieve both exact concept destinations and applicable scheme versions; compare intension, extension, category, scope, granularity, concept-system position, jurisdiction, time, and use.

Use ISO 25964-1:2011 as the reviewed published thesaurus baseline and ISO 25964-2:2013 as the reviewed published interoperability and mapping baseline, while disclosing their lifecycle status. Use the SKOS Reference, W3C Recommendation 18 August 2009, for SKOS data-model semantics. Do not make a protected ISO rule visible merely because an implementation summary is public.

Lexical similarity, shared notation, an existing mapping assertion, or symmetric-looking labels are candidate evidence only. Exact mapping requires especially strong evidence because downstream expansion can propagate error.

## Validation

Validate concept identity on both sides, relation type and direction, source and target scheme versions, within-scheme versus mapping semantics, scope and granularity, intension and extension, hierarchy or system position, use context, and whether the chosen mapping predicate is conservative.

For exact mapping, require evidence that the concepts can be used interchangeably across the stated scope without a material extension, intension, category, jurisdiction, temporal, or governance mismatch. Prefer close, broad, narrow, related, unresolved, or no mapping when exactness is not established.

Check that labels, notations, collections, and documentation notes have not been mistaken for semantic relations; that broader/narrower, partitive, and associative relations remain distinct; and that exporting to SKOS does not silently strengthen local semantics.

## Prohibited claims

- Do not claim exact equivalence from labels, shared identifiers, machine similarity, or an unverified mapping record.
- Do not call a SKOS concept an OWL class, a collection a concept scheme, a notation a preferred label, or `skos:related` a hierarchy.
- Do not call output ISO 25964-conformant or SKOS-conformant unless the applicable requirements and actual validation were identified and performed.
- Do not describe a published edition under revision as an unchanged future baseline, and do not silently use a draft replacement.
- Do not invent scheme membership, identifiers, labels, mappings, governance approval, or version history.

## Completion additions

When material, add scheme identity and version, concept records on both sides, label and notation status, within-scheme relations, mapping direction and predicate, comparison of intension and extension, scope and system position, evidence and limitations, and the requested serialization or validation state.

For a compact mapping answer, put the concept definition or identity statement first, then the proposed relationship and decisive reason. Do not expose every KOS field when the user only needs a conservative mapping decision.

## Reviewed sources

- [ISO 25964-1:2011 official record](https://www.iso.org/standard/53657.html) - Edition 1, published 2011-08, status Published and stage 90.92 To be revised when checked on 2026-08-29; ISO/FDIS 25964-1 was identified as the expected replacement, so the published edition is a reviewed baseline under revision.
- [ISO 25964-2:2013 official record](https://www.iso.org/standard/53658.html) - Edition 1, published 2013-03, status Published and stage 90.92 To be revised when checked on 2026-08-29; ISO/AWI 25964-2 was under development, so no draft was substituted.
- [SKOS Simple Knowledge Organization System Reference](https://www.w3.org/TR/skos-reference/) - W3C Recommendation 18 August 2009 and normative SKOS data-model specification; reviewed for concepts, schemes, labels, notations, documentation, semantic relations, collections, and mappings.
- [OWL 2 Document Overview, Second Edition](https://www.w3.org/TR/owl-overview/) - W3C Recommendation 11 December 2012, non-normative overview within the OWL 2 Recommendation family; reviewed only to preserve the SKOS concept versus OWL class boundary.

## Composition notes

Compose with multilingual terminology when labels or mappings span languages; preserve concept-first equivalence and language-specific designation status rather than translating scheme labels in isolation. Compose with formal ontology only when the user needs explicit class or property commitments, and keep SKOS mapping semantics separate from OWL identity or subclass axioms.

Compose with data definitions for code lists, value domains, or permissible values only after typing each construct. Compose with epistemic governance when a scheme or mapping is community-governed, contested, or jurisdiction-sensitive; interoperability does not override legitimate local authority.
