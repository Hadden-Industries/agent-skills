const COMMANDS = new Map([
  ["snapshot create", [() => import("../command/snapshotCommand.js"), null]],
  [
    "snapshot verify",
    [() => import("../command/snapshotVerificationCommand.js"), null],
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
  commitWorkflow.mjs snapshot create [options]
  commitWorkflow.mjs snapshot verify [options]
  commitWorkflow.mjs inspection prepare [options]
  commitWorkflow.mjs inspection expand-deletion [options]
  commitWorkflow.mjs inspection acknowledge [options]
  commitWorkflow.mjs inspection status [options]
  commitWorkflow.mjs message scaffold [options]
  commitWorkflow.mjs message render [options]
  commitWorkflow.mjs message validate [options] <message-file>
  commitWorkflow.mjs signature verify [options]
  commitWorkflow.mjs report create [options]
  commitWorkflow.mjs publication push [options]

Run a command with --help to inspect its options.
`;

const args = process.argv.slice(2);

if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
  process.stdout.write(HELP);
} else {
  const command = args.slice(0, 2).join(" ");
  const route = COMMANDS.get(command);

  if (!route) {
    const label = command || "(none)";
    console.error(
      `Unknown command: ${label}\nRun commitWorkflow.mjs --help for usage.`,
    );
    process.exitCode = 2;
  } else if (args.length === 3 && ["-h", "--help"].includes(args[2])) {
    process.stdout.write(COMMAND_HELP.get(command));
  } else {
    const [loadCommand, legacyAction] = route;
    process.argv = [
      process.argv[0],
      process.argv[1],
      ...(legacyAction ? [legacyAction] : []),
      ...args.slice(2),
    ];
    await loadCommand();
  }
}
