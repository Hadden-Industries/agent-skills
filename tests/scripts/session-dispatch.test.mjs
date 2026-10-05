import assert from "node:assert/strict";
import test from "node:test";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareNamingSession } from "../../src/naming-objects-in-software-engineering/evals/assurance/v1/profile.mjs";
import {
  prepareSessionDispatch,
  retainSessionDispatch,
  dispatchPreparedSession,
} from "../../scripts/evaluation/session-dispatch.js";
import {
  createTransmissionPacket,
  canonicalJsonBytes,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import { inspectToolchain } from "../../scripts/evaluation/toolchain.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");

test("dispatch selection rejects unknown and unqualified modes without preparing a carrier", (t) => {
  // A production qualification decision must not redefine this refusal fixture.
  const root = mkdtempSync(join(tmpdir(), "unqualified-dispatch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["src", "skills"])
    cpSync(join(repositoryRoot, directory), join(root, directory), {
      recursive: true,
    });
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, "evaluation-toolchain.json")),
  );
  const platform = `${process.platform}-${process.arch}`;
  manifest.skillUp.platforms[platform].qualification =
    "assured-disabled-descendant-survived";
  writeFileSync(
    join(root, "evaluation-toolchain.json"),
    JSON.stringify(manifest),
  );
  for (const name of Object.keys(manifest.packages)) {
    mkdirSync(join(root, "node_modules", name), { recursive: true });
    cpSync(
      join(repositoryRoot, "node_modules", name, "package.json"),
      join(root, "node_modules", name, "package.json"),
    );
  }
  const native = `.agent-tools/evaluation/skill-up-${manifest.skillUp.version}-${platform}`;
  cpSync(join(repositoryRoot, native), join(root, native), { recursive: true });
  assert.equal(
    inspectToolchain(root).manifest.skillUp.platforms[platform].qualification,
    "assured-disabled-descendant-survived",
  );
  assert.equal(prepareSessionDispatch({ executionMode: "direct" }), null);
  assert.throws(
    () => prepareSessionDispatch({ executionMode: "automatic" }),
    /Unknown execution mode/u,
  );
  assert.throws(
    () =>
      prepareSessionDispatch({
        executionMode: "skill-up",
        repositoryRoot: root,
        skillName: "defining-concepts",
        caseId: 10,
        executionTimeoutMs: 10000,
      }),
    /disabled/u,
  );
});

test("prepared dispatch preserves direct results and refuses changed or missing carrier identity", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "session-dispatch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = join(root, "work");
  mkdirSync(work);
  const preparedSession = join(root, "prepared");
  await prepareNamingSession({
    destination: preparedSession,
    caseId: 4,
    arm: "no-skill",
    model: "gemini-3.5-flash-low",
    effort: "low",
    command: process.execPath,
    prefixArguments: [
      join(repositoryRoot, "tests/scripts/fixtures/fake-antigravity-cli.mjs"),
    ],
    environment: Object.fromEntries(
      ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP"]
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    ),
    workingDirectory: work,
    timeoutMs: 10000,
  });
  const packetPath = join(preparedSession, "packet.json");
  const packet = JSON.parse(readFileSync(packetPath));
  const authorizationFile = join(root, "authorization.json");
  writeFileSync(authorizationFile, '{"decision":"rejected"}');
  const directResult = {
    status: "failed",
    failureClass: "authorization-rejected",
  };
  let calls = 0;
  const direct = (options) => {
    calls += 1;
    assert.deepEqual(options.authorization, { decision: "rejected" });
    assert.equal(options.timeoutMs, 2500);
    return directResult;
  };
  const options = {
    preparedSession,
    authorizationFile,
    allowExternalModelCall: true,
    timeoutMs: 2500,
    direct,
  };
  await assert.rejects(
    dispatchPreparedSession({ ...options, allowExternalModelCall: false }),
    /literally true/u,
  );
  assert.equal(calls, 0);
  assert.equal(await dispatchPreparedSession(options), directResult);
  assert.equal(calls, 1);
  const receiptPath = join(root, "receipt.json");
  const receipt = { deadline: { executionTimeoutMs: 10000 } };
  const bytes = canonicalJsonBytes(receipt);
  const bound = createTransmissionPacket({
    ...packet.transmission,
    session: {
      ...packet.transmission.session,
      metadata: {
        ...packet.transmission.session.metadata,
        consumerProjectionSha256: sha256Hex(bytes),
      },
    },
  });
  writeFileSync(packetPath, canonicalJsonBytes(bound));
  await assert.rejects(dispatchPreparedSession(options), /ENOENT/u);
  writeFileSync(receiptPath, bytes);
  const carrier = { receiptPath, projectionReceiptSha256: sha256Hex(bytes) };
  assert.throws(
    () => retainSessionDispatch({ preparedSession, carrier, packet }),
    /does not bind/u,
  );
  retainSessionDispatch({ preparedSession, carrier, packet: bound });
  writeFileSync(receiptPath, Buffer.concat([bytes, Buffer.from("\n")]));
  await assert.rejects(dispatchPreparedSession(options), /receipt drift/u);
  writeFileSync(receiptPath, bytes);
  await assert.rejects(
    dispatchPreparedSession(options),
    /timeout is packet-bound/u,
  );
  assert.equal(
    calls,
    1,
    "bound consumer sessions never fall back to direct execution",
  );
});
