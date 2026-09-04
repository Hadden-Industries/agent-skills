---
name: naming-objects-in-software-engineering
description: Create, assess, and refactor semantically precise, ecosystem-conformant names for programming and data artefacts. Use whenever naming or renaming files, directories, packages, modules, types, functions, methods, parameters, arguments, variables, fields, properties, constants, APIs, CLI commands/options, environment variables, or database objects; and during code review when naming quality, consistency, ambiguity, or terminology is relevant. Enforces conceptual discrimination before casing and separators.
license: MPL-2.0
compatibility: Optional lexical checker requires Python 3.9 or later, uses only the standard library, and requires no network access.
metadata:
  category: research
---

# Naming Objects in Software Engineering (NOISE)

## Governing principle

**One concept, one canonical semantic stem per governed context; many ecosystem-correct physical designations where syntax requires them.**

Treat naming as a small act of conceptual modelling, not typography.

A name MUST pass two independent release gates:

1. **Semantic correctness:** it denotes the intended concept, excludes nearby concepts, uses canonical vocabulary, and truthfully describes behaviour, cardinality, units, representation, and side effects where relevant.
2. **Lexical correctness:** it uses the exact case, separator, affix, extension, and structural form required for the actual artefact kind and ecosystem.

A lexically valid but vague name such as `process_data`, `processData`, or `ProcessData` MUST fail.

## Load the supporting material deliberately

- Read `references/semantic-naming.md` for every non-trivial name, ambiguous rename, API name, domain term, or semantic review.
- Consult `references/language-conventions.md` for the cross-ecosystem baseline profile table.
- **On-demand single-spoke loading rule**: When naming artefacts in a specific language, framework, styling system, or runtime, load ONLY the single dedicated spoke file under `references/languages/<ecosystem>.md` (e.g. `references/languages/python.md` or `references/languages/react.md`). Do NOT load the entire references directory or unrelated language files into your context window.
- Read `references/policy-precedence.md` whenever policies conflict, the repository is inconsistent, an external contract exists, or a generated/framework-required name is involved.
- Read `references/source-authorities.md` when checking provenance or explaining why a convention was selected.
- Use `assets/naming-policy.json` and `scripts/check-name.py` for supported lexical checks. A passing check never certifies semantics.

## Mandatory workflow

### 1. Classify the exact artefact

Determine what is actually being named before proposing spelling.

Do not conflate:

- a parameter with an argument;
- a function with a method;
- a field with a property;
- a type with an instance;
- a JavaScript library module, standalone automation script, React component, custom hook, event prop, event handler, or DOM element reference;
- a CSS class, CSS custom property (variable), or HTML data attribute;
- a Python package, importable module, standalone script, exception class, type parameter, protocol, generator, or pytest fixture;
- a directory with a package namespace;
- a database table, view, column, constraint, or index;
- a public API designation with an internal implementation name.

If the classification is wrong, the naming rule will usually be wrong.

### 2. Resolve the governing authority

Apply this order:

1. language, runtime, protocol, framework, build-tool, or discovery requirements needed for validity;
2. explicit governing instructions for the task, organisation, repository, or scoped path;
3. an official ecosystem convention, or the explicitly selected style profile where no language-owned convention exists;
4. this skill's generic fallback policy.

Observed legacy usage is evidence, not governance. Do not perpetuate a poor convention merely because it is common in the existing codebase.

Preserve externally owned API names, wire fields, schemas, and protocol tokens at their boundary. Prefer an idiomatic internal designation plus an explicit mapping when the external spelling conflicts with internal policy.

See `references/policy-precedence.md` for conflict and exception handling.

### 3. Establish the concept before choosing words

Inspect definitions, call sites, types, tests, documentation, schemas, domain glossaries, ontologies, and neighbouring names. Do not guess from the implementation body alone.

For a non-trivial name, establish at least:

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

The analysis may remain implicit for an obvious local variable, but it MUST be recoverable from evidence.

Use the repository's governed glossary, ontology, schema vocabulary, or ubiquitous language when one exists. Do not invent `client`, `consumer`, `account_holder`, and `buyer` as stylistic variants of a governed `customer` concept.

### 4. Pass the semantic review gate

Reject the proposed name unless every applicable answer is yes:

- Can a new maintainer identify the concept without opening the implementation?
- Does the name distinguish the nearest plausible related concepts?
- Does every included term add information at its use site?
- Are omitted terms recoverable from stable context rather than private knowledge?
- Is the verb truthful about mutation, persistence, I/O, search, construction, validation, and representation?
- Does grammatical number reflect cardinality?
- Are units or representations explicit when the type and stable context do not convey them?
- Does a Boolean read as a clear positive proposition or capability?
- Is each abbreviation standard and unambiguous in this context?
- Does the name use canonical domain vocabulary?
- Does the final spelling obey the exact convention for the classified artefact?

**Remove contextual redundancy; never remove conceptual discrimination.**

For example, `customer.id` may be sufficient when the receiver supplies stable context. `registry.id` is insufficient when the domain distinguishes a registry identifier from a registration identifier in that scope.

