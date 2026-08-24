### 1. Semantic Analysis

* Designation Evaluated: Dataset
* Superordinate Concept (Genus): Collection of data
* Delimiting Characteristics (Differentia): Published or curated by one responsible agent and made available through one or more representations. The dataset is the conceptual collection; a downloadable file or serialization is a distribution, and an application programming interface response is a representation returned through a data service.
* Etymological Justification: “Dataset” is a compound of “data” and “set.” “Data” derives from Latin *datum*, “a thing given,” while “set” denotes a collection regarded as a unit. The designation therefore accurately brackets data treated collectively as one conceptual resource. Its earliest recorded English use dates to 1958.

### 2. Standardization & Reuse Check

* Repositories Queried: W3C Data Catalog Vocabulary Version 3; Dublin Core Metadata Initiative Metadata Terms; ISO terminology resources; general lexicographic and etymological resources.
* Action Taken: Path A — reuse of the normative W3C definition. It is concise, intensional, and consistent with the requested broad Data Catalog Vocabulary sense. The narrower Dublin Core definition, “Data encoded in a defined structure,” was not adopted because it makes encoding structure essential and does not preserve the required distinction between a conceptual dataset and its representations.
* Source Provenance: The definition is reproduced from the normative `dcat:Dataset` class definition in W3C Data Catalog Vocabulary Version 3. W3C expressly identifies the class as describing a conceptual dataset and separately defines `dcat:Distribution` as a specific representation and `dcat:DataService` as a collection of access or processing operations.

### 3. The Formulated Definition

A collection of data, published or curated by a single agent, and available for access or download in one or more representations.

### 4. ISO/IEC 11179-4 Compliance Audit

* Requirement Check: **Pass.** The definition is singular; states positively what the concept is; forms a complete descriptive phrase; contains no abbreviations; and does not embed definitions of constituent concepts. It states only essential characteristics, stands independently, avoids circularity, and follows genus–differentia structure. No ontological category error is present: the dataset is classified as a collection of data, while files, serializations, and service responses remain representations rather than the dataset itself.
* Refinement Notes: Explanations of access mechanisms, serialization, file formats, application programming interfaces, and catalog implementation were excluded from the definition because they concern representations or delivery procedures. Publisher identity and availability across representations were retained because they are delimiting characteristics in the W3C definition.

### 5. Verified Sources

* [W3C Data Catalog Vocabulary Version 3 — Dataset](https://www.w3.org/TR/vocab-dcat-3/#Class:Dataset) (Normative source of the definition; explicitly identifies the class as the conceptual dataset.)
* [W3C Data Catalog Vocabulary Version 3 — Distribution](https://www.w3.org/TR/vocab-dcat-3/#Class:Distribution) (Distinguishes a specific representation, including a downloadable serialization, from its dataset.)
* [W3C Data Catalog Vocabulary Version 3 — Data Service](https://www.w3.org/TR/vocab-dcat-3/#Class:Data_Service) (Distinguishes service operations and their responses from the dataset they expose.)
* [DCMI Metadata Terms — Dataset](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/#http://purl.org/dc/dcmitype/Dataset) (Provides the narrower structured-data definition evaluated but not adopted.)
* [Merriam-Webster — Dataset](https://www.merriam-webster.com/dictionary/dataset) (Confirms the compound designation, collection sense, and earliest recorded use.)
* [Online Etymology Dictionary — Data](https://www.etymonline.com/word/data) (Establishes the derivation of “data” from Latin *datum*, “a thing given.”)
* (Note: I have verified that these URLs are currently active).