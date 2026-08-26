import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSkillBundles } from "./buildSkillBundles.js";
import { selectCanonicalSkillNames } from "./skillSelector.js";
import { runRepositoryTool, validateSkills } from "./validateSkills.js";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const USAGE = "Usage: verifySkill.js --skill <canonical-skill-name>";
const CANONICAL_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const GLOBAL_ONLY_NOT_RUN = [
  "repository-wide Prettier and ESLint",
  "Tessl plugin-package lint",
  "unrelated Node tests",
  "repository-wide diff whitespace checking",
];

function pathEscapes(directory, candidate) {
  const pathFromDirectory = relative(directory, candidate);

  return (
    pathFromDirectory === ".." ||
    pathFromDirectory.startsWith(`..${sep}`) ||
    isAbsolute(pathFromDirectory)
  );
}

function testFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...testFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      const realPath = realpathSync(path);

      if (pathEscapes(realpathSync(directory), realPath)) {
        throw new Error(`Discovered test escapes its convention root: ${path}`);
      }

      files.push(realPath);
    }
  }

  return files;
}

export function parseSkillArgument(args) {
  if (
    args.length !== 2 ||
    args[0] !== "--skill" ||
    !CANONICAL_SKILL_NAME.test(args[1] ?? "")
  ) {
    throw new Error(USAGE);
  }

  return args[1];
}

export function discoverSkillTests(repositoryRoot, skillName) {
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const conventionRoots = [
    join(resolvedRepositoryRoot, "tests", skillName),
    join(resolvedRepositoryRoot, "tests", "evals", skillName),
  ];
  const discovered = [];

  for (const conventionRoot of conventionRoots) {
    if (existsSync(conventionRoot)) {
      const realConventionRoot = realpathSync(conventionRoot);

      for (const path of testFiles(realConventionRoot)) {
        if (pathEscapes(realConventionRoot, path)) {
          throw new Error(
            `Discovered test escapes its convention root: ${path}`,
          );
        }
        discovered.push(path);
      }
    }
  }

  return discovered.sort((left, right) => left.localeCompare(right, "en"));
}

function toGitPath(path) {
  return path.split(sep).join("/");
}

function targetOwnedPaths(repositoryRoot, skillName) {
  return [
    join("skills", skillName),
    join("evals", skillName),
    join("src", skillName),
    join("tests", skillName),
    join("tests", "evals", skillName),
  ]
    .filter((path) => existsSync(join(repositoryRoot, path)))
    .map(toGitPath);
}

export async function verifySkill({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  skillName,
  platform = process.platform,
  run = runRepositoryTool,
} = {}) {
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  selectCanonicalSkillNames(join(resolvedRepositoryRoot, "skills"), [
    skillName,
  ]);

  const buildResult = await buildSkillBundles({
    checkOnly: true,
    repositoryRoot: resolvedRepositoryRoot,
    skillNames: [skillName],
  });

  if (buildResult.staleBundles.length > 0) {
    throw new Error(
      `Published skill bundles are stale or missing: ${buildResult.staleBundles.join(", ")}`,
    );
  }

  const skillValidation = validateSkills({
    repoRoot: resolvedRepositoryRoot,
    platform,
    run,
    skillNames: [skillName],
  });
  const tests = discoverSkillTests(resolvedRepositoryRoot, skillName);

  if (tests.length > 0) {
    run("node", ["--test", ...tests], {
      cwd: resolvedRepositoryRoot,
    });
  }

  const diffPaths = targetOwnedPaths(resolvedRepositoryRoot, skillName);
  run("git", ["diff", "--check", "HEAD", "--", ...diffPaths], {
    cwd: resolvedRepositoryRoot,
  });

  return {
    skillName,
    passedStages: [
      {
        name: "canonical ASCII",
        filesValidated: buildResult.skillFilesValidated,
      },
      {
        name: "evaluation contract",
        suitesValidated: buildResult.evaluationSuitesValidated,
      },
      {
        name: "configured bundles",
        bundlesChecked: buildResult.bundlesChecked,
      },
      {
        name: "skills-ref validation",
        skillsValidated: skillValidation.skillsValidated,
      },
      { name: "target tests", testsDiscovered: tests.length },
      { name: "target diff whitespace", pathsChecked: diffPaths.length },
    ],
    globalOnlyNotRun: [...GLOBAL_ONLY_NOT_RUN],
  };
}

function isMainModule() {
  return (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  try {
    const skillName = parseSkillArgument(process.argv.slice(2));
    const result = await verifySkill({ skillName });
    process.stdout.write(
      `Scoped verification passed for ${result.skillName}.\n`,
    );
    for (const stage of result.passedStages) {
      process.stdout.write(`PASS ${stage.name}: ${JSON.stringify(stage)}\n`);
    }
    for (const omitted of result.globalOnlyNotRun) {
      process.stdout.write(`NOT RUN (global-only): ${omitted}\n`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
