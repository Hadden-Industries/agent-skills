import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  const executableName = platform === "win32" ? `${toolName}.cmd` : toolName;
  const executable = join(repoRoot, ".agent-tools", "bin", executableName);

  if (!existsSync(executable)) {
    throw new Error(
      `Repository-managed ${toolName} was not found at ${executable}. ` +
        "Run the repository development-environment setup first.",
    );
  }

  return executable;
}

function quoteCommandArgument(value) {
  if (/[\r\n\0"]/u.test(value)) {
    throw new Error(
      "Repository tool arguments cannot contain quotes or control characters.",
    );
  }

  return /^[A-Za-z0-9_./:=\\-]+$/u.test(value) ? value : `"${value}"`;
}

export function runRepositoryTool(command, args, options = {}) {
  const {
    commandInterpreter = process.env.ComSpec ?? "cmd.exe",
    platform = process.platform,
    spawn = spawnSync,
    ...spawnOptions
  } = options;
  const executable = platform === "win32" ? commandInterpreter : command;
  const executableArgs =
    platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          [command, ...args].map(quoteCommandArgument).join(" "),
        ]
      : args;
  const result = spawn(executable, executableArgs, {
    ...spawnOptions,
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
} = {}) {
  const skillsRef = resolveRepositoryTool(repoRoot, "skills-ref", platform);
  const skills = findCanonicalSkills(join(repoRoot, "skills"));

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
