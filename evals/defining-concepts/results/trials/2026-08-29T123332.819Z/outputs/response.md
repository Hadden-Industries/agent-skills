## Concept package: **dcat:Dataset (W3C DCAT 3)**

**Definition (formulated):**<br>
`dcat:Dataset` is the conceptual dataset resource in DCAT: a conceptual collection of data made available by a single publisher/community and exposed through one or more representations. It is the abstract data entity described in the catalog, not the serialized form itself.

### Scope and source
- **Exact current W3C destination:** https://www.w3.org/TR/vocab-dcat-3/ (latest published)<br>
  (recency metadata points to the dated Recommendation at https://www.w3.org/TR/2024/REC-vocab-dcat-3-20240822/)<br>
  [source](https://www.w3.org/TR/vocab-dcat-3/)

### Inclusions / exclusions / near miss
- **Included (positive):** The conceptual dataset behind a DCAT record (e.g., a population dataset with multiple downloadable/serializable forms).<br>
- **Excluded (negative):** A single downloadable file/serialization (that is treated under `dcat:Distribution`).<br>
- **Near miss:** `dcat:CatalogRecord` (records about the catalog entry; used when metadata provenance/lifecycle of the catalog entry differs from dataset lifecycle).

### Typed relations (material)
- **Subclass of:** `dcat:Resource` (DCAT 3 class hierarchy).<br>
- **Related role:** `dcat:Distribution` = representation/access form of a dataset.<br>
- **Related role:** `dcat:CatalogRecord` = metadata record for the dataset’s catalog registration.

### Source wording reuse check
- W3C states the document is under the **permissive document license**, with a specific permission page:<br>
  https://www.w3.org/copyright/software-license-2023/<br>
  and short notice details at https://www.w3.org/Consortium/Legal/2023/copyright-software-short-notice.html.
- **Can wording be reused verbatim?** **Yes, with conditions** (include required W3C notice/full text plus required attribution/notice of modifications as specified in the license).<br>
  If your downstream policy cannot carry the required legal notices, use paraphrased text instead.

### Notes for public-sector catalog use
- Keep `dcat:Dataset` at the conceptual data-asset level (not API response, file, or distribution).<br>
- Use `dcat:Distribution` for each tangible API/file/serialization endpoint.

Sources:<br>
- DCAT 3 Recommendation (latest + dated version, class hierarchy, status, and definition context): https://www.w3.org/TR/vocab-dcat-3/<br>
- W3C software/document license (2023): https://www.w3.org/copyright/software-license-2023/<br>
- W3C short notice: https://www.w3.org/Consortium/Legal/2023/copyright-software-short-notice.html