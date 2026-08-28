# Unified Skill Evaluation Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: use `test-driven-development` for every behavior change, `verification-before-completion` before every completion claim, and `committing-to-git` for every commit. Execute inline in one primary-agent session because this repository plan forbids delegation. Steps use checkbox (`- [ ]`) syntax for tracking. Run one shell command and one model session at a time; do not begin a later task before the current task reaches its stated review, verification, and commit boundary.

**Goal:** Replace the duplicated `defining-concepts` and `committing-to-git` execution mechanics with one deep, provider-aware evaluation runtime while preserving the task-specific semantics, historical evidence, and safety guarantees of both suites.

**Architecture:** Keep the two suite CLIs and their domain controllers. Move canonical transmission packets, exact authorization, exclusive evidence, process lifecycle, stable Codex homes, Codex App Server transport, and Claude CLI transport into shared maintainer modules under `scripts/evaluation/`. Standardize both Codex arms on App Server. Require exact packet-digest authorization before every future hosted OpenAI or Anthropic session.

**Tech stack:** Node.js 24+ ECMAScript modules and Node built-ins, a fixed read-only Windows PowerShell path probe for filesystem metadata Node does not expose, Codex App Server JSONL RPC, Claude Code streamed JSON, Node's test runner, ESLint, and Prettier. Add no dependency and change no repository configuration.

**Spec:** The accepted design contract is the `Source of Truth` through `Residual Limits` sections in this file. Tasks argue from that contract without creating a second restatement.

**Accepted home root:** `C:\Users\maksy\AppData\Local\OpenAI\Codex\EvaluationHomes\v1`

**Accepted stable roles:** `preflight` and `execution`

## Global Constraints

- Preserve existing user-owned `.codex/config.toml`, `.claude/`, and all unrelated working-tree state.
- Change no configuration file without later exact approval for the named file and setting; this design requires none.
- Do not edit any retained evaluation result.
- Use Node built-ins plus the repository-owned read-only Windows path probe; retain the repository's Node 24 floor and add no package dependency.
- Run every behavior change RED, then GREEN, then focused verification, then `npm run verify`.
- Run commands sequentially and do not delegate implementation or review.
- Treat every hosted call authorization as exact and one-use; no automatic provider retry.
- Keep production evaluation-home operations outside automated tests and outside implementation tasks.
- Obtain exact staged-scope and message approval before each signed local commit; do not push.

## Source of Truth

This file is both the accepted design specification and the executable implementation plan. Do not create a second architecture document that restates these contracts. Runtime-facing common guidance belongs in `evals/README.md`; suite-specific guidance belongs in the corresponding suite README; implementation invariants belong beside the shared implementation and its tests.

The design incorporates the complete retained context from Codex task `01a03250-edbd-75d3-a1e8-1c8dd20fb5a8`, titled `defining-concepts`. That history includes the provider-neutral runner, isolation choices, immutable result layout, invalid-attempt retention, grading protocol, calibration runs, and the later signed commits. Its core precedent remains binding: centralize universal mechanics and retain suite-specific guarantees in suite-specific code and tests.

## Current State

### `defining-concepts`

`evals/defining-concepts/run-evaluation-session.mjs` is a monolithic single-session launcher. It owns argument parsing, hashing, directory preparation, process launch, JSONL parsing, final-answer extraction, usage normalization, timing, and evidence writing. It supports:

- Claude through its non-interactive streamed-JSON CLI.
- Codex through `codex exec --json` in an empty non-repository working directory.
- Exact prompt, instruction, transcript, stderr, final-answer, metrics, timing, and run artifacts.
- Complete failed-launch records.
- A non-overwrite check for retained run and session directories.

Its README requires approval of the exact hosted-model payload, but the runner does not enforce that approval in code.

### `committing-to-git`

`evals/committing-to-git/evaluation-runner.mjs` owns both Git-specific evaluation behavior and generic execution behavior. Generic behavior includes canonical hashing, packet authorization, exclusive artifact writes, Codex isolation overrides, destination-local disposable `CODEX_HOME` paths, App Server launch, and preflight.

`evals/committing-to-git/app-server-session.mjs` combines a reusable JSONL RPC client and reusable Codex lifecycle assertions with the Git-specific conversation state machine, scope-question parser, proposal parser, permission policy, and exact commit-authorization turn.

The suite has the stronger external-call gate and App Server evidence model, but its fresh destination-local homes cannot use the installed CLI's empirically home-scoped Windows keyring authentication.

### Repository constraints

- Every immediate child of `evals/` is treated as a skill evaluation suite by `scripts/buildSkillBundles.js`; shared code therefore belongs under `scripts/evaluation/`, not `evals/shared/`.
- `scripts/**/*.js` and `tests/**/*.mjs` already participate in formatting and linting.
- Node 24 is already required.
- No package, lockfile, lint, build, CI, or repository-policy change is needed.
- Canonical skill files under `skills/` remain ASCII-only.
- Existing retained evaluation results are evidence, not migration inputs.
- Existing changes to `.codex/config.toml` and `.claude/` are user-owned and outside this plan.

## Design Principles and Reference-Driven Decisions

### Deep modules over shared helper sprawl

The unification boundary follows ports-and-adapters and information-hiding principles:

- Suite controllers are the application/domain layer.
- The shared runtime is the transaction boundary.
- Provider adapters are outbound ports.
- Filesystem, process, and provider protocols are hidden implementation details.

Export complete operations that preserve invariants. Do not export low-level rename, delete, spawn, or unauthenticated-turn helpers that let a suite reassemble a weaker workflow. A shared file is not automatically a good module; the interface must hide substantially more complexity than it exposes.

### Functional core and imperative shell

Keep canonicalization, packet construction, authorization comparison, capability comparison, state transitions, path derivation, and result normalization pure wherever practical. Keep filesystem mutation, child processes, clocks, randomness, and provider I/O at narrow injected edges. Tests should exercise the pure core exhaustively and the imperative shell with fake processes and temporary roots.

### Explicit state machines

Prepared sessions, provider sessions, and home leases are state machines rather than collections of booleans. A transition validates its expected prior state and records its result before a later transition begins. Invalid, repeated, or skipped transitions fail closed.

### Capabilities and least authority

Packets describe positive capabilities: exact filesystem roots, sandbox, network, web search, tools, instruction sources, and permitted continuation behavior. Adapters construct the narrowest provider policy that implements those capabilities and reject any effective capability outside it. Empty or disabled capabilities are verified where the provider exposes effective-state inspection; they are not assumed from requested configuration alone.

### Codex SDK versus App Server

The official Codex SDK is the preferred high-level interface for ordinary automated coding threads and CI. It wraps `codex exec` and offers model, effort, sandbox, network, web-search, working-directory, environment, streaming, and multi-turn controls.

These evaluation suites additionally require:

- Zero-turn `account/read` authentication inspection.
- Forced-refresh `skills/list` and effective isolation checks.
- Hook, app, and other context-source inspection where the protocol supports it.
- Exact ephemeral thread construction and cleanup evidence.
- Server-initiated permission requests with a suite-owned approval callback.
- Version-specific protocol schema generation and pinning.
- Complete request, response, and notification evidence.

The current TypeScript SDK does not expose those deep-integration surfaces. App Server is the official interface for authentication, approvals, conversation lifecycle, and streamed agent events, so it is the least powerful sufficient interface for this evaluation. Both Codex arms use it to avoid a second Codex semantic and isolation path. Revisit this decision only when an official high-level SDK exposes every required capability with equal evidence; do not wrap the SDK and App Server simultaneously.

### Specification-first protocol handling

- Canonical packet bytes follow RFC 8785 JSON Canonicalization Scheme (JCS) over the RFC 7493 I-JSON subset.
- App Server message shapes come from `codex app-server generate-json-schema` for the exact Codex executable and version used by the packet.
- Timestamps use UTC RFC 3339 form; elapsed durations use a monotonic clock.
- Provider-native events remain authoritative. Common fields are a versioned projection, not a replacement protocol.
- Filesystem operations use Node's documented exclusive-create, non-following inspection, handle, and child-process APIs plus the fixed read-only .NET attribute/drive probe, constrained by Windows directory-move and reparse-point semantics.

### Honest guarantees

The packet digest is an exact consent and reproducibility anchor, not a digital signature. The filesystem lease coordinates conforming evaluator processes; it is not a security boundary against another process running with the same user privileges. Same-volume rename gives an atomic namespace transition, not a multi-step crash transaction. Durable phase evidence and fail-closed recovery cover incomplete transitions without overstating filesystem guarantees.

## Target Structure

```text
scripts/evaluation/
  runtime.js
  evaluation-homes.js
  manage-evaluation-homes.js
  windows-path-metadata.js
  windows-path-probe.ps1
  codex-app-server.js
  claude-cli.js

evals/defining-concepts/
  run-evaluation-session.mjs       # thin CLI and suite preparation
  session-controller.mjs           # one-turn suite behavior

evals/committing-to-git/
  run-evaluation-session.mjs       # thin CLI and suite commands
  evaluation-runner.mjs            # Git fixtures, schedule, policy, blinding
  session-controller.mjs           # Git-specific multi-turn behavior
```

Do not add a generic command-line framework. The two existing CLIs have different domain vocabularies and remain separate front doors.

## Ownership Boundary

| Concern | Authoritative owner |
| --- | --- |
| Canonical JSON and SHA-256 transmission digest | `scripts/evaluation/runtime.js` |
| Exact external-model authorization gate | `scripts/evaluation/runtime.js` |
| Exclusive artifacts, terminal records, and common result envelope | `scripts/evaluation/runtime.js` |
| Abortable child lifecycle and raw stream retention | Provider adapter using shared runtime primitives |
| Stable root, role paths, markers, leases, rotation, and quarantine | `scripts/evaluation/evaluation-homes.js` |
| Explicit inspect, initialize, and one-time Codex login commands for stable homes | `scripts/evaluation/manage-evaluation-homes.js` |
| Operation-scoped Windows metadata process and closed JSONL client | `scripts/evaluation/windows-path-metadata.js` |
| Read-only Windows drive type, file attributes, and reparse-point metadata | `scripts/evaluation/windows-path-probe.ps1`, called only through the metadata client |
| JSONL RPC, initialize, account read, skills check, thread lifecycle, and Codex event normalization | `scripts/evaluation/codex-app-server.js` |
| Claude arguments, stream parsing, and Claude event normalization | `scripts/evaluation/claude-cli.js` |
| Concept cases, arms, repetitions, grading, and aggregation | `evals/defining-concepts/` |
| Git schedule, fixtures, revisions, scope semantics, approval policy, state capture, and blinding | `evals/committing-to-git/` |

The shared layer owns mechanics and verifiable invariants. A suite controller owns the meaning of assistant output and any decision to continue a conversation.

## Public Module Contracts

These are the implementation interfaces. Keep all unlisted helpers private. Use JSDoc typedefs in the implementation so Node remains the only runtime dependency. The one test-only dependency bundle is explicitly named in the home-manager contract; no signature gains another production responsibility or weakens an invariant named here.

### Shared runtime

`scripts/evaluation/runtime.js` exports exactly these production operations:

```js
export const EXTERNAL_MODEL_AUTHORIZATION_STATEMENT =
  "I authorize exactly one external model session for this provider, model, effort, and transmission SHA-256.";

export function canonicalJsonBytes(value) {}
export function sha256Hex(bytes) {}
export function createTransmissionPacket(transmission) {}
export function assertTransmissionPacket(packet) {}
export async function prepareEvidenceSession({
  destination,
  packet,
  inputs,
  clock,
}) {}
export async function executeAuthorizedModelSession({
  preparedSession,
  allowExternalModelCall,
  authorization,
  assertCurrent,
  adapter,
  request,
  signal,
  clock,
}) {}
export async function consumeExternalModelLaunch(
  launchCapability,
  expectation,
) {}
```

`canonicalJsonBytes` returns a `Buffer`; `sha256Hex` accepts only a `Uint8Array` and returns lowercase hexadecimal. Callers perform intentional text encoding before hashing.

`prepareEvidenceSession` accepts an already asserted packet and an ordered array of `{ id, mediaType, bytes }`. IDs must be unique lowercase ASCII identifiers from the packet, and every byte sequence must match the packet-bound length and digest. The runtime derives the closed `inputs/` path grammar below; callers cannot supply filesystem paths. It exclusively creates the prepared directory and immutable input artifacts and returns a frozen `{ schemaVersion, preparedSession, transmissionSha256, artifacts }` reference.

`executeAuthorizedModelSession` is the only shared orchestration entry for a hosted turn. It reads and byte-validates the canonical `packet.json`, exclusively acquires the local execution evidence transaction, requires top-level `allowExternalModelCall === true`, validates the distinct exact authorization artifact, runs the asynchronous read-only `assertCurrent(transmission)` callback, and only then calls `adapter.execute(context)`. It always attempts to create the terminal record after evidence acquisition, including when authorization or current-state validation fails. Its provider adapter has this exact port:

```ts
type ProviderAdapter = {
  provider: "openai" | "anthropic";
  execute(context: {
    launchCapability: object;
    transmission: object;
    evidence: EvidenceSink;
    request: object;
    signal?: AbortSignal;
  }): Promise<AdapterResult>;
};
```

