import { commandOptions } from "./commandArguments.js";
import {
  requestedOutputFormat,
  WorkflowOutputError,
  writeWorkflowOutput,
} from "./commandExecution.js";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  DIAGNOSTIC_CONTRACT_VERSION,
  DISPOSITION_EXIT_CODES,
  createWorkflowResult,
  encodeWorkflowResult,
} from "../diagnostics/diagnosticContract.js";

const COMMANDS = new Map([
  [
    "workflow prepare",
    [
      () => import("../workflow/prepareWorkflow.js"),
      "runPrepareWorkflowCommand",
    ],
  ],
  [
    "workflow extend",
    [
      () => import("../workflow/extendReviewWorkflow.js"),
      "runExtendReviewCommand",
    ],
  ],
  [
    "workflow review-next",
    [() => import("../workflow/reviewNextWorkflow.js"), "runReviewNextCommand"],
  ],
  [
    "workflow resume",
    [
      () => import("../workflow/resumePreparationWorkflow.js"),
      "runResumePreparationCommand",
    ],
  ],
  [
    "workflow promote",
    [
      () => import("../workflow/promoteDraftWorkflow.js"),
      "runPromoteDraftCommand",
    ],
  ],
  [
    "workflow check",
    [
      () => import("../workflow/runCheckWorkflow.js"),
      "runCheckWorkflowCommand",
    ],
  ],
  [
    "workflow check-detail",
    [
      () => import("../workflow/checkDetailWorkflow.js"),
      "runCheckDetailCommand",
    ],
  ],
  [
    "workflow commit",
    [
      () => import("../workflow/createCommitWorkflow.js"),
      "runCreateCommitCommand",
    ],
  ],
  [
    "workflow verify",
    [
      () => import("../workflow/createCommitWorkflow.js"),
      "runRetryVerificationCommand",
    ],
  ],
  [
    "workflow report-detail",
    [
      () => import("../workflow/reportDetailWorkflow.js"),
      "runReportDetailCommand",
    ],
  ],
  [
    "workflow publish",
    [() => import("../workflow/publishWorkflow.js"), "runPublishCommand"],
  ],
  [
    "workflow recover",
    [
      () => import("../workflow/recoverTransactionWorkflow.js"),
      "runRecoverTransactionCommand",
    ],
  ],
  [
    "workflow cleanup",
    [
      () => import("../workflow/recoverTransactionWorkflow.js"),
      "runCleanupTransactionCommand",
    ],
  ],
  [
    "message check",
    [
      () => import("../workflow/checkMessageWorkflow.js"),
      "runCheckMessageCommand",
    ],
  ],
  [
    "message finalize",
    [
      () => import("../workflow/finalizeMessageWorkflow.js"),
      "runFinalizeMessageCommand",
    ],
  ],
]);

const COMMAND_HELP = new Map([
  [
    "workflow prepare",
    `Allocates one helper-owned transaction, validates literal scope and evidence
policy, and records the exact snapshot. Path scope accepts literal repeatable
selectors or one --scope-file. JSON is the default output format.
`,
  ],
  [
    "workflow resume",
    `Continues only a reversible preparation from its persisted inputs. Scope,
evidence, policy, and mutation inputs cannot be reconstructed or overridden.
`,
  ],
  [
    "workflow extend",
    `Extends one unchanged route: concise, phase: evidence-ready snapshot only.
Already-extended transactions follow their returned nextAction instead.
Evidence uncertainty consumes only the
fixed evidence-plan-input.json. Semantic structure carries existing evidence
forward without accepting or reading a new plan.
`,
  ],
  [
    "workflow review-next",
    `Returns exactly one complete, bounded, digest-verified review packet from the
current transaction. The helper advances only through its returned opaque
cursor, safely replays the latest delivery, and records review completion.
A completed zero-packet review returns packet null and its authoring action
idempotently without changing the transaction.
`,
  ],
  [
    "workflow promote",
    `Promotes an unchanged draft after complete head, tree, scope, and staged-state
comparison. It installs only the exact recorded tree and preserves review and
message state.
`,
  ],
  [
    "message check",
    `Checks the exact fixed transaction-local message-input.txt and records those
unchanged bytes as the latest canonical message revision. With nextAction:
author-message, accepts a concise subject or extended multi-section message
when semanticStructureRequired is false. With nextAction: author-content,
use message finalize instead. The input is consumed only after durable success.
Arbitrary message-file paths are rejected.
`,
  ],
  [
    "message finalize",
    `Finalizes only the fixed transaction-local content.json for an extended
transaction. Newly required evidence returns as a bounded delta queue.
`,
  ],
  [
    "workflow check",
    `Runs one executable directly, without a shell, in the current worktree. The
helper records the actual child outcome, bounded output evidence, and selected
scope stability in the transaction. Success output remains private; bounded
diagnostics are shown only when the check does not pass.
`,
  ],
  [
    "workflow check-detail",
    `Returns one bounded page from a retained helper-owned check-output segment.
The command accepts no arbitrary path and verifies the segment's recorded size
and digest before returning UTF-8 or base64 content.
`,
  ],
  [
    "workflow commit",
    `After exact commit authorization, creates at most one signed commit from the
recorded tree and approved bytes, consumes only helper-witnessed check
receipts, verifies the exact OID, and records one bounded report. Every
non-passing receipt requires exact acknowledgement. An unknown outcome
requires recovery and is never replayed.
`,
  ],
  [
    "workflow verify",
    `Retries or reclassifies signature verification only for the exact recorded
commit OID. It never creates or replaces a commit.
`,
  ],
  [
    "workflow report-detail",
    `Returns one bounded page of a durable workspace observation. A completed page,
including a cursorless one-page result, replays until --refresh explicitly
starts a new observation.
`,
  ],
  [
    "workflow publish",
    `After separate push authorization, publishes only the exact reported commit.
Every attempt is journaled; no failed or unknown publication is retried
automatically.
A known rejection with phase: reported permits a separately authorized new
attempt, including another destination, without --retry-after-attempt.
`,
  ],
  [
    "workflow recover",
    `Observes only the exact journaled transaction and never replays commit or push.
The exceptional resolution requires explicit confirmation that the relevant
Git, signing, and hook process ended or that the host restarted.
`,
  ],
  [
    "workflow cleanup",
    `Compacts only known-safe helper-owned artifacts beneath the exact transaction.
Pending or unknown mutations are never removed.
`,
  ],
]);

