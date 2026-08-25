---
name: defining-concepts
description: Formulates and audits source-grounded definitions for data, metadata, data elements, metadata items, and related data constructs against ISO/IEC 11179-4:2004. Use when asked to define a data or metadata concept, standardize a definition, audit terminology, or create a semantic artifact. Do NOT use for software code definitions, simple dictionary lookups, or casual term explanations.
license: MPL-2.0
compatibility: Requires an agent with web search and URL-fetching tools for vocabulary research and source verification; no bundled scripts or additional runtimes.
metadata:
  category: research
---

# Defining Concepts

Produce a source-grounded concept definition from a designation, optional starter definition, and contextual notes. Work as a terminology specialist, metadata architect, and ISO/IEC 11179-4:2004 compliance auditor. Keep the workflow internal and return only the final five-section artifact.

## Normative basis

Use ISO/IEC 11179-4:2004, Information technology - Metadata registries (MDR) - Part 4: Formulation of data definitions, as the normative authority for this workflow. Clause 1 covers the semantic content of definitions for data, metadata, data elements, and other data constructs; it does not specify definition formatting. Clause 2 permits independent use outside a metadata registry and permits a compliance claim when the requirements and recommendations have been followed.

Apply Clause 3.6 as the definition criterion: represent a concept with a descriptive statement that differentiates it from related concepts. Clause 5.1 makes the appropriate specificity context dependent and calls for definitions understandable to users and recipients of shared data.

Use genus-differentia formulation and an additional ontological category check as operational safeguards. They support the standard's definition criterion but are not separately enumerated ISO/IEC 11179-4:2004 requirements or recommendations.

Claim ISO/IEC 11179-4:2004 compliance only for a definition within Clause 1's data-and-metadata scope and only after every requirement and recommendation below passes. For another kind of concept, state that its formulation was audited against these provisions; do not claim compliance with the standard.

## Workflow

### 1. Establish the concept boundary

- Identify the intended sense, use context, intended audience, applicable metadata-item or data-construct type, and immediate superordinate concept.
- Separate the concept from neighboring processes, artifacts, carriers, data fields, codes, units, permissible-value sets, and representations.
- Treat supplied values as boundary evidence, not as an extensional definition.
- Discuss wording, morphology, or etymology only when it resolves ambiguity or supports a more precise designation.

### 2. Research with a bounded loop

1. Search the exact designation in the most relevant authoritative vocabulary or registry.
2. Inspect promising term-bearing destinations directly.
3. If no exact concept match exists, search authoritative sources for the genus, differentia, and neighboring concepts needed to establish the boundary.
4. Stop when the reuse path and defining characteristics have adequate authoritative support and at least one eligible source supports the concept or its constituent semantics. Do not collect ornamental sources.

A search-result excerpt discovers a candidate; it does not verify the final destination. Name a repository in `Repositories Queried` only when a visible pre-answer search or retrieval action targeted that repository.

### 3. Maintain a source-evidence ledger

For every candidate source, track internally:

- the repository or publisher actually queried;
- the exact destination URL retrieved;
- whether the retrieval completed without a tool error;
- the source role; and
- the specific semantic statement supported by the destination content.

Use one of these source roles:

- **Exact definition**: defines the same concept with matching extension and intension.
- **Adapted definition**: defines the same concept but its wording requires an identified ISO/IEC 11179-4 correction.
- **Constituent semantics**: supports the genus, differentia, or a neighboring concept without defining the compound designation.
- **Methodological support**: supports the definition method rather than the concept's domain meaning.
- **Rejected attribution**: directly establishes that a supplied source does not define the concept attributed to it.

A source is eligible for `Verified Sources` only when an exact-URL retrieval completed during this task and the inspected destination supports the role and claim assigned to it. A topical search, search-result excerpt, generic homepage, user assertion, or inferred URL does not satisfy this gate. If a retrieval fails or its content does not support the claim, remove the source and dependent claim or replace it with an eligible source. If no source meets the gate, report that limitation instead of inventing provenance.

### 4. Select the reuse path

- **Path A - Reuse**: an eligible authoritative source defines the same concept and its definition meets the Clause 3.6 criterion and passes the applicable requirements and recommendations. Reuse that definition without semantic or wording changes.
- **Path B - Adapt**: an eligible authoritative source defines the same concept, but its wording requires one or more corrections under the Clause 3.6 criterion, requirements, or recommendations. Identify both the retained semantics and every correction.
- **Path C - Create**: no eligible source defines the same concept. Formulate a new definition from eligible constituent semantics and explain that those sources do not define the compound designation.

Designation similarity, shared words, or a source suggested in the prompt does not establish semantic identity.

### 5. Formulate the definition