The opaque `launchCapability` is held in a module-private registry. An adapter must call `consumeExternalModelLaunch` with `{ provider, model, effort, transmissionSha256 }` immediately before its first provider process that can start a model turn. Consumption atomically creates and flushes `attempt.json` and removes the capability from the registry; a second consumption or an existing attempt fails. Adapters, and no suite module, import this consumer. A repository search and import-boundary test enforce that convention.

The runtime supplies an evidence sink with only these methods:

```ts
type EvidenceSink = {
  appendTranscript(bytes: Uint8Array): Promise<void>;
  appendNormalizedEvent(event: object): Promise<void>;
  appendStderr(bytes: Uint8Array): Promise<void>;
  writeFinal(bytes: Uint8Array): Promise<void>;
  writeSuiteArtifact(artifact: {
    relativePath: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<void>;
};

type AdapterResult = {
  status: "completed" | "failed";
  failureClass:
    | "launch-failed"
    | "protocol-failed"
    | "capability-rejected"
    | "timed-out"
    | "controller-failed"
    | "provider-failed"
    | null;
  error: Record<string, unknown> | null;
  nativeUsage: unknown;
  normalizedUsage: {
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    costUsd: number | null;
  };
  closure: ReleaseDisposition;
  suiteResult: unknown;
};
```

Byte-writing methods accept only `Uint8Array`; `appendNormalizedEvent` accepts one closed-schema I-JSON event and canonicalizes it before appending. Artifact paths are relative, traversal-free, and exclusively owned by the prepared session. `nativeUsage`, `error`, and `suiteResult` must be I-JSON values after auth redaction; a failed result has a non-null failure class, while a completed result has `failureClass: null` and `error: null`. The runtime closes and syncs streams, hashes artifacts, writes `metrics.json` and `timing.json`, and creates `run.json` last. Provider adapters do not create common terminal files themselves.

### Evaluation homes

`scripts/evaluation/evaluation-homes.js` exports exactly:

```js
export const EVALUATION_HOME_ROLES = Object.freeze([
  "preflight",
  "execution",
]);
export function evaluationHomesRootFromLocalAppData(localAppData) {}
export async function inspectEvaluationHomes({ root, testDependencies }) {}
export async function initializeEvaluationHomes({ root, testDependencies }) {}
export async function withEvaluationHome(
  { root, role, operationId, testDependencies },
  operation,
) {}
```

`evaluationHomesRootFromLocalAppData` is pure. `inspectEvaluationHomes` performs no writes and returns a versioned inventory of the root, markers, roles, live leases, quarantines, completed history, containment, volume, and reparse status. `initializeEvaluationHomes` either exclusively creates one fully marked empty layout or makes no adoption/replacement; it never repairs an ambiguous partial layout.

`testDependencies`, when present, is the closed bundle `{ clock, randomBytes, pathMetadata, failAfterPhase }`. It is a direct module argument that no CLI, packet, environment variable, or suite module can populate, and the exact production root rejects it. Production callers omit it and receive Node's real clock, cryptographic randomness, filesystem operations, and Windows metadata probe. An import-boundary test permits the option name only in the home module and its test file.

`operationId` is a caller-generated 128-bit identifier encoded as 32 lowercase hexadecimal characters. For an evaluation execution it equals `preparedSessionId`; the operator CLI generates a fresh value for each login operation. It is recorded in lease evidence and journals but is never interpolated into a path without validation.

`withEvaluationHome` is the only rotation entry. The operation receives a frozen context:

```ts
type EvaluationHomeContext = Readonly<{
  role: "preflight" | "execution";
  path: string;
  environment: Readonly<{ CODEX_HOME: string }>;
  registerChild(childProcess: ChildProcess): void;
}>;
```

Every spawned child that can hold the home is registered immediately. The callback returns `{ value, release }` with this exact release shape:

```ts
type ReleaseDisposition =
  | {
      status: "safe";
      exitStatus: "not-started" | "observed";
      exitCode: number | null;
      exitSignal: string | null;
      stdioStatus: "not-opened" | "closed";
      protocolStatus: "not-opened" | "closed" | "not-applicable";
      terminationActions: Array<"interrupt" | "terminate" | "kill">;
      descendantStatus: "none-observed";
    }
  | {
      status: "unsafe";
      reasonCode:
        | "callback-failed"
        | "shutdown-ambiguous"
        | "stdio-open"
        | "protocol-open"
        | "descendant-suspected";
      diagnostics: Record<string, unknown>;
    };
```

The closed `unsafe.reasonCode` set is `callback-failed`, `shutdown-ambiguous`, `stdio-open`, `protocol-open`, and `descendant-suspected`; `diagnostics` is a redacted serializable object and never contains environment or authentication values. The manager independently checks its registered child trackers. `not-started`/`not-opened` is valid only when no child was created. An `unsafe` result, throw, missing field, contradiction, live stream, unobserved exit, unknown protocol state, or suspected descendant preserves the lease and paths. The operation result cannot authorize mutation outside the active role, lease token, and two exact quarantines.

On Windows, the manager's private metadata port invokes the fixed repository script without a shell using this exact argument shape:

```text
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File <absolute-repository-path-to-windows-path-probe.ps1>
```

`windows-path-metadata.js` owns exactly one PowerShell child for each public home-manager operation. It sends closed `{ schemaVersion, id, path }` JSONL requests, requires matching identified responses, rejects malformed or unanswered requests, bounds shutdown, and waits for confirmed process closure. `windows-path-probe.ps1` is read-only and processes those literal paths until stdin closes. Each response contains `{ schemaVersion, id, result }`, where `result` is `{ schemaVersion, exists, fullPath, isContainer, attributes, drive }`, `attributes` is a sorted array of .NET `FileAttributes` names, and `drive` contains the resolved root and `DriveType`. The worker never enumerates children, resolves a wildcard, writes a path, or imports a profile. The Node manager performs non-following, one-directory-at-a-time enumeration and probes every existing ancestor and candidate entry before descent or mutation. It accepts only `DriveType: "Fixed"`, rejects any `ReparsePoint` attribute, and compares the normalized drive root for same-volume operations. Tests inject the metadata port for race/fault cases and exercise the real streaming client only against test-owned paths on Windows.

The production stable-home backend is Windows-only in this version because the accepted root and verified keyring behavior are Windows-specific. On another platform it returns `unsupported-platform` before mutation. Platform-neutral pure invariants run everywhere through the injected test metadata port; a future platform backend requires its own path, credential, and durability design rather than pretending these Windows guarantees transfer unchanged.

`scripts/evaluation/manage-evaluation-homes.js` is a thin operator CLI over that module. It exposes only:

```text
inspect    --root <absolute-path>
initialize --root <absolute-path> --confirm-root <identical-absolute-path>
login      --root <absolute-path> --confirm-root <identical-absolute-path>
           --role <preflight|execution> --codex-command <command>
           [--codex-prefix-arg <argument>]...
           --allow-interactive-login
```

After any explicitly supplied, reviewable prefix arguments, `login` invokes the exact argv suffix `-c`, `cli_auth_credentials_store="keyring"`, `login` through `withEvaluationHome`, with `CODEX_HOME` set only in the child environment. Production uses command `codex` with no prefix; tests use `process.execPath` plus one fake-script prefix argument. It performs no model turn and never writes `.codex/config.toml`. The agent must still obtain separate authorization immediately before a real initialization or login command; the flag is an accident barrier, not proof of conversational approval.

### Codex App Server

`scripts/evaluation/codex-app-server.js` exports exactly:

```js
export async function inspectCodexAppServerToolchain({
  command,
  prefixArguments,
  scratchRoot,
  environment,
}) {}
export async function preflightCodexAppServer({
  toolchain,
  policy,
  withHome,
  evidenceDestination,
  timeoutMs,
  signal,
}) {}
export const codexAppServerAdapter = Object.freeze({
  provider: "openai",
  async execute(context) {},
});
```

The toolchain inspection resolves and fingerprints the executable plus bound prefix files, records the exact version, generates the exact-version JSON Schema bundle in `scratchRoot`, and returns its canonical manifest and digest. `preflightCodexAppServer` is a zero-turn high-level operation. It exclusively creates `toolchain.json`, `policy.json`, `transcript.jsonl`, `events.jsonl`, and `stderr.log`, then writes terminal `preflight.json` last beneath the new `evidenceDestination`. `withHome(operation)` is supplied by the suite and delegates to `withEvaluationHome`; the adapter neither derives a root nor selects a role. The private RPC client and session state machine are unreachable as exports.

### Claude CLI

`scripts/evaluation/claude-cli.js` exports exactly:

```js
export async function inspectClaudeCliToolchain({
  command,
  prefixArguments,
  environment,
}) {}
export async function preflightClaudeAuth({
  toolchain,
  environment,
  timeoutMs,
  signal,
}) {}
export const claudeCliAdapter = Object.freeze({
  provider: "anthropic",
  async execute(context) {},
});
```

The adapter implements the shared execution port without pretending that streamed CLI output is an RPC session. `inspectClaudeCliToolchain` accepts only the private Claude Code `2.1.233` capability profile established by this plan; version drift is an incompatibility, not a best-effort flag downgrade. The adapter creates exactly one child process per authorized defining-concepts session, consumes the launch capability immediately before spawn, and returns provider-native and normalized results plus direct-child closure evidence.

### Suite controller port

The Codex adapter receives one immutable controller object. The Claude adapter accepts the same object only when `maxTurns === 1` and no interactive permission can be requested:

```ts
type SessionController = Readonly<{
  schemaVersion: 1;
  maxTurns: number;
  initialInput: ReadonlyArray<Readonly<{ type: "text"; text: string }>>;
  onTurnCompleted(event: TurnCompletedEvent): Promise<TurnDecision>;
  onApprovalRequest(event: ApprovalEvent): Promise<ApprovalDecision>;
}>;
```

`onTurnCompleted` returns exactly one of `{ action: "complete", suiteResult }`, `{ action: "continue", transitionId, input }`, or `{ action: "reject", failureClass, reason }`. `onApprovalRequest` returns `{ decision: "allow", permissions, scope: "turn", reason }` or `{ decision: "deny", reason }`. The adapter validates these provider-neutral decisions and privately serializes the pinned protocol response. Every continuation input and transition ID is checked against `continuationPolicy` before transmission and appended to evidence when sent.

`maxTurns` must be a positive safe integer no greater than 32 and must equal the packet's continuation limit. The two migrated suites use only 1, 2, or 3; the wider bound keeps the port reusable without allowing an unbounded conversation.

A turn-completed event is `{ turnIndex, status, finalAnswer, nativeUsage, nativeEventRange }`; `status` is `completed`, `failed`, or `cancelled`, and `nativeEventRange` points into retained transcript evidence rather than copying raw protocol objects into domain state. An approval event is `{ turnIndex, kind, cwd, command, permissions, nativeEventIndex }`, where `kind` is `command`, `filesystem`, `network`, or `external`; fields that do not apply are `null`, never omitted. The adapter rejects an upstream request it cannot represent in this closed shape before calling the controller.

## Shared Runtime Contract

### Canonical values

Packet canonicalization implements RFC 8785 JCS rather than a repository-specific "sorted JSON" dialect. Input must satisfy RFC 7493 I-JSON:

- `null`, booleans, finite IEEE 754 binary64 JSON numbers, and Unicode strings.
- Dense arrays whose order is preserved and whose object members are recursively canonicalized.
- Plain objects with unique property names sorted as raw UTF-16 code units, independent of locale.
- No inter-token whitespace and UTF-8 output.
- No Unicode normalization; exact string code points are preserved.

Reject `undefined`, functions, symbols, big integers, non-finite numbers, sparse arrays, cycles, accessors, `toJSON` hooks, non-plain prototypes, and lone Unicode surrogates. Values that need integer precision beyond the I-JSON interoperable range are represented as decimal strings by the packet schema.

Use ECMAScript JSON primitive serialization exactly as JCS specifies and test against RFC 8785 vectors, including numeric and non-ASCII property-order cases. The digest is lowercase hexadecimal SHA-256 over the canonical UTF-8 bytes. Record `canonicalization: "RFC8785"` and `digestAlgorithm: "SHA-256"` so future formats cannot silently reuse the field with different semantics.

### Transmission packet

The common packet has this logical shape:

```js
{
  schemaVersion: 1,
  canonicalization: "RFC8785",
  digestAlgorithm: "SHA-256",
  transmission: {
    suite,
    session,
    provider,
    model,
    effort,
    transport,
    toolchain,
    runtimeFingerprint,
    capabilities,
    isolation,
    harnessControlledInputs,
    continuationPolicy
  },
  transmissionSha256
}
```

`harnessControlledInputs` contains every exact string or byte-preserving encoding the harness controls and sends to the provider, including base and developer instructions, user inputs, and declared dynamic-continuation templates. It does not contain only mutable source paths. Each textual item records its role, media type, exact content, UTF-8 byte length, and SHA-256. Source paths and source hashes may appear as provenance, but execution consumes the packet-bound bytes.

`session` includes a cryptographically random 128-bit `preparedSessionId` in addition to the suite's deterministic case, arm, repetition, and sequence identity. The identifier binds authorization and evidence to one preparation, while the deterministic fields preserve schedule analysis. It is generated once during preparation, encoded as 32 lowercase hexadecimal characters, and never regenerated during execution.

