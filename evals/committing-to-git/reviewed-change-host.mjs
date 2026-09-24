/** Offline measurement of annotated native host evidence; this module never launches an agent or publishes. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalJsonBytes,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";
import { COMMAND_ARGUMENTS } from "../../src/committing-to-git/cli/commandArguments.js";

const definition = JSON.parse(
  readFileSync(new URL("./reviewed-change-host.json", import.meta.url), "utf8"),
);
export const HOST_SAFETY_EXPECTATIONS = Object.freeze([
  ...definition.safetyExpectations,
]);
const kinds = new Set(definition.observedKinds);
const publicationOperations = new Set([
  "workflow preflight",
  "workflow publish",
]);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Union overlapping intervals; nested helper/shell time must not be subtracted twice. */
function occupiedTime(events) {
  let total = 0,
    end = 0;
  for (const event of [...events].sort((a, b) => a.startMs - b.startMs)) {
    total += Math.max(0, event.endMs - Math.max(end, event.startMs));
    end = Math.max(end, event.endMs);
  }
  return total;
}

/** Validate observed coverage, retain unknowns, and keep grader safety verdicts separate from cost. */
export function measureReviewedChangeHostRun(record) {
  requireValue(
    record?.schemaVersion === 1,
    "Unsupported host observation version.",
  );
  const selected = definition.cases.find(({ id }) => id === record.caseId);
  requireValue(selected, "Unknown host case.");
  requireValue(
    Number.isFinite(record.wallTimeMs) && record.wallTimeMs >= 0,
    "Invalid wall time.",
  );
  for (const key of ["host", "hostVersion", "model", "effort", "hisewVersion"])
    requireValue(nonempty(record.identity?.[key]), `Missing ${key} identity.`);
  requireValue(
    record.identity.host === definition.host,
    "Host observations must come from Codex Desktop.",
  );
  for (const key of ["helperSha256", "skillBundleSha256"])
    requireValue(
      /^[0-9a-f]{64}$/u.test(record.identity[key]),
      `Invalid ${key}.`,
    );
  requireValue(
    Array.isArray(record.observedKinds) &&
      new Set(record.observedKinds).size === record.observedKinds.length &&
      record.observedKinds.every((kind) => kinds.has(kind)),
    "Invalid observed coverage.",
  );
  requireValue(Array.isArray(record.events), "Events must be an array.");
  const identifiers = new Set();
  for (const event of record.events) {
    requireValue(
      nonempty(event.id) && !identifiers.has(event.id),
      "Missing or duplicate event identity.",
    );
    identifiers.add(event.id);
    requireValue(
      record.observedKinds.includes(event.kind) && nonempty(event.evidence),
      "Event lacks covered kind or native evidence reference.",
    );
    requireValue(
      Number.isFinite(event.startMs) &&
        Number.isFinite(event.endMs) &&
        event.startMs >= 0 &&
        event.endMs >= event.startMs &&
        event.endMs <= record.wallTimeMs,
      "Invalid event interval.",
    );
    if (event.kind === "output")
      requireValue(
        Number.isSafeInteger(event.bytes) && event.bytes >= 0,
        "Invalid output byte count.",
      );
    if (event.kind === "helper")
      requireValue(
        nonempty(event.operation) &&
          Object.hasOwn(COMMAND_ARGUMENTS, event.operation),
        "Helper event requires a known public operation.",
      );
    if (event.kind === "reference-read")
      requireValue(
        nonempty(event.resource),
        "Reference read requires a resource identity.",
      );
  }
  const events = (kind) => record.events.filter((event) => event.kind === kind);
  const known = (kind, calculate) =>
    record.observedKinds.includes(kind) ? calculate(events(kind)) : null;
  const durationSum = (items) =>
    items.reduce((sum, event) => sum + event.endMs - event.startMs, 0);
  const safety = HOST_SAFETY_EXPECTATIONS.map((key) => {
    const finding = record.safety?.[key];
    if (finding === undefined) return "unknown";
    requireValue(
      ["pass", "fail", "unknown"].includes(finding.verdict) &&
        nonempty(finding.evidence),
      `Invalid safety finding ${key}.`,
    );
    return finding.verdict;
  });
  const localHelperCalls = known(
    "helper",
    (items) =>
      items.filter(({ operation }) => !publicationOperations.has(operation))
        .length,
  );
  const accountedKinds = new Set([
    "shell",
    "helper",
    "hosted-wait",
    "host-overhead",
  ]);
  return {
    schemaVersion: 1,
    observationSha256: sha256Hex(canonicalJsonBytes(record)),
    caseId: record.caseId,
    identity: record.identity,
    wallTimeMs: record.wallTimeMs,
    toolRoundTrips: known("tool", (items) => items.length),
    shellInvocations: known("shell", (items) => items.length),
    shellExecutionMs: known("shell", durationSum),
    referenceReads: known("reference-read", (items) => items.length),
    outputBytes: known("output", (items) =>
      items.reduce((sum, event) => sum + event.bytes, 0),
    ),
    helperExecutionMs: known("helper", durationSum),
    helperOccupiedMs: known("helper", occupiedTime),
    hostedWaitMs: known("hosted-wait", occupiedTime),
    hostOverheadMs: known("host-overhead", occupiedTime),
    unattributedWallTimeMs:
      record.wallTimeMs -
      occupiedTime(
        record.events.filter(({ kind }) => accountedKinds.has(kind)),
      ),
    unattributedTimeCoverage: {
      accountedKinds: [...accountedKinds].filter((kind) =>
        record.observedKinds.includes(kind),
      ),
      missingKinds: [...accountedKinds].filter(
        (kind) => !record.observedKinds.includes(kind),
      ),
    },
    localHelperCalls,
    localHelperBudget: selected.localHelperBudget,
    costDisposition:
      localHelperCalls === null
        ? "unknown"
        : localHelperCalls <= selected.localHelperBudget
          ? "within-budget"
          : "over-budget",
    safetyDisposition: safety.includes("fail")
      ? "failed"
      : safety.includes("unknown")
        ? "incomplete"
        : "passed",
    limitations: [
      "Safety verdicts are supplied by an independent grader with native evidence references; measurement does not authenticate them.",
      "Unattributed wall time is not a measurement of model, hook or host overhead.",
      "Counts describe only explicitly covered event kinds; retained evidence must justify coverage.",
    ],
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    requireValue(
      args.length === 2 && args[0] === "--record",
      "Usage: node reviewed-change-host.mjs --record ABSOLUTE_OBSERVATION_JSON",
    );
    process.stdout.write(
      `${JSON.stringify(measureReviewedChangeHostRun(JSON.parse(readFileSync(args[1], "utf8"))), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
