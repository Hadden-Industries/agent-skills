import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import markdown from "prettier/plugins/markdown";

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

function canonicalSkillMarkdownFiles(directory, insideReferences = false) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(
        ...canonicalSkillMarkdownFiles(
          path,
          insideReferences || entry.name === "references",
        ),
      );
    } else if (
      entry.isFile() &&
      (entry.name === "SKILL.md" ||
        (insideReferences && entry.name.endsWith(".md")))
    ) {
      files.push(path);
    }
  }

  return files;
}

function softWrappedTextNodes(node) {
  if (node?.type === "text" && node.value.includes("\n")) {
    return [node];
  }

  if (!Array.isArray(node?.children)) {
    return [];
  }

  return node.children.flatMap((child) => softWrappedTextNodes(child));
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
  skillNames,
}) {
  const resolvedSkillsRoot = resolve(skillsRoot);
  const resolvedEvaluationsRoot = resolve(evaluationsRoot);
  const repositoryRoot = resolve(resolvedSkillsRoot, "..");
  const violations = [];
  let evaluationFileReferencesValidated = 0;

  const selectedSkillNames =
    skillNames === undefined
      ? childDirectories(resolvedSkillsRoot)
      : selectCanonicalSkillNames(resolvedSkillsRoot, skillNames);

  for (const skillName of selectedSkillNames) {
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

  const evaluationSuiteNames =
    skillNames === undefined
      ? childDirectories(resolvedEvaluationsRoot)
      : selectedSkillNames.filter((skillName) =>
          existsSync(join(resolvedEvaluationsRoot, skillName)),
        );

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
          skillSource: existsSync(canonicalSkill)
            ? readFileSync(canonicalSkill, "utf8")
            : undefined,
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
    deployableSkillsValidated: selectedSkillNames.length,
    evaluationFileReferencesValidated,
    evaluationSuitesValidated: evaluationSuiteNames.length,
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

export async function validateCanonicalSkillMarkdownWrapping(
  skillsRoot,
  { skillNames } = {},
) {
  const violations = [];
  const markdownFiles =
    skillNames === undefined
      ? canonicalSkillMarkdownFiles(skillsRoot)
      : selectCanonicalSkillNames(skillsRoot, skillNames).flatMap((skillName) =>
          canonicalSkillMarkdownFiles(join(skillsRoot, skillName)),
        );

  for (const path of markdownFiles) {
    const source = readFileSync(path, "utf8");
    const ast = markdown.parsers.markdown.parse(source, {});
    const [softWrappedText] = softWrappedTextNodes(ast);

    if (softWrappedText) {
      violations.push(
        `${relative(skillsRoot, path)}:${softWrappedText.position.start.line}:${softWrappedText.position.start.column}`,
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(
      "Canonical skill Markdown must keep each prose block on one physical line and rely on viewer soft wrapping:\n" +
        violations.map((violation) => `- ${violation}`).join("\n"),
    );
  }

  return markdownFiles.length;
}

export async function validateSkillRepository({
  repositoryRoot = defaultRepositoryRoot,
  skillNames,
} = {}) {
  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const skillsRoot = resolve(resolvedRepositoryRoot, "skills");
  const selectedSkillNames =
    skillNames === undefined
      ? undefined
      : selectCanonicalSkillNames(skillsRoot, skillNames);
  const evaluationLayout = validateRepositoryEvaluationLayout({
    skillsRoot,
    evaluationsRoot: resolve(resolvedRepositoryRoot, "evals"),
    skillNames: selectedSkillNames,
  });
  const skillFilesValidated = validateCanonicalSkillAscii(skillsRoot, {
    skillNames: selectedSkillNames,
  });
  const markdownFilesValidated = await validateCanonicalSkillMarkdownWrapping(
    skillsRoot,
    { skillNames: selectedSkillNames },
  );

  return {
    ...evaluationLayout,
    markdownFilesValidated,
    skillFilesValidated,
  };
}
