# Assurance Case: Witnessed Checks, Signature Diagnostics, and Message Approval

Date: 2026-08-25

Status: DETERMINISTIC PASS; MODEL AND HUMAN RELEASE GATES PENDING

Release disposition: HOLD

## 1. Claim and disposition

The `committing-to-git` candidate now records optional verification commands as helper-witnessed transaction evidence instead of accepting an agent-authored summary of checks. It diagnoses SSH trust-source access before a required commit transition, without treating every trust failure as a request for broader filesystem access. It also treats exact approval as the final authoring gate: a checked or structured message must reach `message-ready` before it is shown, and agent-authored body sections or requested inventories go through the structured finalizer.

Fresh deterministic evidence supports the implementation, bundle, schema, recovery, reporting, and documentation claims in this assurance case. It does not prove that an agent will always choose useful checks, understand their output, write a semantically ideal message, or explain a failure well. The candidate therefore remains on HOLD until the new behavioral cases and a human installer review are completed.

This case extends, but does not replace, the broader proportional-workflow case dated 2026-08-23. Historical PASS evidence is not inherited across this transaction-schema cutover.

| Evidence layer | Result | Disposition |
| --- | --- | --- |
| Source, schemas, generated ESM bundle, and repository gates | Fresh run complete | PASS |
| Check execution, output, drift, recovery, authorization, and report contracts | Fresh executable tests complete | PASS |
| SSH trust-source state and recovery contracts | Fresh executable tests complete | PASS |
| Structured detailed-message fixture and one-approval cost contract | Fresh deterministic tests complete | PASS |
| Weakest-model with-skill/without-skill behavioral comparison | Not executed for this cutover | PENDING |
| Human review of deployable skill content | Not executed | PENDING |

## 2. Trust boundaries

### 2.1 What a receipt proves

A check receipt proves only that this helper launched one exact executable with one exact argv vector, from the prepared repository's current worktree, and observed the recorded process outcome. The receipt is append-only transaction state and is bound to the prepared snapshot identity. It does not prove that:

- the command is an adequate test of the change;
- the test itself is correct;
- an agent read or understood its output;
- a passing check examined only the selected commit scope; or
- a result copied from another command, terminal, transaction, or prose is equivalent.

The old external `--checks` input was removed completely. A report can consume only transaction-owned receipts created by `workflow check`; prose and displayed output are not evidence inputs.

### 2.2 Why argv execution is the supported interface