Provider-owned hidden instructions cannot be captured by the harness. Their reproducibility anchor is the exact provider/model, Codex executable version, App Server protocol-schema digest, and transport fingerprint. Documentation and reports must distinguish these provider-owned inputs from exact harness-controlled bytes.

`toolchain` records Node, operating-system, provider CLI, and protocol versions. For Codex it also records the resolved PowerShell host/version used for home metadata and a digest of the version-specific App Server JSON Schema bundle; the path-probe source itself is covered by the runtime fingerprint. `runtimeFingerprint` records the full harness Git commit and tree plus SHA-256 values for every execution module; preparation rejects dirty relevant modules rather than describing uncommitted behavior as the committed harness.

`continuationPolicy` binds the controller implementation hash, maximum turns, allowed state transitions, and any deterministic reply templates. Dynamic continuation bytes are recorded when sent. They need not be known at preparation time only when the approved packet narrowly defines the function and facts from which they may be derived; arbitrary free-form continuation is not authorized by a template policy.

`capabilities` records requested network access, web search, dynamic tools, and provider-specific facilities. `isolation` records sandbox, working-directory, instruction-source, persistence, and stable-home requirements.

`isolation.environment` is a positive policy, not a dump of `process.env`. On Windows the base pass-through names are exactly `SystemRoot`, `WINDIR`, `ComSpec`, `PATH`, `PATHEXT`, `TEMP`, `TMP`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `LOCALAPPDATA`, `APPDATA`, and `PROGRAMDATA`; absent keys remain absent. Their non-secret values are packet-bound exact strings and execution uses those packet bytes rather than rereading changed ambient values. Codex adds only the manager-supplied packet-validated `CODEX_HOME` and deliberately omits `OPENAI_API_KEY` so the inspected stable-home keyring auth is authoritative. Claude omits every inherited `CLAUDE*` and `ANTHROPIC*` key by default, then passes `ANTHROPIC_API_KEY` only when the packet explicitly selects API-key authentication instead of the inspected keychain/OAuth mode. Proxy or custom-certificate variables are absent unless individually named and approved in the packet. Secret values are never packet content or evidence; the packet records the permitted name, source class, and required presence, and execution rejects an auth-mode change.

Windows environment-name comparison is case-insensitive. Normalize names to uppercase for policy comparison, preserve one canonical spelling when spawning, and reject case-colliding source entries instead of letting last-write order decide which value wins.

The digest covers the `transmission` object. Every schema object is closed: a packet assertion recomputes the digest and rejects unknown schema versions, unknown members, missing required fields, invalid enums, and a mismatch.

`packet.json` itself is stored as the canonical UTF-8 encoding of the complete packet with no trailing newline. Execution parses it, reserializes it canonically, and requires byte equality before trusting the object. That boundary rejects alternate whitespace, duplicate member names, reordered members, trailing data, and other noncanonical encodings even when a permissive JSON parser would otherwise collapse them to the same JavaScript value.

Every non-JSONL common JSON artifact uses the same canonical UTF-8/no-trailing-newline encoding. `transcript.jsonl` preserves each accepted provider line's original delimiter; `events.jsonl` stores each normalized harness event as one canonical JSON object followed by one LF. Authentication redaction records replace, rather than accompany, the sensitive raw transcript line and identify the covered method.

### Authorization

The execution API accepts a distinct authorization object:

```js
{
  schemaVersion: 1,
  decision: "authorized",
  statement: EXTERNAL_MODEL_AUTHORIZATION_STATEMENT,
  allowExternalModel: true,
  provider,
  model,
  effort,
  transmissionSha256
}
```

Before invoking any provider adapter, the runtime verifies:

1. The separate CLI/API `allowExternalModelCall` accident barrier is literally `true`.
2. The authorization schema, decision, fixed statement, and literal permission are exact.
3. Provider, model, and effort equal the packet.
4. The supplied digest equals the recomputed packet digest.
5. The canonical packet bytes and every prepared input still match their recorded hashes.
6. The toolchain, protocol schema, runtime modules, committed tree, and capability assertions remain current.
7. The execution transaction and its stream files can be acquired exclusively.

The provider process or App Server turn is unreachable before these checks pass. Tests prove this with a launch sentinel, not merely an expected error string.

An authorization is one-use within its prepared session once the provider adapter consumes its opaque launch capability, even if account inspection later fails before a model turn. Consumption creates immutable `attempt.json` immediately before provider launch, and an existing attempt blocks replay. This avoids ambiguous replay after any provider process has observed the packet-bound environment. Copying a prepared directory before consumption can copy its consent artifact, so the operational rule against reuse remains necessary and is stated as a residual limit rather than misrepresented as a global ledger. Preflight exists to reduce launch risk, not to make an authorization reusable.

Preparation, packet inspection, deterministic fixture construction, local grading, blinding, and zero-model tests do not require this hosted-model authorization. A real keyring login, real-home mutation, or network-bearing preflight remains separately visible and authorized according to its own operation.

### Evidence transaction

The runtime creates a unique prepared-session directory using an exclusive `mkdir`. It never treats a prior `exists` check as an overwrite guarantee and never opens an evidence file with a truncating flag.

Each future session retains:

```text
prepared-session/
  packet.json
  inputs/
    manifest.json
    0001-<packet-input-id>.<media-extension>
    0002-<packet-input-id>.<media-extension>
  authorization.json
  attempt.json
  outputs/
    transcript.jsonl
    events.jsonl
    stderr.log
    final.md
  run.json
  metrics.json
  timing.json
```

Suite-specific output files are allowed only when `transmission.session.suiteArtifacts` names their exact relative paths and media types; `writeSuiteArtifact` rejects every other path. The common files preserve their meaning across suites.

Input files use their zero-padded packet order and an ID matching `[a-z][a-z0-9-]{0,63}`; the media extension is selected from the closed mapping `text/plain -> txt`, `text/markdown -> md`, `application/json -> json`, and `application/octet-stream -> bin`. `inputs/manifest.json` lists every packet input, exact relative path, media type, byte length, and SHA-256. The two rows in the tree illustrate the naming rule; the manifest length is exactly the packet's input count.

`authorization.json` exists only after the distinct authorization artifact passes its complete schema and exact-match checks; the runtime stores its canonical bytes exclusively. `attempt.json` exists only after launch-capability consumption. Authorization rejected before either boundary leaves the corresponding file absent and records `authorization-rejected` in the terminal record; absence of `attempt.json` is evidence that the conforming runtime did not reach the provider-launch boundary.

Raw stdout protocol messages are appended to `transcript.jsonl` as they arrive. Raw stderr bytes are retained without depending on an in-memory aggregate. Provider-native usage is retained, and normalized usage is additive; normalization never replaces the native record.

Authentication methods are the deliberate exception to raw protocol retention. Persist a deterministic redaction event and non-identifying auth summary in place of account identity, bearer material, API keys, login URLs, or refresh data. Record that redaction occurred and which protocol method it covered. Preserve the exact observed UTF-8 line bytes and delimiter for non-auth evaluation-turn events; derive normalized event objects separately.

Create directories and files with the narrowest modes Node and the host filesystem honor. Never persist the complete inherited environment or command line when either may contain secrets; persist a key allowlist and redacted argument view. Evidence remains potentially sensitive because model, tool, hook, or Git output can contain repository content or credentials, so documentation must state its local retention and review requirements.

Create stream files once with exclusive flags, retain their open handles for the child lifetime, and close and sync them before hashing. Do not repeatedly reopen a mutable pathname for append. Record SHA-256 and byte length for every finalized input and output artifact.

Use UTC RFC 3339 timestamps from `Date.prototype.toISOString()` for cross-record ordering and a monotonic clock for durations. Wall-clock adjustments must not create negative or inconsistent elapsed times.

`run.json` is the terminal record and is created last with exclusive, flushed semantics. It contains the hashes of every preceding common artifact and an explicit schema version. A failed launch, timeout, malformed protocol, rejected capability, controller failure, or provider failure still receives a terminal record when the evidence directory was successfully acquired. If terminal-record creation itself fails, the command reports that infrastructure failure and leaves all prior evidence untouched.

The runtime never automatically retries a hosted turn. Once provider execution may have begun, a timeout, EOF, or ambiguous transport outcome is retained as spent; replay requires a newly prepared packet and new authorization.

### Failure classes

Use stable machine-readable classes:

- `authorization-rejected`: no provider process or turn started.
- `preflight-rejected`: account or isolation failed before a model turn.
- `launch-failed`: the provider process could not start.
- `protocol-failed`: malformed, unsupported, or inconsistent provider protocol.
- `capability-rejected`: an external or unrequested capability appeared.
- `timed-out`: bounded shutdown was required.
- `controller-failed`: suite conversation semantics rejected the output or state.
- `provider-failed`: the provider returned a terminal error.
- `completed`: suite completion criteria were met.

Errors retain a serializable name, code where available, safe message, phase, and causal class. Authentication-bearing payloads are summarized before persistence.

## Stable Evaluation Homes

### Root and role layout

The production default is derived from `%LOCALAPPDATA%` and must normalize exactly to the approved root on this machine:

```text
C:\Users\maksy\AppData\Local\OpenAI\Codex\EvaluationHomes\v1\
  .evaluation-homes-root.json
  .leases\
    preflight.lock\                 # present only while active/blocked
      lease.json
      journal.jsonl
    execution.lock\                 # present only while active/blocked
      lease.json
      journal.jsonl
  .quarantine\
  .history\
    <operationId>-<role>-<leaseToken>.completed\
      lease.json
      journal.jsonl
  preflight\
    .evaluation-home-owner.json
  execution\
    .evaluation-home-owner.json
```

Tests inject a temporary root. No automated test accesses the production default.

The root marker records:

- Marker schema and manager identifier.
- Exact normalized and resolved root.
- Allowed roles: exactly `preflight` and `execution`.
- Creation identity and a random root nonce.

Each home marker records:

- Marker schema and manager identifier.
- Root nonce.
- Exact role and stable path.
- A random home generation nonce.
- Creation time for diagnosis, not authorization.

### Validation

Before creation, rename, or deletion, validate the exact target, the nearest existing parent of a not-yet-created target, and every existing ancestor from the volume root through the managed path using non-following Node metadata, the fixed Windows attribute/drive probe, normalized paths, resolved paths, and marker contents.

Reject:

- A target outside the exact approved or explicitly injected root.
- A UNC path, network filesystem, cross-volume quarantine path, drive-relative path such as `C:relative`, or a path whose volume identity differs from the approved local root.
- A root or home whose marker is absent, malformed, or mismatched.
- A role other than `preflight` or `execution`.
- A symbolic link, junction, mount point, or unexpected reparse point in a managed path.
- A quarantine name not generated by the current lease.
- A completed-history destination that already exists or does not exactly encode the active operation, role, and lease token.
- A root, home, or quarantine whose resolved identity changed between validation and mutation.
- An existing lease, including one that merely appears stale.
- A reparse point anywhere in a quarantine subtree before recursive deletion.

The ordinary API never scans arbitrary directories looking for something to clean. It operates only on paths derived from the validated root, role, lease token, and generation token.

Deletion never uses `rm({ recursive: true })` or another opaque recursive remover. Walk each owned quarantine bottom-up with `opendir`, apply non-following Node metadata and the Windows probe immediately before descent or removal, `unlink` validated non-directory entries, and `rmdir` validated empty directories. A newly observed entry or identity change restarts validation for that entry; a reparse point or ambiguity stops the operation and preserves the lease.

Use directory leases rather than a partially writable lock file. Atomic non-recursive `mkdir` acquires `<role>.lock`; `lease.json` is then created exclusively and flushed. Append each lifecycle phase to `journal.jsonl` through one held handle and sync it before the next namespace mutation. The journal is recovery evidence, not permission to infer or repeat an incomplete destructive step.

### Lease and rotation lifecycle

1. Validate the root and acquire the role lease with atomic non-recursive directory creation.
2. Exclusively record operation ID, process ID, role, root nonce, and a cryptographically random lease token, then append and sync the acquired phase.
3. Revalidate the stable home and marker.
4. Rename the prior stable home to a same-volume, token-bound quarantine path.
5. Create the fresh stable directory and owner marker exclusively.
6. Revalidate that `CODEX_HOME` is the exact stable path.
7. Launch the preflight, login, or execution child with the process-local environment override and immediately register it with the operation context.
8. Require the callback to return the exact release disposition and cross-check it against registered-child `exit` and stdio `close` observations, protocol shutdown, and bounded termination actions.
9. Revalidate and rotate the used stable home into a second token-bound quarantine.
10. Create a clean marked stable home for the next operation.
11. Recursively inspect each owned quarantine without following links; validate and delete only the two reparse-free quarantines created under the active lease.
12. Append and sync the completed phase, close the journal handle, and atomically rename the exact lease directory to `.history\<operationId>-<role>-<leaseToken>.completed`; that final rename releases the live role lock while retaining its immutable `lease.json` and `journal.jsonl`.

Append and sync a phase record before and after each rename/create/delete boundary. Same-volume rename makes each individual namespace transition atomic; the journal makes the multi-step lifecycle diagnosable but does not turn it into a filesystem transaction. Completed history is append-only, is never treated as authority for a later mutation, and is not automatically pruned.

