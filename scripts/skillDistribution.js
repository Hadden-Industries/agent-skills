import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function assertUnredirectedPath(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error(`Linked path: ${current}`);
    if (dirname(current) === current) break;
  }
}

export const runtimeRoots = Object.freeze([
  "SKILL.md",
  "references",
  "assets",
  "scripts",
]);
const gitBuildRoots = Object.freeze([
  "checks",
  "cli",
  "command",
  "diagnostics",
  "evidence",
  "git",
  "inspection",
  "message",
  "publication",
  "report",
  "schema",
  "selection",
  "signature",
  "snapshot",
  "transaction",
  "workflow",
]);

export function regularFileInventory(directory, prefix = "") {
  assertUnredirectedPath(directory);
  const files = new Map();
  if (lstatSync(directory).isSymbolicLink())
    throw new Error(`Linked directory: ${directory}`);
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)),
  )) {
    const path = join(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Linked input: ${path}`);
    if (entry.isDirectory()) {
      for (const [key, bytes] of regularFileInventory(path, relativePath))
        files.set(key, bytes);
    } else if (entry.isFile()) {
      files.set(relativePath, readFileSync(path));
    } else throw new Error(`Nonregular input: ${path}`);
  }
  return files;
}

export function authoredRuntimeFiles(repositoryRoot, skillName) {
  const source = join(repositoryRoot, "src", skillName);
  assertUnredirectedPath(source);
  if (lstatSync(source).isSymbolicLink())
    throw new Error(`Linked source: ${source}`);
  const files = new Map();
  const accepted = new Set([
    ...runtimeRoots,
    "evals",
    ...(skillName === "committing-to-git" ? gitBuildRoots : []),
  ]);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const path = join(source, entry.name);
    if (!accepted.has(entry.name))
      throw new Error(`Unregistered source category: ${path}`);
    if (entry.isSymbolicLink()) throw new Error(`Linked source: ${path}`);
    if (!runtimeRoots.includes(entry.name)) continue;
    if (entry.name === "SKILL.md") {
      if (!entry.isFile())
        throw new Error(`Expected regular SKILL.md: ${path}`);
      files.set(entry.name, readFileSync(path));
    } else {
      if (!entry.isDirectory())
        throw new Error(`Expected runtime directory: ${path}`);
      for (const [key, bytes] of regularFileInventory(path, entry.name))
        files.set(key, bytes);
    }
  }
  if (!files.has("SKILL.md"))
    throw new Error(`Missing source SKILL.md: ${source}`);
  const folded = new Set();
  for (const key of files.keys()) {
    const normalized = key.toLowerCase();
    if (folded.has(normalized))
      throw new Error(`Runtime path case collision: ${key}`);
    folded.add(normalized);
  }
  return files;
}
