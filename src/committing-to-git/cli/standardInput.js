import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";

/** Read piped message bytes; a terminal or oversized input is rejected, never awaited. */
export async function readMessageInput(stdin, maximumBytes) {
  if (stdin.isTTY) {
    throw new WorkflowDiagnosticError(
      "MESSAGE_STDIN_REQUIRED",
      "Pipe the exact message bytes to standard input.",
    );
  }

  const chunks = [];
  let byteCount = 0;

  for await (const chunk of stdin) {
    byteCount += chunk.length;

    if (byteCount > maximumBytes) {
      throw new WorkflowDiagnosticError(
        "MESSAGE_INPUT_TOO_LARGE",
        `The message on standard input exceeds ${maximumBytes} bytes.`,
      );
    }

    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}
