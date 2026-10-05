import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createTestWorkspace } from "./temporary-workspace.mjs";

test("real test lifecycle", { timeout: 1000 }, async (t) => {
  const workspace = createTestWorkspace(t, "test-workspace-lifecycle-");
  writeFileSync(join(workspace.root, "payload.txt"), "recoverable fixture");
  process.stdout.write(`${JSON.stringify({ root: workspace.root })}\n`);
  if (process.argv[2] === "failure")
    throw new Error("intentional fixture failure");
  if (process.argv[2] === "cancelled") await new Promise(() => {});
});
