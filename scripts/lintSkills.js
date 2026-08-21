import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveRepositoryTool, runRepositoryTool } from "./validateSkills.js";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");

export function lintSkills({
  repoRoot = DEFAULT_REPOSITORY_ROOT,
  platform = process.platform,
  run = runRepositoryTool,
} = {}) {
  const tessl = resolveRepositoryTool(repoRoot, "tessl", platform);

  run(tessl, ["skill", "lint", "."], { cwd: repoRoot });
}

function isMainModule() {
  return (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  try {
    lintSkills();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
