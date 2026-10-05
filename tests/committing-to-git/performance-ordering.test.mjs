import assert from "node:assert/strict";
import test from "node:test";
import {
  compareChangeUnitsByRawPath,
  sortChangeUnitsByRawPath,
} from "../../src/committing-to-git/message/changeSelection.js";
import { sortByUtf8Bytes } from "../../src/committing-to-git/selection/byteOrdering.js";
import { canonicalizeEvidencePlan } from "../../src/committing-to-git/inspection/reviewCatalog.js";

test("message ordering preserves raw destination, source, UTF-8 ID and stable ties", () => {
  const units = [
    { id: "last", destinationPathBytesBase64: "/w==" },
    { id: "tie", destinationPath: "a", sourcePath: "b", tag: 1 },
    { id: "\u{10000}", destinationPath: "a", sourcePath: "a" },
    { id: "missing" },
    { id: "\ue000", destinationPath: "a", sourcePath: "a" },
    { id: "tie", destinationPath: "a", sourcePath: "b", tag: 2 },
    { id: "encoded", destinationPath: "z", destinationPathBytesBase64: "AA==" },
    { id: "empty-source", destinationPath: "a" },
  ];
  const input = [...units];
  const expected = [
    units[3],
    units[6],
    units[7],
    units[4],
    units[2],
    units[1],
    units[5],
    units[0],
  ];
  assert.deepEqual(sortChangeUnitsByRawPath(units), expected);
  assert.deepEqual([...units].sort(compareChangeUnitsByRawPath), expected);
  assert.deepEqual(units, input);
  assert.equal(sortChangeUnitsByRawPath(units)[5], units[1]);
});

test("a later sort observes mutation and encoded-field precedence without retaining keys", () => {
  const first = {
    id: "F000001",
    destinationPath: "z",
    destinationPathBytesBase64: "YQ==",
  };
  const second = { id: "F000002", destinationPath: "b" };
  assert.deepEqual(sortChangeUnitsByRawPath([second, first]), [first, second]);
  first.destinationPathBytesBase64 = "Yw==";
  assert.deepEqual(sortChangeUnitsByRawPath([second, first]), [second, first]);
  first.destinationPathBytesBase64 = null;
  first.destinationPath = "a";
  assert.deepEqual(sortChangeUnitsByRawPath([second, first]), [first, second]);
  assert.equal(compareChangeUnitsByRawPath(first, second), -1);
  assert.deepEqual(sortChangeUnitsByRawPath([]), []);
  const singleton = { id: null };
  assert.deepEqual(sortChangeUnitsByRawPath([singleton]), [singleton]);
});

test("UTF-8 key preparation is linear, stable, nonmutating and supplementary-aware", () => {
  const values = [
    { path: "\u{10000}", tag: 0 },
    { path: "\ue000", tag: 1 },
    { path: "a", tag: 2 },
    { path: "a", tag: 3 },
  ];
  const visits = [];
  const sorted = sortByUtf8Bytes(values, (value) => {
    visits.push(value);
    return value.path;
  });
  assert.deepEqual(visits, values);
  assert.deepEqual(sorted, [values[2], values[3], values[1], values[0]]);
  assert.deepEqual(
    values.map(({ tag }) => tag),
    [0, 1, 2, 3],
  );
});

test("canonical Unicode selector order remains UTF-8 rather than UTF-16", () => {
  const paths = ["\u{10000}.txt", "\ue000.txt", "a.txt"];
  const manifest = {
    schemaVersion: 2,
    indexTreeOid: "a".repeat(40),
    changeUnitCount: 3,
    changeUnits: paths.map((destinationPath, index) => ({
      id: `F00000${index + 1}`,
      kind: "modified",
      destinationPath,
    })),
  };
  const plan = canonicalizeEvidencePlan({
    manifest,
    groups: [
      {
        selection: { destinationPaths: paths },
        policy: "reuse",
        basis: { kind: "authored-current-task", note: null },
      },
    ],
  });
  assert.deepEqual(plan.groups[0].selection.destinationPaths, [
    "a.txt",
    "\ue000.txt",
    "\u{10000}.txt",
  ]);
  assert.deepEqual(paths, ["\u{10000}.txt", "\ue000.txt", "a.txt"]);
});

test("message keys are extracted once per unit, including ties and long prefixes", () => {
  const visits = { destination: 0, source: 0, id: 0 };
  const units = Array.from({ length: 1000 }, (_, index) => ({
    get destinationPathBytesBase64() {
      visits.destination += 1;
      return Buffer.from("common/".repeat(20) + "same.txt").toString("base64");
    },
    get sourcePathBytesBase64() {
      visits.source += 1;
      return Buffer.from(
        `source-${String(999 - index).padStart(4, "0")}`,
      ).toString("base64");
    },
    get id() {
      visits.id += 1;
      return `F${String(index + 1).padStart(6, "0")}`;
    },
  }));
  const sorted = sortChangeUnitsByRawPath(units);
  assert.deepEqual(visits, { destination: 1000, source: 1000, id: 1000 });
  assert.deepEqual(sorted, [...units].reverse());
});

test("UTF-8 replacement ties and empty encoded keys retain original precedence", () => {
  const values = ["\ud800", "\udfff", "\ue000", "\u{10000}"];
  assert.deepEqual(sortByUtf8Bytes(values), [
    values[2],
    values[0],
    values[1],
    values[3],
  ]);
  const encodedEmpty = {
    id: "F000002",
    destinationPath: "z",
    destinationPathBytesBase64: "",
  };
  const absent = { id: "F000001" };
  const text = { id: "F000003", destinationPath: "a" };
  assert.deepEqual(sortChangeUnitsByRawPath([text, encodedEmpty, absent]), [
    absent,
    encodedEmpty,
    text,
  ]);
});
