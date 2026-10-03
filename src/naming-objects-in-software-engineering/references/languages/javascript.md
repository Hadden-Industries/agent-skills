# JavaScript and Node.js naming conventions

This reference governs physical designations for ECMAScript (ECMA-262) and Node.js environments.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "JavaScript"
  linguistLanguageId: 183
  preferredLabel: "JavaScript"
  color: "#f1e05a"
  type: programming
```

## At-a-glance summary

| Artefact Kind | Convention | Example | Notes |
| --- | --- | --- | --- |
| Domain / library module | `lowerCamelCase.js` | `invoiceParser.js` | Pure ESM explicit extension |
| Standalone script | `kebab-case.mjs` | `rebuild-index.mjs` | Direct CLI / npm execution |
| Class / Constructor | `PascalCase` | `CustomerRegistry` | Instantiable types |
| Function / Method | `lowerCamelCase` | `calculateNetAmount` | Action or property accessor |
| Variable / Property | `lowerCamelCase` | `customerId` | Affirmative booleans (`isValid`) |
| Constant | `UPPER_SNAKE_CASE` | `DEFAULT_TIMEOUT_MS` | True module-level immutable |
| Private field | `#privateField` | `#cache` | ECMAScript 2022 syntax |
| Error code | `UPPER_SNAKE_CASE` | `INVOICE_NOT_FOUND` | Machine-readable `.code` |

## File and module taxonomy

Modern JavaScript distinguishes importable domain modules from standalone automation scripts and test suites:

- Domain and library modules: use `lowerCamelCase.js` or `lowerCamelCase.mjs` (e.g. `invoiceParser.js`, `customerRegistry.js`). Pure ESM requires explicit file extensions in relative import specifiers.
- Standalone automation and build scripts: use `kebab-case.mjs` (or `kebab-case.js` in ESM packages), such as `rebuild-index.mjs` or `verify-bundle.mjs`. These are executed directly by Node.js or npm scripts, not imported as library symbols.
- Test suites:
  - Unit and faceted tests: `<module>.<facet>.test.js` (e.g. `invoiceParser.unit.test.js`, `invoiceParser.edge.test.js`).
  - Cross-runner isolation: `<subject>.<runner>.js` (e.g. `workflow.node.test.js` vs `workflow.browser.test.js`).
  - Architectural seam tests: `<seam>.architecture.test.js` (e.g. `domainBoundaries.architecture.test.js`).
- Configuration files: external tool specifications govern their exact names (e.g. `package.json`, `eslint.config.js`).

## Identifiers and classes

- Classes and constructors: `PascalCase` (e.g. `CustomerRegistry`, `InvoiceParser`).
- Functions, methods, properties, and variables: `lowerCamelCase` (e.g. `calculateNetAmount`, `customerId`).
- Module-level constants: `UPPER_SNAKE_CASE` for true unchanging values (e.g. `DEFAULT_TIMEOUT_MS`, `MAX_RECONNECT_ATTEMPTS`).
- True private class fields: use ECMAScript 2022 `#privateField` syntax rather than underscore prefixing (e.g. `#cache`, `#connectionPool`).
- Domain error codes: domain exceptions should attach a stable `UPPER_SNAKE_CASE` machine-readable `.code` property (e.g. `INVOICE_NOT_FOUND`, `INVALID_CREDENTIALS`).

```javascript
const DEFAULT_TIMEOUT_MS = 30000;

export class CustomerRegistry {
  #cache = new Map();

  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async findCustomer(customerId) {
    if (this.#cache.has(customerId)) {
      return this.#cache.get(customerId);
    }
    const customer = await this.#fetchRemote(customerId);
    this.#cache.set(customerId, customer);
    return customer;
  }

  async #fetchRemote(customerId) {
    // remote network retrieval implementation
  }
}
```
