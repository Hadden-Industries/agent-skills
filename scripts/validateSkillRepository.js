import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { compileSuite } from "./evaluation/compile-suite.js";
import { assertEvaluationCapabilityDefinition } from "./evaluation/capability-reconciliation.js";
import { selectCanonicalSkillNames } from "./skillSelector.js";

const defaultRepositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const maintainerOnlySkillChildren = [".plugin-eval", "evals"];

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

function validateFollowUpTurns({
  evaluation,
  displayPath,
  evaluationLabel,
  violations,
}) {
  if (!Object.hasOwn(evaluation, "follow_up_turns")) {
    return;
  }

  if (
    !Array.isArray(evaluation.follow_up_turns) ||
    evaluation.follow_up_turns.length === 0
  ) {
    violations.push(
      `${displayPath} ${evaluationLabel} follow_up_turns must be a non-empty array`,
    );
    return;
  }

  if (evaluation.follow_up_turns.length > 31) {
    violations.push(
      `${displayPath} ${evaluationLabel} follow_up_turns must contain at most 31 entries`,
    );
  }

  const followUpIds = new Set();

  for (const [index, followUp] of evaluation.follow_up_turns.entries()) {
    const followUpLabel = `follow-up at index ${index}`;

    if (!isJsonObject(followUp)) {
      violations.push(
        `${displayPath} ${evaluationLabel} ${followUpLabel} must be a JSON object`,
      );
      continue;
    }

    const fields = Object.keys(followUp).sort();

    if (fields.length !== 2 || fields[0] !== "id" || fields[1] !== "prompt") {
      violations.push(
        `${displayPath} ${evaluationLabel} ${followUpLabel} must contain exactly id and prompt`,
      );
    }

    const hasValidId =
      typeof followUp.id === "string" &&
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(followUp.id);

    if (!hasValidId) {
      violations.push(
        `${displayPath} ${evaluationLabel} ${followUpLabel} must have a lowercase ASCII kebab-case id`,
      );
    } else if (followUpIds.has(followUp.id)) {
      violations.push(
        `${displayPath} ${evaluationLabel} contains duplicate follow-up id ${JSON.stringify(followUp.id)}`,
      );
    } else {
      followUpIds.add(followUp.id);
    }

    if (!isNonEmptyString(followUp.prompt)) {
      const promptLabel = hasValidId
        ? `follow-up ${JSON.stringify(followUp.id)}`
        : followUpLabel;
      violations.push(
        `${displayPath} ${evaluationLabel} ${promptLabel} must contain a non-empty prompt`,
      );
    }
  }
}

function validateBehavioralEvaluations({
  definition,
  displayPath,
  evaluationSuite,
  realEvaluationSuite,
  skillSource,
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

  try {
    assertEvaluationCapabilityDefinition({ definition, skillSource });
  } catch (error) {
    violations.push(`${displayPath} capability contract: ${error.message}`);
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

    validateFollowUpTurns({
      evaluation,
      displayPath,
      evaluationLabel,
      violations,
    });

    if (Object.hasOwn(evaluation, "expectations")) {
      violations.push(
        `${displayPath} ${evaluationLabel} must use assertions instead of expectations`,
      );
    }

    if (
      !Array.isArray(evaluation.assertions) ||
      evaluation.assertions.length === 0
    ) {
      violations.push(
        `${displayPath} ${evaluationLabel} must contain a non-empty assertions array`,
      );
    } else {
      const expectations = new Set();

      for (const expectation of evaluation.assertions) {
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
  sourcesRoot,
  skillNames,
  validateContracts = true,
}) {
  const repositoryRoot = resolve(sourcesRoot, "..");
  const selectedSkillNames = selectCanonicalSkillNames(sourcesRoot, skillNames);
  const violations = [];
  let evaluationFileReferencesValidated = 0;
  let evaluationSuitesValidated = 0;
  if (skillNames === undefined)
    for (const entry of readdirSync(sourcesRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        existsSync(join(sourcesRoot, entry.name, "evals")) &&
        !existsSync(join(sourcesRoot, entry.name, "SKILL.md"))
      )
        violations.push(
          `${join(sourcesRoot, entry.name, "evals")} has no canonical ${join(sourcesRoot, entry.name, "SKILL.md")}`,
        );
    }
  for (const skillName of selectedSkillNames) {
    const skillRoot = join(sourcesRoot, skillName);
    const evaluationSuite = join(skillRoot, "evals");
    for (const child of maintainerOnlySkillChildren) {
      const path = join(skillsRoot, skillName, child);
      if (existsSync(path))
        violations.push(
          path +
            " is maintainer-only content inside a deployable skill directory",
        );
    }
    if (!existsSync(evaluationSuite)) continue;
    evaluationSuitesValidated += 1;
    const evaluationPath = join(evaluationSuite, "evals.json");
    if (!existsSync(evaluationPath))
      violations.push(evaluationPath + " is required");
    else {
      try {
        const definition = validateContracts
          ? compileSuite({ repositoryRoot, skillName }).definition
          : JSON.parse(readFileSync(evaluationPath, "utf8"));
        evaluationFileReferencesValidated += validateBehavioralEvaluations({
          definition,
          displayPath: evaluationPath,
          evaluationSuite: skillRoot,
          realEvaluationSuite: realpathSync(skillRoot),
          skillSource: readFileSync(join(skillRoot, "SKILL.md"), "utf8"),
          skillName,
          violations,
        });
      } catch (error) {
        violations.push(evaluationPath + ": " + error.message);
      }
    }
    const triggerPath = join(evaluationSuite, "trigger-evals.json");
    if (!existsSync(triggerPath)) violations.push(triggerPath + " is required");
    else {
      const parsed = readJson(triggerPath, triggerPath, violations);
      if (parsed.parsed)
        validateTriggerEvaluations({
          definition: parsed.value,
          displayPath: triggerPath,
          violations,
        });
    }
  }
  if (violations.length)
    throw new Error(
      "Repository evaluation layout is invalid:\n" +
        violations.map((value) => "- " + value).join("\n"),
    );
  return {
    deployableSkillsValidated: selectedSkillNames.length,
    evaluationFileReferencesValidated,
    evaluationSuitesValidated,
  };
}

export function validateCanonicalSkillAscii(skillsRoot, { skillNames } = {}) {
  const violations = [];
  const skillFiles =
    skillNames === undefined
      ? canonicalSkillFiles(skillsRoot)
      : selectCanonicalSkillNames(skillsRoot, skillNames).flatMap((skillName) =>
          canonicalSkillFiles(join(skillsRoot, skillName)),
        );

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

export async function validateSkillRepository({
  repositoryRoot = defaultRepositoryRoot,
  skillNames,
  validateContracts = true,
} = {}) {
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const skillsRoot = resolve(resolvedRepositoryRoot, "src");
  const selectedSkillNames =
    skillNames === undefined
      ? undefined
      : selectCanonicalSkillNames(skillsRoot, skillNames);
  const evaluationLayout = validateRepositoryEvaluationLayout({
    skillsRoot: resolve(resolvedRepositoryRoot, "skills"),
    sourcesRoot: skillsRoot,
    validateContracts,
    skillNames: selectedSkillNames,
  });
  const skillFilesValidated = validateCanonicalSkillAscii(skillsRoot, {
    skillNames: selectedSkillNames,
  });
  return {
    ...evaluationLayout,
    skillFilesValidated,
  };
}
