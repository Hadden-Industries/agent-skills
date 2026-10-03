# TypeScript naming conventions

This reference governs physical designations for TypeScript codebases under the Google TypeScript Style profile.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "TypeScript"
  linguistLanguageId: 378
  preferredLabel: "TypeScript"
  color: "#3178c6"
  type: programming
```

## At-a-glance summary

| Artefact Kind | Convention | Example | Notes |
| --- | --- | --- | --- |
| Source file | `snake_case.ts` / `.tsx` | `payment_transaction_payload.ts` | Google TS style profile |
| Declaration file | `snake_case.d.ts` | `customer_registry.d.ts` | Type definitions |
| Interface / Type | `UpperCamelCase` | `PaymentTransactionPayload` | No `I` prefix |
| Class / Enum | `UpperCamelCase` | `CustomerRegistry` | Instantiable or enumerations |
| Function / Method | `lowerCamelCase` | `calculateNetAmount` | Action or accessor |
| Property / Variable | `lowerCamelCase` | `isSettled`, `timeoutMs` | Explicit units, affirmative booleans |
| Constant | `UPPER_SNAKE_CASE` | `DEFAULT_TIMEOUT_MS` | True module-level immutable |
| Type parameter | `UpperCamelCase` | `T`, `KeyT` | Single letter or descriptive |

## Source files

Use `snake_case.ts` or `snake_case.tsx` for hand-authored source files under this selected profile:

```text
invoice_parser.ts
customer_registry.tsx
```

Declaration files use `snake_case.d.ts` (e.g. `customer_registry.d.ts`).

## Identifiers

```typescript
interface InvoiceReader {}
type CustomerIdentifier = string;
class CustomerRegistry {}
enum PaymentStatus {}

function calculateNetAmount(grossAmount: Money): Money { ... }
const DEFAULT_TIMEOUT_SECONDS = 30;
```

- Types, interfaces, classes, enums, decorators: `UpperCamelCase`.
- Variables, parameters, functions, methods, properties: `lowerCamelCase`.
- Global constants: `CONSTANT_CASE` for immutable, truly constant module values.

## Interfaces and Hungarian notation

Do not prefix an interface with `I` merely to announce that it is an interface (e.g. use `InvoiceReader`, not `IInvoiceReader`). Avoid Hungarian notation and container/type suffixes already expressed by TypeScript's type system (e.g. use `customers`, not `customerArray`).
