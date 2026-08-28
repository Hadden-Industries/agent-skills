# Maintainer Evaluations

This tree contains repository-maintainer evaluation suites and evidence. It is separate from the deployable skills under `skills/`; each `evals/<name>/` suite matches one canonical `skills/<name>/` directory. Suite READMEs define domain cases, controllers, capabilities, grading, and commands. This document is the single source of truth for the shared runtime.

## Lifecycle

Every new provider session crosses an explicit prepare/authorize/run boundary:

1. Inspect the selected provider toolchain and build the suite-controlled inputs.
2. Call `createTransmissionPacket(transmission)` and `prepareEvidenceSession({ destination, packet, inputs })` in a new destination. Preparation is local-only and starts no model turn.
3. Review `packet.json`, including its provider, model, effort, capabilities, isolation, toolchain, runtime fingerprint, exact inputs, and `transmissionSha256`.
4. Create an exact authorization artifact for that packet.
5. Call `executeAuthorizedModelSession(...)`. The common gate acquires evidence first, validates authorization, validates current state, gives one opaque launch capability to the selected adapter, and finalizes terminal evidence.

The public provider adapters are `codexAppServerAdapter`, `claudeCliAdapter`, and `antigravityCliAdapter`. Suites supply a controller and provider request; they do not implement provider transport, credential-home rotation, packet hashing, or run-record writes. `preflightCodexAppServer(...)` is a separate zero-turn local protocol check and requires an explicit suite/operator guard. Antigravity exposes no reviewed zero-turn authentication/status command, so its cached authentication is tested only by a separately authorized model launch.

`evals.json` and `trigger-evals.json` remain the shared manifest surfaces. `npm run build:check` verifies matching skill/suite names, behavioral and trigger shapes, unique normalized cases, contained fixture paths, and the deployable/evaluation boundary. Mechanical validation is not model or semantic evidence.

## Transmission Packet

`packet.json` is RFC 8785 canonical JSON with `schemaVersion`, `canonicalization`, `digestAlgorithm`, `transmission`, and `transmissionSha256`. The transmission binds:

- suite/session identity and declared suite artifacts;
- provider, model, effort, transport, and inspected toolchain;
- runtime fingerprints;
- network, web-search, tool, and provider-facility capabilities;
- sandbox, working directory, workspace roots, instruction sources, persistence, and a positive-name environment;
- every harness-controlled input, with role, media type, encoding, byte length, content, and SHA-256; and
- continuation-controller digest, turn limit, allowed transitions, and exact continuation templates.

`inputs/manifest.json` and `inputs/<ordinal>-<id>.<extension>` retain independent copies of every declared input. Execution revalidates the canonical packet and those bytes before authorization can issue a launch capability. Provider, model, toolchain, home, fixture, capability, input, and result paths are packet- or runtime-bound; execution flags cannot redirect them.

## Authorization

Hosted execution requires both literal `allowExternalModelCall: true` and this exact JSON shape:

```json
{
  "schemaVersion": 1,
  "decision": "authorized",
  "statement": "I authorize exactly one external model session for this provider, model, effort, and transmission SHA-256.",
  "allowExternalModel": true,
  "provider": "openai",
  "model": "gpt-5.6-luna",
  "effort": "low",
  "transmissionSha256": "COPY_THE_REVIEWED_PACKET_DIGEST"
}
```

The provider, model, effort, and digest values must equal the prepared packet. Earlier implementation approval, toolchain login, preflight approval, or authorization of another packet does not authorize a model call. `authorization.json` is written only after exact validation. `attempt.json` is written only when the adapter consumes the packet-bound, single-use launch capability; a retry requires a new prepared session and new exact authorization.

## Evidence

Each prepared session owns one immutable evidence directory:

```text
packet.json
inputs/manifest.json
inputs/<ordinal>-<id>.<extension>
authorization.json          # only after exact authorization
attempt.json                # only after launch-capability consumption
outputs/transcript.jsonl
outputs/events.jsonl
outputs/stderr.log
metrics.json
timing.json
run.json                    # terminal record, written last
```

`run.json` records the transmission digest, status, failure class, redacted error, safe/unsafe closure, suite result, and a SHA-256/byte-length map of every retained artifact. `metrics.json` separates native and normalized usage. `timing.json` records wall-clock timestamps and monotonic duration. Adapter or infrastructure failures remain terminal records; failed and invalid attempts are retained rather than omitted from aggregates.

Codex zero-turn preflight evidence lives beneath the suite-selected preflight destination, conventionally `preflight/`, and includes its own transcript, normalized events, stderr, and terminal `preflight.json`. Suites may declare additional artifacts in the packet; undeclared or path-escaping writes fail closed.

## Provider Adapters

OpenAI sessions use the Codex App Server adapter. It re-inspects the exact executable/schema, launches App Server with a process-local file-credential-store override, verifies the positive-name environment and stable `CODEX_HOME`, checks authentication, models, skills, hooks, apps, and thread isolation, normalizes approval requests through the suite controller, retains JSONL bytes, enforces capability events, and owns thread interruption/deletion and child closure.

Anthropic sessions use the Claude CLI adapter. It pins one reviewed CLI version/capability profile, uses current documented safe-mode and output flags, preserves normal OAuth/keychain authentication, retains the provider-owned default system prompt outside the harness digest, captures provider output once, and normalizes the same result and closure interface. Unsupported versions or required capabilities fail before execution.

