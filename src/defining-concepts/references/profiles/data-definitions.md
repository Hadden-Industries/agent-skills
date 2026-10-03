# Data-Definitions Profile

This profile adds data- and metadata-specific distinctions to the terminology core. It uses ISO/IEC 11179-4:2004 as the reviewed formulation baseline within its actual scope and ISO/IEC 11179-5:2015 only when metadata-registry naming is material.

## Activation

Activate for a data element, data element concept, metadata item, metadata registry, object class, property, conceptual domain, value domain, permissible value, representation class, field, code, datatype, unit, syntax, or another data construct; for an explicit ISO/IEC 11179 request; or as the router's fallback for an otherwise unqualified deliberate definition.

The fallback supplies formulation discipline only. If context establishes another domain or profile, replace or compose the fallback. An ordinary concept outside data and metadata scope must not be converted into a data element, registry record, or compliance target.

## Additional questions

- What kind of semantic or registry object is being defined: concept, object class, property, data element concept, conceptual domain, value domain, data element, permissible value, representation class, or another data construct?
- Is the target the semantic concept, its recorded value, a representation, or a registry record about one of those things?
- Which object class and property combine in the data element concept, and which conceptual domain expresses the possible value meanings independently of representation?
- Which value domain, datatype, format, unit, code list, permissible values, or syntax represents the conceptual domain, and which of those details are accidental rather than constitutive?
- Is metadata-registry naming part of the task, and if so which naming convention, language, context, and administered-item type apply?

## Semantic distinctions

Keep a data element concept distinct from a data element and its representation; an object class distinct from the objects it classifies; a property distinct from a value; a conceptual domain distinct from a value domain; a permissible value distinct from the concept it denotes; and the semantic construct distinct from a field, column, code, datatype, unit, syntax, interface, storage location, transport form, or registry record.

A value list is boundary evidence unless the concept is responsibly defined extensionally. A field or code may represent a concept without being that concept. A registry's acceptance, identifier, status, and naming convention describe an administered record and must not be inferred from definition quality.

Use the immediate superordinate concept and delimiting characteristics when an intensional definition fits. Match specificity to context, users, data-sharing needs, and the exact metadata-item or data-construct type. Do not embed secondary definitions, implementation instructions, permissible values, examples, rationale, or measurement procedures in the definition unless constitutive.

## Evidence

Treat the official ISO product page as edition and lifecycle evidence, and an authorized copy as the rule source. Record ISO/IEC 11179-4:2004, Edition 2, and the exact clauses applied. The official page describes Part 4 as covering semantic requirements and recommendations for definitions of data, metadata, data elements, and related data constructs, not formatting rules for every concept.

Use ISO/IEC 11179-5:2015, Edition 3, only for naming concepts, data element concepts, conceptual domains, data elements, and value domains in metadata registries. Its official lifecycle page was at stage 90.92, to be revised, with ISO/IEC DIS 11179-5 under development when reviewed on 2026-08-29; do not silently substitute the draft for the published edition.

Supplement standards rules with directly retrieved domain, registry, neighboring-concept, value-domain, and representation evidence. A registry candidate establishes only what its retrieved record and version support.

## Validation

For an ISO/IEC 11179-4:2004 audit, first test whether the statement represents one concept and differentiates it from related concepts. Then apply the reviewed mandatory formulation checks: singular form unless the concept itself is plural; positive declaration; descriptive phrase or grammatically complete sentence rather than a synonym or rearranged designation; full words except commonly understood or adopted abbreviations, with acronyms expanded when needed; and no embedded definitions of other concepts.

Apply the reviewed recommendations proportionately: essential meaning at the context-appropriate specificity; precision and one defensible interpretation; concision without lost discrimination; standalone intelligibility; no extraneous rationale, usage, domain, procedure, or implementation detail in the sentence; no circular reasoning; consistent terminology and logical structure among related definitions; and appropriateness for the actual metadata-item or data-construct type.

Perform an additional category and substitutability check: substitute the definition for the designation in representative statements, compare it with plausible siblings, and test that it does not conflate concept with process, result, representation, carrier, field, code, datatype, unit, syntax, conceptual domain, value domain, permissible value, or registry record. Label this category test as a skill safeguard, not an extra ISO/IEC 11179-4 requirement.

## Prohibited claims

- Do not claim ISO/IEC 11179-4 compliance outside its data and metadata scope or when every applicable requirement and recommendation was not actually checked.
- Do not claim ISO/IEC 11179-5 conformance from a plausible name, and do not describe the in-development replacement as the published standard.
- Do not equate a well-formed definition with registry acceptance, registration, standardization, release, identifier assignment, or administered-item status.
- Do not copy proprietary standards text into the answer or repository; cite the reviewed edition and paraphrase within its verified scope.
- Do not force data-specific fields or ISO terminology into an ordinary out-of-scope concept merely because this profile was selected as fallback.

## Completion additions

When material, add the identified data or metadata construct type; object class and property; conceptual-domain and value-domain boundary; representation details kept outside the definition; exact Part 4 checks performed and their results; naming context under Part 5; and a narrow conformance or audit statement.

If fallback use was ordinary and out of Part 4 scope, state only that terminology and data-definition formulation discipline informed the result. Do not add an ISO section or compliance statement that the user does not need.

## Reviewed sources

- [ISO/IEC 11179-4:2004 official record](https://www.iso.org/standard/35346.html) - Edition 2, published 2004-07, status Published and stage 90.93 Confirmed when checked on 2026-08-29; official scope summary plus an authorized copy were reviewed, and the protected text is not reproduced here.
- [ISO/IEC 11179-5:2015 official record](https://www.iso.org/standard/60341.html) - Edition 3, published 2015-04, status Published and stage 90.92 To be revised when checked on 2026-08-29; the page identified ISO/IEC DIS 11179-5 as the replacement under development, so Edition 3 remains the reviewed published naming baseline rather than a claim about the future edition.
- [ISO 704:2022 official record](https://www.iso.org/standard/79077.html) - Edition 4, published 2022-07, status Published when checked on 2026-08-29; used only through the always-active terminology core for concept-oriented terminology principles.
- [ISO 1087:2019 official record](https://www.iso.org/standard/62330.html) - Edition 2, published 2019-09, confirmed in 2025 and stage 90.93 when checked on 2026-08-29; used as terminology vocabulary, not as a registry-conformance source.

## Composition notes

Compose with the multilingual profile when designations, language varieties, translation equivalence, or TBX exchange are material; keep the data construct's identity shared while each profile adds its own checks. Compose with the KOS profile for code lists or controlled vocabularies only after deciding whether a permissible value, concept, label, notation, and mapping are actually distinct.

Compose with formal ontology for class, property, or axiom commitments and with epistemic governance for authority-sensitive data concepts. The terminology core owns identity and definition; this profile must not overwrite a multilingual equivalence judgment, KOS mapping, ontology category, or legitimate governance decision.