If the callback throws, omits the safe-release disposition, the process crashes between steps, stdio closure is unknown, or a descendant process may still hold the home, leave the lease and owned paths for explicit diagnosis. A provider failure may still release safely only when the adapter returns a terminal failure record together with affirmative closure evidence. Do not guess that a process ID proves a lease is dead, and do not auto-steal it. Recovery or repair commands are outside this implementation and require a separate design and authorization.

The manager library does not inspect, rotate, delete, export, or otherwise modify OS-keyring entries. Stable paths preserve the observed keyring namespace; directory rotation removes filesystem residue. The separate operator CLI may ask `codex login` to store a credential under a separately authorized process-only keyring override, but it never manipulates the keyring directly.

### Initialization and login boundary

The first production initialization is an explicit operation, separate from module import, test execution, packet preparation, and evaluation execution. Initialization may create the exact approved root and the two marked homes only after a read-only precheck proves that no unowned entry would be adopted or replaced.

Each role may require a one-time `codex login` because local probes showed that this CLI installation scopes keyring retrieval by `CODEX_HOME`. Login is performed only by the explicit operator command after separate authorization, never by an evaluation run. The login operation uses the ordinary rotate/run/rotate lifecycle, which cleans filesystem residue while retaining the OS-keyring credential associated with the stable path.

The `preflight` role proves the zero-turn protocol and isolation workflow in its own credential namespace. It does not prove that the separate `execution` credential exists. Every execution therefore repeats account and effective-isolation checks inside the freshly rotated `execution` home before starting the first turn. A separately authorized preflight may also inspect the execution role before packet authorization when the operator wants to validate both keyring namespaces without a model call.

## Codex App Server Adapter

### Transport interface

The adapter exports only the three high-level operations fixed in `Public Module Contracts`: toolchain inspection, zero-turn preflight, and the shared adapter object consumed by `executeAuthorizedModelSession`. There is no exported open session, raw request, unauthenticated thread, or standalone turn function. The private implementation preserves these lifecycle states:

```text
spawned -> initialized-requested -> initialized-notified -> authenticated
        -> isolated -> thread-open
        -> turn-running -> turn-complete -> thread-closed -> process-exited
```

Before packet preparation, a read-only toolchain probe runs the exact executable's `--version` and `app-server generate-json-schema` commands. Hash the generated schema bundle as a canonical sorted list of relative path, byte length, and SHA-256 entries. The packet binds the executable identity, version, and schema-bundle digest. Execution repeats the probe and rejects drift before account inspection or a turn. Retain one schema bundle per run set or toolchain catalog, not one duplicate per repetition.

Use the generated schema as the authoritative message-shape reference for the pinned Codex version. Hand-written runtime assertions may enforce narrower evaluation invariants, but they must not redefine upstream fields or accept shapes the generated schema rejects.

The adapter owns:

- JSONL framing and request IDs.
- Pending-request resolution and rejection.
- Notification capture.
- Request handling delegated to a supplied approval callback.
- `initialize` exactly once followed by exactly one `initialized` notification.
- `account/read` with `refreshToken: false` and a redacted authentication summary.
- Exact stable method `modelProvider/capabilities/read` to verify provider/model/effort support before a turn; absence from the pinned schema blocks the adapter version.
- Forced-refresh `skills/list`, `hooks/list`, effective app state, and other stable effective-isolation assertions exposed by the pinned schema.
- Ephemeral thread construction.
- Empty or explicitly packet-bound instruction sources.
- Exact model and disabled provider fallback.
- Working directory and runtime workspace roots.
- Sandbox, network, tools, and web-search capability assertions.
- Token-usage and item-event collection.
- Final-answer extraction from a completed final agent item.
- Thread deletion and bounded process shutdown.

The adapter does not parse a Git scope question, validate a commit proposal, choose a concept grade, or decide whether another turn is semantically warranted.

### Capability policy

The packet names every requested external capability. The adapter fails before a model turn when it cannot express or verify the requested policy against the installed App Server.

Verify both requested and effective state. Configuration overrides are necessary input, not proof that the effective thread has no skills, hooks, apps, plugins, MCP servers, subagents, memories, or inherited instructions. Use stable production endpoints from the pinned schema. Do not call endpoints that the official protocol marks under development merely to make a stronger-sounding claim; bind those sources through configuration, thread response, event observation, and the stable inspection surfaces that exist.

`committing-to-git` requests no web or network capability and a fixture-scoped workspace-write sandbox.

`defining-concepts` requests the suite's documented web-search capability and the narrowest compatible filesystem sandbox. If App Server or the installed version cannot provide that exact profile, the run is invalid rather than silently downgraded.

### Controller callback

Turn completions and permission or external-capability requests are passed to the exact suite-controller port defined above with immutable session context. The adapter records the request and returned decision. An exception or malformed decision fails closed.

The callback returns a capability decision, not raw protocol text. The adapter validates and serializes the version-specific response. Requests received in an invalid session state, after terminal completion, or outside the packet's capability set are denied and terminate the evaluation attempt.

## Claude CLI Adapter

The Claude adapter exposes the same normalized completion boundary, not an artificial App Server abstraction. It owns:

- A zero-model `claude auth status` JSON preflight when requested.
- Argument construction for non-interactive streamed JSON.
- Exact model, turn, tool, permission, and persistence options supported by the installed CLI.
- `--safe-mode` isolation, an explicit empty strict MCP configuration, disabled slash commands, disabled Chrome and prompt suggestions, and explicit built-in/MCP tool restrictions.
- A fresh non-repository working directory.
- Process-local environment construction.
- JSONL parsing and provider-native event retention.
- Final-answer, usage, and timing normalization.
- Timeout, termination, exit, and malformed-stream handling.

The adapter records the exact executable, the mandatory `--version` result, and actual arguments with secrets removed. A plan-time read-only probe observed Claude Code `2.1.233`; the adapter contains one private capability profile for that exact version and rejects every other version until its documented semantics receive explicit review and tests. Unsupported required flags or capabilities fail before model execution.

Use current documented flags rather than inferring support solely from `--help`, which Anthropic documents as incomplete. Pin and test the exact CLI version/capability profile. Use `--safe-mode`, not `--bare`: the installed CLI documents that `--bare` disables OAuth/keychain reads and permits explicitly named skills, while `--safe-mode` disables customization sources without replacing normal authentication. Preserve the default provider system prompt and append exact evaluation instructions; record that provider-owned default content is outside the harness digest.

Do not claim that Claude and Codex have identical credential or storage isolation. The normalized record exposes the verified provider-specific profile.

## Suite Controllers

### `defining-concepts`

`evals/defining-concepts/session-controller.mjs` exports exactly:

```js
export function createDefiningConceptController({ initialInput }) {}
```

`initialInput` is a frozen nonempty array of `{ type: "text", text }` items whose exact strings come from packet inputs; unknown item types are rejected.

The returned controller is intentionally small:

1. Receive the packet-bound prompt and optional skill instructions.
2. Start exactly one turn.
3. Reject any unrequested permission or capability event.
4. Return the authoritative completed final answer and native usage.

It always declares `maxTurns: 1`; `onTurnCompleted` can return only `complete` or `reject`, never `continue`.

Case selection, with-skill/without-skill preparation, repetitions, grading, source verification, aggregate generation, and invalid-attempt accounting remain in the suite.

The CLI gains an explicit prepare/run boundary. Preparation emits an immutable packet and its digest without starting a provider. Run consumes that packet and requires exact authorization flags. Historical result directories are read-only and are not converted to the new envelope.

### `committing-to-git`

`evals/committing-to-git/session-controller.mjs` exports exactly:

```js
export const EXACT_COMMIT_AUTHORIZATION_REPLY =
  "I approve the exact message and authorize creating the proposed local commit for the exact scope shown. Do not push.";
export function createCommittingToGitController({
  session,
  observeGitState,
}) {}
```

`session` is the frozen packet-derived object `{ initialInput, fixtureRoot, expectedScope, scopeClarification, authorizationEligible, approvalPolicy }`. `scopeClarification` is either `null` or `{ options, predeterminedScopeId }`; `approvalPolicy` is exactly `{ readableRoots }`, with normalized absolute paths. Writes are allowed only beneath `fixtureRoot`, reads only beneath `fixtureRoot` or a listed readable root, and network/external permissions are always denied. `observeGitState(fixtureRoot)` returns the suite's existing canonical state object with its SHA-256. The controller receives no provider command, home path, raw RPC client, evidence writer, or filesystem cleanup authority.

All parsing and transition helpers stay private and are tested through the controller's observable decisions. The returned controller retains:

- Exact expected scope and fixture state.
- Scope-question parsing.
- Clarification selection and reply.
- Commit-proposal parsing.
- Approval-request decisions.
- Git-state observation before and after relevant turns.
- The exact commit-authorization continuation.
- Rejection of invalid proposals without authorization.

It declares `maxTurns: 2` when no scope clarification is configured and `maxTurns: 3` when one clarification is configured. The only allowed continuation transition IDs are `scope-selection` and `exact-commit-authorization`, in that order when both occur; neither can repeat.

The suite runner retains schedule generation, isolation catalog discovery, Git fixture creation, pinned skill extraction, treatment validation, and blinded grading bundles.

Preparation stops creating packet-local `runtime-home-preflight` and `runtime-home-run` directories. Packets instead bind the stable role and approved root policy without embedding disposable credential namespaces.

## Historical Evidence Compatibility

- Do not edit any existing file under either `evals/*/results/` tree.
- Do not rewrite historical packet digests.
- Do not make historical records claim the new runtime or stable-home guarantees.
- Preserve tests that validate existing result schemas and retained calibration evidence.
- Introduce the common future schema with an explicit version.
- Keep provider-native fields available even when common normalized fields are added.
- If a reader supports both schemas, branch explicitly by version; do not infer a schema from missing fields.

## Duplication Removal Map

| Existing implementation | Destination or disposition |
| --- | --- |
| `sha256`, `canonicalJson`, `transmissionPacketDigest`, and packet assertions in `evaluation-runner.mjs` | `scripts/evaluation/runtime.js` |
| `sha256`, directory preparation, process capture, JSONL dispatch, timing, and usage plumbing in the defining runner | Shared runtime and provider adapters |
| `writeJsonArtifactExclusive` and `writeRunRecordExclusive` | Shared runtime |
| `preparedRuntimeHome` and `withRuntimeHome` | Stable-home manager plus adapter environment construction |
| `JsonlRpcClient` and generic RPC error serialization | `scripts/evaluation/codex-app-server.js` |
| App Server initialize, account, skills, isolation, thread, token, and cleanup mechanics | `scripts/evaluation/codex-app-server.js` |
| Scope parsing, proposal parsing, Git approval policy, and Git state transitions | `evals/committing-to-git/session-controller.mjs` |
| Claude transcript parsing and launch arguments | `scripts/evaluation/claude-cli.js` |
| Codex `exec` transcript parsing | Removed after defining-concepts uses App Server |

Independent test or fixture hashing may remain where it acts as an oracle. Production implementations of the same invariant must have one owner.

## Configuration Boundary

This plan authorizes no configuration edit. In particular, do not change:

- `package.json` or a lockfile.
- `eslint.config.js` or formatting configuration.
- Build or CI configuration.
- `.codex/config.toml`.
- `.claude/`.
- `evals/*/evals.json` or `trigger-evals.json`.

If implementation demonstrates that one of those files must change, identify the exact file and field, explain the behavioral and pipeline impact, propose the smallest change, and stop for exact approval before editing it.

## Testing Strategy

Tests use fake provider processes and temporary directories. They make no hosted-model call, perform no login, access no real keyring entry, and do not create the production evaluation-home root.

Tests are organized by the interface that owns the behavior:

```text
tests/scripts/evaluation-runtime.test.mjs
tests/scripts/evaluation-homes.test.mjs
tests/scripts/manage-evaluation-homes.test.mjs
tests/scripts/codex-app-server.test.mjs
tests/scripts/claude-cli.test.mjs
tests/evals/run-evaluation-session.test.mjs
tests/committing-to-git/evaluation-runner.test.mjs
```

Replace generic assertions in suite tests after equivalent shared-interface tests pass. Preserve suite-semantic assertions in suite tests. Avoid testing a shared invariant twice through large end-to-end fixtures unless the second test proves an integration boundary that a unit test cannot.

Use four complementary test layers:

1. **Normative vectors:** RFC 8785 canonicalization vectors and version-specific generated App Server schema fixtures.
2. **Pure invariant tests:** Seeded generated values for canonicalization, packet mutation, state transitions, path containment, and result normalization. Print the seed on failure.
3. **Contract tests:** Run every provider adapter against a fake executable that implements the pinned subset of its real protocol and can inject malformed, reordered, partial, and delayed events.
4. **Suite integration tests:** Prove each controller's domain behavior through the shared port without retesting private transport machinery.

Tests must not compute expected packet digests, artifact hashes, path decisions, or normalized events by calling the same production function under test. Use fixed normative values or a deliberately independent oracle. Test names state the invariant and externally observable outcome, not a private helper name.

Run Node tests sequentially for lifecycle-sensitive files. A transport test may create more than one outstanding request inside one fake process to test correlation, but the repository test runner must not launch concurrent provider or home-manager processes against the same fixture.

## Pre-Execution Documentation Boundary

This accepted design and plan is its own documentation change. Before Task 1:

1. Inspect this file and the exact plan-only workspace scope.
2. Verify that no unrelated user-owned path is staged.
3. Use `committing-to-git` to draft a detailed documentation-only commit message.
4. Create a signed local commit only after approval of the exact staged scope and exact message.
5. Do not push.

