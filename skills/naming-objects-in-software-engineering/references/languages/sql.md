# SQL and physical database object naming conventions

This reference defines an explicit physical naming profile for relational database schemas, tables, views, columns, constraints, and indexes.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "SQL"
  linguistLanguageId: 333
  preferredLabel: "SQL"
  color: "#e38c00"
  type: data
```

## Physical naming patterns

```text
schema/table/view/column     lower_snake_case

pk_<table>
fk_<child_table>__<parent_table>
uq_<table>__<semantic_columns>
ck_<table>__<rule_concept>
ix_<table>__<semantic_columns>
```

Examples:

```text
billing
invoice
open_invoice
customer_id

pk_invoice
fk_invoice__customer
uq_customer__external_identifier
ck_invoice__net_amount_nonnegative
ix_invoice__customer_id_created_at
```

## Singular row concepts

Table and view concept names are singular in this profile. The name MUST denote the row entity concept, not the physical collection container:

```text
customer       preferred row concept
customers      rejected by this house profile
```

Do not rename deployed database objects without an explicit migration and downstream dependency analysis. Account for ORMs, replication, stored procedures, reporting pipelines, and external integrations.
