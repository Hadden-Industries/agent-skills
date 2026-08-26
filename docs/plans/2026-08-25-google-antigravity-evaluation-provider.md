# Google Antigravity Evaluation Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: use `test-driven-development` for every behavior change and `verification-before-completion` before every completion claim. Execute inline in one primary-agent session. Steps use checkbox (`- [ ]`) syntax for tracking. Do not run a hosted model, edit user-level Antigravity configuration, commit, or push unless the user separately authorizes that operation.

**Goal:** Add Google as a first-class evaluation provider through the Antigravity CLI while exposing only the read-only and policy-reasoning capabilities that the headless transport can enforce honestly.

**Architecture:** Extend the shared packet runtime with the `google` provider and an `antigravity-cli` transport, then hide executable inspection, streamed NDJSON conversation handling, capability enforcement, and evidence capture behind one adapter. Enable that adapter directly for `defining-concepts`; add a distinct policy-only preparation path for the six `committing-to-git` cases whose manifest declares `execution_mode: "policy"`, leaving the real Git transaction runner OpenAI-only.

**Tech Stack:** Node.js 24+ ECMAScript modules and built-ins, Antigravity CLI 1.1.19 streamed JSON, Node's test runner, ESLint, and Prettier. Add no package dependency and change no repository or user configuration.

**Spec:** This file records the design approved in the conversation on 2026-08-25 and is the source of truth for this implementation.

**Reference basis:** The reviewed transport and safety profile is derived from Google's official [headless CLI guide](https://antigravity.google/docs/cli/headless/), [permissions guide](https://antigravity.google/docs/cli/permissions/), and [CLI reference](https://antigravity.google/docs/cli/reference/). Any future CLI pin update must re-review those sources and the observed `--help`/stream protocol before changing the capability profile.

## Global Constraints

- Preserve the user-owned `.codex/config.toml`, `.claude/`, and all unrelated working-tree state.
- Do not edit any existing file under `evals/*/results/`; the 2026-08-22 Gemini record remains immutable legacy evidence.
- Do not invoke Antigravity with a model during implementation or automated verification. Tests use a repository-owned fake executable.
- Do not edit `~/.gemini/antigravity-cli/settings.json`, trusted workspaces, permissions, plugins, skills, hooks, MCP configuration, credentials, or other user-level state.
- Never pass `--dangerously-skip-permissions` and never preauthorize shell or file tools for a policy evaluation.
- Treat automatic Antigravity skill discovery as out of scope and unproven. Treatment bytes are composed explicitly into a packet-bound user message.
- Consume the shared one-use launch capability immediately before the sole Antigravity process that can start a model turn. Do not retry automatically.
- Pin the reviewed CLI version to exactly `1.1.19`; version, executable, prefix-file, help-output, or capability-profile drift fails closed.
- Preserve provider-native stdout and stderr bytes. Normalized events are an audit projection, not a replacement protocol.
- A Google run is successful only if it emits no tool or subagent step. Advertised built-in tools remain visible in the retained `init` event and are not misrepresented as disabled.
- Google policy runs use an absolute, empty, non-repository working directory, terminal sandboxing, request-review permissions, no continuation or conversation persistence beyond the one process, and no explicit agent override.
- `committing-to-git` Google sessions are `policy-only`; executable fixture cases, Git mutation, dynamic approval, signing, committing, and publishing remain unsupported and fail before launch.
- Report Google token and duration values as provider-native cumulative usage; do not claim cross-provider cost equivalence.
- Run every behavior change RED, then GREEN, then focused verification, followed by `npm run verify`.

## Target Structure

```text
scripts/evaluation/
  runtime.js                    # add google -> antigravity-cli registration
  antigravity-cli.js            # new provider adapter and toolchain inspection

tests/scripts/
  antigravity-cli.test.mjs      # adapter contract and failure behavior
  fixtures/fake-antigravity-cli.mjs

evals/defining-concepts/
  run-evaluation-session.mjs    # add --provider antigravity
  README.md

evals/committing-to-git/
  evaluation-runner.mjs         # policy schedule, preparation, and execution
  run-evaluation-session.mjs    # policy-plan and prepare-policy commands
  README.md

evals/README.md                 # shared provider and capability contract
```

