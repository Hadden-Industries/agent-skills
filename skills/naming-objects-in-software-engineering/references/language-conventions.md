# Language and artefact conventions

This reference renders an already-correct semantic stem into the physical form required for an artefact.

Classification comes first. The generic fallback MUST NOT override a language, runtime, framework, protocol, or tooling requirement.

## Baseline profile

| Ecosystem / artefact | Mandatory form in this skill | Authority |
|---|---|---|
| Generic human-authored file stem | `kebab-case` | Explicit house policy |
| Generic human-authored directory | `kebab-case` | Explicit house policy |
| Standalone Python script | `kebab-case.py` | Explicit hard policy |
| Importable Python module | `snake_case.py`, preferably short | PEP 8 |
| Python package | short lowercase; avoid underscores unless needed | PEP 8 |
| Python function, method, parameter, variable | `snake_case` | PEP 8 |
| Python class | `PascalCase` / CapWords | PEP 8 |
| Python constant | `UPPER_SNAKE_CASE` | PEP 8 |
| Go package | short lowercase single word | Go guidance |
| Go identifier | `MixedCaps` or `mixedCaps`; no word-separating underscores | Go guidance |
| Rust module, function, method, local | `snake_case` | Rust API Guidelines |
| Rust type or trait | `UpperCamelCase` | Rust API Guidelines |
| Rust constant or static | `SCREAMING_SNAKE_CASE` | Rust API Guidelines |
| Java package/module | lowercase concatenated segments | Selected Google Java profile |
| Java type | `UpperCamelCase` | Selected Google Java profile |
| Java method, parameter, local | `lowerCamelCase` | Selected Google Java profile |
| Java constant | `UPPER_SNAKE_CASE` | Selected Google Java profile |
| Kotlin package | lowercase segments without underscores | Kotlin official convention |
| Kotlin class or object | `UpperCamelCase` | Kotlin official convention |
| Kotlin function, property, parameter, local | `lowerCamelCase` | Kotlin official convention |
| Kotlin true constant | `UPPER_SNAKE_CASE` | Kotlin official convention |
| C# namespace, type, method, public member | `PascalCase` | Microsoft convention |
| C# interface | `I` + `PascalCase` | Microsoft convention |
| C# parameter or local | `camelCase` | Microsoft convention |
| C# private/internal instance field | `_camelCase` | Microsoft convention |
| C# private/internal static field | `s_camelCase` | Microsoft convention |
| C# constant | `PascalCase` | Microsoft convention |
| TypeScript source file | `snake_case.ts` or `snake_case.tsx` | Selected Google TypeScript profile |
| TypeScript class, interface, type, enum | `UpperCamelCase` | Selected Google TypeScript profile |
| TypeScript variable, parameter, function, method, property | `lowerCamelCase` | Selected Google TypeScript profile |
| TypeScript global constant value | `CONSTANT_CASE` | Selected Google TypeScript profile |
| C++ source/header | `snake_case.cc` or `snake_case.h` | Opinionated choice within Google's allowed forms |
| C++ type or function | `PascalCase` | Selected Google C++ profile |
| C++ variable or parameter | `snake_case` | Selected Google C++ profile |
| C++ class data member | `snake_case_` | Selected Google C++ profile |
| C++ constant | `kPascalCase` | Selected Google C++ profile |
| Swift type or protocol | `UpperCamelCase` | Swift API Design Guidelines |
| Swift function, method, property, variable, enum case | `lowerCamelCase` | Swift API Design Guidelines |
| Environment variable | `UPPER_SNAKE_CASE` | Explicit house policy |
| CLI command | `kebab-case` | Explicit house policy |
| CLI long option | `--kebab-case` | Explicit house policy |
| SQL schema, table, view, column | `lower_snake_case` | Explicit house policy, not an ISO or SQL requirement |

The machine-readable forms are in `../assets/naming-policy.json`.

## Generic files and directories

Use `kebab-case` for a human-authored file or directory only when no more specific ecosystem or tooling rule applies.

```text
architecture-decisions/
customer-import-guide.md
release-notes.md
```

Do not infer from `SKILL.md`, `README.md`, `LICENSE`, `.editorconfig`, `package.json`, `pyproject.toml`, framework routes, migration filenames, or generated artefacts that generic filenames may use arbitrary case. These are explicit tooling, platform, or community exceptions.

