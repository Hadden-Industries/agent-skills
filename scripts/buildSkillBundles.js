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

function isJsonObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function readJson(path, displayPath, violations) {
  try {
    return { parsed: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (error) {
    violations.push(`${displayPath} is not valid JSON: ${error.message}`);
    return { parsed: false };
  }
}

function validateBehavioralEvaluations({
  definition,
  displayPath,
  evaluationSuite,
  realEvaluationSuite,
  skillName,
  violations,
}) {
  if (!isJsonObject(definition)) {
    violations.push(`${displayPath} must contain a JSON object`);
    return 0;
  }

  if (definition.skill_name !== skillName) {
    violations.push(
      `${displayPath} declares skill_name ${JSON.stringify(definition.skill_name)} instead of ${JSON.stringify(skillName)}`,
    );
  }

  if (!Array.isArray(definition.evals) || definition.evals.length === 0) {
    violations.push(`${displayPath} must contain a non-empty evals array`);
    return 0;
  }

  const evaluationIds = new Set();
  let fileReferencesValidated = 0;

  for (const [index, evaluation] of definition.evals.entries()) {
    if (!isJsonObject(evaluation)) {
      violations.push(
        `${displayPath} eval at index ${index} must be a JSON object`,
      );
      continue;
    }

    const hasValidId = Number.isInteger(evaluation.id) && evaluation.id > 0;
    const evaluationLabel = hasValidId
      ? `eval ${evaluation.id}`
      : `eval at index ${index}`;

    if (!hasValidId) {
      violations.push(
        `${displayPath} ${evaluationLabel} must have a positive integer id`,
      );
    } else if (evaluationIds.has(evaluation.id)) {
      violations.push(
        `${displayPath} contains duplicate evaluation id ${evaluation.id}`,
      );
    } else {
      evaluationIds.add(evaluation.id);
    }

    if (!isNonEmptyString(evaluation.prompt)) {
      violations.push(
        `${displayPath} ${evaluationLabel} must contain a non-empty prompt`,
      );
    }

    if (!isNonEmptyString(evaluation.expected_output)) {
      violations.push(
        `${displayPath} ${evaluationLabel} must contain a non-empty expected_output`,
      );
    }

    if (Object.hasOwn(evaluation, "assertions")) {
      violations.push(
        `${displayPath} ${evaluationLabel} must use expectations instead of assertions`,
      );
    }

    if (
      !Array.isArray(evaluation.expectations) ||
      evaluation.expectations.length === 0
    ) {
      violations.push(
        `${displayPath} ${evaluationLabel} must contain a non-empty expectations array`,
      );
    } else {
      const expectations = new Set();

      for (const expectation of evaluation.expectations) {
        if (!isNonEmptyString(expectation)) {
          violations.push(
            `${displayPath} ${evaluationLabel} contains an expectation that is not a non-empty string`,
          );
          continue;
        }

        const normalizedExpectation = expectation.trim();

        if (expectations.has(normalizedExpectation)) {
          violations.push(
            `${displayPath} ${evaluationLabel} contains duplicate expectation ${JSON.stringify(normalizedExpectation)}`,
          );
        } else {
          expectations.add(normalizedExpectation);
        }
      }
    }

    if (!Array.isArray(evaluation.files)) {
      violations.push(
        `${displayPath} ${evaluationLabel} must contain a files array`,
      );
      continue;
    }

    const fileReferences = new Set();

    for (const fileReference of evaluation.files) {
      if (typeof fileReference !== "string" || fileReference.length === 0) {
        violations.push(
          `${displayPath} ${evaluationLabel} contains an invalid file reference`,
        );
        continue;
      }

      if (fileReferences.has(fileReference)) {
        violations.push(
          `${displayPath} ${evaluationLabel} contains duplicate file reference ${JSON.stringify(fileReference)}`,
        );
        continue;
      }

      fileReferences.add(fileReference);
      const referencedPath = resolve(evaluationSuite, fileReference);

      if (
        pathEscapes(evaluationSuite, referencedPath) ||
        !existsSync(referencedPath)
      ) {
        violations.push(
          `${displayPath} ${evaluationLabel} references missing or out-of-suite file ${JSON.stringify(fileReference)}`,
        );
        continue;
      }

      const realReferencedPath = realpathSync(referencedPath);

      if (pathEscapes(realEvaluationSuite, realReferencedPath)) {
        violations.push(
          `${displayPath} ${evaluationLabel} references file outside its suite through ${JSON.stringify(fileReference)}`,
        );
        continue;
      }

      fileReferencesValidated += 1;
    }
  }

  return fileReferencesValidated;
}

function validateTriggerEvaluations({ definition, displayPath, violations }) {
  if (!Array.isArray(definition) || definition.length === 0) {
    violations.push(`${displayPath} must contain a non-empty array`);
    return;
  }

  const normalizedQueries = new Set();
  let hasShouldTrigger = false;
  let hasShouldNotTrigger = false;

  for (const [index, trigger] of definition.entries()) {
    if (!isJsonObject(trigger)) {
      violations.push(
        `${displayPath} entry at index ${index} must be a JSON object`,
      );
      continue;
    }

    const fields = Object.keys(trigger).sort();

    if (
      fields.length !== 2 ||
      fields[0] !== "query" ||
      fields[1] !== "should_trigger"
    ) {
      violations.push(
        `${displayPath} entry at index ${index} must contain exactly query and should_trigger`,
      );
    }

    if (!isNonEmptyString(trigger.query)) {
      violations.push(
        `${displayPath} entry at index ${index} must contain a non-empty query`,
      );
    } else {
      const normalizedQuery = trigger.query.trim().toLocaleLowerCase("en-US");

      if (normalizedQueries.has(normalizedQuery)) {
        violations.push(
          `${displayPath} contains duplicate query ${JSON.stringify(trigger.query.trim())}`,
        );
      } else {
        normalizedQueries.add(normalizedQuery);
      }
    }

    if (typeof trigger.should_trigger !== "boolean") {
      violations.push(
        `${displayPath} entry at index ${index} must contain a boolean should_trigger`,
      );
    } else if (trigger.should_trigger) {
      hasShouldTrigger = true;
    } else {
      hasShouldNotTrigger = true;
    }
  }

  if (!hasShouldTrigger || !hasShouldNotTrigger) {
    violations.push(
      `${displayPath} must contain at least one should-trigger and one should-not-trigger case`,
    );
  }
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
    const triggerDefinition = join(evaluationSuite, "trigger-evals.json");
    const evaluationDisplayPath = relative(
      repositoryRoot,
      evaluationDefinition,
    );
    const triggerDisplayPath = relative(repositoryRoot, triggerDefinition);

    if (!existsSync(canonicalSkill)) {
      violations.push(
        `${relative(repositoryRoot, evaluationSuite)} has no canonical ${relative(repositoryRoot, canonicalSkill)}`,
      );
    }

    if (!existsSync(evaluationDefinition)) {
      violations.push(
        `${relative(repositoryRoot, evaluationSuite)} has no evals.json`,
      );
    } else {
      const parsedEvaluation = readJson(
        evaluationDefinition,
        evaluationDisplayPath,
        violations,
      );

      if (parsedEvaluation.parsed) {
        evaluationFileReferencesValidated += validateBehavioralEvaluations({
          definition: parsedEvaluation.value,
          displayPath: evaluationDisplayPath,
          evaluationSuite,
          realEvaluationSuite,
          skillName,
          violations,
        });
      }
    }

    if (!existsSync(triggerDefinition)) {
      violations.push(`${triggerDisplayPath} is required`);
    } else {
      const parsedTriggers = readJson(
        triggerDefinition,
        triggerDisplayPath,
        violations,
      );

      if (parsedTriggers.parsed) {
        validateTriggerEvaluations({
          definition: parsedTriggers.value,
          displayPath: triggerDisplayPath,
          violations,
        });
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
