import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stringify } from "yaml";
import { createConsumerWorkspace } from "./consumer-workspace.js";
import { canonicalJsonBytes, sha256Hex } from "./runtime.js";
import { inspectToolchain, assertAssuredQualification } from "./toolchain.js";

/** Allocate public carrier inputs before the Hadden packet is sealed. */
export function prepareConsumerCarrier({
  repositoryRoot,
  compiled,
  caseId,
  publicSessionId,
  executionTimeoutMs,
  cleanupAllowanceMs = 10000,
  startupAllowanceMs = 10000,
}) {
  const toolchain = inspectToolchain(repositoryRoot);
  assertAssuredQualification(toolchain);
  if (
    !compiled.profile.assurance ||
    !compiled.cases.some(({ id }) => id === caseId)
  )
    throw new Error("Unknown assured case");
  if (!/^[a-z0-9-]{1,80}$/u.test(publicSessionId))
    throw new Error("Invalid public session correlation");
  for (const value of [
    executionTimeoutMs,
    cleanupAllowanceMs,
    startupAllowanceMs,
  ])
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("Carrier budgets must be positive safe integers");
  const workspace = createConsumerWorkspace({ repositoryRoot, compiled });
  const controlPath = join(workspace.root, "execution-index.json");
  const maximumSeconds = Math.ceil(
    (executionTimeoutMs + cleanupAllowanceMs + startupAllowanceMs) / 1000,
  );
  const expectedInput = {
    case_id: publicSessionId,
    variant: "with_skill",
    kwargs: { correlation: publicSessionId },
    messages: [
      {
        role: "user",
        content: `Execute the frozen session ${publicSessionId}.`,
      },
    ],
    max_turns: 1,
  };
  const carrierCase = {
    id: publicSessionId,
    title: "Frozen Hadden session",
    input: { prompt: expectedInput.messages[0].content },
    expect: { exit_code: 0 },
  };
  const casePath = join(workspace.skillRoot, "evals/assured-case.yaml");
  writeFileSync(casePath, stringify(carrierCase), { flag: "wx" });
  const configuration = {
    schema_version: "v1alpha1",
    environment: { type: "none" },
    mcp: { servers: [] },
    engine: {
      name: "hadden-assured",
      custom: {
        transport: "local",
        conversation_mode: "batch",
        response_format: "session_result",
        kwargs: expectedInput.kwargs,
        local: {
          command: process.execPath,
          args: [
            join(
              repositoryRoot,
              "scripts/evaluation/skill-up-custom-engine.js",
            ),
            controlPath,
            "${input_file}",
            "${output_file}",
          ],
          output_file: "${output_file}",
        },
      },
    },
    cases: {
      files: ["evals/assured-case.yaml"],
      defaults: { timeout_seconds: maximumSeconds, max_turns: 1 },
      parallelism: 1,
      retry_policy: { max_retries: 0 },
    },
    benchmark: { enabled: false },
    judge: { type: "rule_based" },
    report: { formats: ["json"] },
  };
  const configurationPath = join(workspace.skillRoot, "evals/assured.yaml");
  const configurationBytes = Buffer.from(stringify(configuration));
  writeFileSync(configurationPath, configurationBytes, { flag: "wx" });
  const receipt = {
    schemaVersion: 1,
    profile: compiled.profile.id,
    compiledSuiteSha256: compiled.compiledSuiteSha256,
    caseId,
    consumerRoot: workspace.root,
    configurationPath,
    configurationSha256: sha256Hex(configurationBytes),
    casePath,
    caseSha256: sha256Hex(Buffer.from(stringify(carrierCase))),
    executableSha256: toolchain.receipt.executableSha256,
    expectedInput,
    deadline: {
      executionTimeoutMs,
      cleanupAllowanceMs,
      minimumSeconds: Math.ceil(
        (executionTimeoutMs + cleanupAllowanceMs) / 1000,
      ),
      maximumSeconds,
    },
    outerTurnMeaning:
      "one bridge invocation; Hadden owns provider continuation",
    variantMeaning:
      "with_skill identifies the consumer carrier only, not the Hadden experimental arm",
  };
  const receiptPath = join(workspace.root, "carrier-receipt.json");
  writeFileSync(receiptPath, canonicalJsonBytes(receipt), { flag: "wx" });
  return Object.freeze({
    controlPath,
    receiptPath,
    receipt,
    projectionReceiptSha256: sha256Hex(canonicalJsonBytes(receipt)),
  });
}

/** Call only after preparation has bound the preceding receipt into its packet. */
export function bindPreparedCarrier({
  carrier,
  preparedSession,
  packet,
  authorizationFile,
  evidenceLayout = "legacy-v1",
}) {
  if (
    packet.transmission.session.metadata?.consumerProjectionSha256 !==
      carrier.projectionReceiptSha256 ||
    packet.transmission.session.metadata?.compiledSuiteSha256 !==
      carrier.receipt.compiledSuiteSha256
  )
    throw new Error("Packet does not bind the carrier receipt");
  const {
    profile,
    consumerRoot,
    configurationPath,
    configurationSha256,
    executableSha256,
    expectedInput,
    deadline,
  } = carrier.receipt;
  const control = {
    schemaVersion: 1,
    profile,
    consumerRoot,
    preparedSession,
    transmissionSha256: packet.transmissionSha256,
    configurationPath,
    configurationSha256,
    executableSha256,
    expectedInput,
    deadline,
    projectionReceiptSha256: carrier.projectionReceiptSha256,
    projectionReceiptPath: carrier.receiptPath,
    evidenceLayout,
    authorizationFile,
  };
  writeFileSync(carrier.controlPath, canonicalJsonBytes(control), {
    flag: "wx",
  });
  return carrier.controlPath;
}
