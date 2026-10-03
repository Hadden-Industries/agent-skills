import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
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
import { preparedExecutionProfile } from "./profile-registry.js";
import { deriveOutcomeReference } from "./derive-reports.js";
import { assertProcessHostMembership } from "./process-host.js";

const same = (a, b) => canonicalJsonBytes(a).equals(canonicalJsonBytes(b));

export function assertConsumerOutput(workspace, outputPath, expectedWorkspace) {
  const absoluteOutput = resolve(outputPath);
  if (existsSync(absoluteOutput))
    throw new Error("Consumer output already exists");
  for (
    let parent = dirname(absoluteOutput);
    parent !== dirname(parent);
    parent = dirname(parent)
  )
    if (existsSync(parent) && lstatSync(parent).isSymbolicLink())
      throw new Error("Redirected consumer output");
  const workspaceRealPath = realpathSync(workspace);
  if (expectedWorkspace && workspaceRealPath !== expectedWorkspace)
    throw new Error("Consumer workspace identity changed");
  let parent = dirname(absoluteOutput);
  while (!existsSync(parent)) parent = dirname(parent);
  const locator = relative(workspaceRealPath, realpathSync(parent));
  if (locator === ".." || locator.startsWith(`..${sep}`) || isAbsolute(locator))
    throw new Error("Consumer output escapes real workspace");
  return workspaceRealPath;
}

export function assertConsumerCorrelation(input, expected, deadline) {
  if (
    !deadline ||
    Object.keys(deadline).sort().join(",") !==
      "cleanupAllowanceMs,executionTimeoutMs,maximumSeconds,minimumSeconds" ||
    Object.values(deadline).some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    ) ||
    deadline.minimumSeconds > deadline.maximumSeconds
  )
    throw new Error("Invalid bound consumer deadline");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Malformed SessionInput");
  const accepted = [
    "case_id",
    "variant",
    "workspace",
    "model",
    "kwargs",
    "messages",
    "max_turns",
    "timeout_seconds",
  ];
  if (Object.keys(input).some((key) => !accepted.includes(key)))
    throw new Error(
      "Unknown SessionInput field or forbidden continuation session_id",
    );
  if (!input.workspace || !isAbsolute(input.workspace))
    throw new Error("Expected absolute consumer workspace");
  const { workspace, timeout_seconds: timeout, ...correlation } = input;
  void workspace;
  if (!same(correlation, expected))
    throw new Error("Consumer correlation mismatch");
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < deadline.minimumSeconds ||
    timeout > deadline.maximumSeconds ||
    timeout * 1000 < deadline.executionTimeoutMs + deadline.cleanupAllowanceMs
  )
    throw new Error("Insufficient or expanded consumer deadline");
}