A file's extension is not part of its semantic stem. Keep extensions lowercase unless the external format or tool requires otherwise.

## Python

### Standalone scripts versus importable modules

This skill deliberately distinguishes them.

Standalone executable script:

```text
rebuild-index.py       valid
rebuild_index.py       invalid for this profile
Rebuild-Index.py       invalid
```

Importable module:

```text
rebuild_index.py       valid
rebuild-index.py       invalid because `-` cannot form an ordinary import identifier
```

Classify a `.py` file before naming it. A command-line entry point can be implemented in an importable module; the distribution's console command and the module do not need the same physical spelling.

### Identifiers

```python
class CustomerRegistry: ...

def calculate_net_amount(gross_amount, deductions): ...

DEFAULT_TIMEOUT_SECONDS = 30
```

Non-public functions, methods, and variables may use one leading underscore where the Python convention is intended. Do not add underscores as decoration.

Use `self` for the first parameter of an instance method and `cls` for the first parameter of a class method. A trailing underscore may resolve a Python keyword collision, but first consider a semantically better term.

Do not invent double-underscore names. Reserve language-defined "dunder" names for their specified meanings, and use name mangling only for its intended subclass-collision purpose.

## Go

Packages use short, concise, lowercase single-word names with no underscores or mixed case:

```go
package invoice
package http
```

Exported identifiers begin with an uppercase letter; unexported identifiers begin with a lowercase letter. Multiword identifiers use `MixedCaps` or `mixedCaps`:

```go
type InvoiceReader interface { ... }
func ParseInvoice(...) ...
var customerID string
```

Use package context to remove redundancy:

```text
bufio.Reader   not bufio.BufReader
ring.New       not ring.NewRing
```

Getter methods normally omit `Get`:

```go
Owner()
SetOwner(...)
```

One-method interfaces commonly use the method name plus `-er` or an established analogous form (`Reader`, `Writer`, `Formatter`). Do not use a canonical method name such as `Read`, `Write`, `Close`, or `String` with incompatible meaning or signature.

Effective Go is authoritative for stable core idioms but is not actively updated for the whole modern ecosystem. Check current standard-library practice and repository governance for cases it does not cover.

## Rust

```rust
mod invoice_parser;
fn calculate_net_amount() {}
let customer_id = ...;

struct CustomerRegistry;
trait InvoiceReader {}

const DEFAULT_TIMEOUT_SECONDS: u64 = 30;
```

Treat acronyms as words in CamelCase unless a public contract requires otherwise:

```text
UuidParser     preferred profile form
UUIDParser     reject under this profile
```

Follow compiler and standard-library conventions for lifetimes, type parameters, feature names, crates, macros, and generated identifiers when those are more specific than this table.

## Java

This skill selects Google Java Style as the enforceable profile; it is not presented as a rule of the Java language specification.

```java
package com.example.customerregistry;

final class CustomerRegistry {
  static final int DEFAULT_TIMEOUT_SECONDS = 30;

  Invoice findInvoice(String invoiceId) { ... }
}
```

Package names use lowercase concatenated words. Types use `UpperCamelCase`; methods, parameters, and locals use `lowerCamelCase`; constants, as semantically defined by the selected style guide, use `UPPER_SNAKE_CASE`.

Do not mechanically uppercase every `static final` field. Apply the selected profile's semantic definition of a constant.

## Kotlin

```kotlin
package com.example.customerregistry

class CustomerRegistry
fun calculateNetAmount(grossAmount: Money): Money
const val DEFAULT_TIMEOUT_SECONDS = 30
```

Packages use lowercase names without underscores. Classes and objects use `UpperCamelCase`; functions, properties, parameters, and locals use `lowerCamelCase`; true constants use `UPPER_SNAKE_CASE`.

Avoid meaningless suffixes such as `Manager`, `Wrapper`, `Util`, or `Helper`. A private backing property may use a leading underscore when paired with its public conceptual property according to Kotlin convention.

## C#

```csharp
namespace Billing.InvoiceProcessing;

public interface IInvoiceReader { }
public sealed class CustomerRegistry { }

public decimal CalculateNetAmount(decimal grossAmount) { ... }
private readonly IClock _clock;
private static ICache s_cache;
public const int DefaultTimeoutSeconds = 30;
```

