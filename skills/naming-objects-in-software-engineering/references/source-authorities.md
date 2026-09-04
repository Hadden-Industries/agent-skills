# Source authorities and policy provenance

Checked on 2026-09-03.

This file distinguishes external authority from explicit house policy. A selected style guide is not misrepresented as a language specification, and the ISO-inspired semantic model is not described as formal ISO conformance.

## Agent Skills format

### Agent Skills specification

- URL: https://agentskills.io/specification
- Status used here: normative format authority for `SKILL.md` frontmatter and skill directory structure.
- Applied to: lowercase-hyphenated skill name, required `SKILL.md`, optional `scripts/`, `references/`, and `assets/` directories.

### Agent Skills authoring best practices

- URL: https://agentskills.io/skill-creation/best-practices
- Applied to: concise main skill, progressive disclosure, and moving detailed material into references.

### Agent Skills script guidance

- URL: https://agentskills.io/skill-creation/using-scripts
- Applied to: bundling a self-contained lexical checker under `scripts/`.

## Semantic naming framework

### ISO/IEC 11179-5:2015

- URL: https://www.iso.org/standard/60341.html
- Title: *Information technology -- Metadata registries (MDR) -- Part 5: Naming principles*.
- Status checked: published edition 3 (2015), confirmed in 2020, stage 90.92 ("to be revised"), with ISO identifying ISO/IEC DIS 11179-5 as the developing replacement.
- Applied to: the general distinction among concept, context, designation, naming convention, and semantic name parts; the idea that a concept can have context-specific names; and the use of controlled vocabulary alongside naming governance.
- Important limit: this skill does not reproduce the standard, claim certification, or claim that any particular casing convention is required by ISO/IEC 11179-5.

### ISO/IEC DIS 11179-5

- Canonical product/lifecycle page: https://www.iso.org/standard/60341.html
- Official browsing entry: https://www.iso.org/obp/ui/en/
- Applied to: the research report's forward-looking interpretation that the naming framework is relevant beyond metadata registries and can accommodate programming conventions and system constraints.
- Status caveat: a Draft International Standard can change before publication. The published 2015 edition remains the current International Standard until replaced.

## Python

### PEP 8 -- Style Guide for Python Code

- URL: https://peps.python.org/pep-0008/
- Authority: Python Enhancement Proposal published on the official Python PEP site.
- Applied to: lowercase module names, optional underscores for module readability, lowercase-with-underscores functions and variables, CapWords classes, exception classes ending with `Error`, uppercase-with-underscores constants, `self`, `cls`, non-public underscores, and keyword-collision handling.
- House-policy addition: standalone executable Python scripts use `kebab-case.py`. PEP 8's importable-module convention remains separate.

### PEP 484 and PEP 695 -- Type Hints and Type Parameter Syntax

- PEP 484 URL: https://peps.python.org/pep-0484/
- PEP 695 URL: https://peps.python.org/pep-0695/
- Authority: official Python type system specifications.
- Applied to: `UpperCamelCase` naming for type variables (`TypeVar`) and generic type parameters.

### PEP 544 -- Protocols: Structural Subtyping

- URL: https://peps.python.org/pep-0544/
- Authority: official Python static typing specification.
- Applied to: expressive protocol naming representing capabilities or interfaces (`SupportsClose`, `InvoiceReader`).

## JavaScript, React, and modern web standards

### ECMAScript 2022+ Specification (TC39)

- URL: https://tc39.es/ecma262/
- Authority: Ecma International Standard ECMA-262.
- Applied to: official `#privateField` syntax for private class fields and methods; standard identifier syntax and case rules.

### W3C CSS Custom Properties for Cascading Variables Module Level 1

- URL: https://www.w3.org/TR/css-variables-1/
- Authority: W3C Recommendation.
- Applied to: `--kebab-case` prefix and casing for CSS custom properties.

### W3C HTML5 Specification -- Embedding Custom Non-Visible Data

- URL: https://html.spec.whatwg.org/multipage/dom.html#embedding-custom-non-visible-data-with-the-data-*-attributes
- Authority: WHATWG HTML Living Standard / W3C.
- Applied to: `data-*` custom attributes with kebab-case property naming.

### React Rules of Hooks and Documentation Idioms

- URL: https://react.dev/reference/rules/rules-of-hooks
- Authority: official React documentation.
- Applied to: `use` prefix for custom hooks; `PascalCase` component naming; `on[Event]` callback props paired with `handle[Event]` local handler functions.

### Airbnb JavaScript Style Guide

- URL: https://github.com/airbnb/javascript
- Status: widely adopted ecosystem style profile.
- Applied to: `lowerCamelCase` functions and variables; `PascalCase` classes and constructors; `UPPER_SNAKE_CASE` constants; file naming conventions.

### BEM (Block Element Modifier) Methodology

- URL: https://en.bem.info/methodology/naming-convention/
- Status: widely adopted frontend CSS architecture convention.
- Applied to: `block__element--modifier` class naming.

## Go

### Effective Go -- Names

- URL: https://go.dev/doc/effective_go#names
- Authority: official Go documentation.
- Applied to: short lowercase single-word package names, package context, getter naming, one-method interface idioms, canonical method meanings, and `MixedCaps`/`mixedCaps`.
- Status caveat: the document says it was written for the 2009 release and is not actively updated. Use it for stable core idioms and consult current standard-library practice for newer ecosystem concerns.