Plan approval authorizes the architecture. It does not silently stage this file or create the documentation commit.

---

## Task 1: Introduce the Shared Packet and Evidence Runtime

**Files:**

- Create `scripts/evaluation/runtime.js`.
- Create `tests/scripts/evaluation-runtime.test.mjs`.

**Interfaces:** Implement the seven runtime exports and adapter/evidence port exactly as specified in `Public Module Contracts`. No suite may import `consumeExternalModelLaunch`; only `codex-app-server.js`, `claude-cli.js`, and the runtime fake adapter in this test file may import it.

- [ ] **Step 1.1 (RED): Specify canonical packet identity**

Add tests proving:

- RFC 8785 published primitive, numeric, UTF-16 property-order, and UTF-8 vectors match byte for byte.
- Object insertion order does not affect canonical bytes or digest.
- Array order and string bytes do affect the digest.
- Unicode normalization is not performed: canonically equivalent but byte-distinct strings remain distinct.
- Lone surrogates, duplicate parsed object keys at the JSON-input boundary, and non-I-JSON values fail.
- Provider, model, effort, toolchain, runtime fingerprint, capabilities, isolation, controller policy, and every harness-controlled byte each affect the digest.
- Unsupported JavaScript values fail instead of being silently omitted or coerced.
- Packet validation recomputes the digest.
- Unknown schema versions, object members, and enum values fail closed.

Start with an independent fixed-vector assertion rather than deriving the expectation with production code:

```js
test("canonicalJsonBytes matches the RFC 8785 serialization vector", () => {
  const input = {
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
  };
  const expected = Buffer.from(
    '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27]}',
    "utf8",
  );

  assert.deepEqual(canonicalJsonBytes(input), expected);
});
```

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/evaluation-runtime.test.mjs
```

Expected RED result: the shared runtime import is missing or the new contract assertions fail.

- [ ] **Step 1.2 (GREEN): Implement the minimal canonical runtime**

Export narrowly named operations for:

- Canonical JSON bytes.
- SHA-256 hexadecimal digest.
- Transmission-packet creation and assertion.

Keep normalization helpers private.

Do not label a partial sorted-key serializer JCS. Implement and test the whole accepted RFC 8785/I-JSON subset used by packets.

Run the focused test again. Expected GREEN result: all Step 1.1 assertions pass.

- [ ] **Step 1.3 (RED): Specify authorization ordering**

Add an injected launch sentinel and prove it remains untouched for:

- Missing literal permission.
- Digest mismatch.
- Provider mismatch.
- Model mismatch.
- Effort mismatch.
- Toolchain or protocol-schema drift.
- Runtime module or committed-tree drift.
- Mutated packet contents.
- A stale prepared-input assertion.

Also prove that a matching authorization invokes the injected launcher exactly once.

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/evaluation-runtime.test.mjs
```

Expected RED result: the fake adapter is not gated, no opaque capability exists, or the attempt/evidence assertions fail.

- [ ] **Step 1.4 (GREEN): Implement the gated execution entry**

Implement `executeAuthorizedModelSession` and the opaque `consumeExternalModelLaunch` handshake. Perform every deterministic authorization/current-state assertion before invoking the supplied provider adapter. Do not let suite code call a lower-level launch primitive that bypasses the gate.

Run the focused test again. Expected GREEN result: all Steps 1.1-1.4 assertions pass.

- [ ] **Step 1.5 (RED): Specify evidence transaction behavior**

Test:

- Exclusive prepared-directory acquisition.
- Exclusive packet, accepted-authorization, attempt, and terminal-record creation.
- Stream append ordering.
- Separation of byte-preserved provider transcript lines from canonical normalized events.
- One held handle per raw stream; pathname replacement cannot redirect later writes.
- No overwrite after a pre-existing target appears.
- Terminal record written last.
- Terminal record contains byte lengths and SHA-256 values for every preceding common artifact.
- RFC 3339 wall timestamps and monotonic nonnegative durations.
- Complete launch-failure and timeout records.
- Ambiguous provider outcomes are retained and never auto-retried.
- Native and normalized usage coexist.
- Authentication-bearing values are rejected or redacted before persistence.

Exercise the public transaction rather than a private writer:

```js
const result = await executeAuthorizedModelSession({
  preparedSession,
  allowExternalModelCall: true,
  authorization,
  assertCurrent: async () => {},
  adapter: fakeAdapter,
  request: Object.freeze({}),
});

assert.equal(result.status, "completed");
const run = JSON.parse(
  await readFile(join(preparedSession, "run.json"), "utf8"),
);
assert.deepEqual(Object.keys(run.artifacts).sort(), [
  "attempt.json",
  "authorization.json",
  "inputs/0001-prompt.txt",
  "inputs/manifest.json",
  "metrics.json",
  "outputs/events.jsonl",
  "outputs/final.md",
  "outputs/stderr.log",
  "outputs/transcript.jsonl",
  "packet.json",
  "timing.json",
]);
assert.equal(run.transmissionSha256, packet.transmissionSha256);
```

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/evaluation-runtime.test.mjs
```

Expected RED result: the evidence transaction, held stream handles, or terminal-record ordering is missing.

- [ ] **Step 1.6 (GREEN): Implement evidence primitives**

Implement `prepareEvidenceSession` and the private execution transaction used by `executeAuthorizedModelSession`. Use Node built-ins, explicit exclusive file modes, held handles, and flush/sync support available in Node 24. Keep raw streams byte-preserving. Provide bounded in-memory summaries while writing the complete stream to disk.

Run the focused test again. Expected GREEN result: the complete Task 1 contract passes.

- [ ] **Step 1.7: Verify and review**

Run, one command at a time:

```powershell
node --test --test-concurrency=1 tests/scripts/evaluation-runtime.test.mjs
npm run verify
rg -n "consumeExternalModelLaunch" scripts evals tests
git status --short
git diff -- scripts/evaluation/runtime.js tests/scripts/evaluation-runtime.test.mjs
```

Expected `rg` result at this task boundary: definitions/usages only in `runtime.js` and its fake-adapter test. Tasks 3 and 4 add exactly one provider-adapter usage each; suite directories never appear.

Completion criteria:

- Focused and full verification pass.
- No provider executable was launched except injected local fakes.
- No production home exists because of the tests.
- The shared interface is smaller than the mechanics it hides.
- Exact authorization is unreachable from suite-specific bypasses.

Stop at the task commit boundary. Stage only the two task files, draft a detailed message, and obtain exact commit authorization. Do not push.

---

## Task 2: Implement the Stable Evaluation-Home Manager

**Files:**

- Create `scripts/evaluation/evaluation-homes.js`.
- Create `scripts/evaluation/manage-evaluation-homes.js`.
- Create `scripts/evaluation/windows-path-metadata.js`.
- Create `scripts/evaluation/windows-path-probe.ps1`.
- Create `tests/scripts/evaluation-homes.test.mjs`.
- Create `tests/scripts/manage-evaluation-homes.test.mjs`.
- Create `tests/scripts/windows-path-metadata.test.mjs`.

**Interfaces:** Implement the five home-manager exports, fixed Windows probe contract, frozen operation context, exact release disposition, and three CLI commands specified in `Public Module Contracts`. The CLI imports the manager; the manager never imports a provider adapter or CLI parser. The probe is private to the manager and has no mutation mode.

- [ ] **Step 2.1 (RED): Specify root and marker identity**

Using only injected temporary roots, test:

- `%LOCALAPPDATA%` derivation and explicit-root normalization as pure operations.
- Exactly two allowed roles.
- Rejection of UNC, network, drive-relative, and cross-volume roots.
- Exclusive root and home marker creation.
- Marker/schema/root-nonce/role mismatches.
- Refusal to adopt an unmarked existing directory.
- Refusal to replace a non-directory entry.
- Containment after normalization and resolution.
- Non-following rejection of symlinks and junctions where the platform permits creating them.
- A Windows-specific reparse-point guard behind a platform condition.
- One real Windows probe session reports multiple test-owned paths without writing them and reports a test-created junction or symbolic link with `ReparsePoint` before the manager descends.
- The metadata client reuses one worker, rejects malformed, misidentified, or unanswered responses, and terminates a worker that ignores EOF.
- The production backend returns `unsupported-platform` before mutation outside Windows; pure tests use an explicitly injected metadata port.

Use an injected root for every mutating call:

```js
const root = join(testRoot, "EvaluationHomes", "v1");
await initializeEvaluationHomes({ root });
const inventory = await inspectEvaluationHomes({ root });

assert.deepEqual(inventory.roles.map(({ role }) => role), [
  "execution",
  "preflight",
]);
assert.equal(inventory.valid, true);
```

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/evaluation-homes.test.mjs
```

Expected RED result: the manager import is missing or root/marker assertions fail.

- [ ] **Step 2.2 (GREEN): Implement initialization and validation**

Make production-root initialization an explicit exported operation, never an import side effect. Require dependency-injected root values in tests. Use owner markers as authorization data, not informational decoration.

Run the focused test again. Expected GREEN result: all Step 2.1 assertions pass.

- [ ] **Step 2.3 (RED): Specify lease and rotation lifecycle**

Test:

- Exclusive role lease acquisition.
- The lease is an atomic directory with an exclusive flushed owner record.
- Phase journal entries are ordered, appended through one handle, and synced around namespace mutations.
- Contention fails before rename.
- Stable path exists freshly during the callback.
- Prior and used generations move only to token-bound quarantine paths.
- `CODEX_HOME` passed to the callback is the exact stable role path.
- Cleanup waits for callback/child completion.
- Cleanup also waits for the provider process `exit` and stdio `close` evidence.
- Successful release leaves a fresh marked stable home, no owned quarantine, no live role lock, and one immutable completed-history directory containing the synced lease and journal.
- A provider failure with explicit confirmed-closure evidence releases safely and preserves the failure record.
- A thrown callback, missing release disposition, or ambiguous closure preserves the lease and managed paths.
- Marker, identity, or containment change during the operation fails closed.
- A cleanup failure preserves the lease and suspect paths for diagnosis.
- A completed-history name collision preserves the live lease instead of overwriting history or releasing the role lock.
- An existing lease is not auto-stolen based on age or process ID.
- An unrelated quarantine or sibling is never scanned or deleted.
- A reparse point anywhere inside an owned quarantine blocks recursive deletion and preserves evidence.
- Cleanup uses a validated bottom-up `unlink`/`rmdir` walk and never calls an opaque recursive delete API.
- A simulated crash at each journaled phase leaves a diagnosable, non-replayed state.

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/evaluation-homes.test.mjs
```

Expected RED result: the lease, journal, rotation, or release contract is missing.

- [ ] **Step 2.4 (GREEN): Implement leased acquisition**

Implement `withEvaluationHome({ root, role, operationId, testDependencies }, operation)` exactly. Keep raw rename/delete helpers private. The callback receives only the frozen operation context named in the module contract; it never receives authority to clean other generations.

Use cryptographically random tokens, atomic lease-directory creation, exclusive flushed marker files, and an append-only synced phase journal. Revalidate immediately before each rename or delete. On Windows, use same-volume paths beneath `.quarantine`.

Run the focused test again. Expected GREEN result: Steps 2.1-2.4 pass, including every crash injection point.

- [ ] **Step 2.5 (RED): Specify the operator CLI boundary**

Test the CLI through a fake executable and temporary root:

- `inspect` performs no write and emits only the versioned inventory.
- `initialize` rejects a missing or non-identical `--confirm-root` before mutation.
- `login` rejects a missing `--allow-interactive-login`, invalid role, or root mismatch before launch.
- A valid fake login receives exact `CODEX_HOME` and exact argv `-c`, `cli_auth_credentials_store="keyring"`, `login`.
- The child does not inherit a configuration-file mutation, model argument, packet authorization, or push command.
- Confirmed exit and stdio closure rotate cleanly; ambiguous closure preserves the lease.

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/manage-evaluation-homes.test.mjs
```

Expected RED result: the CLI does not exist or bypasses the manager contract.

- [ ] **Step 2.6 (GREEN): Implement the thin operator CLI**

Keep parsing, confirmation, JSON stdout, and exit-code mapping in the CLI. Delegate all path ownership and mutation to `evaluation-homes.js`. Spawn the login child without a shell, pass only the process-local `CODEX_HOME` overlay plus the inherited environment, register it immediately, and never invoke a model command.

Run the focused CLI test again. Expected GREEN result: all three commands pass against the fake executable.

