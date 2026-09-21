import { encodeWorkflowResult } from "../diagnostics/diagnosticContract.js";
import { workflowFailureResult } from "../diagnostics/workflowDiagnosticError.js";
import { Writable } from "node:stream";

export class WorkflowOutputError extends Error {
  constructor(result, cause) {
    super(
      "Workflow output delivery failed; inspect retained state before another mutation.",
      { cause },
    );
    this.name = "WorkflowOutputError";
    this.exitCode =
      result.disposition === "outcome-unknown"
        ? 4
        : result.commitState === "created"
          ? 3
          : 6;
  }
}

export async function writeWorkflowOutput(stdout, encoded) {
  try {
    if (stdout instanceof Writable) {
      await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        stdout.once("error", onError);
        stdout.write(encoded.output, (error) => {
          if (error) reject(error);
          else {
            stdout.removeListener("error", onError);
            resolve();
          }
        });
      });
    } else {
      stdout.write(encoded.output);
    }
  } catch (cause) {
    throw new WorkflowOutputError(encoded.result, cause);
  }
}

/** Read only helper tokens when syntax admission fails, never child arguments. */
export function requestedOutputFormat(arguments_) {
  const separator = arguments_.indexOf("--");
  const helperArguments =
    separator < 0 ? arguments_ : arguments_.slice(0, separator);
  let format = "json";
  for (let index = 0; index < helperArguments.length; index += 1) {
    const argument = helperArguments[index];
    if (argument === "--format") format = helperArguments[index + 1];
    else if (argument.startsWith("--format=")) format = argument.slice(9);
  }
  return format === "text" ? "text" : "json";
}

/** Execute once, encode once, then write outside the operation's catch boundary. */
export async function executeCommand(
  arguments_,
  { parse, execute, failureState = () => ({}), stdout = process.stdout },
) {
  let options;
  let result;
  try {
    options = parse(arguments_);
    result = await execute(options);
  } catch (caught) {
    result = workflowFailureResult(caught, {
      transaction: options?.transactionPath ?? null,
      state: failureState(options),
    });
  }
  const encoded = encodeWorkflowResult(
    result,
    options?.format ?? requestedOutputFormat(arguments_),
  );
  await writeWorkflowOutput(stdout, encoded);
  return encoded.result.exitCode;
}
