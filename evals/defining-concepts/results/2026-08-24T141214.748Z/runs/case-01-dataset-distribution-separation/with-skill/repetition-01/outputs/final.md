## 1. Semantic Analysis

- **Designation Evaluated:** Dataset
- **Concept Boundary:** A conceptual collection of data made available by a responsible agent. It is distinct from a distribution or representation, such as a downloadable file or serialization; a data service that provides access through an interface; an individual response returned by such a service; and the catalog record containing registration metadata.
- **Superordinate Concept (Genus):** Collection of data
- **Delimiting Characteristics (Differentia):** Published or curated by a single agent and available for access or download in one or more representations.

## 2. Standardization & Reuse Check

- **Repositories Queried:** World Wide Web Consortium Data Catalog Vocabulary, Version 3.
- **Candidate Evidence:** **Exact definition:** the vocabulary defines `dcat:Dataset` with the same conceptual scope requested. **Constituent semantics:** its usage notes identify the dataset as conceptual and distinguish its representations; its definitions of distribution and data service distinguish the dataset from downloadable files, serializations, access interfaces, and service responses.
- **Action Taken:** **Path A — Reuse.** The authoritative definition has matching extension and intension and already satisfies the mandatory ISO/IEC 11179-4 requirements. It is therefore reused without semantic or wording changes.
- **Source Provenance:** The definition and boundary evidence come directly from the World Wide Web Consortium Recommendation for Data Catalog Vocabulary, Version 3.

## 3. The Formulated Definition

A collection of data, published or curated by a single agent, and available for access or download in one or more representations.

## 4. ISO/IEC 11179-4 Compliance Audit

- **Mandatory Requirements:**
  - **Singularity:** Pass — “A collection” states one instance of the concept.
  - **Positive declaration:** Pass — the definition states what a dataset is.
  - **Descriptive form:** Pass — it is a complete descriptive noun phrase.
  - **No uncommon abbreviations:** Pass — it contains no abbreviations.
  - **No embedded definitions:** Pass — it does not define its constituent concepts within the definition.
- **Ontological Category Check:** Pass — the concept is categorized as a collection of data. It is not conflated with a distribution, file, serialization, data service, service response, catalog record, field, code, unit, or permissible-value set.
- **Refinement Notes:** No wording correction was required. The source definition already expresses the conceptual collection and permits one or more separate representations.

## 5. Verified Sources

- [Data Catalog Vocabulary (DCAT) — Version 3: Class Dataset](https://www.w3.org/TR/vocab-dcat-3/#Class:Dataset) - Role: Exact definition. Support: Defines `dcat:Dataset` as a collection of data published or curated by a single agent and available through one or more representations; the usage note identifies it as the conceptual dataset. Verification: Exact-URL retrieval completed and exposed the class definition, subclass relation, and usage note.
- [Data Catalog Vocabulary (DCAT) — Version 3: Class Distribution](https://www.w3.org/TR/vocab-dcat-3/#Class:Distribution) - Role: Constituent semantics. Support: Defines a distribution as a specific representation of a dataset and explains that access may occur by direct download, an application programming interface, or a Web page. Verification: Exact-URL retrieval completed and exposed the distribution definition, usage note, and examples.