- [ ] **Step 2.7: Verify and review**

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/evaluation-homes.test.mjs
node --test --test-concurrency=1 tests/scripts/manage-evaluation-homes.test.mjs
node --test --test-concurrency=1 tests/scripts/windows-path-metadata.test.mjs
npm run verify
rg -n "testDependencies" scripts evals tests
git status --short
git diff -- scripts/evaluation/evaluation-homes.js scripts/evaluation/manage-evaluation-homes.js scripts/evaluation/windows-path-metadata.js scripts/evaluation/windows-path-probe.ps1 tests/scripts/evaluation-homes.test.mjs tests/scripts/manage-evaluation-homes.test.mjs tests/scripts/windows-path-metadata.test.mjs
```

Expected `rg` result: only `evaluation-homes.js` and `evaluation-homes.test.mjs` contain the test-only injection name.

Completion criteria:

- All destructive test actions stay inside test-owned temporary roots.
- No test or import touches the approved production root.
- Every mutation is marker-, token-, role-, and containment-bound.
- A crash-like incomplete state fails closed.
- A successful lifecycle releases its live lock by retiring, not deleting, the synced journal into one exclusive completed-history entry.
- The manager library never invokes `codex login` or a keyring utility.
- The operator CLI can invoke only the exact, separately guarded login flow and never manipulates the keyring directly.

Stop at the task commit boundary for exact scope and message approval. Do not push.

---

## Task 3: Extract the Shared Codex App Server Adapter

**Files:**

- Create `scripts/evaluation/codex-app-server.js`.
- Create `tests/scripts/codex-app-server.test.mjs`.
- Create `tests/scripts/fixtures/codex-app-server-fake-engine.mjs` for generic JSONL framing, request correlation, and fault injection.
- Create `tests/scripts/fixtures/fake-codex-app-server.mjs` as the generic adapter-contract executable over that engine.
- Refactor `tests/committing-to-git/fixtures/fake-app-server.mjs` to import the engine while retaining its Git proposal, scope, permission, command, and final-turn scenarios. Keep that Git fixture through Task 6 because those scenarios are domain-specific.
- Do not yet delete Git-specific behavior from `evals/committing-to-git/app-server-session.mjs`; that cutover occurs in Task 6.

**Interfaces:** Implement `inspectCodexAppServerToolchain`, `preflightCodexAppServer`, and `codexAppServerAdapter` exactly as specified in `Public Module Contracts`. The adapter consumes the shared controller port; no raw RPC class or request method is exported.

- [ ] **Step 3.1 (RED): Specify JSONL RPC transport**

Test with a local fake process:

- Fake scenarios are selected by explicit prefix arguments, never hidden inherited environment variables.
- The exact Codex executable/version probe and a deterministic digest over a fake generated JSON Schema bundle.
- Drift in executable identity, reported version, or schema digest fails before account inspection or a turn.
- One initialize request, correlated response, and exactly one required `initialized` notification.
- Concurrent pending request IDs are correlated correctly even though test execution remains sequential.
- Notifications are retained without resolving requests.
- Server requests are delegated to the approval callback.
- Malformed JSON, duplicate response IDs, unknown response IDs, premature EOF, and nonzero exit become protocol or provider failures.
- Timeout first requests protocol-level interruption/cleanup, then aborts, closes streams, terminates the child, and waits for both `exit` and stdio `close`.
- An unconfirmed shutdown preserves the home lease and records an ambiguous outcome.
- Complete transcript and stderr evidence survive failure.

The test may exercise multiple outstanding protocol requests inside one process because that is transport behavior; do not run multiple test processes or model sessions concurrently.

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/codex-app-server.test.mjs
```

Expected RED result: the shared adapter/fake is missing or the transport contract fails.

- [ ] **Step 3.2 (GREEN): Implement the RPC client as a private deep mechanism**

Export only the three evaluated operations; do not export `JsonlRpcClient`. Keep request maps, readline framing, and child termination behind the adapter boundary. Run the focused test again. Expected GREEN result: toolchain and transport assertions pass while later lifecycle cases remain red.

- [ ] **Step 3.3 (RED): Specify Codex preflight and thread isolation**

Test:
- Account inspection precedes thread creation.
- Missing OpenAI authentication stops before a turn.
- Persisted authentication summary excludes account identity and tokens.
- Model/provider capability inspection confirms the exact model and effort before a turn.
- Forced-refresh `skills/list` must show no enabled skill or unexpected source.
- Stable effective-state endpoints show no hooks or callable apps; other disabled sources are bound by configuration and observed thread/event state without calling under-development endpoints.
- Thread is ephemeral, uses exact model/provider, disables fallback, and carries exact instructions.
- Runtime roots, working directory, sandbox, network, tools, web-search policy, and instruction sources match the packet.
- The spawned environment matches the packet's positive name policy, omits `OPENAI_API_KEY`, and persists neither inherited values nor secret-bearing arguments.
- Unrequested external-capability events fail closed.
- An upstream approval shape that cannot be normalized and a malformed controller decision fail closed before a response or continuation is sent.
- Cleanup deletes the ephemeral thread where required and tolerates only the documented already-ephemeral result.
- Preflight starts no model turn.

Exercise lifecycle through the exported high-level operation:

```js
const result = await preflightCodexAppServer({
  toolchain,
  policy,
  withHome: (operation) => withTemporaryEvaluationHome(operation),
  evidenceDestination,
  timeoutMs: 5_000,
});

assert.equal(result.modelTurns, 0);
assert.equal(result.status, "completed");
```

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/codex-app-server.test.mjs
```

Expected RED result: high-level preflight or lifecycle isolation is not implemented.

- [ ] **Step 3.4 (GREEN): Implement lifecycle states and normalized events**

Separate transport validity from suite meaning. Return provider-native events and a small normalized view. Make final-answer extraction depend on an authoritative completed final agent item, not the last arbitrary text event.

Run the focused test again. Expected GREEN result: transport, preflight, controller, and terminal-event assertions pass.

- [ ] **Step 3.5: Integrate the stable home boundary**

The adapter invokes the supplied `withHome(operation)` function, receives the frozen home context, registers its child immediately, and never derives a root or role. Prove the exact positive-name environment and absence of `OPENAI_API_KEY` immediately before spawn. Require the pinned App Server response to report the exact leased `codexHome`, and validate only response fields defined by the pinned generated schema; a missing schema field blocks the version.

Run both focused adapter and home tests. Expected GREEN result: the integration passes without either module importing the other's private helpers.

- [ ] **Step 3.6: Verify and review**

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/codex-app-server.test.mjs
node --test --test-concurrency=1 tests/scripts/evaluation-homes.test.mjs
npm run verify
git status --short
git diff -- scripts/evaluation/codex-app-server.js tests/scripts/codex-app-server.test.mjs tests/scripts/fixtures/codex-app-server-fake-engine.mjs tests/scripts/fixtures/fake-codex-app-server.mjs tests/committing-to-git/fixtures/fake-app-server.mjs
```

Completion criteria:

- The fake process proves setup, failure, timeout, and cleanup paths.
- No hosted turn occurs.
- The adapter has no Git vocabulary.
- Home rotation remains owned solely by the home manager.

Stop at the task commit boundary for exact scope and message approval. Do not push.

---

## Task 4: Extract the Shared Claude CLI Adapter

**Files:**

- Create `scripts/evaluation/claude-cli.js`.
- Create `tests/scripts/claude-cli.test.mjs`.
- Create `tests/scripts/fixtures/fake-claude-cli.mjs` for the Claude command/auth/stream protocol.

Do not create a generic fake-process framework. The Codex JSONL RPC fake and Claude one-shot stream fake have different causal models; sharing only their process-launch boilerplate would create a shallow abstraction.

**Interfaces:** Implement `inspectClaudeCliToolchain`, `preflightClaudeAuth`, and `claudeCliAdapter` exactly as specified in `Public Module Contracts`. The adapter accepts only a one-turn controller and the common evidence port.

- [ ] **Step 4.1 (RED): Specify argument and capability construction**

Test:

- Fake scenarios are selected by explicit prefix arguments, never hidden inherited environment variables.
- Exact executable identity and `--version`, followed by selection of the reviewed static `2.1.233` capability descriptor without a model call; `--help` output is diagnostic evidence, not the capability oracle.
- Exact argv `claude auth status --json` is parsed as a zero-model preflight and account-identifying fields are not retained.
- Exact provider/model/options mapping.
- Streamed JSON and verbose/native metadata capture.
- Explicit allowed tools and permission mode.
- Bounded turn count.
- Fresh non-repository working directory.
- Exact no-persistence and safe-mode flags from the pinned `2.1.233` capability profile; `--bare` is absent because it would disable OAuth/keychain reads.
- Explicit empty strict MCP configuration, disabled slash commands, `mcp__*` denial, and a positive built-in tool allowlist.
- Disabled Chrome integration and prompt suggestions, preventing unrequested external integration and suggestion generation.
- No fallback model is configured implicitly or explicitly.
- Rejection when a required capability cannot be represented.
- Drift between the prepared and executing CLI capability descriptor.
- The spawned environment matches the exact positive-name policy, rejects an auth-mode change, and never places secret-bearing values in packet or persisted argument records.

Assert the exact argument vector rather than matching substrings:

```js
assert.deepEqual(fakeInvocation.arguments, [
  "-p",
  "--safe-mode",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--no-chrome",
  "--prompt-suggestions",
  "false",
  "--permission-mode",
  "dontAsk",
  "--tools",
  expectedToolAllowlist,
  "--allowedTools",
  expectedToolAllowlist,
  "--disallowedTools",
  "mcp__*",
  "--mcp-config",
  emptyMcpConfigPath,
  "--strict-mcp-config",
  "--input-format",
  "text",
  "--output-format",
  "stream-json",
  "--verbose",
  "--model",
  expectedModel,
  "--effort",
  expectedEffort,
  "--max-turns",
  "1",
  "--max-budget-usd",
  expectedBudget,
  "--append-system-prompt-file",
  packetBoundInstructionsPath,
]);
```

The toolchain inspection must report exactly `2.1.233` and select the reviewed static capability profile for this exact documented flag set. A mismatch blocks Task 4 for a plan revision; the implementation must not parse incomplete help output as a substitute, silently use aliases, omit isolation, or weaken capabilities to reach GREEN.

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/claude-cli.test.mjs
```

Expected RED result: the toolchain/auth/argument adapter does not exist.

- [ ] **Step 4.2 (RED): Specify stream and process outcomes**

Test:

- Exact transcript ordering.
- Final-answer and usage extraction.
- Diagnostic retention.
- Malformed JSONL.
- Launch failure.
- Nonzero exit.
- Timeout and confirmed child exit.
- Timeout with unconfirmed stdio closure remains ambiguous and is not retried.
- Empty final result.

Run the same focused test again. Expected RED result: provider outcome and closure behavior remains unimplemented.

- [ ] **Step 4.3 (GREEN): Implement the adapter**

Use the shared evidence and process primitives. Keep Claude-native events untouched and add normalization separately. Do not add a fake App Server session abstraction around a one-process streamed CLI.

Run the focused test again. Expected GREEN result: both RED groups pass, including exact launch-capability consumption and `attempt.json` creation.

- [ ] **Step 4.4: Verify and review**

Run:

```powershell
node --test --test-concurrency=1 tests/scripts/claude-cli.test.mjs
node --test --test-concurrency=1 tests/scripts/evaluation-runtime.test.mjs
npm run verify
git status --short
git diff -- scripts/evaluation/claude-cli.js tests/scripts/claude-cli.test.mjs tests/scripts/fixtures/fake-claude-cli.mjs
```

Completion criteria:

- Existing defining-concepts Claude behavior is represented by adapter tests.
- Exact external authorization remains owned by the runtime, not duplicated here.
- No hosted Claude process is invoked.

Stop at the task commit boundary for exact scope and message approval. Do not push.

---

## Task 5: Migrate `defining-concepts`

**Files:**

- Create `evals/defining-concepts/session-controller.mjs`.
- Rewrite `evals/defining-concepts/run-evaluation-session.mjs` as a thin suite CLI.
- Refactor `tests/evals/run-evaluation-session.test.mjs` so generic provider mechanics are asserted in shared tests and suite behavior remains here.
- Update `evals/defining-concepts/README.md` only for behavior introduced in this task; final common-doc pruning occurs in Task 7.

**Interfaces:** `session-controller.mjs` exports only `createDefiningConceptController({ initialInput })`. The CLI exposes exactly two commands:

```text
prepare --prompt-file <path> --destination <new-directory>
        --working-dir <empty-non-repository-directory>
        --arm <with_skill|without_skill> --eval-id <positive-integer>
        --repetition <positive-integer> --provider <codex|claude>
        --model <id> --effort <level>
        [--skill-file <path>] [--max-budget-usd <decimal-string>]
        [--codex-command <command>] [--codex-prefix-arg <arg>]...
        [--claude-command <command>] [--claude-prefix-arg <arg>]...
        [--evaluation-homes-root <absolute-test-or-approved-root>]
run     --prepared-session <directory> --authorization <json-file>
        --allow-external-model-call [--timeout-ms <positive-integer>]
```

`prepare` performs toolchain inspection and writes no provider turn. `run` obtains executable, working-directory, home-role, and capability values from the packet; it accepts no flag that can override packet-bound model input or policy. The injectable home root is packet-bound and exists for tests and an explicitly approved nondefault installation, not as an execution-time redirect.

- [ ] **Step 5.1 (RED): Specify the suite controller**

Test:

- Exactly one packet-bound turn.
- With-skill and without-skill instructions remain byte-exact.
- The final answer is taken from the adapter's authoritative completion.
- Unexpected permission or external-capability requests are rejected.
- Provider failure becomes a retained invalid attempt rather than a successful repetition.

Drive the public controller port directly with synthetic completion events; do not launch a fake provider for these domain tests.

```js
const controller = createDefiningConceptController({
  initialInput: Object.freeze([
    Object.freeze({ type: "text", text: "packet-bound prompt" }),
  ]),
});
const decision = await controller.onTurnCompleted({
  turnIndex: 1,
  status: "completed",
  finalAnswer: "authoritative answer",
  nativeUsage: { input_tokens: 10, output_tokens: 4 },
  nativeEventRange: { first: 3, last: 5 },
});

