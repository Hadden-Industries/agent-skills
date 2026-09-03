# Semantic naming

This reference governs what a name means. Apply it before selecting case or separators.

The model is inspired by the concept-, context-, and name-part approach of ISO/IEC 11179-5. It is not a claim of formal ISO conformance, and it does not reproduce the standard's normative text.

## 1. Separate concept from designation

A **concept** is the thing, property, role, event, state, or behaviour being modelled.

A **designation** is the physical name used for that concept in a particular context and ecosystem.

One concept can therefore have several correct designations:

```text
customer birth date     conceptual phrase
customer_birth_date     Python or SQL designation
customerBirthDate       TypeScript or Kotlin designation
CustomerBirthDate       C# public-member designation
customer-birth-date     generic filesystem designation
```

Do not mistake lexical variation for conceptual variation. Conversely, do not collapse two different concepts merely because their current spellings are similar.

## 2. Establish a concept dossier

For a non-trivial naming decision, determine:

```text
artefact-kind:
context:
definition:
nearest-confusable-concepts:
canonical-terms:
  qualifier:
  object-class:
  property-or-behaviour:
  representation-or-unit:
cardinality:
side-effects-and-boundaries:
conceptual-name:
```

Example:

```text
artefact-kind:
    parameter

context:
    invoice creation

definition:
    address to which billing correspondence for this invoice is directed

nearest-confusable-concepts:
    shipping address
    customer's registered address

canonical-terms:
    qualifier: billing
    object-class: address

cardinality:
    one

conceptual-name:
    billing address

Python designation:
    billing_address

TypeScript designation:
    billingAddress
```

A name passes only when it identifies the intended concept and excludes its nearest plausible alternatives.

Thus `address` fails when billing and shipping addresses coexist, while `billing_address` and `shipping_address` discriminate correctly.

## 3. Use name parts as a diagnostic model

A useful conceptual decomposition is:

```text
[qualifier] + [object class] + [property or behaviour] + [representation or unit]
```

Not every name needs every part. Include a part only when it contributes information at the use site.

- **Qualifier:** narrows or differentiates the concept, such as `billing`, `shipping`, `primary`, `approved`, or `effective`.
- **Object class:** identifies the kind of thing, such as `customer`, `invoice`, `address`, or `policy`.
- **Property or behaviour:** identifies a characteristic or action, such as `birth`, `total`, `validate`, or `persist`.
- **Representation or unit:** identifies an encoding, format, unit, or physical representation when needed, such as `epoch_ms`, `bytes`, `json`, or `percentage`.

Examples:

```text
billing + address
customer + birth + date
request + timeout + milliseconds
invoice + serialize + json
```

Do not force this ordering mechanically when an ecosystem's grammar reads more naturally another way. It is a semantic analysis tool, not a universal concatenation formula.

## 4. Prefer governed vocabulary

Search in this order when selecting terms:

1. domain ontology, enterprise glossary, metadata registry, schema, or ubiquitous language;
2. published protocol, standard, or external contract;
3. repository terminology and definitions;
4. official ecosystem vocabulary;
5. ordinary technical language.

A governed term MUST not be replaced with a plausible synonym merely for variety.

Bad drift:

```text
customer
client
consumer
account_holder
buyer
```

when all five refer to the same governed concept.

Different terms are valid when the domain defines different concepts. Semantic consolidation requires evidence, not word similarity.

## 5. Discriminate nearest concepts

Before approving a name, ask:

- What is the nearest thing a maintainer might confuse this with?
- What property distinguishes them?
- Is that distinction stable and visible in the name or surrounding context?
- Would a new maintainer choose the correct object or operation without opening the implementation?

Examples:

```text
registration_id    identifier assigned to a registration
registry_id        identifier assigned to a registry
```

```text
effective_date     date from which a rule or contract applies
created_at         timestamp at which the record was created
```

```text
gross_amount       amount before deductions
net_amount         amount after applicable deductions
```

Do not shorten away a distinction the domain actually makes.

## 6. Remove redundancy only when context is stable

Context can legitimately carry part of a name:

```python
customer.id
invoice.total
```

may be clearer than:

```python
customer.customer_id
invoice.invoice_total
```

But context is not stable when:

- the value is routinely detached from its receiver;
- several identifiers, dates, statuses, or amounts coexist;
- the name appears in logs, telemetry, SQL projections, serialized data, or generic containers without the original receiver;
- the surrounding module or type has an overly broad responsibility;
- readers must know private implementation details to recover the omitted term.

The rule is:

> Remove contextual redundancy; never remove conceptual discrimination.

## 7. Choose truthful verbs

