# Go naming conventions

This reference governs physical designations for Go codebases based on Effective Go and Go community conventions.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "Go"
  linguistLanguageId: 132
  preferredLabel: "Go"
  color: "#00ADD8"
  type: programming
```

## At-a-glance summary

| Artefact Kind | Convention | Example | Notes |
| --- | --- | --- | --- |
| Package | `lowercase` | `package account` | Short single-word, no underscores |
| Exported type / struct | `PascalCase` | `CustomerRegistry` | First letter capitalized |
| Unexported type | `lowerCamelCase` | `internalBuffer` | Package-private |
| Exported func / method | `PascalCase` | `CalculateTax` | First letter capitalized |
| Getter method | `Noun` (no `Get`) | `Account(id string)` | Never `GetAccount()` |
| Single-method interface | `Method + er` | `Reader`, `Writer` | Idiomatic Go suffix |
| Initialisms | Uppercase / Lowercase | `URL`, `ID`, `HTTP` | Consistent case throughout (`CustomerID`) |
| Source file | `snake_case.go` | `customer_account.go` | Test files: `_test.go` |

## Packages

Packages use short, concise, lowercase single-word names with no underscores or mixed case:

```go
package invoice
package http
```

Use package context to eliminate redundant stuttering at import call sites:

```text
bufio.Reader   not bufio.BufReader
ring.New       not ring.NewRing
```

## Identifiers

Exported identifiers begin with an uppercase letter; unexported identifiers begin with a lowercase letter. Multiword identifiers use `MixedCaps` or `mixedCaps`:

```go
type InvoiceReader interface { ... }
func ParseInvoice(...) ...
var customerID string
```

Consistent treatment of common initialisms such as `ID`, `HTTP`, and `URL` is required (e.g. `customerID`, `serverURL`).

## Getters and interfaces

Getter methods normally omit `Get`:

```go
Owner()
SetOwner(...)
```

One-method interfaces commonly use the method name plus `-er` or an established analogous form (`Reader`, `Writer`, `Formatter`). Do not use a canonical method name such as `Read`, `Write`, `Close`, or `String` with incompatible meaning or signature.