assert.equal(controller.maxTurns, 1);
assert.deepEqual(decision, {
  action: "complete",
  suiteResult: { finalAnswer: "authoritative answer" },
});
```

Run:

```powershell
node --test --test-concurrency=1 tests/evals/run-evaluation-session.test.mjs
```

Expected RED result: `session-controller.mjs` is absent or does not enforce the one-turn domain contract.

- [ ] **Step 5.2 (RED): Specify prepare/run separation**

Test the CLI through the real shared adapters and fake provider executables:

- `prepare` writes exact harness-controlled outbound inputs, runtime/toolchain fingerprints, continuation policy, and a digest without launching a provider.
- Prepared bytes, not mutable source paths, are the execution input.
- `run` rejects missing or mismatched authorization before the fake launch sentinel.
- OpenAI runs select the stable `execution` role and shared App Server adapter.
- Anthropic runs select the Claude adapter and record its provider-specific profile.
- A requested web-search capability is explicit and cannot silently disappear.
- Existing nonempty retained destinations are rejected.
- Launch failures retain complete common and suite-specific evidence.

The CLI test launches `prepare`, reads canonical `packet.json`, mutates the original prompt file, and then launches `run` against the fake executable. Assert that the fake receives the packet's original prompt bytes and that its launch log begins only after the exact authorization/current-state events.

Run the same focused test. Expected RED result: the existing one-shot CLI has no prepare/run boundary or shared adapter injection seam.

- [ ] **Step 5.3 (GREEN): Cut over the suite**

Delete the suite's production implementations of hashing, generic directory preparation, process capture, JSONL dispatch, provider parsing, timing, and usage normalization after the shared tests are green.

Remove the Codex `exec` path. Both suites' Codex execution now uses App Server.

Preserve case, arm, repetition, grading, aggregation, and invalid-attempt semantics. Do not rewrite existing result directories.

Run the focused suite and all three shared adapter tests. Expected GREEN result: both fake arms pass and every suite assertion from Steps 5.1-5.2 is green.

- [ ] **Step 5.4: Verify and review**

Run:

```powershell
node --test --test-concurrency=1 tests/evals/run-evaluation-session.test.mjs
node --test --test-concurrency=1 tests/evals/defining-concepts-results.test.mjs
node --test --test-concurrency=1 tests/scripts/evaluation-runtime.test.mjs tests/scripts/codex-app-server.test.mjs tests/scripts/claude-cli.test.mjs
npm run verify
git status --short
git diff -- evals/defining-concepts/run-evaluation-session.mjs evals/defining-concepts/session-controller.mjs evals/defining-concepts/README.md tests/evals/run-evaluation-session.test.mjs
```

Completion criteria:

- Both fake provider arms pass through the common authorization gate.
- Codex uses App Server only.
- Suite tests describe concept-evaluation behavior rather than re-testing the RPC client.
- Historical evidence tests still pass unchanged.
- No hosted model, real home, or keyring operation occurred.

Stop at the task commit boundary for exact scope and message approval. Do not push.

---

## Task 6: Migrate `committing-to-git`

**Files:**

- Create `evals/committing-to-git/session-controller.mjs`.
- Refactor `evals/committing-to-git/evaluation-runner.mjs`.
- Refactor `evals/committing-to-git/run-evaluation-session.mjs`.
- Delete `evals/committing-to-git/app-server-session.mjs` after all generic and Git-specific responsibilities have authoritative destinations.
- Refactor `tests/committing-to-git/evaluation-runner.test.mjs`.
- Update `evals/committing-to-git/README.md` only for behavior introduced in this task; final common-doc pruning occurs in Task 7.

**Interfaces:** `session-controller.mjs` exports only `EXACT_COMMIT_AUTHORIZATION_REPLY` and `createCommittingToGitController({ session, observeGitState })`. After migration, `evaluation-runner.mjs` exports exactly:

```js
export function captureGitState(repository) {}
export function buildEvaluationSchedule(seed) {}
export function discoverRuntimeIsolationCatalog({ codexHome, repositoryRoot }) {}
export function prepareEvaluationSession(options) {}
export async function preflightPreparedEvaluationSession({
  preparedSession,
  allowZeroTurnPreflight,
  timeoutMs,
  signal,
}) {}
export async function executePreparedEvaluationSession({
  preparedSession,
  authorization,
  allowExternalModelCall,
  timeoutMs,
  signal,
}) {}
export function createBlindedGradingBundle({ records, seed }) {}
export const EVALUATION_ARMS = Object.freeze([
  "no-skill",
  "old-skill",
  "new-skill",
]);
export const EVALUATION_CASE_IDS = Object.freeze([
  4, 7, 18, 28, 35, 36, 37, 39, 40, 41, 42, 47, 49, 50, 53, 54, 55,
]);
export const EVALUATION_MODELS = Object.freeze([
  Object.freeze({
    model: "gpt-5.6-luna",
    effort: "low",
    provider: "openai",
    repetitions: 5,
    purpose: "primary",
  }),
  Object.freeze({
    model: "gpt-5.6-sol",
    effort: "low",
    provider: "openai",
    repetitions: 1,
    purpose: "calibration",
  }),
]);
export const PINNED_SKILL_COMMITS = Object.freeze({
  "old-skill": "76baa9b25e0afeaa2c62c4cf7042976444edc15e",
  "new-skill": "ec064b1f8177d9542a82f478ca3b1ce5e44ee702",
});
```

The existing `plan`, `catalog`, `prepare`, `preflight`, `run`, and `blind` CLI commands remain. `preflight` replaces packet/result path overrides with `--prepared-session <directory> --allow-zero-turn-preflight`; `run` uses `--prepared-session <directory> --authorization <json-file> --allow-external-model-call`. Both select their fixed stable role internally. No run/preflight flag may redirect packet-bound home, toolchain, model, fixture, capability, or result paths.

- [ ] **Step 6.1 (RED): Pin the Git-specific controller contract**

Before moving code, ensure tests independently retain:

- Valid and invalid scope-question parsing.
- Exact predetermined-scope replies.
- Proposal scope and message validation.
- State observation before clarification and authorization.
- One exact commit-authorization continuation only after a valid proposal.
- No authorization after invalid output or changed Git state.
- Fixture-scoped permission decisions.
- Rejection of external capabilities.

Use the public controller, not moved private parsers, as the test seam:

```js
const unchangedGitState = Object.freeze({ sha256: "a".repeat(64) });
const fixtureApprovalPolicy = Object.freeze({
  readableRoots: Object.freeze([]),
});
const validAuthorizationEligibleSession = Object.freeze({
  initialInput: Object.freeze([
    Object.freeze({ type: "text", text: "packet-bound Git task" }),
  ]),
  fixtureRoot,
  expectedScope: Object.freeze({
    kind: "paths",
    paths: Object.freeze(["skills-lock.json"]),
  }),
  scopeClarification: null,
  authorizationEligible: true,
  approvalPolicy: fixtureApprovalPolicy,
});
const controller = createCommittingToGitController({
  session: validAuthorizationEligibleSession,
  observeGitState: () => unchangedGitState,
});
const decision = await controller.onTurnCompleted({
  turnIndex: 1,
  status: "completed",
  finalAnswer:
    '<EVALUATION_COMMIT_PROPOSAL>\n{"message":"chore(skills): Update inventory\\n","push":false,"scope":{"kind":"paths","paths":["skills-lock.json"]}}\n</EVALUATION_COMMIT_PROPOSAL>',
  nativeUsage: null,
  nativeEventRange: { first: 4, last: 9 },
});

