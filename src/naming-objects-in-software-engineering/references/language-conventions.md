# Language and artefact conventions

This reference renders an already-correct semantic stem into the physical form required for an artefact.

Classification comes first. The generic fallback MUST NOT override a language, runtime, framework, protocol, or tooling requirement.

## Canonical language classification (GitHub Linguist)

Language names, detection metadata, and taxonomy in this skill are standardised on the open-source **GitHub Linguist** library (`languages.yml`). For reproducible data, entries are pinned to Linguist release `v9.7.0`:

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0"
  commit: "e0c78d62c42abae6122235d8e68a7aa43eef89da"
  source: https://github.com/github-linguist/linguist/blob/v9.7.0/lib/linguist/languages.yml
```

Each language entry conforms to this canonical model:

```yaml
language:
  notation: "JavaScript"
  linguistLanguageId: 183
  preferredLabel: "JavaScript"
  color: "#f1e05a"
  type: programming
```

- **Canonical language name**: The top-level YAML key in `languages.yml` (e.g. `JavaScript`, `Python`, `XSLT`, `CSS`, `HTML`, `PowerShell`). Case-normalized names (e.g. `javascript`) serve as search aliases.
- **Internal language ID (`linguistLanguageId`)**: The numeric identifier used internally by GitHub. It is not a public persistent IRI scheme (e.g. `https://github.com/languages/183` does not exist).
- **Language type**: Categorised by Linguist as `programming`, `markup`, `data`, or `prose`.
- **Display colour**: The canonical hex display colour used in GitHub repository statistics bars.
- **Grouping**: Subordinate dialects or extensions (e.g. `TSX` grouped under `TypeScript`) contribute to parent language statistics. Frameworks (such as React) are documented beside their host languages.

| Canonical Linguist name | Linguist ID | Type | Color | Group / Scope | Spoke guide |
|---|---|---|---|---|---|
| `JavaScript` | 183 | programming | `#f1e05a` | Host of JSX | [`languages/javascript.md`](languages/javascript.md) |
| `Python` | 303 | programming | `#3572A5` | PEP 8, typing PEPs, Pytest | [`languages/python.md`](languages/python.md) |
| `TypeScript` | 378 | programming | `#3178c6` | Host of TSX (ID 94901924) | [`languages/typescript.md`](languages/typescript.md) |
| `CSS` | 50 | markup | `#663399` | W3C CSS variables, BEM | [`languages/css.md`](languages/css.md) |
| `HTML` | 146 | markup | `#e34c26` | W3C HTML5 data-* attributes | [`languages/html.md`](languages/html.md) |
| `PowerShell` | 293 | programming | `#012456` | Microsoft Verb-Noun cmdlets | [`languages/powershell.md`](languages/powershell.md) |
| `XSLT` | 404 | programming | `#EB8CEB` | W3C XSLT templates, XPath | [`languages/xslt.md`](languages/xslt.md) |
| `Go` | 132 | programming | `#00ADD8` | MixedCaps, export visibility | [`languages/go.md`](languages/go.md) |
| `Rust` | 327 | programming | `#dea584` | Traits, snake_case modules | [`languages/rust.md`](languages/rust.md) |
| `C#` | 42 | programming | `#7355dd` | .NET, I-prefix interfaces | [`languages/csharp.md`](languages/csharp.md) |
| `Java` | 181 | programming | `#b07219` | Google Java profile | [`languages/java.md`](languages/java.md) |
| `Kotlin` | 189 | programming | `#A97BFF` | JetBrains conventions | [`languages/kotlin.md`](languages/kotlin.md) |
| `C++` | 43 | programming | `#f34b7d` | Google C++ profile | [`languages/cpp.md`](languages/cpp.md) |
| `Swift` | 362 | programming | `#F05138` | Swift API Design Guidelines | [`languages/swift.md`](languages/swift.md) |
| `SQL` | 333 | data | `#e38c00` | Relational schemas, rows | [`languages/sql.md`](languages/sql.md) |
| `Shell` | 346 | programming | `#89e051` | Bash, sh automation scripts | [`languages/cli-environment.md`](languages/cli-environment.md) |

