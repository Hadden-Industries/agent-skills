import {
  createPublicationCommandRunner,
  commandFailure,
} from "./publicationCommands.js";
import { projectTransportObservation } from "./transportIdentity.js";
import { observeNativeTransport } from "./nativeTransportObservation.js";

/** Worker protocol never returns native stdout, stderr, credentials or exceptions. */
export async function runTransportObservationWorker({
  stdin = process.stdin,
  stdout = process.stdout,
} = {}) {
  let result = { state: "unavailable", reason: "invalid-worker-input" };
  try {
    let input = "";
    for await (const chunk of stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 16384) throw new Error("Input limit.");
    }
    const binding = JSON.parse(input);
    if (
      typeof binding.repositoryRoot === "string" &&
      binding.repositoryRoot.length < 4096
    )
      result = await observeNativeTransport(binding);
  } catch {
    /* Fixed public result; raw exceptions could contain a secret. */
  }
  stdout.write(`${JSON.stringify(projectTransportObservation(result))}\n`);
  return 0;
}

/** The parent receives only projected evidence from a bounded, isolated worker. */
export function observeTransportInWorker(
  binding,
  entrypoint,
  runCommand = createPublicationCommandRunner(),
) {
  if (!entrypoint)
    return { state: "unavailable", reason: "worker-unavailable" };
  try {
    const response = runCommand(
      process.execPath,
      [entrypoint, "--internal-transport-observation"],
      {
        cwd: binding.repositoryRoot,
        input: JSON.stringify({
          repositoryRoot: binding.repositoryRoot,
          repository: binding.repository,
          pushUrl: binding.pushUrl,
        }),
        operation: "transport-observation-worker",
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 16384,
      },
    );
    if (response.status !== 0)
      return { state: "unavailable", reason: "worker-unavailable" };
    return projectTransportObservation(JSON.parse(response.stdout));
  } catch (error) {
    return {
      state: "unavailable",
      reason: "worker-unavailable",
      commandFailure: commandFailure(error),
    };
  }
}
