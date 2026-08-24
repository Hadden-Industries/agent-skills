---
name: defining-concepts
description: Generates strictly ISO/IEC 11179-4 compliant concept definitions from a designation. Use when asked to define a concept, formulate a standardized definition, audit terminology, or create a semantic artifact. Do NOT use for general software code definitions, simple dictionary lookups, or casual term explanations.
license: MPL-2.0
compatibility: Requires an agent with web search and URL-fetching tools for vocabulary research and source verification; no bundled scripts or additional runtimes.
metadata:
  category: research
---

# Defining Concepts

Produce a source-grounded concept definition from a designation, optional starter definition, and contextual notes. Work as a terminology specialist, metadata architect, and ISO/IEC 11179-4 compliance auditor. Keep the workflow internal and return only the final five-section artifact.

## Workflow

### 1. Establish the concept boundary

- Identify the intended sense of the designation and its immediate superordinate concept.
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

- **Path A - Reuse**: an eligible authoritative source defines the same concept and its definition already satisfies the mandatory requirements. Reuse that definition without semantic or wording changes.
- **Path B - Adapt**: an eligible authoritative source defines the same concept, but specific wording must be corrected. Identify both the retained semantics and the correction.
- **Path C - Create**: no eligible source defines the same concept. Formulate a new definition from eligible constituent semantics and explain that those sources do not define the compound designation.

Designation similarity, shared words, or a source suggested in the prompt does not establish semantic identity.

### 5. Formulate the definition

- Use the immediate superordinate concept as the genus.
- Add only the essential characteristics that distinguish sibling concepts.
- Keep examples, permissible values, implementation details, rationale, procedures, symbols, units, and measurement instructions outside the definition unless one is itself an essential defining characteristic.

### 6. Audit the definition

Rewrite until the definition satisfies all five mandatory ISO/IEC 11179-4 requirements:

1. **Singularity**: state the concept in the singular.
2. **Positive declaration**: state what the concept is, not only what it is not.
3. **Descriptive phrase**: use a descriptive phrase or complete sentence.
4. **No uncommon abbreviations**: omit unexplained domain abbreviations.
5. **No embedded definitions**: do not define constituent concepts inside the definition.

Then verify that it is standalone, concise, non-circular, essential-only, and ontologically sound. Rewrite any wording that assigns a characteristic to the wrong category or conflates the concept with its process, representation, carrier, field, code, unit, or value domain.

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

- **Mandatory Requirements:** Evaluate singularity, positive declaration, descriptive form, abbreviations, and embedded definitions separately.
- **Ontological Category Check:** Confirm the relevant category boundaries.
- **Refinement Notes:** Explain only material corrections to the starter or preliminary definition.

### 5. Verified Sources

For each eligible source, use:

`- [Source title](exact URL) - Role: <source role>. Support: <specific semantic support>. Verification: <what the exact-URL retrieval established>.`

List a user-supplied but irrelevant destination only as `Rejected attribution` and only after direct retrieval establishes the mismatch. If no source is eligible, state that no source passed the verification gate; do not supply an unverified URL.
