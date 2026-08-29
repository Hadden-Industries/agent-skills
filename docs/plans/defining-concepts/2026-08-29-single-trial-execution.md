# Defining Concepts Single-Trial Execution Implementation Plan

> **For Codex:** Implement this plan task by task with test-driven development. Do not make a live external model call until the prepared packet's transmission SHA-256 has been disclosed and separately authorized.

**Goal:** Add a bounded, resumable single-trial path to the existing `defining-concepts` evaluation runner so one model session can be prepared, preflighted, run, retained, and verified independently before any larger campaign is attempted.

**Architecture:** Keep `evaluation-runner.mjs` as the public command-line entry point and add a focused `evaluation-trial.mjs` lifecycle module behind a `trial` command group. Reuse the existing frozen-packet, capability-reconciliation, provider-adapter, and authorization machinery. Extend the shared execution runtime with an opt-in `evaluation-trial-v1` evidence layout; leave its legacy layout as the default so existing campaign and cross-skill behavior remains compatible. Write authorization consumption and streamed provider evidence before and during the external call, then write one terminal `result.json` only after a known terminal outcome.

**Technology:** Node.js ESM, built-in `node:test`, repository evaluation runtime and adapters, JSON/JSONL/Markdown evidence artifacts.

## Safety and semantic constraints

- Preserve all existing campaign commands and legacy evidence names.
- Do not change repository configuration, package metadata, lockfiles, or CI configuration.
- Keep the public vocabulary provider-neutral: `trial`, `case-id`, `skill-arm`, `trial-index`, `reasoning-effort`, `result`, `response`, `provider-transcript`, and `authorization-consumption`.
- Continue to use the current provider adapter's internal `arm` and `repetition` fields where backward compatibility requires them; do not expose those legacy names as the new trial CLI.
- Treat the first and second bounded runs as diagnostic and repeatability evidence, respectively. Exclude both from campaign aggregates.
- Never infer semantic success from transport completion. `result.json` records execution status; grading remains separately `not-graded` until an authorized grading workflow exists.
- If `authorization-consumption.json` exists but no terminal `result.json` exists, verification reports `executionStatus: "indeterminate"`, `providerOutcome: "undetermined"`, and `retryPermitted: false`. The verifier must not report `interrupted` unless the runner directly observed and durably recorded that interruption.
- `trial verify` is local and read-only: no provider connection, network access, model turn, artifact repair, or implicit retry.
- The live diagnostic remains a separate authorization step after preparation discloses the exact transmission SHA-256.

## Canonical command surface

```text
node evals/defining-concepts/evaluation-runner.mjs trial prepare ...
node evals/defining-concepts/evaluation-runner.mjs trial preflight --trial-dir <path>
node evals/defining-concepts/evaluation-runner.mjs trial run --trial-dir <path> --authorization-file <path> --allow-external-model-call
node evals/defining-concepts/evaluation-runner.mjs trial verify --trial-dir <path>
```

`trial prepare` accepts `--output-dir`, `--case-id`, `--skill-arm`, `--trial-index`, `--adapter codex-app-server`, `--model`, `--reasoning-effort`, `--created-at`, `--working-root`, and `--baseline-revision`. The manifest records provider `openai`, transport `codex-app-server`, diagnostic evidence use, and aggregate ineligibility.

The default destination convention is:

```text
evals/defining-concepts/results/trials/<filesystem-safe-UTC-timestamp>/
```

For example, `2026-08-29T123456.789Z` preserves ISO ordering while avoiding same-day collisions and Windows-invalid colon characters.

## Canonical trial evidence

```text
manifest.json
case.json
skill-bundle.json
capability-reconciliation.json
packet.json
preflight.json
authorization.json
authorization-consumption.json
result.json
metrics.json
timing.json
inputs/manifest.json
inputs/<ordered-packet-inputs>
outputs/response.md
outputs/provider-transcript.jsonl
outputs/events.jsonl
outputs/stderr.log
preflight/<adapter-evidence>
```

