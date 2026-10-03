import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  namingSchedule,
  namingConversation,
  prepareNamingSession,
  executePreparedNamingSession,
  SKILL_NAME,
} from "../../../src/naming-objects-in-software-engineering/evals/assurance/v1/profile.mjs";
import { compileSuite } from "../../../scripts/evaluation/compile-suite.js";
import { EXTERNAL_MODEL_AUTHORIZATION_STATEMENT } from "../../../scripts/evaluation/runtime.js";
import { deriveOutcomeReference } from "../../../scripts/evaluation/derive-reports.js";
const root = path.resolve(import.meta.dirname, "../../..");

test("naming calibration preserves ten cells and exact follow-up inputs", () => {
  const compiled = compileSuite({
    repositoryRoot: root,
    skillName: SKILL_NAME,
  });
  assert.deepEqual(
    namingSchedule().map(({ caseId, arm, repetition }) => [
      caseId,
      arm,
      repetition,
    ]),
    [1, 2, 4, 6, 7].flatMap((id) => [
      [id, "no-skill", 1],
      [id, "candidate-skill", 1],
    ]),
  );
  for (const id of [4, 7]) {
    const evaluationCase = compiled.definition.evals.find(
      (item) => item.id === id,
    );
    const conversation = namingConversation(evaluationCase, "no-skill", null);
    assert.equal(conversation.length, 2);
    assert.equal(
      conversation[1].input.text,
      evaluationCase.follow_up_turns[0].prompt,
    );
    assert.equal(
      conversation[0].input.text,
      `You are an expert software engineer. Answer the following naming question directly, precisely, and concisely.\n\n${evaluationCase.prompt}`,
    );
    assert.ok(
      !conversation[0].input.text.includes(
        evaluationCase.follow_up_turns[0].prompt,
      ),
    );
  }
});

for (const arm of ["no-skill", "candidate-skill"])
  test(`naming ${arm} executes exact follow-up through the authorized shared runtime`, async (t) => {
    const temporary = mkdtempSync(path.join(tmpdir(), "naming-profile-"));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const workingDirectory = path.join(temporary, "work");
    mkdirSync(workingDirectory);
    const destination = path.join(temporary, "prepared");
    const recordFile = path.join(temporary, "provider.jsonl");
    const environment = Object.fromEntries(
      ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP"]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    );
    await prepareNamingSession({
      destination,
      caseId: 4,
      arm,
      model: "gemini-3.5-flash-low",
      effort: "low",
      command: process.execPath,
      prefixArguments: [
        path.join(root, "tests/scripts/fixtures/fake-antigravity-cli.mjs"),
        "--record-file",
        recordFile,
      ],
      environment,
      workingDirectory,
      timeoutMs: 10000,
    });
    const packet = JSON.parse(
      readFileSync(path.join(destination, "packet.json"), "utf8"),
    );
    const authorization = {
      schemaVersion: 1,
      decision: "authorized",
      statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
      allowExternalModel: true,
      provider: "google",
      model: packet.transmission.model,
      effort: "low",
      transmissionSha256: packet.transmissionSha256,
    };
    const evidenceLayout =
      arm === "no-skill" ? "legacy-v1" : "evaluation-trial-v1";
    const result = await executePreparedNamingSession({
      preparedSession: destination,
      authorization,
      allowExternalModelCall: true,
      evidenceLayout,
    });
    assert.equal(result.status, "completed");
    const records = readFileSync(recordFile, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    const turns = records.filter((entry) => entry.mode === "input");
    assert.equal(turns.length, 2);
    const outcomePath = path.join(
      destination,
      evidenceLayout === "legacy-v1" ? "run.json" : "result.json",
    );
    const derive = () =>
      deriveOutcomeReference({
        path: outcomePath,
        profile: "scripted-v1",
        transmissionSha256: packet.transmissionSha256,
        evidenceLayout,
      });
    const reference = derive();
    assert.equal(reference.status, "completed");
    assert.equal(reference.caseId, 4);
    assert.equal(
      reference.preparedSessionId,
      packet.transmission.session.preparedSessionId,
    );
    assert.equal(reference.grading, "not-graded");
    assert.ok(
      !JSON.stringify(reference).includes(
        packet.transmission.harnessControlledInputs[0].content,
      ),
    );
    await assert.rejects(
      executePreparedNamingSession({
        preparedSession: destination,
        authorization,
        allowExternalModelCall: true,
        evidenceLayout,
      }),
      /consum|already|replay/iu,
    );
    appendFileSync(
      path.join(
        destination,
        "outputs",
        evidenceLayout === "legacy-v1" ? "final.md" : "response.md",
      ),
      "tampered",
    );
    assert.throws(derive, /artifact drift/u);
  });
