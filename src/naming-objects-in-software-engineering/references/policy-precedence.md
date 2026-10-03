# Policy precedence and exceptions

Use this reference when rules conflict, the repository is inconsistent, or compatibility constrains a rename.

## 1. Precedence model

Apply the narrowest valid authority in this order:

```text
language / runtime / protocol / framework / tooling validity
                         v
explicit governing instruction for the task, organisation, repository, or scoped path
                         v
official ecosystem convention or explicitly selected style profile
                         v
this skill's generic fallback policy
```

The first level is not a style preference. A name required for discovery, compilation, interoperability, or protocol conformance must be retained.

Direct task instructions and scoped repository instructions are explicit governance. When two explicit instructions conflict:

1. preserve validity and external contracts;
2. prefer the instruction with the narrowest applicable scope;
3. prefer the more recent direct instruction when scope is equal;
4. surface the conflict rather than silently combining incompatible policies.

This skill's hard defaults, including `kebab-case.py` for standalone Python scripts, remain mandatory unless a higher applicable explicit instruction or tooling requirement overrides them.

## 2. Existing code is not automatically policy

Observed names can reveal:

- an undocumented but coherent convention;
- a migration in progress;
- generated or externally imposed names;
- legacy inconsistency;
- mistakes copied repeatedly.

Therefore frequency alone MUST NOT outrank an explicit policy or authoritative ecosystem convention.

Before treating repository usage as governance, look for evidence such as:

- `AGENTS.md`, `CLAUDE.md`, repository instructions, contribution guides, architecture decisions, or coding standards;
- linter, formatter, analyser, schema, ORM, build-tool, or code-generator configuration;
- tests that assert names or paths;
- documented public API and compatibility commitments;
- a clearly scoped and intentionally enforced convention.

If the repository has no explicit rule and existing usage is inconsistent, apply the selected ecosystem profile rather than taking a majority vote among legacy names.

## 3. External contracts are boundary designations

Published or externally controlled names include:

- API methods, routes, parameters, headers, event types, and CLI commands;
- JSON, XML, CSV, Protobuf, Avro, GraphQL, RDF, or other wire/schema names;
- database objects consumed outside the deployment boundary;
- environment variables, configuration keys, queue/topic names, storage keys, and telemetry dimensions;
- vendor, regulatory, standards-based, or protocol-defined terms.

Do not break such a contract merely to make an internal name idiomatic.

Prefer a boundary mapping:

```python
customer_id = payload["cust_id"]
```

or a serializer/annotation/alias supplied by the language or framework.

Where a public rename is required, provide the appropriate compatibility mechanism: alias, adapter, migration, deprecation period, versioned endpoint/schema, release note, and consumer communication.

An external misspelling may need to remain externally. Do not reproduce it internally unless the mapping would be more dangerous than the inconsistency.

## 4. Tool- and framework-required names are scoped exceptions

Examples include:

```text
SKILL.md
README.md
LICENSE
Dockerfile
Makefile
__init__.py
pyproject.toml
package.json
```

Framework route files, migration identifiers, test-discovery names, generated sources, and platform entry points can also be constrained.

Record the reason conceptually:

```text
exception-type: tooling-required
authority: Agent Skills specification
required-name: SKILL.md
scope: root file of an Agent Skill
```

Never generalise the exception into a broader convention. `SKILL.md` does not make PascalCase generic filenames acceptable.

## 5. Generated code

Do not hand-edit generated names unless the generation workflow explicitly supports it.

Find and change the source of generation, template, schema, or generator configuration. Then regenerate and verify the output.

If a generator produces poor internal names from an external schema, prefer generator-supported mappings or a handwritten adapter rather than a post-generation patch that will be overwritten.

Mark generated directories so reviewers and agents do not learn their conventions as repository policy.

## 6. Legacy handling

A naming-governance skill installed into a legacy repository must not simply perpetuate the legacy.

Use these categories:

### Compliant current name

Leave it unchanged unless a semantic defect exists.

### Lexically non-compliant but semantically correct internal name

Rename when the change is reasonably scoped and verification can establish safety.

### Semantically misleading internal name

Prioritise correction even when the lexical form is already valid. A perfectly cased lie is more dangerous than a casing defect.

### Public or externally consumed legacy name

Preserve at the boundary or migrate explicitly. Introduce a precise internal name and mapping when useful.

### Broad inconsistency requiring a campaign

Do not mix an unbounded repository-wide rename into an unrelated change. Define a migration plan, automate detection, split changes into reviewable units, and prevent new violations immediately.

A touched-file rule may be appropriate only when it does not leave a misleading half-rename or inconsistent public API.

## 7. Compatibility versus correctness

Compatibility is not a blanket reason to retain poor internal names. Semantic correctness is not a blanket reason to break contracts.

Use the following decision:

```text
Is the name externally observable or persisted?
  no  -> rename internally and verify references
  yes -> can an alias or mapping isolate it?
          yes -> precise internal name + compatibility mapping
          no  -> versioned migration, deprecation, or explicit acceptance of legacy spelling
```

Persisted names include database columns, serialized fields, state-machine values, cache keys, object-store paths, metrics, and log fields relied on by automation.

## 8. Database object precedence

A deployed database name may be both internal implementation and external contract.

Before renaming, inspect:

- migrations and rollback strategy;
- application and ORM mappings;
- views, procedures, triggers, functions, grants, and policies;
- ETL/ELT, BI, reports, extracts, spreadsheets, and ad hoc consumers;
- replication, CDC, event publication, and data contracts;
- case-folding, quoting, identifier-length limits, and engine-specific rules.

Use a migration or compatibility view rather than a direct destructive rename when consumers cannot move atomically.

## 9. Case-only renames

Case-insensitive filesystems and Git can fail to record or deploy a case-only rename reliably.

Use an explicit two-step rename when needed:

```text
oldName.ts -> temporary-name.ts -> old_name.ts
```

Verify repository status and the exact casing committed. Check imports on case-sensitive CI or deployment systems.

## 10. Exception acceptance criteria

An exception is valid only when all of the following are known:

```text
required-name:
normal-policy:
conflicting-authority-or-contract:
minimum scope:
compatibility impact:
internal mapping, if any:
expiry or migration condition, if temporary:
```

Avoid "consistent with existing code" as the sole reason.

Temporary exceptions SHOULD have an owner, removal condition, and enforcement that prevents the exception from spreading.

## 11. Rename completion checklist

A rename is complete only after checking applicable items:

- declaration and every static reference;
- imports, exports, re-exports, barrel files, namespaces, and package paths;
- reflection strings, dependency injection names, annotations, decorators, and registration keys;
- serializers, schema mappings, API specifications, clients, and generated artefacts;
- routes, CLI help/completions, environment variables, configuration, and deployment manifests;
- SQL, migrations, reports, ETL, metrics, logs, dashboards, alerts, and saved queries;
- tests, fixtures, snapshots, examples, documentation, diagrams, and comments that define the concept;
- case-sensitive and case-insensitive filesystem behaviour;
- backwards compatibility, aliases, deprecation, and release notes;
- formatter, linter, analyser, type checker, tests, build, and a repository search for the old designation.

Do not perform a text-only replacement when the same token denotes multiple concepts. Rename by symbol or review every occurrence semantically.
