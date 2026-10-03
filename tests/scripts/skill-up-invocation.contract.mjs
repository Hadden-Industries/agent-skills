// Transport and refusal fixtures only. Production qualification is never changed.
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const repository = path.resolve(import.meta.dirname, "../..");
const originalManifest = readFileSync(
  path.join(repository, "evaluation-toolchain.json"),
);
const root = mkdtempSync(path.join(tmpdir(), "bridge-transport-fixture-"));
process.stdout.write(
  JSON.stringify({
    root,
    qualification: "test-only override; no containment claim",
  }) + "\n",
);
const checkout = path.join(root, "checkout");
mkdirSync(checkout);
for (const item of [
  "src",
  "scripts",
  "skills",
  "node_modules",
  "package.json",
  "package-lock.json",
  "evaluation-toolchain.json",
])
  cpSync(path.join(repository, item), path.join(checkout, item), {
    recursive: true,
  });
const platform = `${process.platform}-${process.arch}`;
const manifest = JSON.parse(
  readFileSync(path.join(checkout, "evaluation-toolchain.json"), "utf8"),
);
manifest.skillUp.platforms[platform].qualification = "assured-qualified";
writeFileSync(
  path.join(checkout, "evaluation-toolchain.json"),
  JSON.stringify(manifest, null, 2),
);
const native = `.agent-tools/evaluation/skill-up-${manifest.skillUp.version}-${platform}`;
cpSync(path.join(repository, native), path.join(checkout, native), {
  recursive: true,
});
const globalConfig = path.join(root, "empty-gitconfig");
writeFileSync(globalConfig, "");
const git = (args) => {
  const r = spawnSync("git", args, {
    cwd: checkout,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  if (r.status !== 0) throw new Error(r.stderr);
};
git(["init"]);
git(["add", "package.json"]);
git([
  "-c",
  "user.name=Transport Fixture",
  "-c",
  "user.email=fixture@example.test",
  "-c",
  "commit.gpgsign=false",
  "commit",
  "-m",
  "Transport fixture",
]);
const load = (file) => import(pathToFileURL(path.join(checkout, file)).href);
const { compileSuite } = await load("scripts/evaluation/compile-suite.js");
const { prepareConsumerCarrier, bindPreparedCarrier } = await load(
  "scripts/evaluation/prepare-consumer-carrier.js",
);
const { prepareNamingSession } = await load(
  "src/naming-objects-in-software-engineering/evals/assurance/v1/profile.mjs",
);
const { runSkillUp } = await load("scripts/evaluation/run-skill-up.js");
const { executeSkillUpBridge } = await load(
  "scripts/evaluation/skill-up-custom-engine.js",
);
const {
  EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  canonicalJsonBytes,
  sha256Hex,
} = await load("scripts/evaluation/runtime.js");
const compiled = compileSuite({
  repositoryRoot: checkout,
  skillName: "naming-objects-in-software-engineering",
});
const carrier = prepareConsumerCarrier({
  repositoryRoot: checkout,
  compiled,
  caseId: 4,
  publicSessionId: "fake-normal-closure",
  executionTimeoutMs: 10000,
});
process.stdout.write(
  JSON.stringify({ consumerRoot: carrier.receipt.consumerRoot }) + "\n",
);
const workingDirectory = path.join(root, "work");
mkdirSync(workingDirectory);
const preparedSession = path.join(root, "prepared");
const environment = Object.fromEntries(
  ["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
await prepareNamingSession({
  destination: preparedSession,
  caseId: 4,
  arm: "candidate-skill",
  model: "gemini-3.5-flash-low",
  effort: "low",
  command: process.execPath,
  prefixArguments: [
    path.join(repository, "tests/scripts/fixtures/fake-antigravity-cli.mjs"),
    "--record-file",
    path.join(root, "fake-provider.jsonl"),
  ],
  environment,
  workingDirectory,
  timeoutMs: 10000,
  consumerProjectionSha256: carrier.projectionReceiptSha256,
});
const packet = JSON.parse(
  readFileSync(path.join(preparedSession, "packet.json"), "utf8"),
);
const authorizationFile = path.join(root, "authorization.json");
writeFileSync(
  authorizationFile,
  JSON.stringify({
    schemaVersion: 1,
    decision: "authorized",
    statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
    allowExternalModel: true,
    provider: "google",
    model: packet.transmission.model,
    effort: "low",
    transmissionSha256: packet.transmissionSha256,
  }),
);
const controlPath = bindPreparedCarrier({
  carrier,
  preparedSession,
  packet,
  authorizationFile,
});
const probeWorkspace = path.join(
  carrier.receipt.consumerRoot,
  "refusal-workspace",
);
mkdirSync(probeWorkspace);
const inputPath = path.join(probeWorkspace, "input.json");
const outputPath = path.join(probeWorkspace, "output.json");
writeFileSync(
  inputPath,
  JSON.stringify({
    ...carrier.receipt.expectedInput,
    workspace: probeWorkspace,
    timeout_seconds: carrier.receipt.deadline.maximumSeconds,
  }),
);
const bridge = (output = outputPath) =>
  executeSkillUpBridge({ controlPath, inputPath, outputPath: output });
const controlBytes = readFileSync(controlPath);
const receiptBytes = readFileSync(carrier.receiptPath);
const preflightObservations = readFileSync(
  path.join(root, "fake-provider.jsonl"),
);
writeFileSync(
  carrier.receiptPath,
  Buffer.concat([receiptBytes, Buffer.from(" ")]),
);
await assert.rejects(bridge(), /Carrier receipt drift/u);
writeFileSync(carrier.receiptPath, receiptBytes);
const control = JSON.parse(controlBytes);
writeFileSync(
  controlPath,
  JSON.stringify({ ...control, transmissionSha256: "0".repeat(64) }),
);
await assert.rejects(bridge(), /Prepared carrier binding mismatch/u);
writeFileSync(controlPath, controlBytes);
for (const [field, value, diagnostic] of [
  ["caseId", 7, /Carrier case identity mismatch/u],
  [
    "compiledSuiteSha256",
    "0".repeat(64),
    /Carrier compiled suite identity mismatch/u,
  ],
]) {
  const changedReceipt = canonicalJsonBytes({
    ...carrier.receipt,
    [field]: value,
  });
  writeFileSync(carrier.receiptPath, changedReceipt);
  writeFileSync(
    controlPath,
    JSON.stringify({
      ...control,
      projectionReceiptSha256: sha256Hex(changedReceipt),
    }),
  );
  await assert.rejects(bridge(), diagnostic);
}
writeFileSync(carrier.receiptPath, receiptBytes);
writeFileSync(controlPath, controlBytes);
const configurationBytes = readFileSync(carrier.receipt.configurationPath);
writeFileSync(
  carrier.receipt.configurationPath,
  Buffer.concat([configurationBytes, Buffer.from("\n")]),
);
await assert.rejects(bridge(), /Consumer configuration drift/u);
writeFileSync(carrier.receipt.configurationPath, configurationBytes);
await assert.rejects(
  bridge(path.join(preparedSession, "forbidden-output.json")),
  /prepared evidence boundary/u,
);
writeFileSync(outputPath, "retained existing output");
await assert.rejects(bridge(), /Consumer output already exists/u);
renameSync(
  outputPath,
  path.join(probeWorkspace, "retained-existing-output.json"),
);
assert.equal(existsSync(path.join(preparedSession, "attempt.json")), false);
assert.deepEqual(
  readFileSync(path.join(root, "fake-provider.jsonl")),
  preflightObservations,
);
const result = runSkillUp({ controlPath });
assert.throws(() => runSkillUp({ controlPath }), /already attempted/u);
renameSync(
  path.join(carrier.receipt.consumerRoot, "invocation.json"),
  path.join(carrier.receipt.consumerRoot, "completed-invocation.json"),
);
assert.throws(() => runSkillUp({ controlPath }), /already attempted/u);
const outcome = JSON.parse(
  readFileSync(path.join(preparedSession, "run.json"), "utf8"),
);
if (outcome.status !== "completed") throw new Error("Hadden did not complete");
assert.ok(
  readFileSync(path.join(repository, "evaluation-toolchain.json")).equals(
    originalManifest,
  ),
);
const observations = readFileSync(
  path.join(root, "fake-provider.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map(JSON.parse);
assert.equal(observations.filter(({ mode }) => mode === "model").length, 1);
assert.equal(observations.filter(({ mode }) => mode === "input").length, 2);
const reportBytes = readFileSync(
  path.join(carrier.receipt.consumerRoot, "reports/iteration-1/benchmark.json"),
  "utf8",
);
assert.ok(!reportBytes.includes(EXTERNAL_MODEL_AUTHORIZATION_STATEMENT));
assert.ok(!reportBytes.includes("candidate-skill"));
const receipt = {
  schemaVersion: 1,
  root,
  consumerRoot: carrier.receipt.consumerRoot,
  transmissionSha256: packet.transmissionSha256,
  consumerExit: result.status,
  authoritativeStatus: outcome.status,
  qualification:
    "test-only manifest override in disposable copy; normal transport only; no containment or platform qualification",
};
writeFileSync(
  path.join(root, "receipt.json"),
  JSON.stringify(receipt, null, 2),
);
process.stdout.write(JSON.stringify(receipt) + "\n");
