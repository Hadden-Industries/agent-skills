# Python naming conventions

This reference governs physical designations for Python codebases based on PEP 8, PEP 484, PEP 544, and PEP 695.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "Python"
  linguistLanguageId: 303
  preferredLabel: "Python"
  color: "#3572A5"
  type: programming
```

## Standalone scripts versus importable modules

This skill deliberately distinguishes standalone scripts from importable modules:

Standalone executable script:

```text
rebuild-index.py       valid
rebuild_index.py       invalid for this profile
Rebuild-Index.py       invalid
```

Importable module:

```text
rebuild_index.py       valid
rebuild-index.py       invalid because '-' cannot form an ordinary import identifier
```

Classify a `.py` file before naming it. A command-line entry point can be implemented in an importable module; the distribution console command and the module do not need the same physical spelling. Packages use short lowercase names, avoiding underscores unless necessary for readability.

## Identifiers and constants

```python
class CustomerRegistry: ...

def calculate_net_amount(gross_amount: Decimal, deductions: Decimal) -> Decimal: ...

DEFAULT_TIMEOUT_SECONDS = 30
```

- Classes: `PascalCase` / CapWords.
- Functions, methods, parameters, variables: `snake_case`.
- Module-level constants: `UPPER_SNAKE_CASE`.
- Non-public functions, methods, and variables: single leading underscore (`_snake_case`).
- First parameter: `self` for instance methods, `cls` for class methods.
- Avoid inventing dunder (`__name__`) identifiers; reserve double leading and trailing underscores for language-defined special methods.

## Exceptions

Exception classes MUST use `PascalCase` and end with the suffix `Error` (PEP 8):

```python
class InvoiceNotFoundError(LookupError): ...
class ValidationFailureError(ValueError): ...
```

Do not suffix an exception with `Exception`. Reserve generic suffixes such as `BaseException` or built-in root exceptions to their standard library contexts. Specific error types distinguish failures by condition, not merely by the word "Exception".

## Type parameters and protocols

Generic type variables and parameters use `UpperCamelCase` (PEP 484, PEP 695):

```python
from typing import TypeVar, Protocol

T = TypeVar("T")
KeyT = TypeVar("KeyT")

# Python 3.12+ (PEP 695) type parameter syntax:
type RegistryMap[KeyT, ValueT] = dict[KeyT, ValueT]

class InvoiceReader(Protocol):
    def read_invoice(self, invoice_id: str) -> Invoice: ...
```

Protocols should use expressive nouns or capability names (`InvoiceReader`, `SupportsClose`) rather than arbitrary abstract prefixes.

## Generators versus materialized collections

Distinguish iterables that generate values lazily on demand from materialized in-memory collections:

- Use `iter_*` or `stream_*` prefixes (e.g. `iter_invoices()`, `stream_chunks()`) for generator functions that yield items one at a time and consume state.
- Use plural nouns or collection types (e.g. `invoices`, `customer_list`, `pending_orders`) for materialized collections that support repeated indexing, sizing, or random access.

```python
def iter_invoices(account_id: str) -> Iterator[Invoice]:
    for page in fetch_pages(account_id):
        yield from page.items

invoices: list[Invoice] = list(iter_invoices(account_id))
```

## Context managers

Context managers that acquire and release resources should use descriptive action verbs indicating acquisition or setup, such as `open_*`, `acquire_*`, or `scoped_*`:

```python
@contextmanager
def open_invoice_session(session_id: str) -> Iterator[Session]:
    ...
```

## Pytest discovery conventions

Pytest test discovery relies on deterministic prefix conventions:

- Test files: `test_*.py` or `*_test.py` (prefer `test_<module>.py`).
- Test classes: `Test<Concept>` (using `PascalCase` without `__init__`).
- Test functions and methods: `test_<behaviour>_<condition>()` using `snake_case`.
- Fixtures: descriptive noun phrases representing the provided resource (e.g. `mock_db_session`, `authenticated_client`).