`skill-bundle.json` is present for a skill-bearing arm and omitted for `no-skill`. The manifest and input manifest bind every applicable artifact by digest. A trial directory is immutable with respect to its identity and packet; later lifecycle stages may only add their defined evidence files.

## Task 1: Add the opt-in durable trial evidence layout

**Files:**

- Modify: `tests/scripts/evaluation-runtime.test.mjs`
- Modify: `scripts/evaluation/runtime.js`

1. Add a focused runtime test that executes a fake adapter with `evidenceLayout: "evaluation-trial-v1"` and expects:
   - `authorization-consumption.json` to exist before adapter execution;
   - streamed `outputs/provider-transcript.jsonl`, `outputs/events.jsonl`, and `outputs/stderr.log` evidence;
   - `outputs/response.md` for the final response;
   - `metrics.json` and `timing.json`;
   - a terminal `result.json` with separate execution and grade status;
   - no legacy `attempt.json`, `run.json`, `outputs/transcript.jsonl`, or `outputs/final.md` artifacts.
2. Run only that test and confirm it fails because the runtime does not yet recognize the layout.
3. Introduce a small evidence-layout resolver in `runtime.js`. Keep the current names as the default and map the new names only when explicitly requested.
4. Make authorization consumption durable before invoking the adapter. Preserve the existing exclusive-create semantics and transmission-hash binding.
5. Write the terminal trial result with `artifactType: "evaluation-trial-result"`, `schemaVersion: 1`, `executionStatus`, `gradeStatus: "not-graded"`, `providerOutcome`, `retryPermitted`, the transmission SHA-256, error/closure information, and the relative evidence map.
6. Re-run the focused test and the entire runtime test file.

## Task 2: Propagate the evidence layout through the low-level session runner

**Files:**

- Modify: `tests/evals/defining-concepts/run-evaluation-session.test.mjs`
- Modify: `evals/defining-concepts/run-evaluation-session.mjs`

1. Add a CLI test showing `run --evidence-layout evaluation-trial-v1` reaches the runtime and produces the modern durable artifacts.
2. Run the focused test and observe failure for the unrecognized or ignored flag.
3. Parse and validate `--evidence-layout`; accept only the legacy default and `evaluation-trial-v1`.
4. Pass the selected layout to `executeAuthorizedModelSession` without changing existing callers.
5. Re-run the focused test and the whole session-runner test file.

## Task 3: Implement the isolated trial lifecycle module

**Files:**

- Create: `tests/evals/defining-concepts/evaluation-trial.test.mjs`
- Create: `evals/defining-concepts/evaluation-trial.mjs`

1. Add prepare tests covering one selected case and arm, Windows-safe timestamp naming, packet and input creation, manifest digest bindings, selected skill-bundle handling, full capability reconciliation, diagnostic evidence classification, aggregate exclusion, collision refusal, and staging cleanup behavior.
2. Run the prepare tests and confirm failure because the module does not exist.
3. Implement `prepareEvaluationTrial` using the existing evaluation definitions, skill-bundle capture, capability reconciliation, and low-level packet preparation. Build in a staging directory and atomically rename only after every immutable artifact validates.
4. Add preflight tests covering successful zero-turn retained evidence, packet-integrity rejection, duplicate-preflight refusal, and refusal once authorization consumption or a result already exists.
5. Run the preflight tests and confirm failure before implementing `preflightEvaluationTrial`.
6. Implement preflight as an injected zero-turn process invocation, retain raw adapter evidence under `preflight/`, and write one immutable `preflight.json` only after validation.
7. Add run tests covering exact authorization binding, explicit external-call gate, successful modern evidence retention, duplicate/consumed authorization refusal, and the no-buffering guarantee that consumption and stream files exist while the child invocation is in progress.
8. Run the run tests and confirm failure before implementing `runEvaluationTrial`.
9. Implement run as an injected low-level session invocation with `evaluation-trial-v1`; do not aggregate or rewrite the runtime's durable evidence.
10. Add verify tests for prepared-only, preflighted, completed, failed, and authorization-consumed-without-result states; include digest tampering, missing evidence, unknown enum values, and no-retry semantics.
11. Run the verify tests and confirm failure before implementing `verifyEvaluationTrial`.
12. Implement read-only verification with three independent result dimensions: `artifactIntegrity`, `executionStatus`, and `gradeStatus`. Return `indeterminate` and forbid retries for consumed authorization without a terminal result.
13. Run the full lifecycle test file.

