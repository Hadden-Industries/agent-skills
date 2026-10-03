## Registry concept: Dataset

| Field | Value |
|---|---|
| Designation | Dataset |
| Preferred label | Dataset |
| Identifier | `dcat:Dataset` |
| Identifier IRI | `http://www.w3.org/ns/dcat#Dataset` |
| Concept type | Class |
| Broader concept | `dcat:Resource` |
| Status | Standard |
| Source | W3C Data Catalog Vocabulary (DCAT) Version 3 |

**Definition**

A conceptual collection of data, published or curated by a single agent or identifiable community, and made available through one or more representations.

**Scope note**

A Dataset is the collection as a conceptual entity, independent of any particular encoding, file, delivery mechanism, or access event. Its data may comprise numbers, text, images, sound, multimedia, or other forms.

A Dataset may have:

- one or more downloadable or otherwise accessible representations (`dcat:Distribution`);
- access through an API or other service (`dcat:DataService`);
- no currently described distribution, without ceasing to be a Dataset.

**Inclusions**

- A statistical collection available as CSV, JSON, and XML.
- A geographic collection offered as GeoPackage and GeoJSON.
- An administrative register accessed through an API.
- A multimedia or document collection curated as one data resource.
- A published collection whose access is restricted.

**Exclusions**

- A particular CSV, JSON, XML, PDF, archive, or other downloadable file; model it as a `dcat:Distribution`.
- A serialization or format-specific representation of the collection; model it as a `dcat:Distribution`.
- An API, endpoint, or collection of access operations; model it as a `dcat:DataService`.
- The result returned by one API request; it is a representation or extract of some or all of a Dataset, not the Dataset merely because it was returned.
- The catalog’s metadata record describing the Dataset; model it as a `dcat:CatalogRecord`.

**Identity criterion**

Representations belong to the same Dataset when they broadly embody the same underlying collection, even if their formats, languages, schemas, resolutions, or levels of detail differ. Collections with materially different subject matter, coverage, reference periods, or curatorial identity are ordinarily separate Datasets. The final boundary is application- and community-dependent.

**Semantic relationships**

```text
dcat:Dataset rdfs:subClassOf dcat:Resource
dcat:Dataset dcat:distribution dcat:Distribution
dcat:Distribution dcat:accessService dcat:DataService
dcat:Catalog dcat:dataset dcat:Dataset
dcat:Catalog dcat:record dcat:CatalogRecord
```

**Canonical machine-readable representation**

```turtle
@prefix dcat:  <http://www.w3.org/ns/dcat#> .
@prefix dct:   <http://purl.org/dc/terms/> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos:  <http://www.w3.org/2004/02/skos/core#> .

dcat:Dataset
    a rdfs:Class ;
    rdfs:label "Dataset"@en ;
    rdfs:subClassOf dcat:Resource ;
    skos:definition
        "A conceptual collection of data, published or curated by a single agent or identifiable community, and made available through one or more representations."@en ;
    skos:scopeNote
        "The Dataset is independent of any particular file, serialization, API, endpoint, or API response. Accessible representations are modeled as dcat:Distribution resources, while interfaces providing access or processing operations are modeled as dcat:DataService resources."@en ;
    rdfs:isDefinedBy <https://www.w3.org/TR/vocab-dcat-3/> .

dcat:distribution
    rdfs:domain dcat:Dataset ;
    rdfs:range dcat:Distribution .
```

This artifact follows the broad DCAT 3 treatment: W3C defines `dcat:Dataset` as a collection available through one or more representations and explicitly states that the class describes the conceptual dataset. It separately defines a Distribution as a specific representation and a Data Service as operations exposed through an interface. [W3C DCAT 3 — Dataset](https://www.w3.org/TR/vocab-dcat-3/#Class:Dataset), [Distribution](https://www.w3.org/TR/vocab-dcat-3/#Class:Distribution), and [Data Service](https://www.w3.org/TR/vocab-dcat-3/#Class:Data_Service).