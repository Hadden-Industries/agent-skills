import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  namingSchedule,
  prepareNamingSession,
  executePreparedNamingSession,
  SKILL_NAME,
} from "./profile.mjs";
import {
  prepareSessionDispatch,
  retainSessionDispatch,
  dispatchPreparedSession,
} from "../../../../../scripts/evaluation/session-dispatch.js";

export { namingSchedule, prepareNamingSession, executePreparedNamingSession };

async function main(args) {
  const [operation, inputPath] = args;
  if (args.length !== 2 || !["schedule", "prepare", "run"].includes(operation))
    throw new Error(
      "Usage: evaluation-runner.mjs schedule|prepare|run REQUEST.json",
    );
  const request = JSON.parse(readFileSync(inputPath, "utf8"));
  if (operation === "prepare") {
    if (
      request.executionMode !== undefined &&
      request.consumerProjectionSha256 !== undefined
    )
      throw new Error(
        "Execution mode cannot be combined with a caller-supplied carrier digest",
      );
    const carrier = prepareSessionDispatch({
      executionMode: request.executionMode ?? "direct",
      repositoryRoot: path.resolve(import.meta.dirname, "../../../../.."),
      skillName: SKILL_NAME,
      caseId: request.caseId,
      executionTimeoutMs: request.timeoutMs,
    });
    const result = await prepareNamingSession({
      ...request,
      consumerProjectionSha256:
        carrier?.projectionReceiptSha256 ?? request.consumerProjectionSha256,
    });
    const packet = JSON.parse(
      readFileSync(path.join(request.destination, "packet.json")),
    );
    retainSessionDispatch({
      preparedSession: request.destination,
      carrier,
      packet,
    });
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (operation === "run") {
    if (request.authorizationFile !== undefined) {
      if (request.authorization !== undefined)
        throw new Error("Choose one authorization source");
      const result = await dispatchPreparedSession({
        ...request,
        direct: executePreparedNamingSession,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
      return;
    }
    const packet = JSON.parse(
      readFileSync(path.join(request.preparedSession, "packet.json")),
    );
    if (
      packet.transmission.session.metadata?.consumerProjectionSha256 !==
      undefined
    )
      throw new Error(
        "Consumer-bound sessions require authorizationFile dispatch; direct fallback is forbidden",
      );
  }
  const result =
    operation === "schedule"
      ? namingSchedule()
      : await executePreparedNamingSession(request);
  process.stdout.write(JSON.stringify(result) + "\n");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
}
