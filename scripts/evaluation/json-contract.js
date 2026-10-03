import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";

// JSON.parse owns JSON syntax; the maintained YAML parser diagnoses duplicate
// mapping keys before they can be reduced to a JavaScript object.
export function readContract(path) {
  return parseContract(readFileSync(path), path);
}

export function parseContract(bytes, source = "JSON contract") {
  const text = bytes.toString("utf8");
  const value = JSON.parse(text);
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) {
    throw new Error(
      `${source}: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return value;
}

export function freezeContract(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeContract(child);
    Object.freeze(value);
  }
  return value;
}
