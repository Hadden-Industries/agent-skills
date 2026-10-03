# Kotlin naming conventions

This reference governs physical designations for Kotlin codebases based on official Kotlin coding conventions.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "Kotlin"
  linguistLanguageId: 189
  preferredLabel: "Kotlin"
  color: "#A97BFF"
  type: programming
```

## At-a-glance summary

| Artefact Kind | Convention | Example | Notes |
| --- | --- | --- | --- |
| Package | `lowercase` | `com.example.billing` | No underscores |
| Class / Object / Interface | `UpperCamelCase` | `CustomerRegistry` | Instantiable or singleton |
| Function / Method | `lowerCamelCase` | `calculateNetAmount` | Verbs / verb phrases |
| Property / Variable | `lowerCamelCase` | `grossAmount` | `val` or `var` |
| Constant | `UPPER_SNAKE_CASE` | `DEFAULT_TIMEOUT_SECONDS` | `const val` in companion object |
| Source file (single class) | `PascalCase.kt` | `CustomerRegistry.kt` | Matches declared class |
| Source file (multiple/util) | `PascalCase.kt` | `CustomerUtils.kt` | Meaningful group name |

## Packages and types

Packages use lowercase concatenated segments without underscores:

```kotlin
package com.example.customerregistry
```

Classes, objects, interfaces, and type aliases use `UpperCamelCase`:

```kotlin
class CustomerRegistry
interface InvoiceReader
```

## Functions, properties, and constants

- Functions, properties, parameters, and locals use `lowerCamelCase` (e.g. `calculateNetAmount`, `grossAmount`).
- Compile-time constants (`const val`) use `UPPER_SNAKE_CASE`.
- Private backing properties may use a single leading underscore when paired with their public conceptual property (e.g. `private var _table: Map<String, Int>? = null`, `val table: Map<String, Int> get() = ...`).

Avoid meaningless role suffixes such as `Manager`, `Wrapper`, `Util`, or `Helper`.
