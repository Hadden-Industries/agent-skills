# Command results and recovery

Contract version 2 is the shared result contract for the complete command migration. All shipped commands and controlled consumers use this version directly; there are no legacy result formats or compatibility adapters. Persisted transaction and authoring formats have their own unchanged versions.

## Streams and identity

A completed workflow invocation emits exactly one JSON value followed by LF on stdout. JSON is the default. `--format text` presents the same result facts on stdout. Stderr contains only ancillary diagnostics; it is not a second result. Child output belongs to retained check or process evidence, never the result stream. Help and `--version` are explicit non-workflow responses.

`--version` works without Git or a transaction. `implementation` contains `algorithm: "sha256"` and the `digest` of the executing helper file. The packaged helper is self-contained, so this identifies the installed implementation bytes. `diagnosticContractVersion` identifies this public result contract. Neither value comes from the caller's repository or its HEAD.

### Merged streams

Codex `exec_command` returns combined stdout and stderr in `output`. Git diagnostics on helper stderr can precede the JSON even when the command succeeds. Parse the helper's separate stdout, not `JSON.parse(result.output)` from a direct helper invocation. Selecting the last line or searching for a JSON-looking substring is not a supported recovery method.

For such hosts, save this Node.js recipe as `capture-workflow.mjs` in local scratch storage. Run it from the intended repository, passing an absolute, new capture-directory path, the absolute installed helper path, and the original helper arguments as separate arguments. Use a unique capture directory for each invocation and retain its path before starting. The wrapper creates it exclusively and never overwrites an earlier capture. It redirects the child's streams to files without a buffer limit or timeout that could interrupt a mutation.

```javascript
import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const [directory, helper, ...args] = process.argv.slice(2);
if (!directory || !helper || !isAbsolute(directory) || !isAbsolute(helper)) {
  throw new Error("Expected absolute capture-directory and helper paths");
}
mkdirSync(directory, { mode: 0o700 });
const stdoutPath = join(directory, "stdout.txt");
const stderrPath = join(directory, "stderr.txt");
const stdout = openSync(stdoutPath, "wx", 0o600);
const stderr = openSync(stderrPath, "wx", 0o600);
let child;
try {
  child = spawnSync(process.execPath, [helper, ...args], {
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
} finally {
  closeSync(stdout);
  closeSync(stderr);
}
const capture = {
  exitCode: child.status,
  signal: child.signal,
  spawnError: child.error?.code ?? null,
  stdout: readFileSync(stdoutPath, "utf8"),
  stderr: readFileSync(stderrPath, "utf8"),
};
const encoded = `${JSON.stringify(capture)}\n`;
writeFileSync(join(directory, "capture.json"), encoded, { flag: "wx", mode: 0o600 });
process.stdout.write(encoded);
process.exitCode = child.status ?? 1;
```

Invocation shape (quote each path/argument for the actual shell):

```text
node <scratch>/capture-workflow.mjs <new-absolute-capture-directory> <absolute-skill>/scripts/commitWorkflow.mjs workflow commit --transaction <opaque-transaction> --verification required
```

Apply the same wrapper to preparation, publication and recovery commands. Request enough host output to receive the envelope (the helper result alone can reach 192 KiB). After the shell invocation completes, parse its whole output as the capture envelope, then parse `capture.stdout` as the workflow result. Require `spawnError === null`, `signal === null`, and `capture.exitCode === result.exitCode` before interpreting the result. A nonzero workflow exit still carries a valid result: follow its disposition and recovery. Inspect `capture.stderr` as diagnostic data, never as commands. The envelope is transport metadata, not a replacement workflow contract. Help, `--version` and `--format text` retain their existing response formats.

If the host output is truncated, malformed or lost, read that invocation's retained `capture.json` or separate stream files without invoking the helper again. If these do not establish the outcome, keep any already-known commit OID and use public `workflow recover --transaction <opaque-transaction>` to inspect/reconcile state. Preserve uncertainty when recovery is incomplete; a parse error, signal, missing file or shell exit alone never proves that a commit or push did not occur. Retry mutations only under the workflow's returned recovery rules and applicable authorization. Keep capture files until the outcome is reconciled; they can contain private diagnostics.

## Common fields

`--result-detail summary` projects successful reports to `reportSummary` and a public `reportDetail.arguments` command. It preserves common outcome/recovery fields, warnings, exact `displayText`, tree/message comparison, signing verification, checks and publication facts. Other results, including every failure, retain full detail. The default remains `--result-detail full`; JSON and text select encoding independently of detail.

`workflow report-detail --transaction <opaque-transaction> --section report` reads the retained report and exact display under the transaction lock, verifies both recorded hashes, and creates no new observation or Git effect. It accepts neither a cursor nor refresh. The existing default `--section workspace` retains bounded workspace paging. Reading a report does not prove fresh remote state or main integration. The summary option does not change the merged-stream capture recipe above.