export async function executeSkillUpBridge({
  controlPath,
  inputPath,
  outputPath,
  signal,
}) {
  // The bridge repeats the wrapper gate: direct invocation cannot bypass it.
  const toolchain = inspectToolchain();
  assertAssuredQualification(toolchain);
  for (const path of [controlPath, inputPath]) assertRegularPath(path);
  const control = readContract(controlPath);
  const expectedKeys = [
    "schemaVersion",
    "profile",
    "preparedSession",
    "transmissionSha256",
    "configurationPath",
    "configurationSha256",
    "projectionReceiptSha256",
    "projectionReceiptPath",
    "executableSha256",
    "processHost",
    "expectedInput",
    "deadline",
    "evidenceLayout",
    "authorizationFile",
    "consumerRoot",
  ];
  if (
    control.schemaVersion !== 1 ||
    !same(Object.keys(control).sort(), expectedKeys.sort())
  )
    throw new Error("Invalid bridge control contract");
  if (control.executableSha256 !== toolchain.receipt.executableSha256)
    throw new Error("Consumer executable drift");
  assertRegularPath(control.projectionReceiptPath);
  const receiptBytes = readFileSync(control.projectionReceiptPath);
  if (sha256Hex(receiptBytes) !== control.projectionReceiptSha256)
    throw new Error("Carrier receipt drift");
  const receipt = parseContract(receiptBytes, control.projectionReceiptPath);
  assertRegularPath(receipt.casePath);
  if (sha256Hex(readFileSync(receipt.casePath)) !== receipt.caseSha256)
    throw new Error("Consumer case drift");
  for (const field of [
    "profile",
    "consumerRoot",
    "configurationPath",
    "configurationSha256",
    "executableSha256",
    "processHost",
    "expectedInput",
    "deadline",
  ])
    if (!same(control[field], receipt[field]))
      throw new Error(`Carrier control drift: ${field}`);
  assertRegularPath(control.configurationPath);
  if (
    sha256Hex(readFileSync(control.configurationPath)) !==
    control.configurationSha256
  )
    throw new Error("Consumer configuration drift");
  const input = readContract(inputPath);
  assertConsumerCorrelation(input, control.expectedInput, control.deadline);
  const inside = (parent, child) => {
    const locator = relative(resolve(parent), resolve(child));
    return (
      locator !== "" &&
      locator !== ".." &&
      !locator.startsWith(`..${sep}`) &&
      !isAbsolute(locator)
    );
  };
  if (
    !inside(control.consumerRoot, input.workspace) ||
    !inside(input.workspace, outputPath) ||
    resolve(control.consumerRoot) === resolve(control.preparedSession) ||
    inside(control.consumerRoot, control.preparedSession) ||
    inside(control.preparedSession, control.consumerRoot)
  )
    throw new Error("Consumer paths cross the prepared evidence boundary");
  const absoluteOutput = resolve(outputPath);
  const workspaceRealPath = assertConsumerOutput(
    input.workspace,
    absoluteOutput,
  );
  const packetPath = join(control.preparedSession, "packet.json");
  assertRegularPath(packetPath);
  const packet = readContract(packetPath);
  assertTransmissionPacket(packet);
  if (packet.transmission.session.caseId !== receipt.caseId)
    throw new Error("Carrier case identity mismatch");
  if (
    packet.transmission.session.metadata?.compiledSuiteSha256 !==
    receipt.compiledSuiteSha256
  )
    throw new Error("Carrier compiled suite identity mismatch");
  if (
    packet.transmissionSha256 !== control.transmissionSha256 ||
    packet.transmission.session.metadata?.consumerProjectionSha256 !==
      control.projectionReceiptSha256
  )
    throw new Error("Prepared carrier binding mismatch");
  if (["defining-v1", "scripted-v1"].includes(control.profile)) {
    const settings = packet.transmission.harnessControlledInputs.find(
      ({ id }) => id === "runner-settings",
    );
    if (
      !settings ||
      JSON.parse(settings.content).executionTimeoutMs !==
        control.deadline.executionTimeoutMs
    )
      throw new Error("Prepared execution deadline differs from carrier");
  }
  const profile = await preparedExecutionProfile(control.profile);
  if (profile.suite !== packet.transmission.suite)
    throw new Error("Prepared profile/suite mismatch");
  assertRegularPath(control.authorizationFile);
  const authorization = readContract(control.authorizationFile);
  assertProcessHostMembership(control.processHost);
  const result = await profile.execute({
    preparedSession: control.preparedSession,
    authorization,
    allowExternalModelCall: true,
    timeoutMs: control.deadline.executionTimeoutMs,
    evidenceLayout: control.evidenceLayout,
    signal,
  });
  const reference = deriveOutcomeReference({
    path: join(
      control.preparedSession,
      control.evidenceLayout === "evaluation-trial-v1"
        ? "result.json"
        : "run.json",
    ),
    profile: control.profile,
    transmissionSha256: control.transmissionSha256,
    evidenceLayout: control.evidenceLayout,
  });
  if (result.status !== reference.status)
    throw new Error("Execution return differs from sealed outcome");
  // Caller supplies a framework output location; prevent it from overwriting a
  // prepared record. The wrapper owns a fresh, separate consumer workspace.
  // Recheck after provider execution and directory creation. This narrows the
  // race window; it is not an OS guarantee against hostile concurrent mutation.
  assertConsumerOutput(input.workspace, absoluteOutput, workspaceRealPath);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  assertConsumerOutput(input.workspace, absoluteOutput, workspaceRealPath);
  writeFileSync(
    absoluteOutput,
    JSON.stringify({
      exit_code: reference.status === "completed" ? 0 : 1,
      final_message: JSON.stringify(reference),
      turns: 1,
    }),
    { flag: "wx" },
  );
  return reference;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [controlPath, inputPath, outputPath, ...extra] = process.argv.slice(2);
  if (!controlPath || !inputPath || !outputPath || extra.length)
    throw new Error("Usage: skill-up-custom-engine.js CONTROL INPUT OUTPUT");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, abort);
  try {
    await executeSkillUpBridge({
      controlPath,
      inputPath,
      outputPath,
      signal: controller.signal,
    });
  } finally {
    for (const signal of signals) process.off(signal, abort);
  }
}
