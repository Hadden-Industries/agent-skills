import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVALUATION_HOME_ROLES,
  initializeEvaluationHomes,
  inspectEvaluationHomes,
  withEvaluationHome,
} from "./evaluation-homes.js";

const SCHEMA_VERSION = 1;
const CHILD_CLOSE_TIMEOUT_MS = 1000;
const DEFAULT_MANAGER = Object.freeze({
  initializeEvaluationHomes,
  inspectEvaluationHomes,
  withEvaluationHome,
});
const VALUE_OPTIONS = Object.freeze([
  "--codex-command",
  "--codex-prefix-arg",
  "--confirm-root",
  "--role",
  "--root",
]);

class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
    this.code = "invalid-cli-usage";
  }
}

function usageError(message) {
  throw new CliUsageError(message);
}

function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    usageError("a command is required: inspect, initialize, or login");
  }
  const [command, ...tokens] = argv;
  if (!["inspect", "initialize", "login"].includes(command)) {
    usageError(`unknown command: ${String(command)}`);
  }

  const parsed = {
    command,
    root: null,
    confirmRoot: null,
    role: null,
    codexCommand: null,
    codexPrefixArguments: [],
    allowInteractiveLogin: false,
  };
  const observed = new Set();

  for (let index = 0; index < tokens.length; index += 1) {
    const option = tokens[index];
    if (option === "--allow-interactive-login") {
      if (observed.has(option)) {
        usageError(`${option} may be specified only once`);
      }
      observed.add(option);
      parsed.allowInteractiveLogin = true;
      continue;
    }
    if (!VALUE_OPTIONS.includes(option)) {
      usageError(`unknown option: ${String(option)}`);
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith("--")) {
      usageError(`${option} requires a value`);
    }
    index += 1;

    if (option === "--codex-prefix-arg") {
      parsed.codexPrefixArguments.push(value);
      continue;
    }
    if (observed.has(option)) {
      usageError(`${option} may be specified only once`);
    }
    observed.add(option);
    if (option === "--root") {
      parsed.root = value;
    } else if (option === "--confirm-root") {
      parsed.confirmRoot = value;
    } else if (option === "--role") {
      parsed.role = value;
    } else if (option === "--codex-command") {
      parsed.codexCommand = value;
    }
  }

  validateCommandArguments(parsed);
  return parsed;
}

function validateRoot(root) {
  if (typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root) {
    usageError("--root must be a normalized absolute path");
  }
}

function rejectLoginOnlyOptions(parsed) {
  if (
    parsed.role !== null ||
    parsed.codexCommand !== null ||
    parsed.codexPrefixArguments.length > 0 ||
    parsed.allowInteractiveLogin
  ) {
    usageError(`${parsed.command} does not accept login-only options`);
  }
}

function validateCommandArguments(parsed) {
  validateRoot(parsed.root);

  if (parsed.command === "inspect") {
    if (parsed.confirmRoot !== null) {
      usageError("inspect does not accept --confirm-root");
    }
    rejectLoginOnlyOptions(parsed);
    return;
  }

  if (parsed.confirmRoot === null || parsed.confirmRoot !== parsed.root) {
    usageError("--confirm-root must be present and identical to --root");
  }

  if (parsed.command === "initialize") {
    rejectLoginOnlyOptions(parsed);
    return;
  }

  if (!EVALUATION_HOME_ROLES.includes(parsed.role)) {
    usageError("--role must be preflight or execution");
  }
  if (
    typeof parsed.codexCommand !== "string" ||
    parsed.codexCommand.length === 0
  ) {
    usageError("--codex-command is required");
  }
  if (!parsed.allowInteractiveLogin) {
    usageError("--allow-interactive-login is required");
  }
}

function operationId() {
  return randomBytes(16).toString("hex");
}