## Public Contracts

`scripts/evaluation/antigravity-cli.js` exports exactly:

```js
export async function inspectAntigravityCliToolchain({
  command,
  prefixArguments,
  environment,
}) {}

export const antigravityCliAdapter = Object.freeze({
  provider: "google",
  async execute(context) {},
});
```

The inspected toolchain has this provider-level shape:

```js
{
  schemaVersion: 1,
  provider: "google",
  transport: "antigravity-cli",
  version: "1.1.19",
  command: { path, byteLength, sha256 },
  prefixArguments: [],
  boundPrefixFiles: [],
  help: { byteLength, sha256 },
  capabilityProfile: {
    schemaVersion: 1,
    version: "1.1.19",
    authentication: {
      mode: "cached-cli-credentials",
      zeroTurnStatusCommand: null
    },
    invocation: {
      inputFormat: "stream-json",
      outputFormat: "stream-json",
      sandbox: true,
      slashCommands: false,
      dangerouslySkipPermissions: false,
      permissionMode: "request-review",
      explicitAgent: false,
      processConversationPersistence: true,
      crossProcessConversationPersistence: false,
      observedToolUse: "reject",
      observedSubagentUse: "reject"
    }
  }
}
```

The adapter request has this exact shape:

```js
{
  toolchain,
  controller,
  timeoutMs
}
```

The controller uses the existing shared controller port. Initial and continuation text must match packet-bound `user` and `continuation` inputs. For every turn, the adapter writes one canonical input frame:

```json
{"event":"user","message":{"content":[{"type":"text","text":"..."}]}}
```

The process arguments are exactly the inspected prefix followed by:

```text
--input-format stream-json
--output-format stream-json
--model <packet model>
--effort <packet effort>
--sandbox
--disable-slash-commands
```

No `-p`, `--continue`, `--conversation`, `--agent`, plugin, permission-allow, or dangerous-permission flag is permitted.

## Task 1: Register the Google Provider

**Files:**

- Modify `tests/scripts/evaluation-runtime.test.mjs`.
- Modify `scripts/evaluation/runtime.js`.

**Interfaces:** `EvaluationProvider` gains `"google"`; `PROVIDER_TRANSPORT.google` is exactly `"antigravity-cli"`. Authorization, launch-capability identity, adapter matching, canonicalization, and evidence behavior remain unchanged.

- [x] Add a packet-contract test whose hand-authored Google transmission is accepted only with `transport: "antigravity-cli"` and whose digest changes when provider or transport changes.
- [x] Run `node --test --test-concurrency=1 tests/scripts/evaluation-runtime.test.mjs`; confirm RED reports unsupported provider.
- [x] Add `google` to the provider typedef and transport map, with no provider-specific branch elsewhere in the runtime.
- [x] Run the focused runtime test; confirm GREEN.
- [x] Inspect the runtime diff for accidental authorization or evidence changes.

## Task 2: Add the Antigravity Adapter

**Files:**

- Create `tests/scripts/fixtures/fake-antigravity-cli.mjs`.
- Create `tests/scripts/antigravity-cli.test.mjs`.
- Create `scripts/evaluation/antigravity-cli.js`.

**Interfaces:** The adapter implements the public contracts above and returns the existing common `AdapterResult` shape. The fake executable records invocations and deterministically emits reviewed `init`, `step_update`, and `result` frames without contacting Google.