### 5. Treat generic semantic heads as presumptive defects

Reject unqualified or content-free uses of these terms unless they denote a genuinely bounded, documented architectural role:

```text
data
info
item
thing
object
misc
util
utils
utility
helper
helpers
manager
processor
handler
service
common
base
```

Examples that normally fail:

```text
user_data
common_utils
process_item
data_manager
base_service
```

Examples that may pass only when their role is explicit and bounded:

```text
http_request_handler
schema_migration_manager
cryptographic_key_service
```

Do not mechanically replace one vague word with another. Determine the actual responsibility.

### 6. Express behaviour truthfully

Do not treat `get`, `find`, `fetch`, `read`, `load`, `parse`, `decode`, `validate`, `build`, `create`, `save`, `persist`, `delete`, and `remove` as interchangeable stylistic synonyms.

Select a verb whose contract matches the operation. Account for:

- whether I/O or a remote boundary is crossed;
- whether absence is expected;
- whether state is mutated or persisted;
- whether an object is merely constructed in memory;
- whether syntax, encoding, or serialization is transformed;
- whether the operation returns one value, many values, or a stream;
- whether the operation is idempotent.

Use ecosystem idioms where they carry established meaning, such as Go's `New`, `Read`, `Write`, and `String` conventions.

See `references/semantic-naming.md` for the verb decision guide.

### 7. Encode cardinality and representation only when semantic

Prefer:

```text
customer             one customer
customers            a collection of customers
customer_ids         a collection of customer identifiers
customers_by_id      a mapping keyed by customer identifier
```

Do not add `List`, `Map`, `Array`, `String`, or another implementation type merely because the type system already says so, unless the representation itself is part of the contract or needed to discriminate concepts.

Prefer:

```python
timeout_ms: int
created_at_epoch_ms: int
```

when units or encodings are otherwise ambiguous, but:

```python
timeout: timedelta
created_at: datetime
```

when the type makes the representation unambiguous.

### 8. Render the semantic stem for the ecosystem

Consult `references/language-conventions.md` and apply the profile for the classified artefact.

Important hard defaults include:

- generic human-authored files and directories: `kebab-case`;
- standalone Python scripts: `kebab-case.py`;
- importable Python modules: `snake_case.py`;
- TypeScript source files: `snake_case.ts` or `snake_case.tsx` under the selected Google profile;
- SQL schemas, tables, views, and columns: `lower_snake_case` under this skill's explicit house policy.

`SKILL.md` is not precedent for generic filenames. Its exact spelling is required by the Agent Skills specification and is therefore a tooling exception.

### 9. Check the name at its use site

Read the declaration and representative call sites aloud or mentally as code. A declaration can look concise while producing an ambiguous or ungrammatical API.

For APIs, inspect the full phrase formed by receiver/type, function or method name, argument labels, parameters, and return context. Clarity at use MUST outrank brevity in isolation.

### 10. Run lexical validation where supported

From the skill root:

```bash
python scripts/check-name.py --kind python-script --name rebuild-index.py
```

Expected result:

```text
PASS lexical: 'rebuild-index.py' is valid for python-script
NOTE: semantic correctness is not mechanically certified.
```

The following MUST fail for a standalone script:

```bash
python scripts/check-name.py --kind python-script --name rebuild_index.py
```

The same `rebuild_index.py` should pass when classified as `python-module`.

List supported kinds with:

```bash
python scripts/check-name.py --list-kinds
```

### 11. Complete renames safely

A rename is incomplete until all relevant declarations and references are updated and verified, including:

- imports, exports, re-exports, reflection strings, dependency injection keys, route names, serializers, configuration, tests, documentation, examples, and generated manifests;
- filenames and directory paths, including case-only changes on case-insensitive filesystems;
- public API aliases, deprecation paths, database migrations, schema evolution, and external mappings where compatibility applies.

Do not silently break a published contract merely to satisfy an internal spelling profile.

Run the repository's relevant formatter, linter, type checker, tests, build, and search for the old designation before declaring the rename complete.

## Review and response format

When reviewing names, report each substantive issue in this form when useful:

```text
[semantic | lexical | authority | compatibility]
current: <current name>
proposed: <proposed name>
reason: <the concept, convention, or contract that requires the change>
evidence: <definition, call site, type, glossary, policy, or source>
```

Do not flood a review with merely stylistic alternatives. Report names that are misleading, ambiguous, inconsistent with governing vocabulary, incompatible with the artefact kind, or likely to cause operational errors.

When proposing a new non-trivial name, state the intended concept and the nearest rejected alternative. This makes semantic precision auditable.

## Non-goals

This skill does not:

- claim that a physical spelling such as `customer_birth_date` is formally "ISO 11179 compliant";
- impose one casing system across all languages;
- treat a regex pass as semantic approval;
- override unavoidable framework, protocol, standard-library, generated-code, or external-contract names;
- reward longer names when scope and types already provide reliable context;
- accept brevity that removes a distinction the domain actually makes.
