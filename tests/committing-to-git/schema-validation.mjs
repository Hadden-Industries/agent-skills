/** Full draft-2020-12 validation with local references and no input mutation. */
import Ajv2020 from "ajv/dist/2020.js";
import { readdirSync, readFileSync } from "node:fs";

const directory = new URL(
  "../../src/committing-to-git/schema/",
  import.meta.url,
);
const ajv = new Ajv2020({ strict: true, allErrors: true });
const schemas = readdirSync(directory)
  .filter((name) => name.endsWith(".schema.json"))
  .map((name) => JSON.parse(readFileSync(new URL(name, directory), "utf8")));
const validators = new WeakMap();

/** Validate the supplied schema or a retained root definition; return native errors. */
export function schemaErrors(value, schema) {
  let validate = validators.get(schema);
  if (!validate) {
    const root = schemas.find(
      (candidate) =>
        candidate.title === schema.title ||
        Object.values(candidate.$defs ?? {}).some(
          (definition) => JSON.stringify(definition) === JSON.stringify(schema),
        ),
    );
    validate = ajv.compile(
      root && !schema.$defs ? { ...schema, $defs: root.$defs } : schema,
    );
    validators.set(schema, validate);
  }
  validate(value);
  return (validate.errors ?? []).map(
    (error) =>
      `${error.instancePath} ${error.schemaPath} ${error.message} ${JSON.stringify(error.params)}`,
  );
}