Frameworks and operational environments:
- React (UI library built on JavaScript and TypeScript): [`languages/react.md`](languages/react.md)
- CLI and Environment (cross-platform CLI tools and shell environment variables): [`languages/cli-environment.md`](languages/cli-environment.md)

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
| Python exception class | `PascalCase` ending in `Error` | PEP 8 |
| Python TypeVar / type parameter | `UpperCamelCase` | PEP 484 / PEP 695 |
| Python protocol | `UpperCamelCase` | PEP 544 |
| Python generator / iterator factory | `iter_snake_case` or `stream_snake_case` | Python standard library idiom |
| Python constant | `UPPER_SNAKE_CASE` | PEP 8 |
| JavaScript ESM module | `lowerCamelCase.js` or `lowerCamelCase.mjs` | Selected modern JavaScript house profile |
| JavaScript standalone automation script | `kebab-case.mjs` | Selected modern Node.js house profile |
| JavaScript class | `PascalCase` | ECMAScript 2015+ / ecosystem convention |
| JavaScript function, method, property, variable | `lowerCamelCase` | ECMAScript / ecosystem convention |
| JavaScript private class member | `#lowerCamelCase` | ECMAScript 2022 private fields |
| JavaScript constant | `UPPER_SNAKE_CASE` | Ecosystem convention |
| React component | `PascalCase` / `PascalCase.jsx` | React convention |
| React custom hook | `use` + `PascalCase` | React Rules of Hooks |
| React event handler prop | `on` + `PascalCase` | React / DOM convention |
| React internal event handler | `handle` + `PascalCase` | React community convention |
| CSS custom property (variable) | `--kebab-case` | W3C CSS Custom Properties Level 1 |
| CSS class (BEM) | `block__element--modifier` | BEM CSS convention |
| HTML data attribute | `data-kebab-case` | W3C HTML5 data-* specification |
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
| PowerShell cmdlet or exported function | `Verb-Noun` with approved verb and singular noun | Microsoft PowerShell guidelines |
| PowerShell parameter | `PascalCase` | Microsoft PowerShell guidelines |
| PowerShell standalone script | `kebab-case.ps1` or `PascalCase.ps1` | Microsoft PowerShell guidelines |
| PowerShell script module | `PascalCase.psm1` | Microsoft PowerShell guidelines |
| XSLT named template | `lowerCamelCase` or `kebab-case` | W3C XSLT Recommendations |
| XSLT variable or parameter | `lowerCamelCase` or `kebab-case` | W3C XSLT Recommendations |
| XSLT stylesheet function | `prefix:name` | W3C XSLT 2.0+ / XML Namespaces |
| Environment variable | `UPPER_SNAKE_CASE` | Explicit house policy |
| CLI command | `kebab-case` | Explicit house policy |
| CLI long option | `--kebab-case` | Explicit house policy |
| SQL schema, table, view, column | `lower_snake_case` | Explicit house policy, not an ISO or SQL requirement |

The machine-readable forms are in `../assets/naming-policy.json`.

## Ecosystem-specific guides

For detailed rules, idioms, and code patterns, consult the dedicated guide for your target ecosystem:

- JavaScript and Node.js: [`languages/javascript.md`](languages/javascript.md) (modules, scripts, `#private` members, test suites, error codes)
- React: [`languages/react.md`](languages/react.md) (components, custom hooks, `onEvent` vs `handleEvent` pairing)
- CSS: [`languages/css.md`](languages/css.md) (custom properties `--kebab-case`, BEM class methodology)
- HTML: [`languages/html.md`](languages/html.md) (custom data attributes `data-kebab-case`, element IDs)
- Python: [`languages/python.md`](languages/python.md) (scripts vs modules, `Error` exception suffix, TypeVars, generators, Pytest)
- PowerShell: [`languages/powershell.md`](languages/powershell.md) (Verb-Noun cmdlets, PascalCase parameters, script modules)
- XSLT: [`languages/xslt.md`](languages/xslt.md) (templates, modes, variables, namespace-prefixed functions)
- Go: [`languages/go.md`](languages/go.md) (packages, initialisms, getters without 'Get', -er interfaces)
- Rust: [`languages/rust.md`](languages/rust.md) (modules, traits, acronym-as-word convention)
- TypeScript: [`languages/typescript.md`](languages/typescript.md) (Google TS profile, interfaces without 'I', declaration files)
- C# and .NET: [`languages/csharp.md`](languages/csharp.md) (namespaces, I-prefix interfaces, `_camelCase`, `s_camelCase`)
- Java: [`languages/java.md`](languages/java.md) (Google Java profile, packages, semantic constants)
- Kotlin: [`languages/kotlin.md`](languages/kotlin.md) (packages, backing properties, role name guidance)
- C++: [`languages/cpp.md`](languages/cpp.md) (Google C++ profile, `kPascalCase`, trailing underscore data members)
- Swift: [`languages/swift.md`](languages/swift.md) (Swift API Design Guidelines, call-site ergonomics)
- SQL and physical database objects: [`languages/sql.md`](languages/sql.md) (schemas, singular row concepts, constraint prefixes)
- CLI commands and environment variables: [`languages/cli-environment.md`](languages/cli-environment.md) (environment variables, commands, long options)

## Generic files and directories

Use `kebab-case` for a human-authored file or directory only when no more specific ecosystem or tooling rule applies.

```text
architecture-decisions/
customer-import-guide.md
release-notes.md
```

Do not infer from `SKILL.md`, `README.md`, `LICENSE`, `.editorconfig`, `package.json`, `pyproject.toml`, framework routes, migration filenames, or generated artefacts that generic filenames may use arbitrary case. These are explicit tooling, platform, or community exceptions.

A file's extension is not part of its semantic stem. Keep extensions lowercase unless the external format or tool requires otherwise.

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
