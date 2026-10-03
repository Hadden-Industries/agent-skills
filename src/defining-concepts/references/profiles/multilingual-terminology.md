# Multilingual-Terminology Profile

This profile adds multilingual designation records and cross-language equivalence analysis to the terminology core. It starts from concepts, not isolated word translation.

## Activation

Activate when two or more languages, language varieties, scripts, jurisdictions, translation-oriented term records, multilingual concept schemes, cross-language mappings, TBX exchange, OntoLex-Lemon, or linguistic equivalence are material.

## Additional questions

- Which concept and subject field are shared, and which language, variety, script, jurisdiction, community, and time context applies to each designation?
- Which designation is preferred, alternative or admitted, hidden, deprecated, forbidden, or candidate in each context, and who assigns that status?
- Is equivalence full, partial, directional, pragmatic, or absent for the intended use, and which dimensions differ?
- Do grammatical behavior, register, connotation, legal status, cultural framing, or extension change the mapping?
- Is the requested machine representation terminology exchange, KOS labels, or lexical grounding for an ontology, and which profile or dialect applies?

Treat missing language variety, jurisdiction, or designation authority as an unresolved scope dimension rather than an automatic blocker. When a responsible comparison or package can preserve alternatives under explicit language and jurisdiction assumptions, proceed with provisional concept formulations; ask a focused clarification first only when every plausible scoped formulation would materially mislead.

## Semantic distinctions

Preserve concept orientation before translation: establish the source concept's identity and boundary, then determine whether a target-language community lexicalizes the same concept. Shared spelling, cognates, dictionary glosses, corpus co-occurrence, and machine translation are not sufficient evidence of concept equivalence.

Record language, language variety, script, jurisdiction, community, grammatical information, register, usage status, source, and designation status only when material. Do not treat a language tag as proof of linguistic or community validation.

Distinguish full equivalence from partial equivalence, directional equivalence, pragmatic equivalence for a stated task, and absent equivalence. Preserve a lexical gap, broader or narrower target concept, culturally different partition, or non-equivalent legal category rather than forcing one label-to-label translation.

Keep TBX terminology-resource exchange, SKOS language-tagged labels, and OntoLex-Lemon lexical-ontology representation distinct. Representation choice does not determine the underlying equivalence.

## Evidence

Use directly retrieved concept records, term records, subject-field sources, corpora, standards, legal or policy texts, and community sources appropriate to each language and jurisdiction. Record who assigns preference or acceptability and whether a source supports lexical use, concept identity, domain meaning, or community authority.

For consequential use, seek native-language domain expertise or legitimate community review proportionate to risk. A machine-generated translation or general bilingual dictionary may discover candidates but cannot establish specialist, legal, scientific, or community-governed equivalence alone.

Use ISO 30042:2019 only when TBX representation or terminology-resource interchange is actually requested. Use the 2016 OntoLex-Lemon Community Group Report only for applicable lexical grounding of ontology or vocabulary entities; it is a W3C Community Group Report, not a W3C Standard or Recommendation.

## Validation

Test source and target concept intension, extension, category, scope, granularity, system position, jurisdiction, time, register, and intended use. Test positive examples, exclusions, siblings, and near misses in both languages where possible, and state whether the mapping is symmetric or directional.

Validate each designation's language or variety, script, grammatical and usage information, source, and status only to the depth the task needs. Distinguish linguistic review, domain review, community review, parser validation, TBX dialect validation, RDF validation, and ontology reasoning.

When native-speaker, domain-specialist, or community review is needed but unavailable, mark the entry proposed or provisional, specify the review question, and avoid operationally final language.

## Prohibited claims

- Do not claim full equivalence from machine translation, shared spelling, cognates, labels, or a single general dictionary.
- Do not invent a preferred designation, language variety, script, grammatical property, community acceptance, equivalence relation, or review result.
- Do not claim that native-speaker, domain-specialist, or community review occurred unless an identified review actually occurred.
- Do not claim TBX, SKOS, RDF, or OntoLex-Lemon conformance from surface resemblance or undeclared profiles.
- Do not force a target-language label when no responsible equivalent exists; preserve explanation, borrowing, paraphrase, narrower mappings, or a lexical gap as appropriate.

## Completion additions

When material, add concept identity shared across languages; designation records with language, variety, script, jurisdiction, source, and status; equivalence type and direction; decisive mismatches; candidate recommendations by use context; required review; and requested representation plus validation state.

For consequential use, include an explicit `Required review:` item naming each applicable reviewer type - native-language, domain-specialist, legal, or affected-community - and the question that reviewer must settle. Mark unavailable review as `not performed`; do not leave the review need implicit in general cautionary prose.

For a compact answer, keep the definition first, then state the recommended designation and the one material equivalence limitation. Do not display exchange-format fields unless the user requests them.

## Reviewed sources

- [ISO 704:2022 official record](https://www.iso.org/standard/79077.html) - Edition 4, published 2022-07 and status Published when checked on 2026-08-29; used through the terminology core for concept-oriented terminology work and designation principles.
- [ISO 1087:2019 official record](https://www.iso.org/standard/62330.html) - Edition 2, published 2019-09 and stage 90.93 Confirmed when checked on 2026-08-29; used for terminology vocabulary.
- [ISO 30042:2019 official record](https://www.iso.org/standard/62510.html) - Edition 2, published 2019-04, status Published and stage 90.92 To be revised when checked on 2026-08-29; ISO/CD 30042 was under development, so the published edition remains the reviewed TBX baseline under revision.
- [Lexicon Model for Ontologies](https://www.w3.org/2016/05/ontolex/) - OntoLex-Lemon final W3C Community Group Report published 2016-05; the report explicitly is not a W3C Standard or Standards Track document.
- [Ontology-Lexica Community Group status page](https://www.w3.org/community/ontolex/wiki/Main_Page) - Maintained community page checked on 2026-08-29 for module and report status; emerging modules are not silently treated as final core specifications.

## Composition notes

Compose with data definitions when multilingual designations belong to metadata items or TBX output is requested; preserve the shared concept and add language-specific records without duplicating the Part 4 audit. Compose with KOS for multilingual labels and cross-scheme mappings, and with formal ontology for OntoLex-Lemon or language-tagged ontology annotations.

Compose with epistemic governance when language authority, naming rights, contested translation, or community conceptualization is material. The terminology core owns concept identity; this profile must not override locally legitimate governance with an ostensibly universal translation.