- [x] Write tests for the two-export public surface, executable/prefix fingerprinting, exact 1.1.19 version pin, help digest, frozen capability profile, and rejection of version drift.
- [x] Run the new test file; confirm RED because the adapter module does not exist.
- [x] Implement the minimal local inspection path using `--version` and `--help`, an absolute executable identity, bound script-prefix fingerprints, a positive-name environment, and bounded child-process capture.
- [x] Run the focused inspection tests; confirm GREEN.
- [x] Add failing tests proving exact launch arguments, working directory and environment, canonical user frames, byte-for-byte stdout/stderr retention, authoritative terminal response, cumulative native usage, normalized usage, final output, and safe protocol closure.
- [x] Run the focused tests; confirm RED before any model-session implementation exists.
- [x] Implement streamed NDJSON execution. Retain every stdout chunk before parsing, emit bounded normalized event metadata, allow one `init`, require one terminal `result` per turn, validate conversation identity and cumulative turn count, and close stdin after the controller completes.
- [x] Run the focused happy-path tests; confirm GREEN.
- [x] Add a failing two-turn test proving a packet-authorized controller continuation is sent through the same process and final cumulative usage is retained.
- [x] Implement bounded continuation validation against `continuationPolicy.allowedTransitions` and exact templates; confirm the two-turn test turns GREEN.
- [x] Add failing tests for malformed UTF-8/JSONL, duplicate or missing init/result, empty response, non-success result, nonzero exit, model/cwd/permission drift, unknown external advertised facilities, tool steps, subagent metadata, input drift, controller rejection/failure, timeout, ambiguous shutdown, and spawn failure.
- [x] Implement fail-closed classification and bounded shutdown. Tool or subagent observation is `capability-rejected`; malformed protocol is `protocol-failed`; provider terminal error is `provider-failed`; timeouts are never retried.
- [x] Run `node --test --test-concurrency=1 tests/scripts/antigravity-cli.test.mjs` and confirm all adapter scenarios pass.

## Task 3: Enable Google for Defining Concepts

**Files:**

- Modify `tests/evals/run-evaluation-session.test.mjs`.
- Modify `evals/defining-concepts/run-evaluation-session.mjs`.

**Interfaces:** The CLI accepts `--provider antigravity`, `--antigravity-command <absolute path>`, and repeatable `--antigravity-prefix-arg`. The packet provider is `google`, transport is `antigravity-cli`, and the exact outbound user message contains the isolated evaluation harness, explicit task-specific skill text when selected, and user prompt. Google capabilities declare no permitted tools, network, or web search; provider default context is acknowledged explicitly.

- [x] Add a failing prepare test showing Google toolchain inspection performs no model turn and the packet contains the exact composed post-activation message.
- [x] Add a failing run test showing an exact authorization selects the Antigravity adapter and retains the shared evidence envelope.
- [x] Run `node --test --test-concurrency=1 tests/evals/run-evaluation-session.test.mjs`; confirm both tests fail because the provider is unsupported.
- [x] Add provider selection, provider-specific runtime fingerprints, toolchain inspection, packet inputs/capabilities/isolation, adapter request construction, and current-state validation.
- [x] Keep Codex and Claude packet shapes and launch paths unchanged except for provider-specific fingerprint decomposition.
- [x] Run the focused defining-concepts tests; confirm GREEN for all three providers using fakes only.

## Task 4: Add the Committing-to-Git Policy-Only Profile

**Files:**

- Modify `tests/committing-to-git/evaluation-runner.test.mjs`.
- Modify `evals/committing-to-git/evaluation-runner.mjs`.
- Modify `evals/committing-to-git/run-evaluation-session.mjs`.

**Interfaces:** Add these exports:

```js
export function listPolicyEvaluationCaseIds(repositoryRoot) {}
export function buildPolicyEvaluationSchedule({
  seed,
  provider,
  model,
  effort,
  repetitions,
  caseIds,
}) {}
export async function preparePolicyEvaluationSession(options) {}
```

`executePreparedEvaluationSession` dispatches by the packet provider. OpenAI retains the existing Git controller and managed-home App Server request. Google accepts only suite-context profile `policy-only`, uses the one-turn defining-style completion controller, and invokes the Antigravity adapter. `preflightPreparedEvaluationSession` rejects non-OpenAI packets because Antigravity exposes no documented zero-turn authentication/status protocol.

