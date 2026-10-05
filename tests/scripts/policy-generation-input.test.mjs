import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { inspectPolicyGenerationInput } from "../../scripts/evaluation/inspect-policy-generation.js";
import {
  createTransmissionPacket,
  canonicalJsonBytes,
} from "../../scripts/evaluation/runtime.js";

const conversationId = "bf7ae75a-a7a7-46bc-8933-14bd593c23fb";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function nativeFixture(
  t,
  { generationSuffix = "", clipped = false, cliVersion = "1.2.16" } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "policy-generation-input-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const session = join(root, "session");
  mkdirSync(join(session, "outputs"), { recursive: true });
  const prompt =
    '# User task\n\nReject stale handover.\n<BEGIN_SKILL_FILE path="SKILL.md">\nUse exact authority.\n';
  const transmission = {
    suite: "committing-to-git",
    session: {
      preparedSessionId: "a".repeat(32),
      caseId: 24,
      arm: "new-skill",
      repetition: 1,
      sequence: 1,
      suiteArtifacts: [],
      metadata: { profile: "policy-only" },
    },
    provider: "google",
    model: "gemini-3.8-flash-low",
    effort: "low",
    transport: "antigravity-cli",
    toolchain: {
      provider: "google",
      transport: "antigravity-cli",
      version: cliVersion,
    },
    runtimeFingerprint: {
      gitCommit: "b".repeat(40),
      gitTree: "c".repeat(40),
      modules: [
        {
          path: "scripts/evaluation/runtime.js",
          byteLength: 1,
          sha256: "d".repeat(64),
        },
      ],
    },
    capabilities: {
      network: false,
      webSearch: false,
      tools: [],
      providerFacilities: [],
    },
    isolation: {
      sandbox: "read-only",
      workingDirectory: root,
      instructionSources: [],
      persistence: false,
      stableHome: null,
      environment: { values: {}, secretSources: [] },
    },
    harnessControlledInputs: [
      {
        id: "prompt",
        role: "user",
        mediaType: "text/markdown",
        encoding: "utf8",
        content: prompt,
        byteLength: Buffer.byteLength(prompt),
        sha256: digest(prompt),
      },
    ],
    continuationPolicy: {
      controllerSha256: "e".repeat(64),
      maxTurns: 1,
      allowedTransitions: [],
      templates: [],
    },
  };
  const packet = createTransmissionPacket(transmission);
  writeFileSync(join(session, "packet.json"), canonicalJsonBytes(packet));
  const transcript = Buffer.from(
    JSON.stringify({ event: "init", conversation_id: conversationId }) + "\n",
  );
  writeFileSync(join(session, "outputs/transcript.jsonl"), transcript);
  const artifacts = {};
  for (const path of ["packet.json", "outputs/transcript.jsonl"]) {
    const bytes = readFileSync(join(session, path));
    artifacts[path] = { byteLength: bytes.length, sha256: digest(bytes) };
  }
  writeFileSync(
    join(session, "run.json"),
    JSON.stringify({
      status: "completed",
      transmissionSha256: packet.transmissionSha256,
      artifacts,
    }),
  );
  const conversationDatabase = join(root, `${conversationId}.db`);
  const database = new DatabaseSync(conversationDatabase);
  database.exec(
    "CREATE TABLE steps(idx INTEGER, step_type INTEGER, step_payload BLOB); CREATE TABLE gen_metadata(idx INTEGER, data BLOB)",
  );
  database
    .prepare("INSERT INTO steps VALUES(0,14,?)")
    .run(Buffer.from(`native-user:${prompt}`));
  database
    .prepare("INSERT INTO gen_metadata VALUES(0,?)")
    .run(
      Buffer.from(
        `native-generation:${clipped ? prompt.slice(0, 30) + "<truncated 60 bytes>" : prompt}${generationSuffix}`,
      ),
    );
  database.close();
  return { session, conversationDatabase, prompt };
}

