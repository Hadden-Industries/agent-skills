/**
 * Minimal, dependency-free JSON Schema checker.
 *
 * This supports only the keyword subset used by the schemas committed in this
 * repository: `type` (including union arrays and `integer`), `const`, `enum`,
 * `required`, `properties`, `additionalProperties: false`, `items`, `minimum`,
 * `minLength`, and local `$ref` pointers into `$defs`. The annotation keywords
 * `title` and `description` are accepted and carry no validation effect.
 *
 * A full JSON Schema implementation is deliberately avoided so that validating
 * a committed schema needs no third-party dependency and no package manifest.
 * Extend this helper when a committed schema starts using a new keyword; do not
 * let a schema rely on a keyword that is silently ignored here.
 */

const SUPPORTED_KEYWORDS = new Set([
  "$schema",
  "$defs",
  "$ref",
  "title",
  "description",
  "type",
  "const",
  "enum",
  "required",
  "properties",
  "additionalProperties",
  "items",
  "minimum",
  "minLength",
]);

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local $ref pointers are supported, got: ${ref}`);
  }

  let node = root;

  for (const segment of ref.slice(2).split("/")) {
    node = node?.[segment];

    if (node === undefined) {
      throw new Error(`Unresolvable $ref pointer: ${ref}`);
    }
  }

  return node;
}

function typeOf(value) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function matchesType(value, expected) {
  if (expected === "integer") {
    return Number.isInteger(value);
  }

  if (expected === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }

  return typeOf(value) === expected;
}

function assertKeywordsSupported(schema, path) {
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(
        `Schema at ${path} uses unsupported keyword "${keyword}". ` +
          "Extend tests/helpers/json-schema.mjs rather than relying on it " +
          "being ignored.",
      );
    }
  }
}

function check(value, schema, root, path, errors) {
  if (schema.$ref) {
    check(value, resolveRef(root, schema.$ref), root, path, errors);
    return;
  }

  assertKeywordsSupported(schema, path);

  if ("const" in schema && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
    return;
  }

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];

    if (!expected.some((candidate) => matchesType(value, candidate))) {
      errors.push(`${path}: expected type ${expected.join("|")}, got ${typeOf(value)}`);
      return;
    }
  }

  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
  }

  if (typeof value === "string" && typeof schema.minLength === "number" && value.length < schema.minLength) {
    errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => {
      check(entry, schema.items, root, `${path}[${index}]`, errors);
    });
  }

  if (typeOf(value) === "object") {
    for (const key of schema.required || []) {
      if (!(key in value)) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }

    for (const [key, entry] of Object.entries(value)) {
      const propertySchema = schema.properties?.[key];

      if (propertySchema) {
        check(entry, propertySchema, root, `${path}.${key}`, errors);
        continue;
      }

      if (schema.properties && schema.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }
}

/**
 * Returns a list of human-readable validation errors. An empty list means the
 * value conforms to the schema.
 */
export function schemaErrors(value, schema) {
  const errors = [];

  check(value, schema, schema, "$", errors);

  return errors;
}
