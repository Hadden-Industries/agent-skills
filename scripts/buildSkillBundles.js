import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const maintainerOnlySkillChildren = [".plugin-eval", "evals"];
const skillBundles = [
  {
    entryPoint: "./src/committing-to-git/cli/commitWorkflow.js",
    outputFile: "skills/committing-to-git/scripts/commitWorkflow.mjs",
  },
];

function canonicalSkillFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...canonicalSkillFiles(path));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      files.push(path);
    }
  }

  return files;
}

function childDirectories(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function pathEscapes(directory, candidate) {
  const pathFromDirectory = relative(directory, candidate);

  return (
    pathFromDirectory === ".." ||
    pathFromDirectory.startsWith(`..${sep}`) ||
    isAbsolute(pathFromDirectory)
  );
}

export function validateRepositoryEvaluationLayout({
  skillsRoot,
  evaluationsRoot,
}) {
  const resolvedSkillsRoot = resolve(skillsRoot);
  const resolvedEvaluationsRoot = resolve(evaluationsRoot);
  const repositoryRoot = resolve(resolvedSkillsRoot, "..");
  const violations = [];
  let evaluationFileReferencesValidated = 0;

  const skillNames = childDirectories(resolvedSkillsRoot);

  for (const skillName of skillNames) {
    for (const maintainerOnlyChild of maintainerOnlySkillChildren) {
      const packagedMaintainerContent = join(
        resolvedSkillsRoot,
        skillName,
        maintainerOnlyChild,
      );

      if (existsSync(packagedMaintainerContent)) {
        violations.push(
          `${relative(repositoryRoot, packagedMaintainerContent)} is maintainer-only content inside a deployable skill directory`,
        );
      }
    }
  }

  const evaluationSuiteNames = childDirectories(resolvedEvaluationsRoot);

  for (const skillName of evaluationSuiteNames) {
    const evaluationSuite = join(resolvedEvaluationsRoot, skillName);
    const realEvaluationSuite = realpathSync(evaluationSuite);
    const canonicalSkill = join(resolvedSkillsRoot, skillName, "SKILL.md");
    const evaluationDefinition = join(evaluationSuite, "evals.json");

    if (!existsSync(canonicalSkill)) {
      violations.push(
        `${relative(repositoryRoot, evaluationSuite)} has no canonical ${relative(repositoryRoot, canonicalSkill)}`,
      );
    }

    if (!existsSync(evaluationDefinition)) {
      violations.push(
        `${relative(repositoryRoot, evaluationSuite)} has no evals.json`,
      );
      continue;
    }

    let definition;

    try {
      definition = JSON.parse(readFileSync(evaluationDefinition, "utf8"));
    } catch (error) {
      violations.push(
        `${relative(repositoryRoot, evaluationDefinition)} is not valid JSON: ${error.message}`,
      );
      continue;
    }

    if (definition.skill_name !== skillName) {
      violations.push(
        `${relative(repositoryRoot, evaluationDefinition)} declares skill_name ${JSON.stringify(definition.skill_name)} instead of ${JSON.stringify(skillName)}`,
      );
    }

    if (!Array.isArray(definition.evals)) {
      violations.push(
        `${relative(repositoryRoot, evaluationDefinition)} must contain an evals array`,
      );
      continue;
    }

    for (const evaluation of definition.evals) {
      if (!Array.isArray(evaluation.files)) {
        violations.push(
          `${relative(repositoryRoot, evaluationDefinition)} eval ${JSON.stringify(evaluation.id)} must contain a files array`,
        );
        continue;
      }

      for (const fileReference of evaluation.files) {
        if (typeof fileReference !== "string" || fileReference.length === 0) {
          violations.push(
            `${relative(repositoryRoot, evaluationDefinition)} eval ${JSON.stringify(evaluation.id)} contains an invalid file reference`,
          );
          continue;
        }

        const referencedPath = resolve(evaluationSuite, fileReference);

        if (
          pathEscapes(evaluationSuite, referencedPath) ||
          !existsSync(referencedPath)
        ) {
          violations.push(
            `${relative(repositoryRoot, evaluationDefinition)} eval ${JSON.stringify(evaluation.id)} references missing or out-of-suite file ${JSON.stringify(fileReference)}`,
          );
          continue;
        }

        const realReferencedPath = realpathSync(referencedPath);

        if (pathEscapes(realEvaluationSuite, realReferencedPath)) {
          violations.push(
            `${relative(repositoryRoot, evaluationDefinition)} eval ${JSON.stringify(evaluation.id)} references file outside its suite through ${JSON.stringify(fileReference)}`,
          );
          continue;
        }

        evaluationFileReferencesValidated += 1;
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      "Repository evaluation layout is invalid:\n" +
        violations.map((violation) => `- ${violation}`).join("\n"),
    );
  }

  return {
    deployableSkillsValidated: skillNames.length,
    evaluationFileReferencesValidated,
    evaluationSuitesValidated: evaluationSuiteNames.length,
  };
}

export function validateCanonicalSkillAscii(skillsRoot) {
  const violations = [];
  const skillFiles = canonicalSkillFiles(skillsRoot);

  for (const path of skillFiles) {
    const bytes = readFileSync(path);
    let line = 1;
    let column = 1;

    for (const byte of bytes) {
      if (byte > 0x7f) {
        violations.push(
          `${relative(skillsRoot, path)}:${line}:${column} contains non-ASCII byte ` +
            `0x${byte.toString(16).toUpperCase().padStart(2, "0")}`,
        );
        break;
      }

      if (byte === 0x0a) {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      "Canonical SKILL.md files must contain ASCII bytes only:\n" +
        violations.map((violation) => `- ${violation}`).join("\n"),
    );
  }

  return skillFiles.length;
}

async function generateBundle(definition) {
  const result = await build({
    absWorkingDir: repositoryRoot,
    entryPoints: [resolve(repositoryRoot, definition.entryPoint)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    minify: false,
    sourcemap: false,
    legalComments: "inline",
    write: false,
    banner: {
      js: "// Generated by scripts/buildSkillBundles.js. Edit src/, then run npm run build.",
    },
  });

  if (result.outputFiles.length !== 1) {
    throw new Error(
      `${definition.entryPoint} produced ${result.outputFiles.length} outputs; expected one.`,
    );
  }

  return result.outputFiles[0].text;
}

export async function buildSkillBundles({ checkOnly = false } = {}) {
  const evaluationLayout = validateRepositoryEvaluationLayout({
    skillsRoot: resolve(repositoryRoot, "skills"),
    evaluationsRoot: resolve(repositoryRoot, "evals"),
  });
  const skillFilesValidated = validateCanonicalSkillAscii(
    resolve(repositoryRoot, "skills"),
  );
  const staleBundles = [];

  for (const definition of skillBundles) {
    const outputPath = resolve(repositoryRoot, definition.outputFile);
    const generated = await generateBundle(definition);

    if (checkOnly) {
      let committed;

      try {
        committed = readFileSync(outputPath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }

      if (committed !== generated) {
        staleBundles.push(definition.outputFile);
      }
    } else {
      writeFileSync(outputPath, generated);
      process.stdout.write(`Built ${definition.outputFile}\n`);
    }
  }

  return { ...evaluationLayout, staleBundles, skillFilesValidated };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const checkOnly = process.argv.slice(2).includes("--check");
  const { staleBundles } = await buildSkillBundles({ checkOnly });

  if (staleBundles.length > 0) {
    console.error("Published skill bundles are stale or missing:");
    for (const bundle of staleBundles) {
      console.error(`- ${bundle}`);
    }
    console.error("Run npm run build and commit the generated output.");
    process.exitCode = 1;
  }
}