test("policy generation inspection reads the qualified 1.2.17 schema without requiring legacy launch support", async (t) => {
  const fixture = nativeFixture(t, { cliVersion: "1.2.17" });
  const result = await inspectPolicyGenerationInput({
    preparedSession: fixture.session,
    conversationDatabase: fixture.conversationDatabase,
  });
  assert.equal(result.providerVersion, "1.2.17");
  assert.equal(result.assessmentDisposition, "input-preserved");
});

test("policy generation inspection refuses an unreviewed native version without altering evidence", async (t) => {
  const fixture = nativeFixture(t, { cliVersion: "1.2.18" });
  const bytes = readFileSync(fixture.conversationDatabase);
  await assert.rejects(
    inspectPolicyGenerationInput({
      preparedSession: fixture.session,
      conversationDatabase: fixture.conversationDatabase,
    }),
    /1\.2\.16 or 1\.2\.17/u,
  );
  assert.deepEqual(readFileSync(fixture.conversationDatabase), bytes);
});

test("policy generation inspection distinguishes retained raw input from clipped generation input", async (t) => {
  const complete = nativeFixture(t);
  const preserved = await inspectPolicyGenerationInput({
    preparedSession: complete.session,
    conversationDatabase: complete.conversationDatabase,
  });
  assert.equal(preserved.assessmentDisposition, "input-preserved");
  assert.equal(preserved.generationContainsExactPrompt, true);
  assert.equal(preserved.serviceContextReceipt, false);
  const clipped = nativeFixture(t, { clipped: true });
  const databaseBytes = readFileSync(clipped.conversationDatabase);
  const loss = await inspectPolicyGenerationInput({
    preparedSession: clipped.session,
    conversationDatabase: clipped.conversationDatabase,
  });
  assert.equal(loss.assessmentDisposition, "input-loss");
  assert.equal(loss.rawUserContainsExactPrompt, true);
  assert.equal(loss.generationContainsExactPrompt, false);
  assert.equal(loss.generationPromptPrefixBytes, 30);
  assert.deepEqual(readFileSync(clipped.conversationDatabase), databaseBytes);
  assert.equal(
    JSON.stringify(loss).includes("Reject stale"),
    false,
    "private payload text must not be exported",
  );
});

test("policy generation inspection refuses unrelated databases and non-single generation records", async (t) => {
  const fixture = nativeFixture(t);
  await assert.rejects(
    inspectPolicyGenerationInput({
      preparedSession: fixture.session,
      conversationDatabase: join(fixture.session, "not-owned.db"),
    }),
  );
  const database = new DatabaseSync(fixture.conversationDatabase);
  database
    .prepare("INSERT INTO gen_metadata VALUES(1,?)")
    .run(Buffer.from(fixture.prompt));
  database.close();
  await assert.rejects(
    inspectPolicyGenerationInput({
      preparedSession: fixture.session,
      conversationDatabase: fixture.conversationDatabase,
    }),
    /record shape/u,
  );
});

test("policy generation inspection verifies retained evidence and CLI preserves immutable trial", async (t) => {
  const fixture = nativeFixture(t);
  const cli = fileURLToPath(
    new URL(
      "../../scripts/evaluation/inspect-policy-generation.js",
      import.meta.url,
    ),
  );
  const args = [
    cli,
    "--prepared-session",
    fixture.session,
    "--conversation-database",
    fixture.conversationDatabase,
  ];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).assessmentDisposition,
    "input-preserved",
  );
  const insideTrial = join(fixture.session, "inspection.json");
  const refused = spawnSync(
    process.execPath,
    [...args, "--output", insideTrial],
    { encoding: "utf8" },
  );
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /outside.*immutable/u);
  writeFileSync(join(fixture.session, "outputs/transcript.jsonl"), "changed");
  await assert.rejects(
    inspectPolicyGenerationInput({
      preparedSession: fixture.session,
      conversationDatabase: fixture.conversationDatabase,
    }),
    /artifact identity mismatch/u,
  );
});
