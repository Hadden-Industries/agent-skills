# Rust naming conventions

This reference governs physical designations for Rust codebases based on the Rust API Guidelines and official Rust style guide.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "Rust"
  linguistLanguageId: 327
  preferredLabel: "Rust"
  color: "#dea584"
  type: programming
```

## At-a-glance summary

| Artefact Kind | Convention | Example | Notes |
| --- | --- | --- | --- |
| Crate / Module | `snake_case` | `invoice_parser` | Lowercase with underscores |
| Struct / Enum / Trait | `UpperCamelCase` | `CustomerRegistry`, `HttpHeader` | Acronyms as words (`HttpHeader`) |
| Function / Method | `snake_case` | `calculate_net_amount` | Action or conversion |
| Conversion method | `to_`, `as_`, `into_` | `to_connection_string` | Follows Rust API Guidelines |
| Variable / Field | `snake_case` | `customer_id` | Local bindings and struct fields |
| Constant / Static | `UPPER_SNAKE_CASE` | `DEFAULT_TIMEOUT_SECONDS` | True immutables |
| Type parameter | `UpperCamelCase` | `T`, `Item` | Usually single upper letter |
| Source file | `snake_case.rs` | `invoice_parser.rs` | Matches module designation |

## Identifiers and items

```rust
mod invoice_parser;
fn calculate_net_amount() {}
let customer_id = ...;

struct CustomerRegistry;
trait InvoiceReader {}

const DEFAULT_TIMEOUT_SECONDS: u64 = 30;
static MAX_CONCURRENT_REQUESTS: usize = 100;
```

- Modules, functions, methods, local bindings: `snake_case`.
- Types and traits: `UpperCamelCase`.
- Constants and statics: `SCREAMING_SNAKE_CASE`.

## Acronyms in CamelCase

Treat acronyms as words in `UpperCamelCase` unless an external public contract requires otherwise:

```text
UuidParser     preferred profile form
UUIDParser     reject under this profile
```

Follow standard library idioms for conversions (`as_`, `to_`, `into_`), iterators (`iter`, `iter_mut`, `into_iter`), and getters (omit `get_` except when returning a specific element from a collection or map).