assert.deepEqual(decision, {
  action: "continue",
  transitionId: "exact-commit-authorization",
  input: [
    {
      type: "text",
      text: EXACT_COMMIT_AUTHORIZATION_REPLY,
    },
  ],
});
```

Run:

```powershell
node --test --test-concurrency=1 tests/committing-to-git/evaluation-runner.test.mjs
```

Expected RED result: the new controller import is absent while the existing tests provide the behavior oracle.

- [ ] **Step 6.2 (RED): Specify shared-runtime integration**

Test:

- Preparation uses the common packet and digest.
- Execution calls the common authorization gate before home acquisition or App Server launch.
- Preflight selects stable role `preflight` and starts no turn.
- Execution selects stable role `execution`.
- Packet preparation no longer creates `runtime-home-preflight` or `runtime-home-run`.
- Runtime-home paths cannot be redirected through packet-local data.
- Infrastructure failure retains a terminal record through the shared evidence API.
- Existing fixture, pinning, schedule, treatment, and blinding results remain semantically unchanged.

Add a launch-order event log with the exact successful prefix `evidence-acquired`, `authorization-validated`, `current-state-validated`, `home-acquired`, `launch-consumed`, `app-server-spawned`. Every rejection assertion compares the complete prefix reached.

For a digest rejection the complete log is `evidence-acquired`; for runtime/toolchain drift it is `evidence-acquired`, `authorization-validated`; for home contention it ends after `current-state-validated`; for successful launch it equals the full prefix. These fixed expectations prevent a test from passing merely because some later error happened.

Run the focused test again. Expected RED result: generic runtime/home mechanics still live in the suite or occur in the wrong order.

- [ ] **Step 6.3 (GREEN): Move, import, and delete**

Move Git-specific conversation code into `session-controller.mjs`. Replace the embedded RPC client with the shared Codex adapter. Replace production hashing, packet, authorization, artifact, and destination-home implementations with shared imports.

Keep in `evaluation-runner.mjs`:

- Schedule generation.
- Repository path and fixture validation.
- Git-state capture.
- Runtime isolation catalog discovery and suite capability policy.
- Fixture materialization.
- Pinned skill extraction.
- Prepared-scope derivation.
- Treatment snapshot validation.
- Blinded grading bundles.

Delete `app-server-session.mjs` only after `rg` and tests show that no import remains and every responsibility has one owner.

Run the focused suite and shared runtime, home, and Codex adapter tests. Expected GREEN result: all controller and integration assertions pass before deletion; repeat them after deletion and require the same result.

- [ ] **Step 6.4: Verify and review**

Run:

```powershell
node --test --test-concurrency=1 tests/committing-to-git/evaluation-runner.test.mjs
node --test --test-concurrency=1 tests/scripts/evaluation-runtime.test.mjs tests/scripts/evaluation-homes.test.mjs tests/scripts/codex-app-server.test.mjs
npm run verify
rg -n "app-server-session|runtime-home-preflight|runtime-home-run|class JsonlRpcClient|function canonicalJson|function transmissionPacketDigest" evals scripts tests
git status --short
git diff -- evals/committing-to-git scripts/evaluation tests/committing-to-git/evaluation-runner.test.mjs
```

Expected `rg` result: no production duplicate or obsolete runtime-home reference. Test fixture text may remain only when explicitly asserting its absence from generated output.

Completion criteria:

- The full 306-session plan remains deterministic.
- Git-specific clarification and commit authorization semantics are unchanged.
- The shared App Server adapter contains no Git-specific parser or policy.
- No packet-local credential home remains.
- No hosted model, real home, keyring operation, commit, or push occurred during tests.

Stop at the task commit boundary for exact scope and message approval. Do not push.

---

## Task 7: Consolidate Documentation and Remove Residual Duplication

**Files:**

- Update `evals/README.md` as the common runtime and evidence contract.
- Update `evals/defining-concepts/README.md` to contain only concept-suite usage and deviations.
- Update `evals/committing-to-git/README.md` to contain only Git-suite usage and deviations.

**Interfaces:** Documentation must use the exact public names, CLI commands, authorization fields, stable roles, evidence paths, and failure classes in this plan. Task 7 changes only these three README files. If its audit reveals an implementation defect, return to the owning earlier task, add a failing test there, and complete a separately reviewed fix before resuming Task 7.

- [ ] **Step 7.1: Establish the documentation hierarchy**

`evals/README.md` owns:

- Shared prepare/authorize/run lifecycle.
- Common packet and evidence fields.
- Provider-adapter distinctions.
- Stable evaluation-home concepts and role names.
- External-call authorization rule.
- Historical schema policy.
- Common failure classes.

The suite READMEs own:

- Their commands and domain inputs.
- Their controller behavior.
- Their sandbox/network/tool capability profile.
- Their grading or blinding workflow.
- Links to the common contract instead of copies of it.

Use this exact heading hierarchy in `evals/README.md`: `Lifecycle`, `Transmission Packet`, `Authorization`, `Evidence`, `Provider Adapters`, `Evaluation Homes`, `Failure Classes`, `Historical Results`, and `Sensitive Evidence`. Each suite README contains one `Shared Runtime` link to that document and does not reproduce those sections.

Correct the false statement that one ambient keyring login automatically authenticates fresh `CODEX_HOME` paths. State the empirical boundary precisely: this installed CLI's keyring lookup is scoped by the stable home path, so each stable role may require a separately authorized one-time login.

- [ ] **Step 7.2: Remove code duplication**

Search production code for duplicate implementations of:

- Canonical serialization and transmission digest.
- Exact external authorization.
- Exclusive JSON/run-record writes.
- JSONL RPC transport.
- Account/skills/thread isolation.
- Provider process capture.
- Evaluation-home selection and cleanup.

Retain a duplicate-looking helper only when it is an independent test oracle or has materially different semantics. Add a comment naming that distinction when it is not obvious.

- [ ] **Step 7.3: Verify and review**

Run:

```powershell
rg -n "function sha256|function canonicalJson|transmissionPacketDigest|class JsonlRpcClient|writeJsonArtifactExclusive|runtime-home-preflight|runtime-home-run" evals scripts tests
rg -n 'consumeExternalModelLaunch|node:child_process' scripts evals
node --test --test-concurrency=1 tests/scripts/evaluation-runtime.test.mjs tests/scripts/evaluation-homes.test.mjs tests/scripts/codex-app-server.test.mjs tests/scripts/claude-cli.test.mjs
node --test --test-concurrency=1 tests/evals/run-evaluation-session.test.mjs tests/evals/defining-concepts-results.test.mjs tests/committing-to-git/evaluation-runner.test.mjs
npm run verify
git status --short
git diff -- evals scripts/evaluation tests
```

Expected second `rg` result: the capability consumer occurs only in the runtime and two provider adapters; provider-launch imports occur only in the two provider adapters and the explicit operator login CLI. A suite result here is a blocking bypass.

Completion criteria:

- Each shared invariant has one production owner.
- Each suite README points to, rather than repeats, the common contract.
- Historical result files remain unmodified.
- No configuration file changed.
- Full verification passes.

Stop at the task commit boundary for exact scope and message approval. Do not push.

---

## Task 8: Final Semantic and Safety Verification

This task changes no behavior unless verification exposes a defect. If a fix is needed, return to RED before editing implementation.

- [ ] **Step 8.1: Verify repository state and historical evidence**

Run one command at a time:

```powershell
git status --short
git diff --stat HEAD
git diff --name-status HEAD
git diff HEAD -- scripts/evaluation evals tests docs/plans/2026-08-24-unified-skill-evaluation-runtime.md
npm run verify
```

Confirm manually:

- `.codex/config.toml` and `.claude/` remain user-owned and outside every task commit.
- No existing file under `evals/*/results/` changed.
- No configuration file changed.
- Every deleted helper has one tested replacement.
- Every common provider call is behind the exact authorization gate.
- Every real-home mutation is behind root, marker, role, lease, identity, and containment checks.
- No test accessed the production home root or a real keyring entry.
- No hosted model was run.

- [ ] **Step 8.2: Exercise only deterministic CLI paths**

Use temporary directories and fake executables to exercise:

- Defining-concepts preparation.
- Committing-to-git planning and cataloging.
- Packet inspection and authorization rejection.
- Codex preflight protocol against the fake App Server.
- Stable-home lifecycle against an injected temporary root.

Do not supply a real `allowExternalModel: true` authorization. Do not initialize or rotate the production home root.

Run the deterministic surfaces with the fakes owned by their test files:

```powershell
node --test --test-concurrency=1 tests/scripts/manage-evaluation-homes.test.mjs
node --test --test-concurrency=1 tests/scripts/codex-app-server.test.mjs tests/scripts/claude-cli.test.mjs
node --test --test-concurrency=1 tests/evals/run-evaluation-session.test.mjs tests/committing-to-git/evaluation-runner.test.mjs
```

Expected result: all pass; fake invocation logs contain no non-fake executable path and every temporary root is removed by its owning test except deliberately quarantined failure fixtures, which the test removes only after asserting their state.

- [ ] **Step 8.3: Review the final interface depth**

The final review must answer:

1. Can a new suite prepare, authorize, and retain a single provider session without importing either existing suite?
2. Can a provider adapter be replaced without moving concept or Git semantics into the runtime?
3. Is the home manager reusable without knowing a skill name or result layout?
4. Is there exactly one production path that can launch each provider?
5. Can a caller bypass exact authorization using a lower-level exported function?
6. Does any documentation restate a contract that has a clearer authoritative location?

Any negative answer blocks completion.

- [ ] **Step 8.4: Final commit boundary**

After all prior task commits and final verification:

1. Inspect the complete local commit stack and working tree.
2. Confirm every implementation commit is signed and matches its approved scope/message.
3. Draft any necessary final cleanup commit and obtain exact authorization.
4. Do not push.

## Post-Implementation Operational Gates

The following are deliberately outside Tasks 1-8. Complete them later, one at a time, only after implementation is committed and only with the corresponding authorization.

1. Read-only inspect the approved production root and its ancestors.
2. Initialize exactly the approved root and two marked homes.
3. Perform the separately authorized one-time `preflight` login through the operator CLI; its normal lifecycle rotates before login and again after confirmed closure.
4. Perform the separately authorized one-time `execution` login through the same lifecycle.
5. Run a zero-turn preflight under separately confirmed scope.
6. Prepare a new evaluation packet from the committed harness revision.
7. Present provider, model, effort, exact harness-controlled outbound content, continuation policy, toolchain/runtime fingerprints, and `transmissionSha256`.
8. Run exactly the authorized sequential session; never reuse a digest after any content or policy change.

An authorization for one item does not authorize the next item. A prior failed packet remains spent and is never retried.

## Residual Limits

- RFC 8785 canonicalization and SHA-256 make packet identity reproducible; they do not authenticate the human approver or constitute a digital signature.
- `attempt.json` and the opaque capability enforce one launch per conforming prepared-session directory and process. They are not a global consent ledger; a copied pre-consumption directory can duplicate the authorization artifact, so the operator must never copy or reuse an authorized prepared session.
- The harness can bind only content and policy it controls. Provider-owned hidden instructions and server-side behavior are identified indirectly by provider, model, executable, version, and protocol-schema fingerprints.
- A generated App Server schema proves the message shapes published by that executable version. It does not prove that every server implementation detail or remote provider behavior is unchanged.
- `account/read` or `claude auth status` proves observed local auth state at that moment. Credentials can expire, be revoked, or fail at the later provider request.
- The empirically observed Windows keyring namespace may change in a future Codex release. Version drift must fail preflight and trigger a new local probe before relying on the stable-home design.
- The home lease coordinates conforming evaluator processes. Another same-user or privileged process can still race or alter files; anomaly checks reduce accidental and opportunistic path substitution but are not a hostile-local-process security boundary.
- Same-volume rename makes one namespace change indivisible to ordinary observers, but the complete rotate/run/rotate/delete sequence is not atomic or fully power-loss durable. Synced phase evidence supports diagnosis; ambiguous state remains blocked.
- Completed lease histories are intentionally not auto-pruned, so the small metadata-only `.history` directory grows with operations until a future separately designed archive policy exists.
- A child `exit` and stdio `close` do not prove that an unknown detached descendant no longer has a handle. If the adapter cannot establish safe closure, the home and lease remain quarantined for explicit recovery.
- Claude `--safe-mode` disables the documented customization sources, but applicable managed policy may still constrain the process. The packet records the observed capability profile and does not claim bit-identical isolation with Codex.
- Raw evaluation evidence can contain sensitive repository or model-produced content. Narrow file permissions and auth redaction do not make retained transcripts non-sensitive.
- Normalized usage and event fields are convenience projections. Provider-native evidence remains necessary when providers differ or the normalization schema evolves.
- Model output remains nondeterministic even with byte-identical inputs and toolchain fingerprints. Statistical, paired, blinded, and human-calibrated suite methodology remains necessary; the shared runtime alone proves no performance improvement.

## Final Acceptance Criteria

1. Both suites use `scripts/evaluation/runtime.js` for canonical packets, exact external authorization, and common evidence transactions.
2. Both Codex arms use `scripts/evaluation/codex-app-server.js`; no production `codex exec` evaluation path remains.
3. Claude uses one shared CLI adapter with provider-native evidence preserved.
4. The common runtime contains no concept grading or Git commit semantics.
5. The Git controller contains no JSONL RPC client or home lifecycle implementation.
6. The defining controller contains no provider process parser.
7. Every hosted provider session is unreachable without the exact statement/digest/provider/model/effort authorization.
8. Launch-capability consumption is one-use, creates `attempt.json` before spawn, and cannot be imported from a suite.
9. Packet bytes conform to RFC 8785 over I-JSON and pass normative vectors.
10. Codex packets bind the exact executable/version and generated App Server schema digest, and execution rejects drift.
11. Stable homes are exactly `preflight` and `execution` beneath the approved skill-neutral root.
12. Home operations fail closed on ownership, role, lease, containment, volume, identity, symlink, junction, or reparse anomalies.
13. Cleanup waits for adapter shutdown, child exit, and stdio close, deletes only exact owned reparse-free quarantines, and releases the live lock only by retiring its synced journal into exclusive immutable history.
14. The manager never modifies keyring entries or scans outside the approved root.
15. The operator CLI exposes only inspect, confirmed initialize, and confirmed one-time login; it never edits repository or user configuration.
16. Tests use temporary roots and fake providers only.
17. Existing retained results remain byte-for-byte historical evidence.
18. Shared behavior is tested at the shared interface; suite tests retain domain guarantees.
19. No new dependency or configuration change is introduced.
20. `npm run verify` passes.
21. The complete diff contains no unrelated `.codex/` or `.claude/` content.
22. Every created commit is signed, individually scope/message approved, and local only.

## Reference Traceability

| Design contract | Primary authority | Implementation/test gate |
| --- | --- | --- |
| Information-hiding module boundaries and ports | Parnas's decomposition criterion plus Cockburn's Ports and Adapters pattern | Exact public contracts; Tasks 5-8 import/duplication/depth reviews |
| Least authority and fail-closed capability gates | Saltzer and Schroeder's least-privilege principle plus provider capability schemas | Tasks 1, 3, and 4 launch sentinel, opaque capability, and effective-state tests |
| Canonical packet bytes | RFC 8785 plus RFC 7493 | Task 1 normative vectors and I-JSON rejection tests |
| UTC timestamps | RFC 3339 | Task 1 timestamp shape plus monotonic-duration tests |
| Codex protocol shapes and lifecycle | Exact-version generated App Server JSON Schema plus official App Server guide | Task 3 toolchain fingerprint, schema-drift, handshake, and fake-protocol tests |
| Codex automation-interface choice | Official SDK guide/source and App Server guide | Capability decision above; Task 3 proves the deep surfaces the SDK does not expose |
| `CODEX_HOME` and auth storage behavior | Official Codex environment/config/auth guides plus retained local keyring probes | Task 2 role-path tests and later separately authorized operational preflight |
| Claude flags and auth preflight | Official Claude Code CLI reference | Task 4 version/capability, safe-mode, tool, persistence, and auth-status tests |
| Exclusive creation and child cancellation | Node filesystem and child-process references | Tasks 1-4 exclusive-handle, abort, exit, and close tests |
| Same-volume directory rotation and reparse handling | Microsoft directory-move, reparse-point, .NET `FileAttributes`, and `DriveInfo.DriveType` references | Task 2 real probe plus volume, junction, subtree, journal, and quarantine tests |
| Task-specific logging, calibration, and blinded comparison | OpenAI evaluation best-practices guide | Existing suite methodology retained; Tasks 5-7 prevent generic runtime logic from replacing it |

## Primary References

- David Parnas, module decomposition by information hiding: <https://doi.org/10.1145/361598.361623>
- Alistair Cockburn, Hexagonal Architecture (Ports and Adapters): <https://alistair.cockburn.us/hexagonal-architecture/>
- Saltzer and Schroeder, protection and least privilege: <https://doi.org/10.1109/PROC.1975.9939>
- Codex environment and `CODEX_HOME`: <https://learn.chatgpt.com/docs/config-file/environment-variables>
- Codex authentication storage configuration: <https://learn.chatgpt.com/docs/config-file/config-reference>
- Codex authentication: <https://learn.chatgpt.com/docs/auth>
- Codex App Server protocol: <https://learn.chatgpt.com/docs/app-server>
- Codex SDK guidance and supported high-level controls: <https://learn.chatgpt.com/docs/codex-sdk>
- Official Codex TypeScript SDK source: <https://github.com/openai/codex/tree/main/sdk/typescript>
- Codex non-interactive mode: <https://learn.chatgpt.com/docs/non-interactive-mode>
- OpenAI evaluation best practices: <https://developers.openai.com/api/docs/guides/evaluation-best-practices>
- RFC 8785 JSON Canonicalization Scheme: <https://www.rfc-editor.org/rfc/rfc8785>
- RFC 7493 I-JSON: <https://www.rfc-editor.org/rfc/rfc7493>
- RFC 3339 timestamps: <https://www.rfc-editor.org/rfc/rfc3339>
- Claude Code CLI reference: <https://code.claude.com/docs/en/cli-reference>
- Node child processes: <https://nodejs.org/api/child_process.html>
- Node filesystem flags and exclusive creation: <https://nodejs.org/api/fs.html>
- Windows reparse points: <https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points>
- Windows directory moves: <https://learn.microsoft.com/en-us/windows/win32/fileio/moving-directories>
- .NET file-attribute flags: <https://learn.microsoft.com/en-us/dotnet/api/system.io.fileattributes>
- .NET drive-type metadata: <https://learn.microsoft.com/en-us/dotnet/api/system.io.driveinfo.drivetype>

## Execution Start Gate

The architecture is approved, but implementation begins only after the pre-execution documentation boundary is complete. Review and commit this plan as its own exact documentation scope, then wait for the user's instruction to start Task 1. No hosted model call, production-home operation, login, or push is implied.
