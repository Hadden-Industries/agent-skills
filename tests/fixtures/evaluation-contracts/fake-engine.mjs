import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (
  input.messages?.[0]?.content !==
  "Reply with the literal qualification marker."
) {
  throw new Error("Unexpected consumer input");
}
if (
  process.env.OPENAI_API_KEY ||
  process.env.ANTHROPIC_API_KEY ||
  process.env.SKILL_UP_CONFIG
) {
  throw new Error("Ambient authority reached the fake engine");
}
mkdirSync(dirname(process.argv[3]), { recursive: true });
writeFileSync(
  process.argv[3],
  JSON.stringify({
    exit_code: process.argv[4] === "error" ? 1 : 0,
    final_message:
      process.argv[4] === "wrong-marker"
        ? "incorrect-output"
        : "qualification-marker",
    turns: 1,
    artifacts: {
      files: [{ name: "observed-input.json", content: JSON.stringify(input) }],
    },
  }),
);
