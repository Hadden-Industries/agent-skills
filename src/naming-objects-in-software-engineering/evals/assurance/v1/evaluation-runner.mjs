import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  namingSchedule,
  prepareNamingSession,
  executePreparedNamingSession,
} from "./profile.mjs";

export { namingSchedule, prepareNamingSession, executePreparedNamingSession };

async function main(args) {
  const [operation, inputPath] = args;
  if (args.length !== 2 || !["schedule", "prepare", "run"].includes(operation))
    throw new Error(
      "Usage: evaluation-runner.mjs schedule|prepare|run REQUEST.json",
    );
  const request = JSON.parse(readFileSync(inputPath, "utf8"));
  const result =
    operation === "schedule"
      ? namingSchedule()
      : operation === "prepare"
        ? await prepareNamingSession(request)
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
