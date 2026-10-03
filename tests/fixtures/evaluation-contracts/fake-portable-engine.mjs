import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (input.messages?.length !== 1 || input.messages[0].role !== "user")
  throw new Error("Expected one initial user message");
mkdirSync(dirname(process.argv[3]), { recursive: true });
writeFileSync(
  join(dirname(process.argv[3]), "observed-input.json"),
  JSON.stringify(input),
);
writeFileSync(
  process.argv[3],
  JSON.stringify({
    exit_code: 0,
    final_message: "portable-transport-ok",
    turns: 1,
  }),
);
