## 1. Semantic Analysis

- **Designation Evaluated:** Identity Verification Outcome
- **Concept Boundary:** A recorded determination produced by identity verification. It is neither the verification process itself, the identity evidence examined, nor the value domain containing labels such as Pass, Fail, or Inconclusive.
- **Superordinate Concept (Genus):** Recorded determination
- **Delimiting Characteristics (Differentia):** Produced by an identity-verification process and concerns whether an applicant holds the claimed identity represented by validated identity attributes and associated evidence.

## 2. Standardization & Reuse Check

- **Repositories Queried:** ISO website; NIST Computer Security Resource Center Glossary; NIST Digital Identity Guidelines; NIST SP 800-63 implementation resources.
- **Candidate Evidence:** No eligible source supplied an exact or adaptable definition of “Identity Verification Outcome.” NIST provides constituent semantics for identity verification and separately identifies an identity-evidence verification result as information recorded in enrollment records or audit logs.
- **Action Taken:** **Path C — Create.** The definition combines the supported meaning of identity verification with the distinguishing characteristic that this concept is its recorded determination. The permissible labels are excluded because they define the separate value domain, not the concept.
- **Source Provenance:** NIST SP 800-63-4 supports the meaning of identity verification. NIST’s SP 800-63A implementation resources support treating the verification result as recorded information but do not define the compound designation.
- **Verification Limitations:** The ISO-targeted search returned no exact term-bearing destination suitable for direct verification; therefore, no ISO source is attributed as defining this concept.

## 3. The Formulated Definition

A recorded determination produced by an identity-verification process concerning whether an applicant holds the claimed identity represented by validated identity attributes and associated evidence.

## 4. ISO/IEC 11179-4 Compliance Audit

- **Mandatory Requirements:**
  - **Singularity:** Defines one recorded determination.
  - **Positive declaration:** States what the concept is.
  - **Descriptive form:** Uses a complete descriptive phrase.
  - **Abbreviations:** Contains no abbreviations.
  - **Embedded definitions:** Does not define identity verification, identity attributes, or identity evidence within the definition.
- **Ontological Category Check:** The definition classifies the concept as a recorded determination, not as a verification process, evidence artifact, data field, code, or permissible-value set.
- **Refinement Notes:** The starter definition incorrectly classified the concept as a process and embedded permissible values. The standardized definition changes the genus to “recorded determination” and leaves Pass, Fail, and Inconclusive to the separate value domain.

## 5. Verified Sources

- [NIST CSRC Glossary — identity verification](https://csrc.nist.gov/glossary/term/identity_verification) - Role: Constituent semantics. Support: Defines identity verification as confirming that an applicant holds the claimed real-life identity represented by validated identity attributes and associated evidence. Verification: Exact-URL retrieval displayed the term, definition, and cited NIST sources.
- [NIST SP 800-63A-4 — Identity Proofing Overview](https://pages.nist.gov/800-63-4/sp800-63a/proofing/) - Role: Constituent semantics. Support: States that identity verification confirms the linkage between the claimed validated identity and the applicant presenting the evidence. Verification: Exact-URL retrieval displayed the normative overview and identity-verification section.
- [NIST SP 800-63A Implementation Resources — Identity Proofing Process Documentation](https://pages.nist.gov/800-63-3-Implementation-Resources/63A/process/) - Role: Constituent semantics. Support: Identifies the identity-evidence verification result as information collected and recorded in enrollment records or audit logs. Verification: Exact-URL retrieval displayed the process-documentation guidance and its list of recordable results.