- Use the immediate superordinate concept as the genus.
- Add the primary, essential characteristics that distinguish sibling concepts.
- Match the level of specificity to the context, intended audience, system user, and environment.
- Make the definition appropriate for the type of metadata item or data construct being defined.
- Keep examples, permissible values, implementation details, rationale, procedures, symbols, units, and measurement instructions outside the definition unless one is itself an essential defining characteristic.

### 6. Audit the definition against ISO/IEC 11179-4:2004

First apply the Clause 3.6 definition criterion: the descriptive statement must represent one concept and differentiate it from related concepts.

Rewrite until the definition satisfies every Clause 4.1 requirement, using the explanations in Clause 5.2:

1. **Singularity**: state the concept in the singular unless the concept itself is plural.
2. **Positive declaration**: state what the concept is, not only what it is not.
3. **Descriptive form**: use a descriptive phrase or one or more sentences; synonyms or a reordered designation are insufficient, and text longer than a phrase must use complete, grammatically correct sentences.
4. **Commonly understood abbreviations only**: use full words by default, retain only commonly understood abbreviations or terms adopted in their abbreviated form, and expand every acronym on first occurrence.
5. **No embedded definitions**: do not embed definitions of other data or underlying concepts; move them to a glossary, note, separate entry, or relational cross-reference.

Then apply every Clause 4.2 recommendation, using the explanations in Clause 5.3:

1. **Essential meaning**: include every primary characteristic needed at the context-appropriate level of specificity and omit non-essential characteristics.
2. **Precision and unambiguity**: make the exact meaning apparent and allow only one interpretation.
3. **Conciseness**: be brief and comprehensive, without extraneous qualifiers or registry boilerplate.
4. **Standalone meaning**: make the concept understandable without another explanation or reference.
5. **No extraneous information**: exclude rationale, functional usage, domain information, and procedural information from the definition proper; place useful examples after the definition.
6. **No circular reasoning**: do not define concepts in terms of each other or substitute another concept's definition for the concept being defined.
7. **Related-definition consistency**: use the same terminology and a consistent logical structure for similar or associated definitions.
8. **Metadata-item appropriateness**: reflect the distinct role of the metadata-item or data-construct type being defined, such as a data element concept, data element, conceptual domain, or value domain.

Finally perform an additional ontological category check. This is a skill safeguard, not another ISO/IEC 11179-4:2004 provision. Rewrite any wording that assigns a characteristic to the wrong category or conflates the concept with its process, representation, carrier, field, code, unit, or value domain.

### 7. Apply the final evidence gate

Before answering, reconcile every repository, provenance statement, and final URL with the source-evidence ledger. Keep only claims supported at their stated role. Report a completed exact-URL retrieval as such; claim that a destination was active, reachable, or verified only when the tool result established that fact. Do not use one blanket verification statement for several URLs.

## Output format

Use exactly these five numbered top-level sections, in order, with no preamble, progress narration, or closing conversation.

### 1. Semantic Analysis

- **Designation Evaluated:**
- **Concept Boundary:**
- **Superordinate Concept (Genus):**
- **Delimiting Characteristics (Differentia):**
- **Designation Precision:** Include only when wording or linguistic analysis materially changes the result.

### 2. Standardization & Reuse Check

- **Repositories Queried:** Name only repositories evidenced by actual actions.
- **Candidate Evidence:** Distinguish exact, adapted, constituent, methodological, and rejected-attribution roles.
- **Action Taken:** State Path A, B, or C and justify it from eligible evidence.
- **Source Provenance:** Attribute no stronger role than the destination content supports.
- **Verification Limitations:** Include only when a material candidate could not pass the final evidence gate.

### 3. The Formulated Definition

State only the final definition.

### 4. ISO/IEC 11179-4 Compliance Audit

- **Definition Criterion (Clause 3.6):** Confirm that the descriptive statement represents one concept and differentiates it from related concepts.
- **Mandatory Requirements (Clauses 4.1 and 5.2):** Evaluate singularity, positive declaration, descriptive form, abbreviations, and embedded definitions separately.
- **Recommendations (Clauses 4.2 and 5.3):** Evaluate essential meaning, precision, conciseness, standalone meaning, extraneous information, circularity, related-definition consistency, and metadata-item appropriateness separately.
- **Additional Ontological Category Check:** Label this as an additional safeguard and confirm the relevant category boundaries.
- **Conformance Statement:** Claim compliance only when the definition is within Clause 1's scope and every requirement and recommendation passes; otherwise state the narrower audit result.
- **Refinement Notes:** Explain only material corrections to the starter or preliminary definition.

### 5. Verified Sources

For each eligible source, use:

`- [Source title](exact URL) - Role: <source role>. Support: <specific semantic support>. Verification: <what the exact-URL retrieval established>.`

List a user-supplied but irrelevant destination only as `Rejected attribution` and only after direct retrieval establishes the mismatch. If no source is eligible, state that no source passed the verification gate; do not supply an unverified URL.
