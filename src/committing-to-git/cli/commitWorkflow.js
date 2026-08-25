import { readFileSync } from "node:fs";

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
    `Usage: commitWorkflow.mjs workflow prepare --mode <actual|draft> --scope <staged|full|paths> (--evidence <reuse|message|review> --basis <kind> | --evidence-plan <file>) [options]

Allocates one helper-owned transaction, validates literal scope and evidence
policy, and records the exact snapshot. Path scope accepts literal repeatable
selectors or one --scope-file. JSON is the default output format.

Exit status:
  0  Preparation reached evidence-ready or review-pending.
  1  Repository state stopped safely or preparation is resumable.
  2  Input, policy, capability, selector, or execution failure.
`,
  ],
  [
    "workflow resume",
    `Usage: commitWorkflow.mjs workflow resume --transaction <transaction.json> [--format <json|text>]

Continues only a reversible preparation from its persisted inputs. Scope,
evidence, policy, and mutation inputs cannot be reconstructed or overridden.
`,
  ],
  [
    "workflow extend",
    `Usage: commitWorkflow.mjs workflow extend --transaction <transaction.json> --reason <evidence-uncertainty|semantic-structure-required> [--format <json|text>]

Extends one unchanged concise snapshot. Evidence uncertainty consumes only the
fixed evidence-plan-input.json. Semantic structure carries existing evidence
forward without accepting or reading a new plan.
`,
  ],
  [
    "workflow review-next",
    `Usage: commitWorkflow.mjs workflow review-next --transaction <transaction.json> [--cursor <opaque-cursor>] [--format <json|text>]

Returns exactly one complete, bounded, digest-verified review packet from the
current transaction. The helper advances only through its returned opaque
cursor, safely replays the latest delivery, and records review completion.
`,
  ],
  [
    "workflow promote",
    `Usage: commitWorkflow.mjs workflow promote --transaction <transaction.json> [--format <json|text>]

Promotes an unchanged draft after complete head, tree, scope, and staged-state
comparison. It installs only the exact recorded tree and preserves review and
message state.
`,
  ],
  [
    "message check",
    `Usage: commitWorkflow.mjs message check --transaction <transaction.json> [--format <json|text>]

Checks the exact fixed transaction-local message-input.txt and records those
unchanged bytes as the latest canonical concise message revision. The input is
consumed only after durable success. Arbitrary message-file paths are rejected.
`,
  ],
  [
    "message finalize",
    `Usage: commitWorkflow.mjs message finalize --transaction <transaction.json> [--format <json|text>]

Finalizes only the fixed transaction-local content.json for an extended
transaction. Newly required evidence returns as a bounded delta queue.
`,
  ],
  [
    "workflow check",
    `Usage: commitWorkflow.mjs workflow check --transaction <transaction.json> [--label <description>] [--working-directory <repository-relative-directory>] [--timeout-ms <milliseconds>] [--retry-after-attempt <receipt-id>] [--format <json|text>] -- <executable> [arguments...]

Runs one executable directly, without a shell, in the current worktree. The
helper records the actual child outcome, bounded output evidence, and selected
scope stability in the transaction. Success output remains private; bounded
diagnostics are shown only when the check does not pass.

Exit status:
  0  The child passed and the selected scope remained stable.
  1  The child did not pass or the selected scope changed.
  2  Input, policy, capability, or pre-launch execution failure.
  4  The child outcome is unknown and requires recovery.
`,
  ],
  [
    "workflow check-detail",
    `Usage: commitWorkflow.mjs workflow check-detail --transaction <transaction.json> --receipt <receipt-id> --stream <stdout|stderr> --segment <head|tail> [--offset <bytes>] [--format <json|text>]

Returns one bounded page from a retained helper-owned check-output segment.
The command accepts no arbitrary path and verifies the segment's recorded size
and digest before returning UTF-8 or base64 content.
`,
  ],
  [
    "workflow commit",
    `Usage: commitWorkflow.mjs workflow commit --transaction <transaction.json> [--message <subject>] [--verification <required|advisory|skipped>] [--acknowledge-failed-check <receipt-id> ...] [--retain-review-artifacts] [--retain-process-logs] [--format <json|text>]

After exact commit authorization, creates at most one signed commit from the
recorded tree and approved bytes, consumes only helper-witnessed check
receipts, verifies the exact OID, and records one bounded report. Every
non-passing receipt requires exact acknowledgement. An unknown outcome
requires recovery and is never replayed.

Exit status:
  0  Matching commit and policy-permitted report completed.
  1  Git durably did not create a commit or repository state stopped safely.
  2  Input or pre-journal failure.
  3  A known commit is blocked by comparison, verification, or reporting.
  4  Commit outcome is unknown and requires recovery.
`,
  ],
  [
    "workflow verify",
    `Usage: commitWorkflow.mjs workflow verify --transaction <transaction.json> [--verification <required|advisory|skipped>] [--format <json|text>]

Retries or reclassifies signature verification only for the exact recorded
commit OID. It never creates or replaces a commit.
`,
  ],
  [
    "workflow report-detail",
    `Usage: commitWorkflow.mjs workflow report-detail --transaction <transaction.json> [--cursor <cursor> | --refresh] [--format <json|text>]

Returns one bounded page of a durable workspace observation. A completed page,
including a cursorless one-page result, replays until --refresh explicitly
starts a new observation.
`,
  ],
  [
    "workflow publish",
    `Usage: commitWorkflow.mjs workflow publish --transaction <transaction.json> --remote <name> --destination <refs/heads/name> [--retry-after-attempt <attempt-id>] [--format <json|text>]

After separate push authorization, publishes only the exact reported commit.
Every attempt is journaled; no failed or unknown publication is retried
automatically.

Exit status:
  0  Push success was witnessed or a matching remote OID was observed.
  1  Git reported a known rejection.
  2  Input or pre-journal failure.
  3  Commit comparison or verification policy blocks publication.
  4  Remote outcome is unknown and requires recovery.
`,
  ],
  [
    "workflow recover",
    `Usage: commitWorkflow.mjs workflow recover --transaction <transaction.json> [--resolution <confirmed-no-live-child>] [--format <json|text>]

Observes only the exact journaled transaction and never replays commit or push.
The exceptional resolution requires explicit confirmation that the relevant
Git, signing, and hook process ended or that the host restarted.
`,
  ],
  [
    "workflow cleanup",
    `Usage: commitWorkflow.mjs workflow cleanup --transaction <transaction.json> [--purge] [--format <json|text>]

Compacts only known-safe helper-owned artifacts beneath the exact transaction.
Pending or unknown mutations are never removed.
`,
  ],
]);