- [x] Add failing tests deriving exactly the six current manifest policy case IDs and producing a deterministic Google schedule over existing arms without adding Google to the executable transaction schedule.
- [x] Add failing preparation tests proving executable cases and non-Google providers are rejected, no Git fixture is created, treatment files are explicitly and deterministically composed into the packet-bound prompt, and preparation performs no model turn.
- [x] Add a failing exact-authorization execution test against the fake Antigravity CLI and a failing rejection test showing executable/profile drift cannot consume a launch.
- [x] Run `node --test --test-concurrency=1 tests/committing-to-git/evaluation-runner.test.mjs`; confirm RED for the missing policy API.
- [x] Implement the policy case reader, pure schedule, explicit treatment-bundle renderer, prepared suite context, provider-specific fingerprint, one-turn controller, and execution dispatch.
- [x] Preserve the OpenAI-only guard in `prepareEvaluationSession`, the real fixture/controller semantics, and all existing schedule counts.
- [x] Add `policy-plan` and `prepare-policy` CLI commands. Require an explicit absolute Antigravity command for preparation and an explicit empty working directory. Do not add Google options to executable `prepare`.
- [x] Run the focused committing-to-git runner tests; confirm GREEN.

## Task 5: Document Capabilities and Historical Boundaries

**Files:**

- Modify `evals/README.md`.
- Modify `evals/defining-concepts/README.md`.
- Modify `evals/committing-to-git/README.md`.

**Interfaces:** Documentation names provider `google`, transport `antigravity-cli`, pinned version `1.1.19`, explicit post-activation, cached-auth limitation, raw evidence, cumulative usage, and policy-only scope. It must not imply disabled advertised tools, automatic skill discovery, zero-turn auth verification, or command-execution parity.

- [x] Add Google to the shared lifecycle, provider, evidence, and residual-limit documentation.
- [x] Add defining-concepts prepare/run examples with an absolute Antigravity executable and exact authorization boundary.
- [x] Add committing-to-git `policy-plan` and `prepare-policy` examples, supported case/arm semantics, and an explicit rejection table for executable Git behavior.
- [x] Keep the historical Gemini result description unchanged except for linking it to the new legacy-evidence interpretation.
- [x] Review all examples against actual CLI option names and packet fields.

## Task 6: Verify the Complete Change

- [x] Run the focused runtime, adapter, defining-concepts, and committing-to-git test files sequentially.
- [x] Run `npm run verify` and require exit code 0.
- [x] Run the provider-launch ownership search. `consumeExternalModelLaunch` may occur only in `runtime.js` and the three provider adapters; provider process launches remain adapter-owned except documented zero-turn/operator paths.
- [x] Inspect `git status --short`, `git diff --stat`, and the complete diff for every changed implementation, test, and documentation file.
- [x] Confirm `.codex/config.toml` and `.claude/` are untouched by this implementation, no configuration file or retained result changed, and no hosted model was invoked.
- [x] Do not commit or push without a separate explicit request.

## Acceptance Criteria

1. `createTransmissionPacket` accepts `google` only with `antigravity-cli` and exact authorization remains provider-neutral.
2. One reviewed Antigravity adapter owns every Google model process and consumes one launch capability immediately before spawn.
3. Toolchain inspection is local-only, pins 1.1.19, and binds executable, prefix scripts, help bytes, and the static capability profile.
4. Google input and output use one persistent streamed-NDJSON process with byte-preserved stdout/stderr and authoritative result events.
5. Model, working directory, request-review permission mode, conversation identity, turn count, usage, and controller transitions are validated.
6. Any observed tool or subagent step fails the run; dangerous permission bypass is unreachable.
7. `defining-concepts` supports Google with explicit packet-bound skill treatment and no automatic discovery claim.
8. `committing-to-git` supports Google only for manifest-declared policy cases and cannot create a Git fixture, execute commands, approve tools, sign, commit, or push through that profile.
9. Existing OpenAI and Anthropic runner behavior remains covered and passing.
10. The historical 2026-08-22 Gemini result remains byte-for-byte unchanged and explicitly legacy.
11. Automated tests use only fake executables and temporary roots.
12. No dependency or configuration change is introduced.
13. `npm run verify` passes.