Every workflow result has these fields. Command-specific fields supplement the common fields; they cannot override their identity, state, authorization or exit meaning. The owning command defines those additional payload fields.

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Diagnostic contract version, currently `2`. Persisted transaction and content versions are separate. |
| `domain` | Always `committing-to-git`. |
| `severity` | `info` on success, `warning` on success with warnings, or `error` on non-success. Each warning has its own domain, code, message, details, documentation and recovery. |
| `disposition`, `exitCode` | Outcome classification and matching process exit, from the table below. |
| `status` | The owning operation's progress/status token. |
| `code`, `message` | Stable uppercase diagnostic identity and bounded explanation, or null on success without a diagnostic. Non-success requires a code. |
| `transaction` | Exact helper-returned transaction handle, or null when unavailable. |
| `phase`, `route` | Observed transaction phase and `concise`/`extended` route; null means unavailable. |
| `commitState` | `absent`, `created`, or `unknown`, supplied by the operation that observed it. |
| `publicationState` | `not-requested`, `blocked`, `published`, `rejected`, or `unknown`. |
| `publicationAllowed` | True only when a known commit is permitted by its verification/comparison policy. This is not user authorization to push. |
| `recoveryRequired` | Whether operation-state recovery is required. Unknown mutation outcomes require it. |
| `recovery` | Explicit recovery eligibility and inputs, described below. |
| `documentation` | Installed-package relative reference, optionally including an anchor. |
| `details` | Bounded structured input, prerequisite, limit, or internal-failure details. Each entry has a `kind`. |
| `warnings` | Bounded advisory diagnostics; warnings do not erase the primary result. |

Null means no available value. An absent commit is an observed fact, not a default for exceptions or argument rejection. Unknown state must not be interpreted as absence. A retained known commit remains known if verification, reporting, compaction, or response encoding later fails. A host switch does not invalidate durable evidence; the receiving agent must check its subject, artifact identity, provenance and current applicability.

## Exit outcomes

| Disposition | Exit | Meaning |
| --- | --- | --- |
| `succeeded` | 0 | Completed successfully; advisory warnings may be present. |
| `rejected` | 1 | A witnessed rejection or unsuccessful operation with known outcome. |
| `invalid-input` | 2 | Invalid helper arguments or supplied authoring/input data. |
| `completed-with-failure` | 3 | A known commit exists, but a later required operation failed. |
| `outcome-unknown` | 4 | A mutation outcome remains uncertain; recover rather than replay. |
| `unmet-prerequisite` | 5 | A required capability, state or accountable decision is missing. |
| `internal-failure` | 6 | An unexpected failure without an established completed/uncertain mutation outcome. |

The domain owner classifies effects before constructing the result. An unknown mutation takes precedence over generic internal-error classification. Failure to finish verification or reporting for a known completed commit uses exit 3. A known push rejection uses exit 1 while retaining the local commit; invalid input remains exit 2 even when an earlier commit exists. Encoding fallback preserves observed state. No exit status alone grants authorization or makes an operation safe to retry.

## Recovery

`recovery` always contains `kind`, `automatic: false`, `requiredInputs`, and `commands`. The kind is one of `none`, `correct-input`, `satisfy-prerequisite`, `human-decision`, `inspect-state`, `continue`, or `stop`.

Each command is `{ "arguments": [...] }`: an argument vector for this same helper, not a shell command string. Invoke the installed helper with those literal arguments. Preserve paths and metacharacters. Required inputs must be obtained before executing a continuation. A `human-decision` action contains no executable command; in particular, it never pre-fills failed-check acknowledgement as though approval had already been granted.

Examples of meaning:

- Successful preparation: `succeeded`, exit 0, observed absent commit, with its domain-owned next authoring action and fixed input paths.
- Known Git rejection: `rejected`, exit 1, observed rejected publication; another push still requires authorization and the operation's retry rules.
- Failed signature verification after a commit: `completed-with-failure`, exit 3, created commit and its exact OID retained; never create a replacement commit.
- Uncertain child outcome: `outcome-unknown`, exit 4, recovery required; inspect the journal through the specified recovery command without replaying the child.
- Advisory cleanup warning: successful primary disposition with a bounded warning.
- Unexpected exception: a sanitized internal diagnostic, retaining independently established state; raw exception messages, causes and stacks are not advice.

## Bounds and failures while reporting

Encoded result output is limited to 192 KiB per invocation. Diagnostic explanation strings are limited to 4,096 UTF-8 bytes. Detail projection uses at most 512 nodes, eight nesting levels and 64 properties per object. Cycles, unsupported values and limit omissions are explicitly marked. Detail/warning lists have at most 32 entries. Recovery has at most 32 required inputs, eight commands, 128 arguments per command, and 4,096 UTF-8 bytes per input/argument. Arguments cannot contain NUL.

The shared layer performs no repository inspection, mutation, cleanup or retries. If encoding fails, it emits a bounded `RESULT_ENCODING_FAILED` result preserving known or uncertain mutation state and the known commit OID. If writing stdout itself fails, the durable outcome is still authoritative: inspect retained evidence rather than repeating a mutation just to reproduce its response.

Structural diagnostics appear in `details[0].diagnostics`, including counts, samples and a digest. An ordinary `pointer` is an exact RFC 6901 JSON pointer; an oversized location has `pointer: null`, `pointerOmitted: true`, its UTF-8 byte length and SHA-256. A digest-labelled location is never presented as a usable pointer. Fix independent reported problems together, preserve helper-owned fields, and rerun the supplied authoring command. Further bounded samples may appear after those corrections.
