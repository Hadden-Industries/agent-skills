const COMMANDS = new Map([
  [
    "workflow prepare",
    [
      () => import("../workflow/prepareWorkflow.js"),
      null,
      "runPrepareWorkflowCommand",
    ],
  ],
  [
    "workflow extend",
    [
      () => import("../workflow/extendReviewWorkflow.js"),
      null,
      "runExtendReviewCommand",
    ],
  ],
  [
    "workflow resume",
    [
      () => import("../workflow/resumePreparationWorkflow.js"),
      null,
      "runResumePreparationCommand",
    ],
  ],
  [
    "workflow commit",
    [
      () => import("../workflow/createCommitWorkflow.js"),
      null,
      "runCreateCommitCommand",
    ],
  ],
  [
    "workflow verify",
    [
      () => import("../workflow/createCommitWorkflow.js"),
      null,
      "runRetryVerificationCommand",
    ],
  ],
  [
    "workflow report-detail",
    [
      () => import("../workflow/reportDetailWorkflow.js"),
      null,
      "runReportDetailCommand",
    ],
  ],
  [
    "workflow publish",
    [() => import("../workflow/publishWorkflow.js"), null, "runPublishCommand"],
  ],
  [
    "workflow recover",
    [
      () => import("../workflow/recoverTransactionWorkflow.js"),
      null,
      "runRecoverTransactionCommand",
    ],
  ],
  [
    "workflow cleanup",
    [
      () => import("../workflow/recoverTransactionWorkflow.js"),
      null,
      "runCleanupTransactionCommand",
    ],
  ],
  ["snapshot create", [() => import("../command/snapshotCommand.js"), null]],
  [
    "snapshot verify",
    [
      () => import("../command/snapshotVerificationCommand.js"),
      null,
      "runSnapshotVerificationCommand",
    ],
  ],
  [
    "inspection prepare",
    [() => import("../command/inspectionCommand.js"), "prepare"],
  ],
  [
    "inspection expand-deletion",
    [() => import("../command/inspectionCommand.js"), "expand-deletion"],
  ],
  [
    "inspection acknowledge",
    [() => import("../command/inspectionCommand.js"), "ack"],
  ],
  [
    "inspection status",
    [() => import("../command/inspectionCommand.js"), "status"],
  ],
  [
    "message scaffold",
    [() => import("../command/messageCommand.js"), "scaffold"],
  ],
  ["message render", [() => import("../command/messageCommand.js"), "render"]],
  [
    "message validate",
    [() => import("../message/commitMessageValidator.js"), null],
  ],
  [
    "message check",
    [
      () => import("../workflow/checkMessageWorkflow.js"),
      null,
      "runCheckMessageCommand",
    ],
  ],
  [
    "message finalize",
    [
      () => import("../workflow/finalizeMessageWorkflow.js"),
      null,
      "runFinalizeMessageCommand",
    ],
  ],
  [
    "signature verify",
    [() => import("../command/postCommitCommand.js"), "verify"],
  ],
  [
    "report create",
    [() => import("../command/postCommitCommand.js"), "report"],
  ],
  [
    "publication push",
    [() => import("../command/publicationCommand.js"), null],
  ],
]);

