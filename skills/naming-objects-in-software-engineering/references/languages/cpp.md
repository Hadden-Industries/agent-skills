# C++ naming conventions

This reference governs physical designations for C++ codebases under the Google C++ Style profile.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "C++"
  linguistLanguageId: 43
  preferredLabel: "C++"
  color: "#f34b7d"
  type: programming
```

## Source and header filenames

Use lowercase with underscores for filenames under this profile:

```text
invoice_parser.cc
invoice_parser.h
```

A repository or build system may govern another extension (such as `.cpp` or `.hpp`); treat that as a scoped repository override.

## Identifiers

```cpp
class CustomerRegistry {};
Money CalculateNetAmount(Money gross_amount);
int retry_count;
int retry_count_;
constexpr int kDefaultTimeoutSeconds = 30;
```

- Types and functions: `PascalCase` (e.g. `CustomerRegistry`, `CalculateNetAmount`).
- Variables and parameters: `snake_case` (e.g. `gross_amount`, `retry_count`).
- Class data members: `snake_case_` with a trailing underscore (e.g. `retry_count_`, `customer_id_`).
- Constants: `kPascalCase` with a lowercase `k` prefix (e.g. `kDefaultTimeoutSeconds`, `kMaxRetryCount`).
