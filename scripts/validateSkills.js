import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { selectCanonicalSkillNames } from "./skillSelector.js";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");

export function findCanonicalSkills(skillsRoot) {
  const skills = [];

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true });

    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      skills.push(directory);
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        visit(join(directory, entry.name));
      }
    }
  }

  visit(skillsRoot);
  return skills.sort();
}

export function resolveRepositoryTool(
  repoRoot,
  toolName,
  platform = process.platform,
) {
  const windowsTools = {
    "skills-ref": join(repoRoot, ".venv", "Scripts", "skills-ref.exe"),
    tessl: join(
      repoRoot,
      ".agent-tools",
      "tessl",
      "node_modules",
      "@tessl",
      "cli",
      "bin",
      "tessl.js",
    ),
  };
  const executable =
    platform === "win32"
      ? windowsTools[toolName]
      : join(repoRoot, ".agent-tools", "bin", toolName);

  if (!executable) throw new Error(`Unsupported repository tool: ${toolName}`);

  if (!existsSync(executable)) {
    throw new Error(
      `Repository-managed ${toolName} was not found at ${executable}. ` +
        "Run the repository development-environment setup first.",
    );
  }

  return executable;
}

export function runRepositoryTool(command, args, options = {}) {
  const {
    platform = process.platform,
    spawn = spawnSync,
    ...spawnOptions
  } = options;
  if (platform === "win32" && /\.(?:cmd|bat)$/iu.test(command))
    throw new Error(
      "Repository tools require a native executable or Node entry point, not a command script.",
    );
  const nodeEntryPoint = platform === "win32" && /\.m?js$/iu.test(command);
  const executable = nodeEntryPoint ? process.execPath : command;
  const executableArgs = nodeEntryPoint ? [command, ...args] : args;
  const result = spawn(executable, executableArgs, {
    ...spawnOptions,
    shell: false,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}.`);
  }
}

export function validateSkills({
  repoRoot = DEFAULT_REPOSITORY_ROOT,
  platform = process.platform,
  run = runRepositoryTool,
  skillNames,
} = {}) {
  const skillsRef = resolveRepositoryTool(repoRoot, "skills-ref", platform);
  const skillsRoot = join(repoRoot, "skills");
  const skills =
    skillNames === undefined
      ? findCanonicalSkills(skillsRoot)
      : selectCanonicalSkillNames(skillsRoot, skillNames).map((skillName) =>
          join(skillsRoot, skillName),
        );

  for (const skill of skills) {
    run(skillsRef, ["validate", skill]);
  }

  return { skillsValidated: skills.length };
}

function isMainModule() {
  return (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  try {
    const result = validateSkills();
    console.error(`Validated ${result.skillsValidated} canonical skills.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
