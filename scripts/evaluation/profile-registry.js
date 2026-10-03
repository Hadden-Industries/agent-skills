import { freezeContract } from "./json-contract.js";

const profiles = freezeContract({
  "reading-epubs": { id: "portable-v1", version: 1, assurance: false },
  "committing-to-git": {
    id: "git-v1",
    version: 1,
    assurance: true,
    retiredIds: [20, 22, 25, 26, 27],
    nextUnusedId: 78,
  },
  "defining-concepts": { id: "defining-v1", version: 1, assurance: true },
  "naming-objects-in-software-engineering": {
    id: "scripted-v1",
    version: 1,
    assurance: true,
  },
});

export function evaluationProfile(skillName) {
  if (!Object.hasOwn(profiles, skillName))
    throw new Error(`Unregistered evaluation skill: ${skillName}`);
  return profiles[skillName];
}

// Only maintained modules can supply executable behavior. Authored sidecars
// select identifiers, never module paths or provider configuration.
export async function preparedExecutionProfile(id) {
  if (id === "scripted-v1") {
    const module =
      await import("../../src/naming-objects-in-software-engineering/evals/assurance/v1/profile.mjs");
    return Object.freeze({
      suite: "naming-objects-in-software-engineering",
      execute: module.executePreparedNamingSession,
    });
  }
  if (id === "git-v1") {
    const module =
      await import("../../src/committing-to-git/evals/assurance/v1/evaluation-runner.mjs");
    return Object.freeze({
      suite: "committing-to-git",
      execute: module.executePreparedEvaluationSession,
    });
  }
  if (id === "defining-v1") {
    const module =
      await import("../../src/defining-concepts/evals/assurance/v1/run-evaluation-session.mjs");
    return Object.freeze({
      suite: "defining-concepts",
      execute: module.executePreparedDefiningSession,
    });
  }
  throw new Error(`Unregistered prepared execution profile: ${id}`);
}