const COMMAND_HELP = new Map([
  [
    "workflow commit",
    `Usage: commitWorkflow.mjs workflow commit --transaction <transaction.json> [--message <subject>] [--verification <required|advisory|skipped>] [--checks <checks.json>] [--retain-review-artifacts] [--retain-process-logs] [--format <json|text>]

Creates at most one signed commit from the recorded tree and canonical message.
The irreversible child is journaled before launch; rerun recovery, never commit,
when the returned outcome is unknown.

Exit status:
  0  Matching signed commit and policy-permitted local report completed.
  1  Git durably did not create a commit or repository state stopped safely.
  2  Usage, message, checks, snapshot, or pre-journal helper failure.
  3  A known commit is blocked by comparison, verification, or reporting.
  4  Commit child or ref outcome is indeterminate and requires recovery.
`,
  ],
  [
    "workflow verify",
    `Usage: commitWorkflow.mjs workflow verify --transaction <transaction.json> [--verification <required|advisory|skipped>] [--format <json|text>]

Retries or reclassifies signature verification only for the already recorded
commit OID. This command never invokes commit creation.
`,
  ],
  [
    "workflow report-detail",
    `Usage: commitWorkflow.mjs workflow report-detail --transaction <transaction.json> [--cursor <cursor> | --refresh] [--format <json|text>]

Streams one fresh, bounded workspace observation for a reported or published
transaction. Continue an immutable observation with its opaque cursor. A
completed response is replayed until --refresh explicitly starts a new one.
`,
  ],
  [
    "workflow publish",
    `Usage: commitWorkflow.mjs workflow publish --transaction <transaction.json> --remote <name> --destination <refs/heads/name> [--retry-after-attempt <attempt-id>] [--format <json|text>]

Publishes the exact recorded commit only when its comparison, signature header,
verification policy, configured remote, and full destination ref permit it.
Every attempt is journaled and never retried automatically.

Exit status:
  0  Push success was witnessed, or recovery observed the matching remote OID.
  1  Git reported a known rejection with no successful push recorded.
  2  Invalid input or failure before a publication attempt was journaled.
  3  The known commit report or verification policy blocks publication.
  4  Remote outcome is unknown and requires recovery before any new attempt.
`,
  ],
  [
    "workflow recover",
    `Usage: commitWorkflow.mjs workflow recover --transaction <transaction.json> [--resolution <confirmed-no-live-child>] [--format <json|text>]

Observes only the exact journaled transaction and never replays commit or push.
The exceptional resolution requires explicit confirmation that the relevant
Git, signing, and hook process has ended or the host restarted.
`,
  ],
  [
    "workflow cleanup",
    `Usage: commitWorkflow.mjs workflow cleanup --transaction <transaction.json> [--purge] [--format <json|text>]

Compacts only known-safe helper-owned artifacts beneath the exact transaction.
--purge abandons an active precommit transaction or removes a terminal attempt.
Pending or unknown mutations are never removed.
`,
  ],
  [
    "workflow extend",
    `Usage: commitWorkflow.mjs workflow extend --transaction <transaction.json> --reason <evidence-uncertainty|semantic-structure-required> [--format <json|text>]

Moves one unchanged concise snapshot into the extended review route. Evidence
uncertainty consumes only the fixed transaction-local evidence-plan input after
durable success. Semantic structure forbids that input and carries the existing
capsule forward without a packet queue.

Exit status:
  0  The unchanged snapshot reached review-pending.
  1  Transaction state or repository anchors no longer permit extension.
  2  Usage, plan, artifact, or execution failure.
`,
  ],
  [
    "workflow prepare",
    `Usage: commitWorkflow.mjs workflow prepare --mode <actual|draft> --scope <staged|full|paths> (--evidence <reuse|message|review> --basis <kind> | --evidence-plan <file>) [options]

Creates one helper-owned transaction, validates literal scope and evidence policy,
and records an exact snapshot. Path scope accepts repeatable --path,
--path-prefix, --exclude-path, and --exclude-path-prefix selectors or one
--scope-file. --allowed-type is repeatable. Verification defaults to required.

Exit status:
  0  Snapshot and applicable exact index installation completed.
  1  Safe repository-state stop or resumable preparation interruption.
  2  Usage, policy, artifact, selector, repository, or execution failure.
`,
  ],
  [
    "workflow resume",
    `Usage: commitWorkflow.mjs workflow resume --transaction <transaction.json> [--format <json|text>]

Continues only a reversible preparation from its persisted scope, evidence,
policy, snapshot, head anchor, and index-installation journal. No override input
is accepted, and commit or publication mutation is never replayed.

Exit status:
  0  Persisted preparation reached evidence-ready or review-pending.
  1  Resume is unsafe, ambiguous, or not permitted from the current phase.
  2  Usage, transaction, artifact, or execution failure.
`,
  ],
  [
    "snapshot create",
    `Usage: commitWorkflow.mjs snapshot create --mode <actual|draft> --scope <staged|full|paths> [--scope-file <scope.json>] --output <snapshot.json>

Records one exact Git index tree and its normalized change inventory.

Side effects:
  Every mode may write Git objects. Staged scope reads the real index as-is
  and may lock it to update cache metadata without changing staged entries.
  Draft full and paths do not change the real index.
  Actual full and paths prepare elsewhere, then install the completed tree in the real index.

Output:
  Writes snapshot.json. Draft full and paths also retain a temporary index beside it.

Exit status:
  0  Snapshot written; any documented actual-mode index installation completed.
  2  Input, repository, staging, snapshot, state-drift, or output failure.
`,
  ],
  [
    "snapshot verify",
    `Usage: commitWorkflow.mjs snapshot verify --manifest <snapshot.json>

Read-only comparison of repository root, HEAD, index tree, and operation state with the supplied manifest.

Output and exit status:
  0  Emits JSON with valid true.
  1  Emits structured drift JSON with valid false.
  2  Usage, manifest, repository, or Git execution failure.
`,
  ],
  [
    "inspection prepare",
    `Usage: commitWorkflow.mjs inspection prepare --manifest <snapshot.json> --output-dir <directory>

Writes bounded exhaustive inventory, required non-deletion patch, metadata, and ledger artifacts after confirming the source index still matches the manifest. Whole-file deletion bodies are summarized with exact old-object facts and can be expanded separately.

Exit status:
  0  Artifacts written and ledger summary emitted as JSON.
  2  Usage, manifest, index-drift, Git, or output failure.
`,
  ],
  [
    "inspection acknowledge",
    `Usage: commitWorkflow.mjs inspection acknowledge --ledger <ledger.json> --id <unit-id> --sha256 <hash>

Marks one ledger artifact reviewed only when its current SHA-256 matches the supplied hash.

Side effect and exit status:
  0  Rewrites the ledger and emits it as JSON.
  2  Usage, ID, hash, artifact, or output failure; no successful acknowledgement.
`,
  ],
  [
    "inspection expand-deletion",
    `Usage: commitWorkflow.mjs inspection expand-deletion --manifest <snapshot.json> --ledger <ledger.json> --change-unit <F000001>

Materializes the exact old blob for one summarized whole-file text deletion and appends bounded deleted-content units to the primary inspection ledger.

Side effect:
  Creates one deletion artifact directory and makes the ledger incomplete until every appended unit is acknowledged.

Exit status:
  0  Exact old-blob chunks appended and the updated ledger summary emitted as JSON.
  2  Usage, manifest, ledger, change-unit, object-type, Git, collision, or output failure.
`,
  ],
  [
    "inspection status",
    `Usage: commitWorkflow.mjs inspection status --ledger <ledger.json>

Read-only ledger status output.

Exit status:
  0  Emits the ledger JSON.
  2  Usage or input failure.
`,
  ],
  [
    "message scaffold",
    `Usage: commitWorkflow.mjs message scaffold --manifest <snapshot.json> --output <content.json> --template <template.txt>

Writes semantic content scaffolding and a deliberately noncommittable human template for the manifest's detailed or bulk mode.

Exit status:
  0  Both files written and their paths emitted as JSON.
  2  Usage, manifest, rendering, or output failure.
`,
  ],
  [
    "message render",
    `Usage: commitWorkflow.mjs message render --manifest <snapshot.json> --content <content.json> --ledger <ledger.json> --output <message.txt>

Requires a complete tree-matched inspection ledger and writes the deterministic message for the semantic content.

Exit status:
  0  Canonical message written and path emitted as JSON.
  2  Usage, artifact, incomplete-inspection, semantic-input, or output failure.
`,
  ],
  [
    "message validate",
    `Usage: commitWorkflow.mjs message validate [--manifest <snapshot.json> --content <content.json> --ledger <ledger.json>] <message.txt>

Validates a message and emits a JSON result on stdout. Supply all three manifest-backed inputs together for this workflow.

Exit status:
  0  No blocking error; read manualReviewRequired and every review issue.
  1  Structured validation failure was emitted.
  2  Usage, input, repository, schema, or execution failure.
`,
  ],
  [
    "message check",
    `Usage: commitWorkflow.mjs message check --transaction <transaction.json> [--format <json|text>]

Validates the exact fixed transaction-local message-input.txt for a concise
precommit transaction, persists those unchanged bytes as the sole canonical
message revision, and removes the input only when same-object cleanup is safe.

Exit status:
  0  The exact checked bytes reached message-ready.
  2  Usage, transaction, input, snapshot, validation, or persistence failure.
`,
  ],
  [
    "message finalize",
    `Usage: commitWorkflow.mjs message finalize --transaction <transaction.json> [--format <json|text>]

Finalizes only the fixed transaction-local content.json for an extended
precommit transaction. A changed evidence plan may return a bounded delta queue
before the exact structured message can be persisted.

Exit status:
  0  Structured content reached one canonical message-ready revision.
  1  Newly required evidence was materialized for review.
  2  Usage, transaction, content, review, validation, or persistence failure.
`,
  ],
  [
    "signature verify",
    `Usage: commitWorkflow.mjs signature verify --commit <full-oid> --initial-policy <policy> --policy <policy> --output <verification.json>

Runs Git verification unless policy is skipped and binds the result to the exact full commit OID.

Output:
  Writes verification.json and emits the same JSON on stdout.

Exit status:
  0  The selected policy does not block publication.
  1  Required policy lacks a verified result; the artifact is still written.
  2  Usage, commit-resolution, verifier-launch, input, or output failure.
`,
  ],
  [
    "report create",
    `Usage: commitWorkflow.mjs report create --commit <oid> --manifest <snapshot.json> --approved-message <message.txt> --verification <verification.json> --checks <checks.json> [--publication <publication.json>] --output-json <report.json> --output-text <report.txt>

Compares the actual commit with the recorded parent, tree, message, verification OID, and optional publication result.

Output:
  Writes machine-readable report.json and human-readable report.txt.

Exit status:
  0  Parent, tree, and message match.
  1  At least one comparison differs; both reports are still written.
  2  Usage, artifact, commit-inspection, or output failure.
`,
  ],
  [
    "publication push",
    `Usage: commitWorkflow.mjs publication push --commit <full-oid> --remote <name> --destination <refs/heads/name> --output <publication.json>

Network side effect:
  Performs a non-force push of the exact OID to the full destination ref.
  This command does not enforce authorization, signature policy, or pre-push report gates.

Output:
  Requires unused output and .pending paths. Writes .pending before Git, then the final JSON result.

Exit status:
  0  Git reported success and publication.json records pushed.
  1  Git reported failure and publication.json records failed.
  2  Input/execution/output failure. A remaining .pending journal means remote outcome unknown.
`,
  ],
]);