const HELP = `Commit workflow

Usage:
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

function requestedOutputFormat(args) {
  const index = args.lastIndexOf("--format");
  return index >= 0 && args[index + 1] === "text" ? "text" : "json";
}

function invalidResult(code, message, details = {}) {
  const displayText = `Status: invalid\nCode: ${code}\nMessage: ${message}\n`;

  return {
    schemaVersion: 1,
    status: "invalid",
    phase: null,
    terminalDisposition: null,
    transaction: null,
    route: null,
    commitState: "absent",
    publicationState: "not-requested",
    publicationAllowed: false,
    recoveryRequired: false,
    code,
    message,
    ...details,
    displayText,
  };
}

function writeInvalidResult(result, args, stdout, stderr) {
  stderr.write(`${result.code}: ${result.message}\n`);
  stdout.write(
    requestedOutputFormat(args) === "text"
      ? result.displayText
      : `${JSON.stringify(result)}\n`,
  );
}

function unsupportedAttemptResult(args) {
  const index = args.indexOf("--transaction");

  if (index < 0 || typeof args[index + 1] !== "string") {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(args[index + 1], "utf8"));

    if (payload?.schemaVersion !== 3) {
      return invalidResult(
        "UNSUPPORTED_ATTEMPT_VERSION",
        `Transaction schemaVersion ${JSON.stringify(payload?.schemaVersion)} is unsupported; attempts are never migrated in place.`,
        { transaction: args[index + 1] },
      );
    }
  } catch {
    // The selected handler owns malformed paths and JSON so its established
    // transaction error remains precise. This preflight recognizes versions.
  }

  return null;
}

export async function dispatchCommitWorkflow(
  args,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    stdout.write(HELP);
    return 0;
  }

  const command = args.slice(0, 2).join(" ");
  const route = COMMANDS.get(command);

  if (!route) {
    const label = command || "(none)";
    const result = invalidResult(
      "UNKNOWN_COMMAND",
      `Unknown command: ${label}. Run commitWorkflow.mjs --help for usage.`,
      { command: label },
    );

    writeInvalidResult(result, args, stdout, stderr);
    return 2;
  }

  if (args.length === 3 && ["-h", "--help"].includes(args[2])) {
    stdout.write(COMMAND_HELP.get(command));
    return 0;
  }

  const unsupported = unsupportedAttemptResult(args.slice(2));

  if (unsupported) {
    writeInvalidResult(unsupported, args, stdout, stderr);
    return 2;
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
  } catch (error) {
    const result = invalidResult("COMMAND_DISPATCH_FAILED", error.message);

    writeInvalidResult(result, args, stdout, stderr);
    return 2;
  }
}

process.exitCode = await runCommitWorkflowCli(process.argv.slice(2));