### Go Code Review Comments -- Initialisms

- URL: https://go.dev/wiki/CodeReviewComments#initialisms
- Authority: official Go project wiki guidance.
- Applied to: consistent treatment of common initialisms such as `ID`, `HTTP`, and `URL` in Go identifiers when relevant.

## Rust

### Rust API Guidelines -- Naming

- URL: https://rust-lang.github.io/api-guidelines/naming.html
- Authority: Rust API Guidelines maintained under the Rust language documentation organisation.
- Applied to: `UpperCamelCase` types/traits, `snake_case` modules/functions/methods/locals, `SCREAMING_SNAKE_CASE` statics/constants, and acronym-as-word treatment in CamelCase.

### Rust style guide -- identifiers

- URL: https://doc.rust-lang.org/style-guide/items.html
- Authority: official Rust documentation.
- Applied to: supporting lexical conventions where the API Guidelines defer to standard Rust style.

## Kotlin

### Kotlin coding conventions

- URL: https://kotlinlang.org/docs/coding-conventions.html
- Authority: official Kotlin documentation.
- Applied to: lowercase package names without underscores, `UpperCamelCase` classes/objects, `lowerCamelCase` functions/properties/locals, uppercase underscore-separated constants, private backing-property convention, and warnings against meaningless role names.

## C# and .NET

### C# identifier naming rules and conventions

- URL: https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/identifier-names
- Authority: Microsoft Learn documentation for C#.
- Applied to: PascalCase types/namespaces/public members, camelCase parameters and locals, interface `I` prefix, and clarity over brevity.

### .NET coding conventions

- URL: https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions
- Authority: Microsoft Learn.
- Applied to: `_camelCase` instance fields, `s_camelCase` static fields, and current .NET examples for member naming.

### .NET naming rules

- URL: https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/style-rules/naming-rules
- Authority: Microsoft Learn.
- Applied to: mechanical enforcement through `.editorconfig` when a repository configures explicit naming rules.

## Java

### Google Java Style Guide -- Naming

- URL: https://google.github.io/styleguide/javaguide.html#s5-naming
- Status: selected enforceable style profile; not a Java language specification.
- Applied to: lowercase package names, `UpperCamelCase` classes, `lowerCamelCase` methods/parameters/locals, and `UPPER_SNAKE_CASE` constants under the guide's semantic definition.

## TypeScript

### Google TypeScript Style Guide -- Identifiers

- URL: https://google.github.io/styleguide/tsguide.html#identifiers
- Status: selected enforceable style profile; not a TypeScript language specification.
- Applied to: `UpperCamelCase` types, `lowerCamelCase` values/functions/methods/properties/parameters, constant-case global constant values, no interface-prefix notation, and avoiding redundant type encoding.

### Google TypeScript Style Guide -- File encoding and source organisation

- URL: https://google.github.io/styleguide/tsguide.html#file-encoding-utf-8
- Main guide URL: https://google.github.io/styleguide/tsguide.html
- Applied to: selected `snake_case.ts` / `snake_case.tsx` source-file profile described in the research report.

## C++

### Google C++ Style Guide -- Naming

- URL: https://google.github.io/styleguide/cppguide.html#Naming
- Status: selected enforceable style profile; not an ISO C++ language requirement.
- Applied to: lowercase source filenames, underscore as the chosen allowed separator, type/function naming, variable/parameter `snake_case`, trailing underscore for class data members, and `kPascalCase` constants.

### Google C++ Style Guide -- General naming rules

- URL: https://google.github.io/styleguide/cppguide.html#General_Naming_Rules
- Applied to: names that communicate purpose and account for scope.

## Swift

### Swift API Design Guidelines

- URL: https://www.swift.org/documentation/api-design-guidelines/
- Authority: official Swift documentation.
- Applied to: clarity at the point of use, evaluating base names with argument labels, Boolean proposition naming, mutation semantics, and `UpperCamelCase` types / `lowerCamelCase` members.

## Explicit house policies

The following are intentional policy choices, not attributed to ISO or a language standard:

- generic human-authored files and directories use `kebab-case`;
- standalone Python scripts use `kebab-case.py`;
- JavaScript domain and library modules use `lowerCamelCase.js` or `lowerCamelCase.mjs`;
- standalone JavaScript automation and build scripts use `kebab-case.mjs` (or `kebab-case.js` in ESM packages);
- JavaScript test suites use `<module>.<facet>.test.js`, `<subject>.<runner>.js`, and `<seam>.architecture.test.js`;
- environment variables use `UPPER_SNAKE_CASE`;
- CLI commands and long options use kebab case;
- SQL schemas, tables, views, and columns use `lower_snake_case`;
- SQL table/view row concepts are singular;
- SQL constraints and indexes use:

```text
pk_<table>
fk_<child_table>__<parent_table>
uq_<table>__<semantic_columns>
ck_<table>__<rule_concept>
ix_<table>__<semantic_columns>
```

Repositories may replace a house profile with a clearly documented, explicitly governed alternative according to `policy-precedence.md`. Mere legacy frequency is not sufficient.
