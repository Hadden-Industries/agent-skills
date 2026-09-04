# Swift naming conventions

This reference governs physical designations for Swift codebases based on the official Swift API Design Guidelines.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "Swift"
  linguistLanguageId: 362
  preferredLabel: "Swift"
  color: "#F05138"
  type: programming
```

## Types and members

```swift
struct CustomerRegistry { }
protocol InvoiceReading { }

func calculateNetAmount(grossAmount: Money) -> Money
let customerId: CustomerIdentifier
```

- Types and protocols: `UpperCamelCase`. Protocols that describe what something is should read as nouns (e.g. `Collection`); protocols that describe a capability should use the suffixes `-able`, `-ible`, or `-ing` (e.g. `Equatable`, `ProgressReporting`, `InvoiceReading`).
- Functions, methods, properties, variables, enum cases: `lowerCamelCase`.

## Clarity at the point of use

Swift naming is evaluated at call sites. Base names and argument labels together should form a grammatical English phrase.

Name mutating/non-mutating method pairs according to established Swift API idioms: when the operation is naturally described by a verb, use the imperative for the mutating method and the `-ed` or `-ing` suffix for the non-mutating method (e.g. `sort()` vs `sorted()`, `reverse()` vs `reversed()`).