The helper accepts one executable plus a string argv vector and launches with shell mode disabled. Node documents `spawn(command, args)` as the direct argv interface, documents `shell: false` as the default, and warns that shell-enabled execution can interpret metacharacters as commands. Node also distinguishes launch errors, exit codes, signals, and timeouts, which correspond to separate receipt outcomes. See the [Node.js child-process documentation](https://nodejs.org/api/child_process.html).

The cross-platform npm shim is resolved by `cross-spawn`, but the recorded logical command remains the exact user-facing argv. Tests prove that shell metacharacters stay literal, npm scripts run on Windows, shell command strings are rejected, and synchronous and asynchronous launch failures remain distinct.

### 2.3 Why the bundle remains ESM

The publication bundle remains `format: "esm"`, uses the `.mjs` extension, and begins with a native ESM import. A small generated banner creates a module-local `require` with Node's `createRequire(import.meta.url)` so the bundled CommonJS internals of `cross-spawn` can load Node built-ins. This is interoperation inside an ESM artifact, not a conversion to CommonJS. esbuild documents `esm` as the output format that uses `import` and `export`, and documents JavaScript banners as content inserted at the beginning of generated output. See the [esbuild API documentation](https://esbuild.github.io/api/).

## 3. Proportional output and inspection

Each stream is hashed and byte-counted over its complete output while retaining no more than a 256-KiB head and a non-overlapping 256-KiB tail. Normal successful output is not echoed. A non-passing command receives a diagnostic capped at 32 KiB across its nonempty streams, with an explicit suppression marker when bytes are omitted.

`workflow check-detail` reads only a transaction-owned retained segment selected by receipt ID, stream, segment, and bounded offset. It emits pages of at most 16 KiB and revalidates the segment's path, size, and SHA-256 digest before reading. It rejects arbitrary paths, hostile receipt identifiers, replacement, corruption, and unavailable retained output.

This design avoids two disproportionate costs at once:

- a successful noisy check does not consume the agent's display budget merely to establish an exit status; and
- failure diagnosis does not require loading an entire log when a bounded diagnostic or one selected page is sufficient.

The retained hashes support integrity and later bounded access. They do not establish semantic understanding, redact secrets, or make a partial view complete.

## 4. Scope and recovery semantics

Before and after each check, the helper compares the selected worktree paths with the prepared tree. A selected-path mutation stops the transaction from proceeding as though the check applied to the approved snapshot. Changes outside the selected scope are permitted, but the receipt explicitly records current-worktree context; it never claims an isolated staged-tree execution.

An attempt is journaled before process launch. Outcomes are `passed`, `failed`, `launch-error`, `signaled`, `timed-out`, or an active/unknown recovery state. Recovery is observation-only:

- it never relaunches or kills the command;
- a live recorded child cannot be declared ended;
- `confirmed-no-live-child` requires explicit user confirmation that the process ended or the host restarted; and
- the next execution must be a separately authorized receipt directly linked to the resolved attempt.

Commit creation blocks while a check attempt is active or while an unknown attempt has been resolved without its required linked retry. This prevents a recovery label from being mistaken for a witnessed result.

## 5. Failed-check authorization

A non-passing receipt does not silently prohibit a checkpoint commit, and the skill never asks the user to reduce the already selected scope. Instead, the exact commit authorization must name every reportable non-passing receipt once through repeatable `--acknowledge-failed-check` arguments. Missing, duplicate, unknown, passing, or extra receipt IDs fail closed.

This is informed authorization, not a waiver of reality. The post-commit report preserves the exact argv, outcome, duration, exit or signal facts, output integrity facts, and acknowledgement state. The user can therefore authorize a known failing checkpoint without the helper rewriting that failure as success.

## 6. SSH trust-source diagnostics

Git documents `gpg.ssh.allowedSignersFile` as the configured file of principals and SSH public keys used to establish trusted SSH signers. OpenSSH's verification interface likewise takes an allowed-signers file explicitly. See [Git configuration documentation](https://git-scm.com/docs/git-config) and the [OpenSSH `ssh-keygen` manual](https://man.openbsd.org/ssh-keygen#ALLOWED_SIGNERS).

For required SSH identity verification, preflight resolves the configured origin and directly probes the exact configured path before transaction allocation or Git mutation. It records one of these structured states:

| State | Meaning | Required-policy response |
| --- | --- | --- |
| `readable` | The configured regular file can be read | Continue |
| `not-configured` | No allowed-signers path is configured | Repair configuration or change policy |
| `not-found` | The configured path does not exist | Repair the exact path or configuration |
| `permission-denied` | The configured path exists but this process cannot read it | Request capability for that exact path only |
| `invalid-file-type` | The path is not a regular file | Repair configuration |
| `probe-error` | Another bounded operating-system error occurred | Report the safe diagnostic; do not invent a remedy |

Only `permission-denied` justifies requesting exact-path read capability. Missing or invalid configuration is not recast as a sandbox problem. OpenPGP preflight does not probe an SSH trust path. At any point the user may choose `required`, `advisory`, or `skipped`; the skill reports the consequence but does not insist that verification remain mandatory.

The helper still verifies the recorded full commit OID after creation. A signature header, cryptographic validity, and trusted signer identity remain separate report claims.

## 7. Message finalization and approval ordering

The production transcript that motivated this extension exposed one ordering defect rather than three independent formatting defects. The agent presented an unvalidated detailed message, asked for approval, discovered formatter constraints only afterward, asked again after revising mechanics, and eventually removed the requested `File Changes:` section to escape the validation path. The message helper already had a structured renderer for section order, wrapping, reversible paths, ordinals, indentation, and coverage; the skill did not make that renderer the mandatory route before approval.

The revised contract makes the observable state transition explicit:

1. assemble all requested semantics and sections;
2. choose direct subject transport, checked exact bytes, or structured finalization from the completed message shape;
3. correct formatter failures privately while preserving the last valid transaction state and rejected input;
4. require `status: message-ready` and show the helper's `displayText` verbatim; and
5. request one exact approval for those canonical bytes.

A second approval remains appropriate only when later judgment changes the displayed bytes or commit authorization must acknowledge a named non-passing check. Consuming a successfully checked or finalized fixed input is normal lifecycle behavior, not a missing-file error. Requested sections cannot be silently removed to obtain validation success.

Evaluation case 75 materializes exactly three staged S3 deletion-synchronization paths alongside unrelated unstaged `skills-lock.json` and `.claude/local-notes.md` changes, then asks for rationale, user-experience effects, and complete `File Changes:` coverage without absorbing the exclusions. Its `structured-detailed` profile allows four high-level helper calls - prepare, semantic-structure extension, finalization, and commit - with one fixed content read, one write, and exactly one approval turn. The case is executable and critical-safety graded. This deterministic fixture proves that the regression is represented and schedulable; it does not prove model compliance until the matched external run occurs.

## 8. Fresh deterministic evidence

Every deterministic gate invoked by `npm run verify` completed separately on 2026-08-25 after the source, documentation, evaluation, and test changes. The aggregate wrapper was blocked before launch because its Tessl subprocess attempts optional outbound telemetry; no repository content was sent. Running the local gates separately preserved the same build, test, validation, lint, and diff coverage without granting network access.

| Gate | Fresh result |
| --- | --- |
| Prettier | Passed |
| ESLint with zero warnings | Passed |
| Generated bundle drift and canonical `SKILL.md` ASCII checks | Passed |
| Full repository tests | 701 total; 699 passed; 2 conditional skips; 0 failed |
| Canonical skill validation | Passed for all 3 deployable skills |
| Tessl plugin lint | Passed |
| Git whitespace/diff check | Passed |

The Tessl process returned success and identified the plugin as valid; its optional PostHog flush was denied by the network-restricted sandbox after linting. The two test skips are environment branches outside the witnessed-check implementation. The canonical `committing-to-git` skill is 1,489 whitespace-delimited words and 11,483 characters, beneath its enforced 1,500-word and 12-KiB ceilings.

Focused evidence includes:

- 17 check-workflow cases covering success, nonzero exit, literal metacharacters, shell rejection, selected and excluded scope changes, npm shims, both launch-error forms, signal, timeout, bounded noisy output, detail paging, hostile IDs, replaced output, removed external checks, and repeatable acknowledgement parsing;
- 12 transaction-workspace cases, including append-only receipt validation;
- 34 transaction-recovery cases, including active/unknown check recovery, linked retries, failed-check authorization, report integration, terminal cleanup, and bundle-backed recovery routes;
- signature-policy cases for every trust-source state and backend separation;
- schema and report tests proving that only helper-witnessed receipts enter a version-2 report; and
- 32 build tests proving bundle freshness, native ESM interop, deployable/evaluation separation, ASCII validation, and evaluation-layout contracts.

The published bundle was exercised through the exact transaction-recovery routes that previously failed with `Dynamic require of "child_process" is not supported`. Those routes now pass with the ESM `createRequire` banner in place.

## 9. Edge cases explicitly covered

| Risk | Enforced response |
| --- | --- |
| Shell injection or platform quoting drift | String argv only; shell command strings rejected; metacharacters remain literal |
| Windows npm shim lookup | Cross-platform resolution while preserving exact logical argv |
| Large output | Complete byte count/hash plus bounded retained head/tail and diagnostic |
| Output replacement after execution | Size/digest/path revalidation fails detail access |
| Check edits selected files | Transaction stops on selected-worktree drift |
| Check edits excluded files | Receipt remains valid only as current-worktree evidence and records that context |
| Launcher throws before child exists | `launch-error` without invented PID or exit |
| Executable lookup fails asynchronously | Distinct journaled launch failure |
| Signal or timeout | Separate non-passing outcome, never rewritten as ordinary exit |
| Crash after launch intent | Unknown until observation and explicit no-live-child resolution |
| Failed check followed by commit | Exact receipt IDs require informed authorization and remain in report |
| Old transaction/check artifact | Schema version 2 required; no compatibility reader or migration |
| SSH trust path outside sandbox | Request exact-path access only after `permission-denied` |
| Missing allowed-signers file | Configuration repair, not filesystem escalation |
| User does not require identity verification | `advisory` or `skipped` remains user-controlled |
| Detailed message formatter rejects a candidate | Correct privately before approval; preserve requested sections and exact transaction scope |
| Successful fixed-input validation consumes its input | Treat as expected lifecycle; recreate only for a semantic revision |

## 10. Residual limits

- A command can pass while testing the wrong behavior.
- Current-worktree checks can observe unrelated files, environment state, network services, caches, and nondeterministic dependencies.
- Allowing excluded paths to change avoids false invalidation but means the receipt is not an isolated selected-tree execution claim.
- A timeout signal does not prove that every descendant process stopped; unknown recovery remains conservative.
- Retained output may contain secrets or personal data. The helper bounds display and storage but does not redact semantics it cannot understand.
- Head/tail retention can omit the decisive middle of a log; bounded detail can inspect only retained segments.
- SHA-256 integrity detects replacement but does not provide secrecy or prove authorship.
- PID and process observations have operating-system race limits; the workflow therefore requires explicit confirmation and a linked retry after unknown outcomes.
- Advisory or skipped signature verification intentionally weakens the identity claim and must be reported as such.
- The CommonJS interop banner is required as long as a bundled dependency dynamically requires Node built-ins. The regression suite must catch removal or a future dependency-shape change.
- Deterministic tests cannot establish that the skill's prose causes the least capable supported model to follow the intended route efficiently.

## 11. Pending release evidence

The deterministic implementation, eight-case witnessed-check tranche, and one detailed-message approval-order regression are ready for behavioral execution, but release remains on HOLD. Before changing this case to PASS:

1. run the configured sequential matched no-skill, old-skill, and new-skill sessions on the least capable available model, retaining exact prompts, outputs, tool activity, timing, and failures;
2. execute all eight witnessed-check cases covering noisy output, failed-check authorization, selected-scope drift, excluded-file mutation, missing trust configuration, permission denial, one npm-script receipt, and prose-only check claims, plus case 75's validation-before-approval behavior;
3. have a human reviewer inspect only the deployable `skills/committing-to-git/` directory and explain the ordinary optional-check path, validation-before-approval route choice, requested-section preservation, the current-worktree limitation, failure authorization, recovery, and verification override; and
4. update this document with versioned result artifacts and every defect found, rather than inferring behavioral quality from deterministic PASS.

No commit or push was created by this assurance work.
