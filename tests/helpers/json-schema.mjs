/**
 * Minimal, dependency-free JSON Schema checker.
 *
 * This supports only the keyword subset used by the schemas committed in this
 * repository: `type` (including union arrays and `integer`), `const`, `enum`,
 * `required`, `properties`, `additionalProperties: false`, `items`, `minimum`,
 * `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`,
 * `anyOf`, `oneOf`, and local `$ref` pointers into `$defs`. The annotation
 * keywords `title` and `description` are accepted and carry no validation effect.
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
  "minItems",
  "maxItems",
  "uniqueItems",
  "minLength",
  "maxLength",
  "pattern",
  "anyOf",
  "oneOf",
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

  if (schema.anyOf) {
    const matchingBranches = schema.anyOf.filter((branch) => {
      const branchErrors = [];
      check(value, branch, root, path, branchErrors);
      return branchErrors.length === 0;
    });

    if (matchingBranches.length === 0) {
      errors.push(`${path}: value does not match any anyOf branch`);
    }
  }

  if (schema.oneOf) {
    const matchingBranches = schema.oneOf.filter((branch) => {
      const branchErrors = [];
      check(value, branch, root, path, branchErrors);
      return branchErrors.length === 0;
    });

    if (matchingBranches.length !== 1) {
      errors.push(
        `${path}: value must match exactly one oneOf branch; matched ${matchingBranches.length}`,
      );
    }
  }

  if ("const" in schema && value !== schema.const) {
    errors.push(
      `${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`,
    );
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(
      `${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`,
    );
    return;
  }

  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];

    if (!expected.some((candidate) => matchesType(value, candidate))) {
      errors.push(
        `${path}: expected type ${expected.join("|")}, got ${typeOf(value)}`,
      );
      return;
    }
  }

  if (
    typeof value === "number" &&
    typeof schema.minimum === "number" &&
    value < schema.minimum
  ) {
    errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
  }

  if (
    typeof value === "string" &&
    typeof schema.minLength === "number" &&
    [...value].length < schema.minLength
  ) {
    errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
  }

  if (
    typeof value === "string" &&
    typeof schema.maxLength === "number" &&
    [...value].length > schema.maxLength
  ) {
    errors.push(`${path}: string longer than maxLength ${schema.maxLength}`);
  }

  if (
    typeof value === "string" &&
    typeof schema.pattern === "string" &&
    !new RegExp(schema.pattern, "u").test(value)
  ) {
    errors.push(`${path}: string does not match pattern ${schema.pattern}`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => {
      check(entry, schema.items, root, `${path}[${index}]`, errors);
    });
  }

  if (
    Array.isArray(value) &&
    typeof schema.minItems === "number" &&
    value.length < schema.minItems
  ) {
    errors.push(`${path}: array shorter than minItems ${schema.minItems}`);
  }

  if (
    Array.isArray(value) &&
    typeof schema.maxItems === "number" &&
    value.length > schema.maxItems
  ) {
    errors.push(`${path}: array longer than maxItems ${schema.maxItems}`);
  }

  if (Array.isArray(value) && schema.uniqueItems === true) {
    const uniqueEntries = new Set(value.map((entry) => JSON.stringify(entry)));

    if (uniqueEntries.size !== value.length) {
      errors.push(`${path}: array entries are not unique`);
    }
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