function writeJson(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function unsafeClosure(exitObserved, closeObserved) {
  return {
    status: "unsafe",
    reasonCode: "shutdown-ambiguous",
    diagnostics: { exitObserved, closeObserved },
  };
}

function observeLoginChild(child) {
  return new Promise((resolvePromise) => {
    let settled = false;
    let exitObserved = false;
    let closeObserved = false;
    let exitCode = null;
    let exitSignal = null;
    let closeTimer = null;

    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (closeTimer !== null) {
        clearTimeout(closeTimer);
      }
      resolvePromise(value);
    };

    child.once("error", () => {
      settle({
        value: null,
        release: unsafeClosure(exitObserved, closeObserved),
      });
    });
    child.once("exit", (code, signal) => {
      exitObserved = true;
      exitCode = code;
      exitSignal = signal;
      closeTimer = setTimeout(() => {
        settle({
          value: null,
          release: unsafeClosure(exitObserved, closeObserved),
        });
      }, CHILD_CLOSE_TIMEOUT_MS);
    });
    child.once("close", (code, signal) => {
      closeObserved = true;
      if (!exitObserved) {
        settle({
          value: null,
          release: unsafeClosure(exitObserved, closeObserved),
        });
        return;
      }
      if (code !== exitCode || signal !== exitSignal) {
        settle({
          value: null,
          release: unsafeClosure(exitObserved, closeObserved),
        });
        return;
      }

      settle({
        value: {
          schemaVersion: SCHEMA_VERSION,
          command: "login",
          status: code === 0 ? "completed" : "failed",
          exitCode: code,
          exitSignal: signal,
        },
        release: {
          status: "safe",
          exitStatus: "observed",
          exitCode: code,
          exitSignal: signal,
          stdioStatus: "closed",
          protocolStatus: "not-applicable",
          terminationActions: [],
          descendantStatus: "none-observed",
        },
      });
    });
  });
}

async function executeLogin({ parsed, manager, environment, spawnProcess }) {
  const result = await manager.withEvaluationHome(
    {
      root: parsed.root,
      role: parsed.role,
      operationId: operationId(),
    },
    async (context) => {
      const child = spawnProcess(
        parsed.codexCommand,
        [
          ...parsed.codexPrefixArguments,
          "-c",
          'cli_auth_credentials_store="keyring"',
          "login",
        ],
        {
          shell: false,
          stdio: "inherit",
          env: { ...environment, ...context.environment },
        },
      );
      context.registerChild(child);
      return observeLoginChild(child);
    },
  );

  return { ...result, role: parsed.role };
}

function assertManagerPort(manager) {
  if (
    manager === null ||
    typeof manager !== "object" ||
    typeof manager.inspectEvaluationHomes !== "function" ||
    typeof manager.initializeEvaluationHomes !== "function" ||
    typeof manager.withEvaluationHome !== "function"
  ) {
    throw new TypeError("manager must implement the evaluation-home interface");
  }
}

export async function runEvaluationHomesCli({
  argv,
  environment = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  manager = DEFAULT_MANAGER,
  spawnProcess = spawn,
}) {
  try {
    const parsed = parseArguments(argv);
    assertManagerPort(manager);

    if (parsed.command === "inspect") {
      const inventory = await manager.inspectEvaluationHomes({
        root: parsed.root,
      });
      writeJson(stdout, inventory);
      return 0;
    }
    if (parsed.command === "initialize") {
      const inventory = await manager.initializeEvaluationHomes({
        root: parsed.root,
      });
      writeJson(stdout, inventory);
      return 0;
    }

    const result = await executeLogin({
      parsed,
      manager,
      environment,
      spawnProcess,
    });
    writeJson(stdout, result);
    return result.status === "completed" ? 0 : 1;
  } catch (error) {
    writeJson(stderr, {
      schemaVersion: SCHEMA_VERSION,
      error: {
        code:
          typeof error?.code === "string"
            ? error.code
            : error instanceof CliUsageError
              ? "invalid-cli-usage"
              : "evaluation-home-command-failed",
        message:
          typeof error?.message === "string"
            ? error.message
            : "evaluation-home command failed",
      },
    });
    return error instanceof CliUsageError ? 2 : 1;
  }
}

function isDirectInvocation() {
  return (
    typeof process.argv[1] === "string" &&
    resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  );
}

if (isDirectInvocation()) {
  runEvaluationHomesCli({ argv: process.argv.slice(2) })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      writeJson(process.stderr, {
        schemaVersion: SCHEMA_VERSION,
        error: {
          code: "unexpected-cli-failure",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      process.exitCode = 1;
    });
}
