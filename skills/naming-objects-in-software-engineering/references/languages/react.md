# React naming conventions

This reference governs physical designations for React components, hooks, and event interfaces.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

framework:
  name: "React"
  parentLanguages:
    - notation: "JavaScript"
      linguistLanguageId: 183
      type: programming
    - notation: "TSX"
      linguistLanguageId: 94901924
      group: "TypeScript"
      type: programming
```

## Components and filenames

- Component functions and classes: `PascalCase` (e.g. `CustomerInvoiceCard`, `OrderSummary`).
- Component source files: `PascalCase.jsx` or `PascalCase.tsx` matching the primary exported component name (e.g. `CustomerInvoiceCard.jsx`, `OrderSummary.tsx`).
- Higher-order components: `with` + `PascalCase` (e.g. `withAuthentication`, `withSubscription`).

## Custom hooks

Custom hooks MUST begin with `use` followed by `PascalCase` (e.g. `useCustomerAccount`, `useWindowDimensions`). This prefix is required by the React Rules of Hooks to enable automated linting and execution order enforcement.

Do not name a hook with a generic noun (`customerAccount`) or getter verb (`getCustomerAccount`). The `use` prefix is an authoritative runtime contract.

## Event callback props versus event handlers

Maintain strict discrimination between the interface contract and the internal implementation:

- Event callback props: MUST use `on[Event]` (e.g. `onInvoiceSubmit`, `onCustomerSelect`, `onCancel`). This establishes the external interface contract that parents bind to.
- Internal event handlers: MUST use `handle[Event]` (e.g. `handleInvoiceSubmit`, `handleCustomerSelect`, `handleCancel`). This identifies the concrete local function that handles DOM or child events.

```jsx
import React, { useState } from "react";

export function InvoiceForm({ onInvoiceSubmit, onCancel }) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleInvoiceSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    onInvoiceSubmit(formData);
  }

  function handleCancel(event) {
    event.preventDefault();
    onCancel();
  }

  return (
    <form onSubmit={handleInvoiceSubmit}>
      <button type="submit" disabled={isSubmitting}>Submit</button>
      <button type="button" onClick={handleCancel}>Cancel</button>
    </form>
  );
}
```
