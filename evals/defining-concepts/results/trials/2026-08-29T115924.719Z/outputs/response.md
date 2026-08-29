Here’s a DCAT **concept package** for your catalog use.

### Definition<br>
`dcat:Dataset` is the class for the **actual, conceptual dataset** in DCAT 3: the data collection as published by a provider (as a conceptual bundle), with one or more representations/access methods (distributions), and identified as `http://www.w3.org/ns/dcat#Dataset`. It is a subclass of `dcat:Resource`. ([w3.org](https://www.w3.org/TR/vocab-dcat-3/))

### Identity and source basis<br>
- **Authoritative W3C destination:**<br>
  - Stable pointer: `https://www.w3.org/TR/vocab-dcat-3/`<br>
  - Latest specific REC (versioned): `https://www.w3.org/TR/2024/REC-vocab-dcat-3-20240822/`<br>
  (Status shown as W3C Recommendation; date: **22 August 2024**). ([w3.org](https://www.w3.org/TR/vocab-dcat-3/))<br>
- **Namespace/term IRI:** `http://www.w3.org/ns/dcat#Dataset` (via namespace documentation). ([w3.org](https://www.w3.org/ns/dcat3.html))

### Scope & boundaries (as requested: not files/serializations/services)<br>
- **In-scope (positive examples):**<br>
  - The conceptual dataset entity itself, including metadata like title/description, temporal coverage, themes, and links to one or more `dcat:Distribution`s. ([w3.org](https://www.w3.org/TR/vocab-dcat-3/))<br>
- **Explicit boundaries from W3C usage notes:**<br>
  - `dcat:Dataset` is **not** the catalog-record wrapper; that role is `dcat:CatalogRecord` (for catalog-entry metadata). ([w3.org](https://www.w3.org/TR/vocab-dcat-3/))<br>
  - Distribution artifacts (downloadable formats/files/endpoints) are modeled separately via `dcat:Distribution` and `dcat:distribution`. ([w3.org](https://www.w3.org/TR/vocab-dcat-3/))<br>
- **Boundary fit to your requirement:** treat `dcat:Dataset` as conceptual object, and keep technical/physical forms (files, API responses, serializations) in `dcat:Distribution`.

### Reuse disposition and wording reuse<br>
- **Reuse/disposition:** **Adopt** (same concept and official scope; we can use W3C wording).<br>
- **Wording reuse permission (separately):** **Yes, with conditions.**<br>
  - DCAT 3 spec uses W3C “permissive document license.” ([w3.org](https://www.w3.org/TR/vocab-dcat-3/))<br>
  - The license (software-document 2023) grants copy/modify/distribute, provided required notices/attribution and change-notice requirements are included on redistributed derivative copies. ([w3.org](https://www.w3.org/copyright/software-license-2023/))

### Typed relations (core)<br>
- `dcat:Dataset` **sub-class of** `dcat:Resource`. ([w3.org](https://www.w3.org/TR/vocab-dcat-3/))<br>
- `dcat:Dataset` **has property** `dcat:distribution` (range `dcat:Distribution`, sub-property of `dcterms:relation`). ([w3.org](https://www.w3.org/TR/vocab-dcat-3/))

### Validation notes<br>
- Concept retrieval and status checked from the DCAT 3 Recommendation page and class section.<br>
- No parser/OWL reasoner/conformance checks were run in this step (**not run**).

If you want, I can output this as a JSON package (machine-readable) in the same structure.