Here is a **concept package** for **`dcat:Dataset`** in the W3C DCAT context, scoped as a **conceptual dataset** (not a file/distribution/API).

## Definition
**`dcat:Dataset`**: a conceptual collection of data, published or curated by a single agent, and available for access or download in one or more representations (serializations).  

- Source basis: DCAT 3 Recommendation.  
- Clarification: DCAT explicitly distinguishes this from a specific available form; that form is modeled as **`dcat:Distribution`**.

## Purpose and scope
- **Purpose:** cataloging descriptive metadata for government/public-sector data resources.
- **Scope:** W3C Data Catalog Vocabulary (DCAT) Version 3, using the DCAT namespace vocabulary.
- **Non-scope:** not a concrete file, serialization, API response, or downloadable package instance.

## Exact current destination (as of 2026-08-29)
- **Current W3C stable document:** https://www.w3.org/TR/vocab-dcat-3/  
- **Current editor/published snapshot:** https://www.w3.org/TR/2024/REC-vocab-dcat-3-20240822/  
- **Namespace URI:** `http://www.w3.org/ns/dcat#`  
- **Class URI (designation):** `http://www.w3.org/ns/dcat#Dataset`

## Boundary tests (to keep meaning stable)
- **Inclusion:** a dataset comprising sensor readings, geospatial layers, tabular tables, images, or other data content curated together.
- **Exclusion:** a downloadable file artifact or API endpoint object (these are usually modeled via **`dcat:Distribution`** / **`dcat:DataService`** depending on context).
- **Decision rule:** if it is a conceptual “dataset-as-whole” with possible multiple serializations, classify as `dcat:Dataset`; if it is one realized access format, classify as `dcat:Distribution`.

## Typed relations
- `dcat:Dataset` **sub-class-of** `dcat:Resource`.
- `dcat:Dataset` **has distribution** `dcat:distribution` → `dcat:Distribution`.
- `dcat:CatalogRecord` may represent the catalog-entry level metadata alternative when needed (distinct from the dataset itself).

## Reuse and wording permission
- **Concept reuse relationship:** `same` as the DCAT 3 concept.
- **Wording reuse (verbatim):** **Allowed with conditions** under W3C’s permissive software/document license (i.e., permission to copy/modify/distribute exists, with required notice and attribution terms).
- Practical note: if you paste exact spec text in public docs, include the required W3C license/notice language and copyright attribution.

## Evidence and provenance (key claims)
- DCAT 3 Recommendation header/date and current version links are explicitly listed on the W3C TR page (published as Recommendation on 22 Aug 2024; latest published pointer).  
- `dcat:Dataset` definition and usage notes are in the DCAT 3 vocabulary class section (defines it as conceptual dataset and distinguishes representations, while distribution describes realizations).  
- W3C namespace and canonical URI are published on the DCAT 3 namespace page (`dcat3.html`).  
- W3C permissive document license text confirms allowed copy/modify/distribute terms.

## Validation status
- **Critical checks:**  
  - Concept identity and scope against DCAT 3: **passed (human review)**  
  - Relation to `dcat:Distribution`/`dcat:Resource`: **passed (human review)**  
  - Machine parser / OWL / SHACL / competency-question inference runs: **not run** (not executed here)

If you want, I can also give you a compact RDF/Turtle/JSON-LD serialization of this concept entry for your catalog metadata model (without changing the concept meaning).