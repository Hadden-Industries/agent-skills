## 1. Semantic Analysis

- **Designation Evaluated:** Evidence Retention Authorization Status
- **Concept Boundary:** A status assigned to an evidence item that records the current standing of permission for continued retention. It is distinct from the authorization decision or review process, the retention period, the evidence item itself, and the permissible-value set. “Unknown,” “Pending review,” “Authorized,” “Refused,” and “Expired” are values representing possible states, not the definition.
- **Superordinate Concept (Genus):** Authorization status
- **Delimiting Characteristics (Differentia):** Concerns permission to continue retaining a particular evidence item.

## 2. Standardization & Reuse Check

- **Repositories Queried:** W3C Data Catalog Vocabulary, NIEM, and Evidence Management Institute standards.
- **Candidate Evidence:** The W3C DCAT specification was verified by direct retrieval but is a **rejected attribution** for the exact concept. It contains no occurrence of “Evidence Retention Authorization Status”; its generic `adms:status` property concerns a resource’s status in a workflow and prescribes no specific status set. The Evidence Management Institute material provides **constituent semantics**: continued-retention responses should be documented, may require supervisory authorization, and are distinct from disposition approval.
- **Action Taken:** **Path C — Create.** No retrieved authoritative source defined the compound designation. The definition was formulated from the generic category of status and authoritative evidence-management semantics concerning authorization for continued retention.
- **Source Provenance:** DCAT supports only generic workflow-status semantics and directly establishes the supplied attribution mismatch. The Evidence Management Institute supports the retention-authorization differentia, but does not define the compound designation.
- **Verification Limitations:** The targeted NIEM search produced no exact-concept candidate suitable for direct retrieval and verification.

## 3. The Formulated Definition

An authorization status indicating the current standing of permission to continue retaining an evidence item.

## 4. ISO/IEC 11179-4 Compliance Audit

- **Mandatory Requirements:**
  - **Singularity:** Uses the singular “an authorization status” and “an evidence item.”
  - **Positive declaration:** States what the concept is.
  - **Descriptive form:** Uses a complete descriptive noun phrase.
  - **Abbreviations:** Contains no abbreviations.
  - **Embedded definitions:** Does not define authorization, status, retention, or evidence item within the definition.
- **Ontological Category Check:** The concept is a status, not an evidence item, authorization act, review process, retention rule, duration, date, code, or permissible-value set.
- **Refinement Notes:** The supplied values were excluded from the definition because they describe the value domain. “Current standing” accommodates unresolved, granted, refused, and expired authorization without defining those individual states.

## 5. Verified Sources

- [Data Catalog Vocabulary (DCAT) — Version 3](https://www.w3.org/TR/vocab-dcat-3/) - Role: Rejected attribution. Support: Defines only a generic resource status in a workflow, explicitly leaves status sets to application practice, and contains no exact “Evidence Retention Authorization Status” term. Verification: Direct retrieval completed successfully and an exact-text search of the retrieved specification found no match.
- [Chapter 10 — Evidence Retention and Disposition](https://evidencemanagement.com/resources/emi-standards-and-best-practices/chapter-10-evidence-retention-and-disposition/) - Role: Constituent semantics. Support: Establishes that requests and responses for continued evidence retention should be documented and that continued retention may require supervisory authorization. Verification: Direct retrieval completed successfully and exposed the supporting retention and authorization provisions.