Use:

- `PascalCase` for namespaces, types, methods, public properties/fields/events, and constants;
- `I` + `PascalCase` for interfaces;
- `camelCase` for parameters and locals;
- `_camelCase` for private/internal instance fields;
- `s_camelCase` for private/internal static fields under the selected Microsoft convention.

Prefer clarity to brevity. Use .NET analyser naming rules when the repository configures them; explicit `.editorconfig` rules are repository governance.

## TypeScript

This skill selects Google TypeScript Style as the enforceable profile; it is not presented as a TypeScript language requirement.

Source files:

```text
invoice_parser.ts
customer_registry.tsx
```

Identifiers:

```typescript
interface InvoiceReader {}
type CustomerIdentifier = string;
class CustomerRegistry {}

function calculateNetAmount(grossAmount: Money): Money { ... }
const DEFAULT_TIMEOUT_SECONDS = 30;
```

Use `UpperCamelCase` for classes, interfaces, types, enums, and decorators; `lowerCamelCase` for variables, parameters, functions, methods, and properties; and `CONSTANT_CASE` for global constant values under the selected profile.

Do not prefix an interface merely to announce that it is an interface. Avoid Hungarian notation and container/type suffixes already expressed by TypeScript's type system.

Declaration files, generated files, test-runner discoveries, routes, and framework conventions require separate classification and may be valid exceptions.

## C++

This skill chooses the underscore form that Google's C++ guide permits and prefers when no local convention governs filenames:

```text
invoice_parser.cc
invoice_parser.h
```

Identifiers:

```cpp
class CustomerRegistry {};
Money CalculateNetAmount(Money gross_amount);
int retry_count;
int retry_count_;
constexpr int kDefaultTimeoutSeconds = 30;
```

Use `PascalCase` for types and functions, `snake_case` for variables and parameters, trailing underscore for class data members, and `kPascalCase` for constants under the selected profile.

Build-system, platform, generated, and imported library conventions may require other extensions or spellings. Record the exception rather than broadening the generic rule.

## Swift

Swift naming is evaluated at the point of use.

```swift
struct CustomerRegistry { }
protocol InvoiceReading { }

func calculateNetAmount(grossAmount: Money) -> Money
let customerId: CustomerIdentifier
```

Use `UpperCamelCase` for types and protocols, and `lowerCamelCase` for functions, methods, properties, variables, and enum cases.

Clarity at use outranks brevity. Base names and argument labels together should form a clear phrase. Boolean methods and properties should read as assertions. Name mutating/non-mutating pairs according to established Swift API design idioms.

The lexical checker intentionally validates only simple case profiles; semantic and grammatical quality must be reviewed at call sites.

## Environment variables and CLI names

Environment variables:

```text
DATABASE_URL
DEFAULT_TIMEOUT_SECONDS
```

CLI command and option:

```text
rebuild-index
--dry-run
--output-directory
```

A short option is a separate artefact and follows the CLI framework's syntax, for example `-o`. Do not force a long-option policy onto it.

Published CLI names are compatibility contracts. Renaming one normally requires an alias, deprecation period, documentation update, and shell-completion update.

## SQL and physical data objects

This is an explicit house profile, not a claim about ISO/IEC 11179 or the SQL standard.

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

Table and view concept names are singular in this profile. The name must denote the row concept, not the physical container:

```text
customer       preferred row concept
customers      rejected by this house profile
```

Do not rename deployed database objects without an explicit migration and impact analysis. Account for quoted identifiers, engine limits, ORM mappings, replication, reporting, grants, stored code, and downstream consumers.

Derive physical terms from governed conceptual vocabulary wherever practical. The lexical form does not establish semantic equivalence.

## Special and externally required names

The following often override the generic profile:

- `SKILL.md`, `README.md`, `LICENSE`, `Dockerfile`, `Makefile`;
- Python `__init__.py`, `pyproject.toml`, and framework-discovered names;
- Java/Kotlin package layout and build-tool files;
- TypeScript declaration files, route files, test discovery, and generated clients;
- C/C++ platform headers and imported library conventions;
- database system-generated identifiers;
- protocol tokens, serialized keys, public endpoints, and vendor schemas.

Treat each as a scoped exception. Do not use an exception as precedent outside its required scope.