Verb meaning is part of the contract. The following is a decision guide, not a substitute for an established repository glossary or ecosystem idiom.

| Verb | Prefer when the operation... | Do not imply accidentally... |
|---|---|---|
| `get` | returns an already-owned value, property, cache entry, or direct accessor result | network I/O, expensive search, construction, or persistence |
| `find` | searches using criteria and absence is a normal outcome | guaranteed existence |
| `list` | returns or enumerates multiple values | exactly one value |
| `fetch` | crosses a remote, service, or otherwise explicit I/O boundary to retrieve data | a cheap local accessor |
| `read` | consumes from a file, stream, buffer, reader, or textual/binary source | parsing or domain reconstruction unless it actually occurs |
| `load` | brings persisted or configured state into memory, often reconstructing a usable object | a direct accessor |
| `parse` | converts syntax or text into a structured representation and can fail on invalid syntax | semantic validation or remote retrieval |
| `decode` | reverses an encoding into its represented value | parsing an unrelated grammar |
| `deserialize` | reconstructs a value or object from a serialization format | simple text parsing without object reconstruction |
| `serialize` | produces a defined serialized representation | persistence by itself |
| `validate` | checks conformance and reports or returns validity without silently repairing | mutation or normalization |
| `normalize` | converts equivalent representations into a canonical representation | merely checking validity |
| `convert` | changes representation or type while preserving relevant meaning | arbitrary business transformation |
| `transform` | applies a defined mapping that can change structure or semantics | a no-op accessor |
| `calculate` / `compute` | derives a result from inputs without persistence as the primary effect | retrieval of stored state |
| `derive` | infers a value from other authoritative values or rules | direct copying |
| `build` | assembles a complex in-memory value, often stepwise | persistence or registration |
| `create` | creates a new domain object or resource according to the API contract | guaranteed persistence unless documented |
| `new` / `make` | follows an ecosystem constructor or allocation idiom | a generic synonym outside that idiom |
| `save` | writes current state so it can be recovered later | insert-only semantics |
| `persist` | crosses a persistence boundary intentionally | a transient in-memory update |
| `store` | places a value into a repository, cache, or durable medium identified by context | validation or transformation |
| `write` | emits bytes, text, or records to a writer or target | domain-level persistence semantics not present in the API |
| `add` | includes a value while preserving existing values | replacement |
| `set` | assigns or replaces a property or current value | appending to a collection |
| `update` | changes an existing value or resource | creation when absence is expected |
| `upsert` | creates or updates according to explicit key/existence semantics | plain update |
| `remove` | detaches from a collection, relationship, or in-memory structure | durable deletion unless that is the defined contract |
| `delete` | removes a persisted resource or durable record | mere detachment |
| `clear` | removes all content or resets a bounded value | deleting the containing object |
| `ensure` | makes a postcondition true, commonly idempotently | a read-only check |
| `try` | follows an ecosystem pattern where failure/absence is returned rather than thrown | best-effort vagueness without a defined outcome |

### Verb review questions

- Is I/O local, filesystem-based, database-based, or remote?
- Can the result be absent?
- Can the operation mutate inputs, receiver state, external state, or durable state?
- Is a value constructed, retrieved, parsed, decoded, normalized, or validated?
- Does the name reveal the principal externally observable effect?
- Does the ecosystem reserve or strongly conventionally associate the verb with a signature or behaviour?

`process`, `handle`, `manage`, `execute`, and `run` are acceptable only when the bounded process, handler role, command, job, or execution contract is already explicit. Otherwise they usually conceal the actual behaviour.

## 8. Name Boolean values as propositions

A Boolean name should read naturally as a positive assertion, capability, requirement, or policy decision.

Useful semantic families include:

```text
is_valid
has_permission
can_retry
should_persist
needs_refresh
supports_streaming
contains_errors
```

Avoid:

```text
valid_flag
not_disabled
status
check
value
```

Prefer positive names. Double negation increases cognitive load:

```text
is_enabled            preferred
is_not_disabled       reject unless the domain truly models that distinct state
```

Do not prefix a Boolean mechanically when the ecosystem's API reads more naturally without it. Swift and some fluent APIs often achieve proposition-like clarity through the full use-site phrase.

## 9. Express cardinality semantically

Use grammatical number and role rather than container implementation:

```text
customer              one customer
customers             zero or more customers
customer_ids          zero or more customer identifiers
customers_by_id       mapping from customer identifier to customer
primary_customer      one customer in the primary role
```

Avoid:

```text
customer_list
customer_array
customer_map
customer_data
items
```

unless the physical container or representation is itself part of the public contract.

For iterators, streams, pages, batches, queues, and sets, name the semantic role when it matters:

