import { spawnSync } from "node:child_process";

/** A non-executed operation is neither an authentication failure nor a push rejection. */
export class PublicationCommandError extends Error {
  constructor(code, operation, { executed = false, ruleId = null } = {}) {
    super("Publication observation could not establish its prerequisite.");
    this.code = code;
    this.operation = operation;
    this.executed = executed;
    this.ruleId = ruleId;
  }
}

/** Only fixed operation identifiers and native rule identifiers leave this boundary. */
export function commandFailure(error) {
  if (
    !/^COMMAND_(GUARD_DENIED|GUARD_UNAVAILABLE|UNAVAILABLE|FAILED)$/u.test(
      error?.code ?? "",
    )
  )
    return null;
  return {
    code: error.code,
    operation: /^[a-z][a-z0-9-]{0,80}$/u.test(error.operation ?? "")
      ? error.operation
      : "publication-observation",
    executed: error.executed === true,
    ruleId: /^[a-z0-9_.:-]{1,160}$/iu.test(error.ruleId ?? "")
      ? error.ruleId
      : null,
  };
}

function quoted(argument) {
  // This is a classifier input, never a shell command. Quoting is deliberately
  // conservative and preserves the exact argv represented to the native guard.
  if (typeof argument !== "string" || /[\r\n\0]/u.test(argument))
    throw new Error("Invalid observation argument.");
  return /^[a-zA-Z0-9_./:=@,+-]+$/u.test(argument)
    ? argument
    : `'${argument.replaceAll("'", "'\\''")}'`;
}

function classify(command, { cwd, env }) {
  return spawnSync("dcg", ["test", "--format", "json", command], {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 64 * 1024,
  });
}

/**
 * Native DCG owns classification. A denial or unavailable classifier latches
 * this observation session closed: callers cannot try another command as a fallback.
 * The host still guards the outer invocation; that denial produces no helper output.
 */
export function createPublicationCommandRunner({
  classifyCommand = classify,
  launch = spawnSync,
} = {}) {
  let stopped = null;
  return (
    executable,
    args,
    { operation = "publication-observation", ...options } = {},
  ) => {
    if (stopped) throw stopped;
    let response;
    let decision;
    try {
      response = classifyCommand([executable, ...args].map(quoted).join(" "), {
        cwd: options.cwd,
        env: options.env ?? process.env,
      });
      decision = JSON.parse(response.stdout);
      if (!decision || typeof decision !== "object" || Array.isArray(decision))
        throw new Error("Invalid guard response.");
    } catch {
      stopped = new PublicationCommandError(
        "COMMAND_GUARD_UNAVAILABLE",
        operation,
      );
      throw stopped;
    }
    if (
      !response.error &&
      response.status === 1 &&
      decision.schema_version === 1 &&
      decision.decision === "deny"
    ) {
      stopped = new PublicationCommandError("COMMAND_GUARD_DENIED", operation, {
        ruleId: decision.rule_id ?? decision.rule ?? null,
      });
      throw stopped;
    }
    if (
      response.error ||
      response.status !== 0 ||
      decision.schema_version !== 1 ||
      decision.decision !== "allow"
    ) {
      stopped = new PublicationCommandError(
        "COMMAND_GUARD_UNAVAILABLE",
        operation,
      );
      throw stopped;
    }
    let result;
    try {
      result = launch(executable, args, {
        ...options,
        windowsHide: true,
        timeout: options.timeout ?? 15000,
        maxBuffer: options.maxBuffer ?? 1024 * 1024,
      });
    } catch {
      throw new PublicationCommandError("COMMAND_UNAVAILABLE", operation);
    }
    if (result.error)
      throw new PublicationCommandError("COMMAND_UNAVAILABLE", operation, {
        executed: result.pid > 0,
      });
    return result;
  };
}
