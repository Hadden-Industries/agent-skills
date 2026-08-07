# Concept Definition: Judicial Plea Status

---

### 1. Semantic Analysis

* **Designation Evaluated:** Judicial Plea Status
* **Superordinate Concept (Genus):** Status (a condition or standing at a particular point in time)
* **Delimiting Characteristics (Differentia):**
  * Pertains to a *plea* — i.e., the formal response given by a party to a charge or allegation within judicial proceedings.
  * Classifies the *current standing* of that plea (e.g., whether a plea has been entered and, if so, what category of response it represents).
  * Operates within the domain of *judicial proceedings*, encompassing both criminal and civil procedural contexts.
* **Etymological Justification:**
  * **Judicial** — from Latin *iudicialis*, from *iudicium* ("judgement, trial"), from *iudex* ("judge"). Precisely scopes the concept to the domain of courts and legal adjudication, distinguishing it from non-judicial uses of the term "plea" (e.g., an informal entreaty).
  * **Plea** — from Anglo-French *plai*, Old French *plait* ("lawsuit, decision, decree"), from Medieval Latin *placitum* ("that which pleases, that which is agreed upon"), the neuter past participle of *placere* ("to please, be approved"). The term evolved from denoting a public judicial assembly and its decrees to the modern sense of a formal answer given by a party to a legal charge or allegation.
  * **Status** — from Latin *status* ("condition, position, manner"), from the past-participle stem of *stare* ("to stand"), from Proto-Indo-European root *\*sta-* ("to stand, make or be firm"). The term entered English legal use by 1791 to denote "legal standing." Combined with "plea," it denotes the fixed, recorded standing of a formal judicial response at a given point in time.
  * The compound designation "Judicial Plea Status" is linguistically precise: it brackets the concept to the recorded condition (*status*) of a formal legal response (*plea*) within a court of law (*judicial*).

---

### 2. Standardisation & Reuse Check

* **Repositories Queried:**
  * Cornell Law Information Institute (LII) — *Wex* legal encyclopedia
  * NIEM (National Information Exchange Model) — Justice domain (`j:PleaCategoryCode`)
  * HMCTS Common Platform data standards (England and Wales)
  * ISO/IEC 11179 Metadata Registries framework
  * BARTOC (Basel Register of Thesauri, Ontologies & Classifications)
  * ELI / ECLI (European Legislation / Case Law Identifiers)
* **Action Taken:** **Path C — Novel definition created.** No established vocabulary or metadata registry provides a pre-existing, ISO-compliant intensional definition for the compound concept "Judicial Plea Status" as a *status*. The closest analogues found are:
  * **LII (Cornell):** Defines "plea" as the formal answer given by a defendant to criminal charges (guilty, not guilty, nolo contendere). This is a definition of the *plea* itself, not of its *status*.
  * **NIEM Justice Domain:** Provides the data element `j:PleaCategoryCode` to classify the type of plea entered. This functions as a *code set* for plea categories within an information exchange model, not as a conceptual definition of the *status* of a plea.
  * **HMCTS Common Platform:** Records plea information at offence level for case management purposes. Internal data standards are not publicly published as formal definitions.
  * No source defines the *status* dimension — i.e., the recorded condition of a party's formal response — as a standalone concept.
* **Source Provenance:** The novel definition synthesises the genus-differentia structure from ISO 704:2022 methodology with the legal semantics established by the LII *Wex* definition of "plea" and the data modelling context of NIEM's Justice domain. The enumerated value set provided by the user reflects a UK-centric procedural vocabulary that spans both criminal pleas (Guilty, Not guilty, Guilty by post) and civil/hybrid procedural responses (Consented, Resisted, Admitted, Denied), with procedural states (Not known, No plea taken) indicating the absence or indeterminacy of a response.

---

### 3. The Formulated Definition

> **Judicial Plea Status**
>
> Recorded condition of a party's formal response to a charge or allegation within judicial proceedings, indicating whether a plea has been entered and, if so, the category of response given.

---

### 4. ISO/IEC 11179-4 Compliance Audit

* **Requirement Check:**

| # | Requirement | Pass |
|---|---|---|
| 1 | **Singularity** — stated in the singular | ✅ "condition" (singular) |
| 2 | **Positive Declaration** — states what the concept *is* | ✅ States it is a "recorded condition ... indicating ..." |
| 3 | **Descriptive Phrase** — is a descriptive phrase or complete sentence | ✅ Descriptive phrase with genus and differentia |
| 4 | **No Uncommon Abbreviations** — no domain-specific acronyms | ✅ No abbreviations present |
| 5 | **No Embedded Definitions** — does not define underlying concepts | ✅ Does not embed definitions of "plea," "charge," "allegation," or "judicial proceedings" |

* **Refinement Notes:**
  * An earlier draft included procedural information describing the mechanisms by which pleas are entered (e.g., at arraignment, by post, via single justice procedure). This was stripped as it constitutes functional usage guidance rather than essential meaning, in compliance with Recommendation 5.
  * An earlier draft enumerated the specific permissible values (Guilty, Not guilty, etc.). This was removed from the definition itself because the enumerated value domain is a property of the data element's *value set*, not of the concept's intensional definition. Embedding the value list would violate Recommendation 1 (state only the essential meaning) and would conflate the concept with its extensional representation.
  * The phrase "recorded condition" was chosen over "state" or "standing" to avoid ambiguity with the legal term "standing" (locus standi) and the political/geographical sense of "state," satisfying Recommendation 2 (supreme precision and lack of ambiguity).
  * The definition was scrutinised for ontological category errors (Step 6). The concept is correctly classified as an abstract status (a condition), not as the plea itself (the act or statement), the code that represents it (a data carrier), or the proceedings in which it arises (a process). No category error was detected.

---

### 5. Verified Sources

* [Cornell LII — Wex: *plea*](https://www.law.cornell.edu/wex/plea) — Authoritative U.S. legal encyclopedia definition of "plea" as a formal answer to a criminal charge. Confirmed the core legal semantics of the constituent concept.
* [Online Etymology Dictionary — *plea*](https://www.etymonline.com/word/plea) — Comprehensive etymological trace from Medieval Latin *placitum* through Anglo-French *plai* to modern English. Grounded the linguistic justification.
* [Online Etymology Dictionary — *status*](https://www.etymonline.com/word/status) — Etymology from Latin *status* (past participle of *stare*, "to stand") with confirmation of legal usage ("legal standing") by 1791.
* [NIEM Open — niem-model (GitHub)](https://github.com/niemopen/niem-model) — Canonical repository for the NIEM data model, including the Justice domain and the `PleaCategoryCode` element. Confirmed that NIEM provides a code-based classification, not an intensional definition of plea status.

> (Note: I have verified that these URLs are currently active.)
