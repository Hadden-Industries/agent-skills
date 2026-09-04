# XSLT naming conventions

XSLT (Extensible Stylesheet Language Transformations) conventions follow W3C XSLT 1.0, 2.0, and 3.0 Recommendations and XML Namespaces standards.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "XSLT"
  linguistLanguageId: 404
  preferredLabel: "XSLT"
  color: "#EB8CEB"
  type: programming
```

## Templates

- Named templates (`<xsl:template name="...">`) use `lowerCamelCase` or `kebab-case` (e.g. `renderInvoiceHeader`, `format-currency`, `extractSummary`). Choose one convention consistently across the stylesheet module.
- Match templates (`<xsl:template match="...">`) match XPath node tests and patterns without explicit names.
- Template modes (`mode="..."`) use `kebab-case` or `lowerCamelCase` identifying rendering intent (e.g. `summary-view`, `detailRow`, `export-csv`).

## Variables and parameters

- Global and local variables (`<xsl:variable name="...">`) use `lowerCamelCase` or `kebab-case` (e.g. `customerTaxRate`, `item-count`, `activeCurrency`).
- Template and stylesheet parameters (`<xsl:param name="...">`) follow the same casing as variables (e.g. `pageSize`, `debug-flag`).
- Tunnel parameters (`tunnel="yes"`) should include clear qualifying prefixes if passed across distant template invocations.

## Functions

- Stylesheet functions (`<xsl:function name="prefix:name">`) in XSLT 2.0 and 3.0 MUST include a namespace prefix defined in the stylesheet header (e.g. `f:calculateTax`, `ext:format-date`).
- Unprefixed function names are reserved for system and XPath built-in functions.

## Files

- Stylesheet modules: `kebab-case.xsl` or `kebab-case.xslt` (e.g. `invoice-transform.xsl`, `tei-to-html.xslt`).
- Root transformation entry point: `main.xsl` or descriptive `kebab-case.xsl`.
