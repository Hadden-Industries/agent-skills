# Java naming conventions

This reference governs physical designations for Java codebases under the Google Java Style profile.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "Java"
  linguistLanguageId: 181
  preferredLabel: "Java"
  color: "#b07219"
  type: programming
```

## At-a-glance summary

| Artefact Kind | Convention | Example | Notes |
| --- | --- | --- | --- |
| Package | `lowercase` | `com.example.billing` | No underscores |
| Class / Interface / Record | `UpperCamelCase` | `CustomerRegistry` | Instantiable types |
| Method | `lowerCamelCase` | `calculateNetAmount` | Verbs / verb phrases |
| Variable / Parameter | `lowerCamelCase` | `grossAmount` | Local and instance scope |
| Constant | `UPPER_SNAKE_CASE` | `DEFAULT_TIMEOUT_SECONDS` | `static final` immutables |
| Type parameter | `UpperCamelCase` | `T`, `KeyT` | Single letter or capitalized |
| Source file | `PascalCase.java` | `CustomerRegistry.java` | Matches top-level public type |

## Packages and types

Package names use lowercase concatenated words without underscores:

```java
package com.example.customerregistry;
```

Types (classes, interfaces, enums, records, annotations) use `UpperCamelCase`:

```java
final class CustomerRegistry {
  static final int DEFAULT_TIMEOUT_SECONDS = 30;

  Invoice findInvoice(String invoiceId) { ... }
}
```

## Methods, parameters, and locals

Methods, parameters, and local variables use `lowerCamelCase` (e.g. `calculateNetAmount`, `customerId`).

Constants, as semantically defined by Google Java Style (immutable values whose methods have no detectable side effects), use `UPPER_SNAKE_CASE`. Do not mechanically uppercase every `static final` field.
