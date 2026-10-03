import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  projectTriggerDataset,
  classifyTriggerObservation,
} from "../../scripts/evaluation/trigger-contract.js";
test("naming trigger dataset remains 32 balanced literal queries", () => {
  const entries = JSON.parse(
    readFileSync(
      new URL(
        "../../src/naming-objects-in-software-engineering/evals/trigger-evals.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const projection = projectTriggerDataset(entries);
  assert.equal(entries.length, 32);
  assert.equal(entries.filter((item) => item.should_trigger).length, 16);
  assert.deepEqual(projection.entries, entries);
  assert.equal(projection.establishesActivation, false);
  assert.throws(
    () => projectTriggerDataset([...entries, entries[0]]),
    /Duplicate/u,
  );
});
test("self-reported selection never establishes host activation", () => {
  assert.deepEqual(
    classifyTriggerObservation({
      evidenceCategory: "selection-diagnostic",
      selected: true,
    }),
    { status: "diagnostic-only", establishesActivation: false },
  );
  const context = {
    evidenceCategory: "host-activation-experiment",
    host: "fixture",
    hostVersion: "1",
    provider: "fake",
    model: "fake",
    effort: "none",
    installedArtifactSha256: "a".repeat(64),
    query: "test",
    querySet: "original",
    observationContract: "fixture-only",
    repetition: 1,
    competingSkills: [],
    environmentPolicy: {},
    capabilityPolicy: {},
    loadEvidence: [],
    answer: "selected",
    status: "completed",
  };
  assert.equal(classifyTriggerObservation(context).status, "unknown");
  assert.equal(
    classifyTriggerObservation({
      ...context,
      loadEvidence: [
        {
          type: "skill-loaded",
          artifactSha256: "b".repeat(64),
          source: "fixture",
        },
      ],
    }).establishesActivation,
    false,
  );
});
