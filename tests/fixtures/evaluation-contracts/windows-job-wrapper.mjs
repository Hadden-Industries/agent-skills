import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runProcessHost } from "../../../scripts/evaluation/process-host.js";
const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
const result = await runProcessHost(request);
writeFileSync(
  join(request.cwd, "wrapper-result.json"),
  JSON.stringify({ ...result, error: result.error?.message ?? null }),
);
