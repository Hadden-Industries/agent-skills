import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  assertTransmissionPacket,
  canonicalJsonBytes,
  sha256Hex,
} from "./runtime.js";

const MAXIMUM_NATIVE_PAYLOAD_BYTES = 8 * 1024 * 1024;
const CONVERSATION_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

function retainedBytes(directory, relativePath, run) {
  const bytes = readFileSync(join(directory, relativePath));
  const identity = run.artifacts?.[relativePath];
  if (
    identity?.byteLength !== bytes.length ||
    identity?.sha256 !== sha256Hex(bytes)
  ) {
    throw new Error(
      `Retained policy artifact identity mismatch: ${relativePath}`,
    );
  }
  return bytes;
}

/**
 * Inspect only the named, completed Antigravity 1.2.16 policy trial's user step
 * and single generation record. No ambient home discovery, model call or raw
 * private payload export occurs. This is a local observation, not a sealed
 * service-context receipt or evidence of semantic policy compliance.
 * Missing/changed native schemas throw; callers must treat them as unavailable.
 */
export async function inspectPolicyGenerationInput({
  preparedSession,
  conversationDatabase,
}) {
  if (
    typeof preparedSession !== "string" ||
    typeof conversationDatabase !== "string" ||
    !isAbsolute(preparedSession) ||
    !isAbsolute(conversationDatabase)
  ) {
    throw new Error(
      "Policy session and conversation database paths must be absolute",
    );
  }
  const run = JSON.parse(
    readFileSync(join(preparedSession, "run.json"), "utf8"),
  );
  const packet = JSON.parse(
    retainedBytes(preparedSession, "packet.json", run).toString("utf8"),
  );
  assertTransmissionPacket(packet);
  const transmission = packet.transmission;
  if (
    run.status !== "completed" ||
    run.transmissionSha256 !== packet.transmissionSha256 ||
    transmission.suite !== "committing-to-git" ||
    transmission.provider !== "google" ||
    transmission.transport !== "antigravity-cli" ||
    transmission.toolchain.version !== "1.2.16" ||
    transmission.session.metadata?.profile !== "policy-only"
  ) {
    throw new Error(
      "Generation inspection requires one completed Antigravity 1.2.16 policy trial",
    );
  }
  const users = transmission.harnessControlledInputs.filter(
    ({ role }) => role === "user",
  );
  if (
    users.length !== 1 ||
    users[0].encoding !== "utf8" ||
    users[0].byteLength === 0
  ) {
    throw new Error(
      "Generation inspection requires one nonempty UTF-8 policy input",
    );
  }
  const prompt = Buffer.from(users[0].content, "utf8");
  const transcript = retainedBytes(
    preparedSession,
    "outputs/transcript.jsonl",
    run,
  )
    .toString("utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const initializations = transcript.filter(({ event }) => event === "init");
  const conversationId = initializations[0]?.conversation_id;
  if (
    initializations.length !== 1 ||
    !CONVERSATION_ID.test(conversationId ?? "")
  ) {
    throw new Error(
      "Retained policy transcript requires one native conversation identity",
    );
  }
  const databaseState = lstatSync(conversationDatabase);
  if (
    !databaseState.isFile() ||
    databaseState.isSymbolicLink() ||
    databaseState.size > 128 * 1024 * 1024 ||
    basename(conversationDatabase) !== `${conversationId}.db` ||
    basename(realpathSync(conversationDatabase)) !== `${conversationId}.db`
  ) {
    throw new Error(
      "Explicit conversation database does not match the retained trial identity",
    );
  }
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(conversationDatabase, {
    readOnly: true,
    allowExtension: false,
  });
  try {
    database.exec("BEGIN");
    const user = database
      .prepare(
        "SELECT step_type, length(step_payload) AS bytes FROM steps WHERE idx=0 LIMIT 2",
      )
      .all();
    const generations = database
      .prepare(
        "SELECT idx, length(data) AS bytes FROM gen_metadata ORDER BY idx LIMIT 2",
      )
      .all();
    if (
      user.length !== 1 ||
      user[0].step_type !== 14 ||
      generations.length !== 1 ||
      generations[0].idx !== 0 ||
      [...user, ...generations].some(
        ({ bytes }) =>
          !Number.isSafeInteger(bytes) ||
          bytes < 1 ||
          bytes > MAXIMUM_NATIVE_PAYLOAD_BYTES,
      )
    ) {
      throw new Error(
        "Unsupported native policy generation record shape or payload size",
      );
    }
    const rawUser = Buffer.from(
      database.prepare("SELECT step_payload FROM steps WHERE idx=0").get()
        .step_payload,
    );
    const generation = Buffer.from(
      database.prepare("SELECT data FROM gen_metadata WHERE idx=0").get().data,
    );
    database.exec("COMMIT");
    const offset = generation.indexOf(
      prompt.subarray(0, Math.min(16, prompt.length)),
    );
    let prefixBytes = 0;
    if (offset >= 0) {
      while (
        prefixBytes < prompt.length &&
        generation[offset + prefixBytes] === prompt[prefixBytes]
      )
        prefixBytes += 1;
    }
    const rawUserContainsExactPrompt = rawUser.includes(prompt);
    const generationContainsExactPrompt = generation.includes(prompt);
    return {
      schemaVersion: 1,
      assessmentDisposition:
        rawUserContainsExactPrompt && generationContainsExactPrompt
          ? "input-preserved"
          : "input-loss",
      transmissionSha256: packet.transmissionSha256,
      preparedSessionId: transmission.session.preparedSessionId,
      conversationId,
      providerVersion: transmission.toolchain.version,
      policyInputProtocol:
        transmission.session.metadata.policyInputProtocol ?? "full-package-v1",
      promptBytes: prompt.length,
      promptSha256: sha256Hex(prompt),
      rawUserPayloadBytes: rawUser.length,
      rawUserPayloadSha256: sha256Hex(rawUser),
      rawUserContainsExactPrompt,
      generationBytes: generation.length,
      generationSha256: sha256Hex(generation),
      generationContainsExactPrompt,
      generationPromptPrefixBytes: prefixBytes,
      serviceContextReceipt: false,
      scope:
        "Exact local user and generation payload occurrence; no semantic grade or sealed service-context evidence",
    };
  } finally {
    database.close();
  }
}

/** Explicit read-only invocation; output is exclusively created outside the trial. */
async function main(tokens) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];
    if (
      !["--prepared-session", "--conversation-database", "--output"].includes(
        flag,
      ) ||
      Object.hasOwn(options, flag) ||
      !value ||
      !isAbsolute(value)
    ) {
      throw new Error(
        "Usage: inspect-policy-generation.js --prepared-session ABSOLUTE --conversation-database ABSOLUTE [--output ABSOLUTE]",
      );
    }
    options[flag] = value;
  }
  if (options["--output"] && options["--prepared-session"]) {
    const output = join(
      realpathSync(dirname(options["--output"])),
      basename(options["--output"]),
    );
    const pathWithinSession = relative(
      realpathSync(options["--prepared-session"]),
      output,
    );
    if (
      pathWithinSession !== ".." &&
      !pathWithinSession.startsWith(`..${sep}`) &&
      !isAbsolute(pathWithinSession)
    ) {
      throw new Error(
        "Inspection output must remain outside the immutable prepared trial",
      );
    }
  }
  const report = await inspectPolicyGenerationInput({
    preparedSession: options["--prepared-session"],
    conversationDatabase: options["--conversation-database"],
  });
  const bytes = canonicalJsonBytes(report);
  if (options["--output"])
    writeFileSync(options["--output"], bytes, { flag: "wx" });
  process.stdout.write(`${bytes.toString("utf8")}\n`);
  if (report.assessmentDisposition !== "input-preserved") process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `Policy input inspection unavailable: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