function commandHelp(command) {
  const options = Object.entries(commandOptions(command))
    .map(([name, option]) => `  --${name} ${option.description ?? ""}`)
    .join("\n");
  return `Usage: commitWorkflow.mjs ${command} [options]${command === "workflow check" ? " -- <executable> [arguments...]" : ""}

${COMMAND_HELP.get(command)}
Options:
${options}
  --help, -h  Show this help as the sole command argument; performs no workflow.
Options are single-use unless marked repeatable. Value options take one value.
Unspecified optional selectors, cursors, overrides, and retries are absent.

Exit status:
${Object.entries(DISPOSITION_EXIT_CODES)
  .map(([disposition, code]) => `  ${code}  ${disposition}`)
  .join("\n")}
See references/diagnostics.md for state, recovery, and stream semantics.
`;
}

const HELP = `Commit workflow

Usage:
  commitWorkflow.mjs --version
  commitWorkflow.mjs workflow prepare [options]
  commitWorkflow.mjs workflow resume [options]
  commitWorkflow.mjs workflow extend [options]
  commitWorkflow.mjs workflow review-next [options]
  commitWorkflow.mjs workflow promote [options]
  commitWorkflow.mjs message check [options]
  commitWorkflow.mjs message finalize [options]
  commitWorkflow.mjs workflow check [options] -- <executable> [arguments...]
  commitWorkflow.mjs workflow check-detail [options]
  commitWorkflow.mjs workflow commit [options]
  commitWorkflow.mjs workflow verify [options]
  commitWorkflow.mjs workflow report-detail [options]
  commitWorkflow.mjs workflow publish [options]
  commitWorkflow.mjs workflow recover [options]
  commitWorkflow.mjs workflow cleanup [options]

JSON is the default machine contract. --format text is for direct human use.
Run a command with --help to inspect its options.
`;

async function writeInvalidResult(result, args, stdout) {
  const encoded = encodeWorkflowResult(result, requestedOutputFormat(args));
  await writeWorkflowOutput(stdout, encoded);
  return encoded.result.exitCode;
}

export async function dispatchCommitWorkflow(
  args,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  if (args.length === 1 && args[0] === "--version") {
    // The self-contained bundle is the implementation, including its dependencies.
    // Hash installed bytes rather than trusting a caller's repository metadata.
    const digest = createHash("sha256")
      .update(readFileSync(new URL(import.meta.url)))
      .digest("hex");
    await writeWorkflowOutput(stdout, {
      result: { disposition: "succeeded", commitState: "unknown" },
      output: `${JSON.stringify({
        implementation: { algorithm: "sha256", digest },
        diagnosticContractVersion: DIAGNOSTIC_CONTRACT_VERSION,
      })}\n`,
    });
    return 0;
  }
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    await writeWorkflowOutput(stdout, {
      result: { disposition: "succeeded", commitState: "unknown" },
      output: HELP,
    });
    return 0;
  }

  const command = args.slice(0, 2).join(" ");
  const route = COMMANDS.get(command);

  if (!route) {
    const label = command || "(none)";
    const result = createWorkflowResult({
      disposition: "invalid-input",
      status: "invalid",
      code: "UNKNOWN_COMMAND",
      message: `Unknown command: ${label}. Run commitWorkflow.mjs --help for usage.`,
      recovery: {
        kind: "correct-input",
        requiredInputs: [],
        commands: [{ arguments: ["--help"] }],
        automatic: false,
      },
    });

    return writeInvalidResult(result, args, stdout);
  }

  if (args.length === 3 && ["-h", "--help"].includes(args[2])) {
    await writeWorkflowOutput(stdout, {
      result: { disposition: "succeeded", commitState: "unknown" },
      output: commandHelp(command),
    });
    return 0;
  }

  const [loadCommand, handlerName] = route;
  const commandModule = await loadCommand();

  return commandModule[handlerName](args.slice(2), { stdout, stderr });
}

export async function runCommitWorkflowCli(
  args,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    return await dispatchCommitWorkflow(args, { stdout, stderr });
  } catch (caught) {
    if (caught instanceof WorkflowOutputError) {
      try {
        stderr.write(
          "OUTPUT_DELIVERY_FAILED: Inspect retained transaction evidence; do not replay the mutation.\n",
        );
      } catch {
        /* There is no reliable output channel. */
      }
      return caught.exitCode;
    }
    const result = createWorkflowResult({
      disposition: "internal-failure",
      status: "failed",
      code: "COMMAND_DISPATCH_FAILED",
      message:
        "The command could not complete its response. Inspect the transaction state before attempting another mutation.",
      recovery: {
        kind: "inspect-state",
        requiredInputs: ["transaction handle, if one was returned"],
        commands: [],
        automatic: false,
      },
    });

    return writeInvalidResult(result, args, stdout);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  process.exitCode = await runCommitWorkflowCli(process.argv.slice(2));
}
