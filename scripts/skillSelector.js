import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CANONICAL_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function selectCanonicalSkillNames(skillsRoot, skillNames) {
  const availableSkillNames = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(skillsRoot, entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"));

  if (skillNames === undefined) {
    return availableSkillNames;
  }

  const requestedSkillNames = [...skillNames];

  if (requestedSkillNames.length === 0) {
    throw new Error("At least one canonical skill must be selected.");
  }

  const uniqueSkillNames = new Set();

  for (const skillName of requestedSkillNames) {
    if (
      typeof skillName !== "string" ||
      !CANONICAL_SKILL_NAME.test(skillName)
    ) {
      throw new Error(`Invalid canonical skill name: ${String(skillName)}`);
    }

    if (uniqueSkillNames.has(skillName)) {
      throw new Error(`Canonical skill selected more than once: ${skillName}`);
    }

    if (!availableSkillNames.includes(skillName)) {
      throw new Error(`Unknown canonical skill: ${skillName}`);
    }

    uniqueSkillNames.add(skillName);
  }

  return [...uniqueSkillNames].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}
