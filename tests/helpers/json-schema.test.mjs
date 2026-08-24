/**
 * Tests for the minimal JSON Schema checker.
 *
 * The validator contract tests are only meaningful if this helper actually
 * rejects malformed payloads. A checker that silently accepted everything would
 * make every `assertConformsToSchema` call pass for the wrong reason, so each
 * supported keyword is exercised here in both directions.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { schemaErrors } from "./json-schema.mjs";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "name", "count", "tags", "nested"],
  properties: {
    version: { const: 1 },
    name: { type: "string", minLength: 1, pattern: "^[a-z]+$" },
    count: { type: "integer", minimum: 0 },
    optional: { type: ["string", "null"] },
    tags: { type: "array", items: { enum: ["alpha", "beta"] } },
    nested: { $ref: "#/$defs/nested" },
  },
  $defs: {
    nested: {
      type: "object",
      additionalProperties: false,
      required: ["flag"],
      properties: { flag: { type: "boolean" } },
    },
  },
};

function valid() {
  return {
    version: 1,
    name: "example",
    count: 0,
    tags: ["alpha"],
    nested: { flag: true },
  };
}

test("a conforming payload produces no errors", () => {
  assert.deepEqual(schemaErrors(valid(), SCHEMA), []);
});

test("optional properties may be omitted or null", () => {
  assert.deepEqual(schemaErrors({ ...valid(), optional: null }, SCHEMA), []);
  assert.deepEqual(schemaErrors({ ...valid(), optional: "text" }, SCHEMA), []);
});

test("each violation is reported", () => {
  const cases = [
    ["missing required property", (payload) => delete payload.name],
    ["wrong const", (payload) => (payload.version = 2)],
    ["wrong type", (payload) => (payload.name = 42)],
    ["non-integer where integer required", (payload) => (payload.count = 1.5)],
    ["below minimum", (payload) => (payload.count = -1)],
    ["below minLength", (payload) => (payload.name = "")],
    ["string outside pattern", (payload) => (payload.name = "Example")],
    ["value outside enum", (payload) => (payload.tags = ["gamma"])],
    ["unexpected property", (payload) => (payload.extra = true)],
    ["union type violated", (payload) => (payload.optional = 5)],
    [
      "violation behind a $ref",
      (payload) => (payload.nested = { flag: "yes" }),
    ],
    [
      "unexpected property behind a $ref",
      (payload) => (payload.nested = { flag: true, other: 1 }),
    ],
  ];

  for (const [label, mutate] of cases) {
    const payload = valid();

    mutate(payload);

    assert.ok(
      schemaErrors(payload, SCHEMA).length > 0,
      `expected an error for: ${label}`,
    );
  }
});

test("annotation keywords are accepted and do not affect validation", () => {
  const annotated = {
    title: "Annotated",
    description: "Annotations carry documentation, not constraints.",
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: { value: { description: "A counter.", type: "integer" } },
  };

  assert.deepEqual(schemaErrors({ value: 1 }, annotated), []);
  assert.ok(schemaErrors({ value: "one" }, annotated).length > 0);
});

test("maximum and minProperties enforce upper and object-size bounds", () => {
  const bounded = {
    type: "object",
    minProperties: 1,
    additionalProperties: false,
    properties: { count: { type: "integer", maximum: 4 } },
  };

  assert.deepEqual(schemaErrors({ count: 4 }, bounded), []);
  assert.match(schemaErrors({ count: 5 }, bounded).join("\n"), /maximum/u);
  assert.match(schemaErrors({}, bounded).join("\n"), /minProperties/u);
});

test("allOf and conditional branches apply their selected constraints", () => {
  const conditional = {
    type: "object",
    required: ["kind", "value"],
    allOf: [
      { properties: { value: { type: "integer", minimum: 0 } } },
      {
        if: { properties: { kind: { const: "fixed" } } },
        then: { properties: { value: { const: 4 } } },
        else: { properties: { value: { maximum: 3 } } },
      },
    ],
  };

  assert.deepEqual(schemaErrors({ kind: "fixed", value: 4 }, conditional), []);
  assert.deepEqual(
    schemaErrors({ kind: "bounded", value: 3 }, conditional),
    [],
  );
  assert.match(
    schemaErrors({ kind: "fixed", value: 3 }, conditional).join("\n"),
    /expected const 4/u,
  );
  assert.match(
    schemaErrors({ kind: "bounded", value: 4 }, conditional).join("\n"),
    /maximum 3/u,
  );
});

test("unsupported keywords fail loudly rather than being ignored", () => {
  assert.throws(
    () =>
      schemaErrors(
        { value: 1 },
        { type: "object", properties: { value: { multipleOf: 2 } } },
      ),
    /unsupported keyword "multipleOf"/u,
  );
});

test("unresolvable $ref pointers fail loudly", () => {
  assert.throws(
    () => schemaErrors({}, { $ref: "#/$defs/absent" }),
    /Unresolvable \$ref pointer/u,
  );
});
