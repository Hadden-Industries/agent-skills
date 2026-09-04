# HTML naming conventions

This reference governs physical designations for HTML elements, attributes, and custom data tokens.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "HTML"
  linguistLanguageId: 146
  preferredLabel: "HTML"
  color: "#e34c26"
  type: markup
```

## Custom data attributes

Custom data attributes on DOM elements MUST begin with `data-` followed by kebab-case segments: `data-kebab-case`. This is an authoritative requirement of the W3C / WHATWG HTML5 Living Standard for embedding custom non-visible data.

```html
<article
  class="invoice-card"
  data-customer-id="cust_98765"
  data-invoice-status="overdue"
  data-currency-code="USD"
  data-testid="invoice-summary-card">
  <h2 id="invoice-header-title">Invoice #98765</h2>
</article>
```

In the DOM JavaScript API, `element.dataset` automatically translates kebab-case into camelCase (e.g. `data-customer-id` maps to `dataset.customerId`). Do not write `data-customerId` in the HTML markup.

## Element identifiers (id attribute)

The `id` attribute MUST be unique within the document and uses `kebab-case` (e.g. `app-root`, `main-content`, `user-profile-dialog`).

## Autonomous custom elements (Web Components)

Custom element tag names MUST contain at least one hyphen per the W3C Custom Elements specification to avoid collisions with future standard HTML tags:

```html
<customer-registry-view></customer-registry-view>
<invoice-line-item></invoice-line-item>
```