## Task 4: Expose the `trial` command group through the existing runner

**Files:**

- Modify: `tests/evals/defining-concepts/evaluation-runner.test.mjs`
- Modify: `evals/defining-concepts/evaluation-runner.mjs`

1. Add parser and dispatch tests for `trial prepare`, `trial preflight`, `trial run`, and `trial verify`, including the exact approved flag vocabulary and rejection of legacy or ambiguous aliases.
2. Run the focused tests and confirm failure because `trial` is not yet a command group.
3. Add nested-command parsing without changing the current campaign commands.
4. Delegate lifecycle behavior to `evaluation-trial.mjs` and print machine-readable JSON summaries suitable for retained logs and automation.
5. Ensure `trial run` requires both the exact authorization file and `--allow-external-model-call`.
6. Re-run the runner tests and existing defining-concepts deterministic tests.

## Task 5: Document the bounded diagnostic workflow

**Files:**

- Modify: `evals/defining-concepts/README.md`

1. Document why single-trial execution precedes campaign execution.
2. Document the four lifecycle commands, flags, timestamp naming, evidence tree, and status semantics.
3. State that the first recommended diagnostic is case 1, `candidate-skill`, `gpt-5.3-codex-spark`, and `low`, because the case exercises the skill's required live web-search and URL-retrieval capabilities at the lowest-cost arm.
4. State that preparation and verification make no model calls, preflight must remain zero-turn, and run requires exact packet authorization.
5. State that a completed execution is not a semantic pass and that diagnostic/repeatability trials are excluded from aggregate campaign conclusions.
6. State that a second same-condition success supports repeatability only, not reproducibility.

## Task 6: Verify deterministic behavior

**Files:**

- Inspect: all files changed above

1. Run the focused test files:

```text
node --test tests/scripts/evaluation-runtime.test.mjs
node --test tests/evals/defining-concepts/run-evaluation-session.test.mjs
node --test tests/evals/defining-concepts/evaluation-trial.test.mjs
node --test tests/evals/defining-concepts/evaluation-runner.test.mjs
```

2. Run the repository-required deterministic gate:

```text
npm run verify
```

3. Inspect `git status --short`, the complete diff, and any generated artifacts. Preserve unrelated and pre-existing changes.

## Task 7: Execute one separately authorized live diagnostic

**Files:**

- Create under: `evals/defining-concepts/results/trials/<timestamp>/`

1. Prepare exactly one diagnostic trial for case 1, `candidate-skill`, trial index 1, adapter `codex-app-server`, model `gpt-5.3-codex-spark`, and reasoning effort `low`.
2. Run the zero-turn preflight and retain its evidence.
3. Verify the prepared/preflighted trial locally.
4. Disclose the exact trial path, manifest digest, packet transmission SHA-256, provider, adapter, model, reasoning effort, and maximum turns to the user.
5. Obtain new exact authorization for that packet. Prior campaign authorizations do not apply.
6. Create the per-packet authorization artifact containing the exact approved statement and bindings.
7. Run exactly one external session with no retry.
8. Immediately run `trial verify` and inspect the retained response, transcript, events, stderr, timing, metrics, authorization consumption, and terminal result.
9. Report execution status separately from grade status and qualitative findings.

## Task 8: Establish repeatability before expanding

1. Only after Task 7 yields retained, verified evidence, prepare a second trial under the same case, skill arm, adapter, model, reasoning effort, capabilities, and turn budget with trial index 2.
2. Obtain separate exact authorization for its new transmission SHA-256.
3. Run once with no retry and verify independently.
4. Compare lifecycle reliability and retained evidence. Describe matched success as repeatability evidence, not reproducibility and not campaign-level quality evidence.
5. Do not resume the 30-case campaigns until both bounded trials have retained, independently verifiable outcomes and any single-trial harness defects are corrected test-first.
