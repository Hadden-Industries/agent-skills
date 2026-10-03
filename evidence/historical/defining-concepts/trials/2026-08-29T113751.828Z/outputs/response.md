**Definition (DCAT `dcat:Dataset`)**<br>
In W3C DCAT terminology, `dcat:Dataset` is the conceptual collection of data described in a catalog, published/curated by one agent and available through one or more representations (serializations/formats), with concrete accessible forms represented separately as `dcat:Distribution`[ [TR-vocab-dcat-3](https://www.w3.org/TR/vocab-dcat-3/) ].

**Exact current W3C destination**<br>
- Current published destination: https://www.w3.org/TR/vocab-dcat-3/<br>
- Current versioned destination (per the TR page): https://www.w3.org/TR/2024/REC-vocab-dcat-3-20240822/<br>
- Namespace location: https://www.w3.org/ns/dcat (and canonical namespace URI `http://www.w3.org/ns/dcat#`, revision 3.0, dated 2024-09-22)[ [DCAT namespace](https://www.w3.org/ns/dcat) ].<br>

As of the latest published page, DCAT is a **W3C Recommendation** dated **22 August 2024**[ [W3C TR header](https://www.w3.org/TR/vocab-dcat-3/) ].

**Wording reuse (verbatim) decision**<br>
- **Can it be copied verbatim?** Yes, with conditions.<br>
- Applicable license: **W3C Document License (2023)** applies to the W3C page, allowing copy/distribution with required attribution, link, and copyright notice, and with derivative-usage limits noted in the license[ [Doc license](https://www.w3.org/copyright/document-license-2023/) ][ [TR copyright notice](https://www.w3.org/TR/vocab-dcat-3/) ].

**Concept package (for a public-sector catalog, excluding file/API objects)**<br>
- **Included:**<br>
  - Conceptual data collection itself.<br>
  - Broad resource types across domains (multimedia, text, imagery, etc.) are in-scope[ [DCAT 3 §6.6](https://www.w3.org/TR/vocab-dcat-3/) ].<br>
- **Excluded:**<br>
  - Downloadable file/API response/transfer form (`dcat:Distribution`) is not the dataset itself but one representation of it[ [DCAT 3 §6.6 usage note](https://www.w3.org/TR/vocab-dcat-3/) ].<br>
  - Catalog-entry metadata record is `dcat:CatalogRecord`, used when catalog metadata differs from dataset metadata like modification date[ [DCAT 3 §6.5 / §6.6](https://www.w3.org/TR/vocab-dcat-3/) ].<br>
- **Relations:** `dcat:Dataset` is a subclass of `dcat:Resource`, and has `dcat:distribution` links to one or more `dcat:Distribution` instances[ [DCAT 3 class and property definitions](https://www.w3.org/TR/vocab-dcat-3/) ].

