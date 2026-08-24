## Registry entry: Dataset

| Field | Value |
|---|---|
| Preferred designation | Dataset |
| Concept identifier | `dataset` |
| Semantic identifier | `http://www.w3.org/ns/dcat#Dataset` |
| Concept type | Class |
| Status | Standard |
| Definition | A conceptual collection of data, published or curated by a single agent or identifiable community, and made available through one or more representations. |
| Scope note | A dataset is independent of its particular encodings, formats, access mechanisms, and delivery responses. CSV files, JSON documents, database exports, and other accessible forms are distributions or representations of the dataset. An API providing access to it is a data service; an individual API response is a representation of all or part of the dataset. |
| Inclusion criteria | Use for an identifiable collection of data treated by its provider or community as one intellectual or informational resource. The collection may contain numbers, text, images, sound, multimedia, or other forms of data. |
| Exclusion criteria | Do not use for a particular downloadable file, serialization, API endpoint, user interface, catalog metadata record, or individual API response. |
| Broader concept | `dcat:Resource` |
| Closely related concepts | `dcat:Distribution`, `dcat:DataService`, `dcat:DatasetSeries`, `dcat:CatalogRecord` |
| Source | W3C Data Catalog Vocabulary (DCAT) 3 |
| Source definition | “A collection of data, published or curated by a single agent, and available for access or download in one or more representations.” |
| Editorial treatment | The registry definition preserves the normative DCAT meaning while explicitly identifying the dataset as the conceptual collection and clarifying common public-sector boundary cases. |

Examples:

- “National road-traffic collision statistics, 2025” — dataset.
- Its CSV and JSON downloads — distributions.
- The API through which records can be queried — data service.
- The JSON returned by one API request — response representation, not the dataset.
- The catalog record describing when the dataset was registered — catalog record, not the dataset.

Machine-readable RDF/Turtle:

```turtle
@prefix dcat: <http://www.w3.org/ns/dcat#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

dcat:Dataset
    a owl:Class ;
    rdfs:label "Dataset"@en ;
    skos:prefLabel "Dataset"@en ;
    skos:definition
        "A conceptual collection of data, published or curated by a single agent or identifiable community, and made available through one or more representations."@en ;
    skos:scopeNote
        "Use for the collection independently of its encodings, formats, access mechanisms, and delivery responses. A downloadable file or serialization is a distribution or representation; an API is a data service; and an individual API response is a representation of all or part of the dataset."@en ;
    skos:example
        "National road-traffic collision statistics for a stated reporting period, independently of whether they are supplied as CSV, JSON, or through an API."@en ;
    rdfs:subClassOf dcat:Resource ;
    rdfs:isDefinedBy
        <https://www.w3.org/TR/vocab-dcat-3/#Class:Dataset> ;
    dcterms:source
        <https://www.w3.org/TR/vocab-dcat-3/> .
```

This aligns with the [W3C DCAT 3 Dataset class](https://www.w3.org/TR/vocab-dcat-3/#Class:Dataset) and its explicit distinction between a conceptual dataset, a [distribution](https://www.w3.org/TR/vocab-dcat-3/#Class:Distribution), and a data service.