```text
pending_invoices
invoice_page
invoice_batches
invoice_stream
unique_customer_ids
```

Do not claim uniqueness, ordering, completeness, or boundedness unless the contract guarantees it.

## 10. Include units and representations only when needed

Add a unit or representation term when materially different values would otherwise be indistinguishable.

Good:

```python
timeout_ms: int
created_at_epoch_ms: int
payload_bytes: bytes
exchange_rate_percentage: Decimal
```

Good when the type already supplies the distinction:

```python
timeout: timedelta
created_at: datetime
payload: bytes
exchange_rate: Decimal
```

A type is not always visible at every use site, especially across serialization, SQL, configuration, telemetry, or dynamically typed boundaries. Judge the actual context.

Use standard unit symbols or governed names consistently. Do not alternate among `ms`, `millis`, and `milliseconds` without a policy.

## 11. Treat lifecycle and time terms precisely

Commonly confused temporal concepts include:

```text
created_at
updated_at
submitted_at
approved_at
published_at
effective_from
effective_to
valid_from
valid_to
expires_at
deleted_at
```

Do not use generic `date`, `timestamp`, `start`, or `end` when multiple lifecycle events exist.

Distinguish an instant (`*_at`) from a calendar date (`*_date`) and from an interval boundary (`*_from`, `*_to`) according to repository policy and domain meaning.

## 12. Use abbreviations and acronyms deliberately

An abbreviation may be used when it is:

- mandated by a standard or public API;
- canonical in the language or domain;
- substantially more recognisable than its expansion;
- unambiguous in the relevant context.

Reject private, local, or lossy abbreviations that save a few characters at the cost of meaning:

```text
cust
acct
cfg
proc
mgr
num
val
```

unless the ecosystem or governed vocabulary establishes them.

Render accepted acronyms according to the ecosystem convention. For example, Rust commonly treats an acronym as a word in `UpperCamelCase` (`Uuid`), while an external protocol token may require `HTTP` or `UUID` exactly.

## 13. Avoid type and implementation encoding by default

Do not encode information that the type system or declaration already communicates:

```text
customerList
customerMap
strCustomerName
IUserService       in a TypeScript profile that rejects interface prefixes
```

Encode representation when it is semantically material, not merely because of the current implementation.

A public `customer_ids` concept may remain correct if its internal container changes from list to set. `customer_list` becomes misleading.

## 14. Generic nouns require a bounded role

These words are not forbidden strings; they are presumptive semantic defects:

```text
data info item thing object misc util utility helper manager processor handler service common base
```

They may pass when the architecture defines the role and the qualifier makes the responsibility bounded:

```text
http_request_handler
schema_migration_manager
identity_provider_service
```

Even then, test whether a more specific responsibility name exists.

## 15. Review public APIs at the point of use

For a public function or method, evaluate the phrase created by:

```text
receiver/type + base name + argument labels + arguments + return context
```

Examples:

```swift
invoice.apply(discount: discount)
collection.remove(at: index)
view.dismiss(animated: true)
```

A declaration that appears concise in isolation may be repetitive or ambiguous at the call site. Clarity at use outranks declaration-only neatness.

## 16. Preserve external designations at boundaries

External names can be semantically or lexically poor yet contractually fixed:

```json
{"cust_id": "..."}
```

Map them explicitly:

```python
customer_id = payload["cust_id"]
```

Do not spread the external spelling through the internal model. Do not break the external contract merely to satisfy internal style.

## 17. Worked review examples

### Vague behaviour

```text
current: processData
```

Evidence shows it parses invoice JSON and performs no persistence.

```text
concept: parse invoice JSON
TypeScript designation: parseInvoiceJson
```

### Cardinality and keying

```text
current: customerMap
```

Evidence shows a mapping keyed by customer identifier.

```text
concept: customers indexed by identifier
Python designation: customers_by_id
TypeScript designation: customersById
```

### Contextual redundancy

```python
customer.customer_id
```

When `customer` is a stable typed receiver and no alternate identifier exists:

```python
customer.id
```

When several identifiers exist:

```python
customer.registry_id
customer.registration_id
```

### Representation

```text
current: createdAt
```

If the value is an integer epoch in milliseconds and the type is not visible across the boundary:

```text
createdAtEpochMs
```

If it is a strongly typed date-time value:

```text
createdAt
```

## 18. Semantic acceptance template

For consequential names, record:

```text
concept:
definition:
nearest rejected concepts:
canonical terms and source:
selected semantic stem:
physical designation:
artefact profile:
external compatibility impact:
```

This record can be brief, but it prevents a casing discussion from substituting for conceptual analysis.
