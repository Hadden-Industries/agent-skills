# CSS naming conventions

This reference governs physical designations for CSS stylesheets, classes, and custom properties (variables).

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "CSS"
  linguistLanguageId: 50
  preferredLabel: "CSS"
  color: "#663399"
  type: markup
```

## CSS custom properties (variables)

CSS custom properties MUST begin with two hyphens followed by kebab-case segments: `--kebab-case`. This is governed by the W3C CSS Custom Properties for Cascading Variables Module Level 1 specification.

Structure custom property names hierarchically from category to variant:

```css
:root {
  --color-brand-primary: #1a73e8;
  --color-surface-card: #ffffff;
  --spacing-unit-sm: 4px;
  --spacing-unit-md: 8px;
  --spacing-unit-lg: 16px;
  --typography-heading-line-height: 1.25;
  --z-index-modal-overlay: 1000;
}
```

Do not use camelCase (`--colorPrimary`) or snake_case (`--color_primary`).

## CSS class naming: BEM methodology

Use the BEM (Block Element Modifier) methodology to enforce clear boundaries and prevent cascading selector collisions:

- Block: standalone component or entity that has meaning on its own (`block`, e.g. `invoice-card`, `navigation-bar`).
- Element: part of a block tied to its parent with no standalone meaning (`block__element`, e.g. `invoice-card__header`, `invoice-card__total`).
- Modifier: flag that alters appearance or behavior (`block--modifier` or `block__element--modifier`, e.g. `invoice-card--highlighted`, `invoice-card__total--overdue`).

```css
.invoice-card {
  display: flex;
  flex-direction: column;
}

.invoice-card__header {
  font-size: var(--typography-heading-line-height);
  padding: var(--spacing-unit-md);
}

.invoice-card__total {
  font-weight: bold;
}

.invoice-card--highlighted {
  border: 2px solid var(--color-brand-primary);
}

.invoice-card__total--overdue {
  color: #d93025;
}
```

## CSS filenames

- Global or component stylesheets: `kebab-case.css` (e.g. `base-layout.css`, `design-tokens.css`).
- CSS Modules paired with components: `<Component>.module.css` matching the component identifier (e.g. `CustomerInvoiceCard.module.css`).
