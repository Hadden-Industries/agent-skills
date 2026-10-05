import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compileSuite } from "./compile-suite.js";
import {
  prepareConsumerCarrier,
  bindPreparedCarrier,
} from "./prepare-consumer-carrier.js";
import { runSkillUp } from "./run-skill-up.js";
import {
  assertTransmissionPacket,
  canonicalJsonBytes,
  sha256Hex,
} from "./runtime.js";
import {
  assertRegularPath,
  inspectToolchain,
  assertAssuredQualification,
} from "./toolchain.js";
import { parseContract, readContract } from "./json-contract.js";
import { deriveOutcomeReference } from "./derive-reports.js";

// The carrier is allocated before packet sealing. Direct remains the default;
// qualification is enforced by prepareConsumerCarrier before any model work.
// temporaryParent selects caller-owned scratch, never model-call authority.
export function prepareSessionDispatch({
  executionMode = "direct",
  repositoryRoot,
  skillName,
  caseId,
  executionTimeoutMs,
  temporaryParent,
}) {
  if (executionMode === "direct") return null;
  if (executionMode !== "skill-up") throw new Error("Unknown execution mode");
  return prepareConsumerCarrier({
    repositoryRoot,
    compiled: compileSuite({ repositoryRoot, skillName }),
    caseId,
    publicSessionId: randomUUID(),
    executionTimeoutMs,
    temporaryParent,
  });
}

// Keep dispatch discovery outside immutable Hadden session evidence. Its bytes
// are untrusted: execution checks the receipt against the packet-bound digest.
export function retainSessionDispatch({ preparedSession, carrier, packet }) {
  if (carrier === null) return;
  assertTransmissionPacket(packet);
  if (
    packet.transmission.session.metadata?.consumerProjectionSha256 !==
    carrier.projectionReceiptSha256
  )
    throw new Error("Prepared packet does not bind dispatch receipt");
  writeFileSync(
    `${resolve(preparedSession)}.consumer.json`,
    canonicalJsonBytes({
      schemaVersion: 1,
      receiptPath: carrier.receiptPath,
    }),
    { flag: "wx", mode: 0o600 },
  );
}

export async function dispatchPreparedSession({
  preparedSession,
  authorizationFile,
  allowExternalModelCall,
  direct,
  timeoutMs,
  evidenceLayout = "legacy-v1",
}) {
  if (allowExternalModelCall !== true)
    throw new Error("allowExternalModelCall must be literally true");
  let authorization;
  try {
    assertRegularPath(authorizationFile);
    authorization = readContract(authorizationFile);
  } catch (error) {
    throw new Error(`Unable to read authorization file: ${error.message}`, {
      cause: error,
    });
  }
  const directory = resolve(preparedSession);
  assertRegularPath(join(directory, "packet.json"));
  const packet = readContract(join(directory, "packet.json"));
  assertTransmissionPacket(packet);
  const projectionDigest =
    packet.transmission.session.metadata?.consumerProjectionSha256;
  if (projectionDigest === undefined) {
    return direct({
      preparedSession: directory,
      authorization,
      allowExternalModelCall: true,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      evidenceLayout,
    });
  }
  const dispatchPath = `${directory}.consumer.json`;
  assertRegularPath(dispatchPath);
  const dispatch = readContract(dispatchPath);
  if (
    dispatch.schemaVersion !== 1 ||
    Object.keys(dispatch).sort().join(",") !== "receiptPath,schemaVersion"
  )
    throw new Error("Invalid prepared dispatch locator");
  assertRegularPath(dispatch.receiptPath);
  const receiptBytes = readFileSync(dispatch.receiptPath);
  if (sha256Hex(receiptBytes) !== projectionDigest)
    throw new Error("Prepared dispatch receipt drift");
  const receipt = parseContract(receiptBytes, dispatch.receiptPath);
  if (
    timeoutMs !== undefined &&
    timeoutMs !== receipt.deadline.executionTimeoutMs
  )
    throw new Error("Consumer execution timeout is packet-bound");
  const carrier = {
    receipt,
    receiptPath: dispatch.receiptPath,
    projectionReceiptSha256: projectionDigest,
    controlPath: join(receipt.consumerRoot, "execution-index.json"),
  };
  assertAssuredQualification(inspectToolchain());
  const controlPath = bindPreparedCarrier({
    carrier,
    packet,
    preparedSession: directory,
    authorizationFile: resolve(authorizationFile),
    evidenceLayout,
  });
  // No catch/fallback: a failed native attempt is reconciled by the existing
  // campaign against terminal/consumption evidence, never retried here.
  await runSkillUp({ controlPath });
  const resultPath = join(
    directory,
    evidenceLayout === "evaluation-trial-v1" ? "result.json" : "run.json",
  );
  const reference = deriveOutcomeReference({
    path: resultPath,
    profile: receipt.profile,
    transmissionSha256: packet.transmissionSha256,
    evidenceLayout,
  });
  const resultBytes = readFileSync(resultPath);
  if (sha256Hex(resultBytes) !== reference.authoritativeSha256)
    throw new Error("Authoritative outcome changed during dispatch readback");
  return JSON.parse(resultBytes);
}