Google sessions use the Antigravity CLI adapter. It pins reviewed version `1.1.19`, the exact executable and prefix files, and the `--help` bytes. It uses one process with `stream-json` input and output, explicit model and effort, terminal sandboxing, disabled slash commands, and request-review permissions. It never passes `--dangerously-skip-permissions`, an agent override, a conversation-resume flag, or permission allow rules. One `init` event and one terminal `result` per turn are required; raw NDJSON and stderr are retained, while final cumulative usage is normalized. Any observed tool or subagent step fails the run.

Antigravity's `init.tools` inventory is evidence of advertised built-in facilities, not a claim that the CLI disabled them. The policy profile proves that no tool step appeared in a completed run; it does not prove that provider-owned tools, default instructions, global customizations, or cached account context were unavailable. An advertised plugin or MCP tool fails closed. Treatment activation is therefore explicit and packet-bound rather than delegated to automatic skill discovery.

Provider process launch belongs only to these three adapters. The operator login CLI is the sole separate Codex process-launch path and performs no model run. Suite controllers own domain conversation semantics and permission decisions; adapters contain no concept- or Git-specific parser.

## Evaluation Homes

`scripts/evaluation/evaluation-homes.js` manages the reusable versioned root returned by `evaluationHomesRootFromLocalAppData(localAppData)`. It owns exactly two stable roles: `preflight` and `execution`. A role operation validates the approved absolute root and owner marker, acquires an exclusive lease, verifies path identity and containment, rotates the prior home into owned quarantine, creates the fresh stable path, carries forward only a validated single-link ordinary `auth.json`, binds `CODEX_HOME`, registers child processes, requires exact release evidence, retires the used generation, carries the possibly refreshed credential cache into the next clean stable path, and records immutable completion history. Every other Codex-created file is disposable runtime residue.

Windows path attestation remains per-path and fail-closed, but it no longer starts PowerShell for every ancestor lookup. `scripts/evaluation/windows-path-metadata.js` owns one bounded JSONL worker per public manager operation, while `scripts/evaluation/windows-path-probe.ps1` performs the same read-only drive, attribute, resolved-path, and reparse checks for each identified request. The execution fingerprint binds both files.

The installed Codex CLI reports a successful browser login even when Windows keyring storage falls back to `auth.json`. Deleting the disposable generation would therefore delete the credential. Each stable `preflight` or `execution` role instead owns one file-backed credential cache inside the approved root and may require its own separately authorized one-time login through `manage-evaluation-homes.js login`. The operator forces file storage only for the child process, rotates the cache through the ordinary lifecycle, and reports success only after `codex login status` passes in a second rotated home. The manager never reads or copies credential bytes, never writes `config.toml`, and never modifies the OS keyring. Tests use injected temporary roots, fake credentials, and fake executables, never the production root or real authentication material.

## Failure Classes

Common terminal execution failures use exactly these classes:

| Failure class            | Boundary                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `authorization-rejected` | External-call flag, authorization artifact, canonical packet, or prepared input rejected before launch |
| `preflight-rejected`     | Runtime, toolchain, fixture, treatment, or other current-state validation rejected                     |
| `capability-rejected`    | Provider/thread attestation or emitted capability exceeded the packet policy                           |
| `controller-failed`      | Suite controller contract, approval decision, turn decision, or continuation was invalid               |
| `launch-failed`          | The reviewed provider process could not be launched                                                    |
| `protocol-failed`        | Provider output or request/response lifecycle violated the reviewed protocol                           |
| `provider-failed`        | Provider or home boundary failed outside a more specific class                                         |
| `timed-out`              | A bounded provider phase exceeded its deadline                                                         |

`status` is `completed` or `failed`; failure class, error, closure, and retained artifacts stay distinct. A safe closure proves the registered child and streams reached the declared terminal state. An unsafe release preserves the lease/owned generations for explicit recovery rather than guessing that cleanup is safe.

## Historical Results

Existing files under `evals/*/results/` are immutable evidence for their recorded runner and schema. Do not rewrite packet digests, retrofit the common envelope, or make an older result claim current runtime, adapter, authorization, or stable-home guarantees. Readers branch on an explicit schema/version; they do not infer a schema from absent fields.

The retained `committing-to-git/results/2026-08-22-gemini-3.5-flash-low.json` record remains a legacy Antigravity 1.1.18 explicit-activation policy experiment. It is not migrated to the 1.1.19 adapter schema and does not establish automatic discovery, dynamic approvals, Git command execution, or current-run parity.

New result sets keep raw provider evidence immutable and derived grading/aggregation separate. Corrections create a new record that names the superseded derivation. Every failed launch, invalid attempt, exclusion, requested model, provider-confirmed model when available, toolchain, seed, repetition, timestamp, and limitation remains visible.

## Sensitive Evidence

Authentication material never enters packet inputs, transcripts, normalized events, suite artifacts, errors, or run results. The evidence API rejects authentication-bearing member names and scans structured values before persistence. Adapters redact account email, tokens, login URLs, bearer values, secrets, and provider diagnostics; environment policy forbids provider API-key variables and records secret sources as an empty array. Evaluation-home rotation identity-checks and renames `auth.json` without reading its bytes. Antigravity uses the CLI's cached credentials without exporting or inspecting their values.

Evidence retains only what is needed to audit the session: account type/authentication-required state, toolchain identity, safe protocol metadata, bounded stderr, usage, timing, controller decisions, and artifact digests. Keep private arm mappings separate from blinded grading packages, and treat exact packet authorization as consent to the declared provider inputs only, never as consent to persist credentials.
