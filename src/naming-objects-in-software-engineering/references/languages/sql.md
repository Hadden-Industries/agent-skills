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

## At-a-glance summary

| Artefact Kind | Convention | Example | Notes |
| --- | --- | --- | --- |
| Table | Singular `lower_snake_case` | `customer_account` | Represents individual row entity |
| View | `lower_snake_case` | `active_customer` | Query abstraction / projection |
| Column (general) | `lower_snake_case` | `billing_address` | Semantic attribute |
| Column (boolean) | `is_predicate` | `is_email_verified` | Positive assertion |
| Column (timestamp) | `name_unit` | `created_at_epoch_ms` | Explicit units / encoding |
| Primary Key | `pk_<table>` | `pk_customer_account` | Standard prefix |
| Foreign Key | `fk_<child>__<parent>` | `fk_invoice__customer_account` | Double underscore separator |
| Unique Constraint | `uq_<table>__<columns>` | `uq_customer_account__email` | Double underscore separator |
| Index | `ix_<table>__<columns>` | `ix_customer_account__created_at` | Double underscore separator |

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