const HELP = `Commit workflow

Usage:
  commitWorkflow.mjs workflow prepare [options]
  commitWorkflow.mjs workflow resume [options]
  commitWorkflow.mjs workflow extend [options]
  commitWorkflow.mjs workflow commit [options]
  commitWorkflow.mjs workflow verify [options]
  commitWorkflow.mjs workflow report-detail [options]
  commitWorkflow.mjs workflow publish [options]
  commitWorkflow.mjs workflow recover [options]
  commitWorkflow.mjs workflow cleanup [options]
  commitWorkflow.mjs snapshot create [options]
  commitWorkflow.mjs snapshot verify [options]
  commitWorkflow.mjs inspection prepare [options]
  commitWorkflow.mjs inspection expand-deletion [options]
  commitWorkflow.mjs inspection acknowledge [options]
  commitWorkflow.mjs inspection status [options]
  commitWorkflow.mjs message scaffold [options]
  commitWorkflow.mjs message render [options]
  commitWorkflow.mjs message validate [options] <message-file>
  commitWorkflow.mjs message check [options]
  commitWorkflow.mjs message finalize [options]
  commitWorkflow.mjs signature verify [options]
  commitWorkflow.mjs report create [options]
  commitWorkflow.mjs publication push [options]

Run a command with --help to inspect its options.
`;

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
    stderr.write(
      `Unknown command: ${label}\nRun commitWorkflow.mjs --help for usage.`,
    );
    return 2;
  } else if (args.length === 3 && ["-h", "--help"].includes(args[2])) {
    stdout.write(COMMAND_HELP.get(command));
    return 0;
  } else {
    const [loadCommand, legacyAction, handlerName] = route;

    if (handlerName) {
      const commandModule = await loadCommand();
      return commandModule[handlerName](args.slice(2), { stdout, stderr });
    } else {
      process.argv = [
        process.argv[0],
        process.argv[1],
        ...(legacyAction ? [legacyAction] : []),
        ...args.slice(2),
      ];
      await loadCommand();
      return process.exitCode ?? 0;
    }
  }
}

function requestedOutputFormat(args) {
  const index = args.lastIndexOf("--format");
  return index >= 0 && args[index + 1] === "text" ? "text" : "json";
}

export async function runCommitWorkflowCli(
  args,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  try {
    return await dispatchCommitWorkflow(args, { stdout, stderr });
  } catch (error) {
    const result = {
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
      code: "COMMAND_DISPATCH_FAILED",
      message: error.message,
    };

    stderr.write(`COMMAND_DISPATCH_FAILED: ${error.message}\n`);
    stdout.write(
      requestedOutputFormat(args) === "text"
        ? `Status: invalid\nCode: ${result.code}\nMessage: ${result.message}\n`
        : `${JSON.stringify(result)}\n`,
    );
    return 2;
  }
}

process.exitCode = await runCommitWorkflowCli(process.argv.slice(2));
