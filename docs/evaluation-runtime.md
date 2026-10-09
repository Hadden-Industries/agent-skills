# Maintainer Evaluations

Each canonical `src/<name>/` project contains runtime source and a maintainer-only `evals/` directory.
`npm run build` creates the exact deployable runtime inventory under `skills/<name>/`; evals and private execution code are excluded.
Suite READMEs define domain cases, controllers, capabilities, grading, and commands.
This document defines the shared runtime.

The [architecture](designs/2026-10-03-evaluation-architecture.md), [preservation ledger](designs/2026-10-03-evaluation-preservation-ledger.md), and [implementation plan](plans/2026-10-03-evaluation-modernization.md) record the modernization requirements.
Historical bytes are retained under `evidence/historical/`, with original paths and Git differences in `evidence/migrations/2026-10-03-historical-results.json`.
New authoritative executions and derived reports use separate ignored roots under `evidence/`.

The [naming suite](../src/naming-objects-in-software-engineering/evals/README.md) uses the existing Antigravity adapter and scripted controller for new prepared sessions.
Historical keyword grading remains diagnostic-only.
Neither semantic grades nor self-reported selection establish actual host activation.

## Portable compilation and consumers

`src/<skill>/evals/evals.json` contains only `skill_name` and portable `evals`: exact IDs, prompts, expected output, ordered assertions, and optional skill-root-relative `files` such as `evals/files/sample.epub`.
`extensions/v1/suite.json` retains protocol and assurance metadata, selected profile identifiers, provenance and a portable-case binding for every extended case.
The compiler rejects duplicate JSON keys, unknown fields, stale bindings, orphan IDs, fixture escapes, unsupported capabilities, and stale or extra runtime payloads before preparation.

`scripts/evaluation/compile-suite.js` returns a frozen versioned contract with source, distribution, fixture and case identities.
Only the maintained profile registry resolves executable policy.
No authored JSON field imports a module.
`project-skill-up.js` creates static YAML and an explicit coverage receipt; expected output and assertions remain semantic descriptions, never guessed substring rules.
`consumer-workspace.js` copies verified runtime bytes and referenced fixtures into a fresh temporary root.
Source extensions and private mappings stay outside the model-readable skill.

The pinned native consumer is skill-up 0.12.0; the independent portable reader is agent-skills-eval 0.1.1.
Exact versions, archives, executable hashes and license hashes are in `evaluation-toolchain.json`.
Explicit tool acquisition uses `python scripts/set_up_evaluation_execution_tools.py`; verification must not download tools.
Fake target and static judge checks establish transport and format conformance only.
The independent reader omits baseline fixtures, skips binary EPUB input and does not send expected output to its assertion judge; its coverage receipt records those limits.

The owner approved Windows x64 assured bridge enablement on 2026-10-05 after the Job Object host, independent closure recorder and explicit interrupted-home recovery passed their synthetic qualification.
The [Windows qualification record](evaluation-windows-bridge-qualification.md) separates that path from the original failed native-consumer experiment, whose [retained evidence](../evidence/qualification/2026-10-03-windows-process-tree.json) remains unchanged.
Linux functional consumer execution has passed CI, but Linux assured dispatch remains disabled with its qualification marker `pending`.
An unqualified bridge fails before provider launch; direct Hadden execution remains an explicit mode.
Qualification permits an explicitly selected execution path, not a model call: exact packet authorization is still required.
Native conformance and Windows workload closure do not establish OS-level network isolation, real-provider acceptance or host activation.

### Prepared execution mode

Windows carrier preparation binds the absolute installed base Python interpreter, its executable digest and version, both host/closure-recorder source digests, and a fresh job identity in `windows-job-v2`. Dispatch uses one short-lived workload host and one bounded independent closure recorder; no service or dependency is installed. Job membership is assigned atomically at process creation, breakaway is disabled, and only standard stream handles enter the workload. The Node wrapper owns the sole liveness-pipe writer. The recorder is armed before any workload, outside this invocation's job, with explicitly inherited query/terminate and exact host process handles.
Those handles become non-inheritable in the recorder and never enter the workload.
Wrapper loss, timeout, recorder loss or consumer exit makes the host terminate the job.
The bridge checks membership in its packet-bound job before executing the provider; its brief query-only probe closes its handle before returning.

The recorder's additional handle changes kill-on-last-handle-close: host death alone is no longer the final close.
It waits for the retained exact host process handle to become signaled, terminates that exact job, and observes zero active processes within five seconds before sealing a separate `process-host-observation.json.closure.json`.
Waiting for actual host termination covers in-flight process creation.
Readiness pins lossless FILETIME birth identities, producer/consumer digests, the private carrier/packet association and an invocation-only public RSA key.
The private key remains in the recorder, using native Windows CNG; the receipt is signed over sorted compact UTF-8 JSON with RSA/SHA-256. This detects altered receipt bytes against the readiness key recorded in the home lease. It is not independent attestation of arbitrary producer code or protection against a hostile account that can replace all trusted control records. [CNG signing](https://learn.microsoft.com/en-us/windows/win32/api/bcrypt/nf-bcrypt-bcryptsignhash) and the [RSA public blob layout](https://learn.microsoft.com/en-us/windows/win32/api/bcrypt/ns-bcrypt-bcrypt_rsakey_blob) define the native boundary.

Host closure observations are derived diagnostics.
An abrupt host death remains a failed invocation even when the independent recorder proves workload closure.
If recorder and host both die, closing both job handles retains kernel kill-on-close, but the missing signed receipt remains unknown.
Missing/truncated observations, remaining active processes, invalid signatures or stale interpreter/script bytes fail closed and do not fabricate terminal Hadden results or reset consumed authority.
Identity binding covers interpreter executable and both source files, not every Python DLL or standard-library file; this is lifecycle containment, not a hostile-local-user sandbox.
The Windows qualification marker admits this bound `windows-job-v2` path; Linux retains its disabled qualification gate.

### Interrupted evaluation-home recovery

`prepareEvaluationHomeRecovery` and `applyEvaluationHomeRecovery` in `scripts/evaluation/evaluation-homes.js` maintain a resource, not an evaluation outcome.
The initial scope is version2 Windows bridge-owned execution leases whose journal reached the witnessed operation interval.
Legacy, preflight, direct-provider and Linux leases remain unavailable.
An eligible proposal binds root/volume/marker identity, role, lease token, operation, original generation inventory, exact lease/journal bytes, packet/carrier/readiness records, the exclusive signed closure reservation, consumed-attempt bytes and the original outcome's bytes or absence.
Preparation reads metadata for `auth.json`, never its contents.

Use an existing private operator-evidence directory outside home, carrier and prepared-session roots.
Preparation writes its proposal exclusively, without changing the managed home.
The printed digest and proposed paths are the concrete operator decision:

```powershell
node scripts/evaluation/manage-evaluation-homes.js prepare-recovery --root ROOT --role execution --proposal ABSOLUTE_PROPOSAL_PATH
node scripts/evaluation/manage-evaluation-homes.js apply-recovery --root ROOT --role execution --confirm-root ROOT --confirm-role execution --proposal ABSOLUTE_PROPOSAL_PATH --state-digest PRINTED_DIGEST
```

Application revalidates exact state and acquires exclusive recovery ownership while the original role lease continues blocking ordinary operations.
It retains the used generation in distinct quarantine, creates a marked fresh generation, identity-checks and renames at most the existing single-link credential cache, and seals a `recovered-evaluation-home` resource receipt before moving the original lease directory into `.history/*.recovered`.
No quarantine, failed evidence or consumed authority is deleted.
Inspection distinguishes `completedHistory`, `recoveredHistory` and unclassified `otherHistory`; recovered history is not a successful evaluation.

An interrupted recovery retains its original proposal, transition journal and numbered owner records.
To resume, run `prepare-recovery` into a new proposal path, review its new state/digest, then use `resume-recovery` with the same exact root/role/digest confirmations. A live owner refuses immediately. A returned owner has a bound durable release; a hard-killed owner requires native PID/birth comparison and process-state inspection.
This owner observation is separate from the signed workload-closure proof; PID absence never substitutes for that proof.
Recovery attempts are capped at 32 and never automatically retried.

Known pre/post-transition states can resume after rotation, marked staging creation, publication, credential transfer and receipt sealing. Missing/truncated journals, incomplete ownership, an unmarked partial replacement, conflicting credential caches, changed evidence, redirected paths, hardlinks or unsupported original phases remain unknown and retained for explicit investigation.
If archival finished but the caller died before receiving its response, inspection shows the sealed recovered history and released role.
No repeated recovery is needed.

A subsequent evaluation needs a fresh prepared packet and exact authorization.
The original consumed packet still refuses replay, and its absent/failed outcome remains unchanged. These APIs do not authorize production-home recovery, real model calls, campaign advancement or bridge activation. Qualification uses synthetic credentials/providers and disposable homes; a real recovery remains a separate exact operator decision.

Git session preparation and defining-concepts campaign preparation accept `--execution-mode direct|skill-up`, defaulting to `direct`.
Git's consumer mode also requires a positive `--execution-timeout-ms` at preparation; defining-concepts keeps its existing required deadline.
Naming's preparation request uses `executionMode` with the same values and its existing `timeoutMs`.

Consumer preparation allocates one carrier per selected session before sealing the Hadden packet.
The packet binds the receipt digest, including its exact native configuration and deadline.
A sibling `<preparedSession>.consumer.json` contains only the receipt locator; execution treats that locator as untrusted and verifies the packet-bound digest.
Campaign-directory relocation does not move the external carrier or change its receipt.
Retain both locations with the session evidence.

The existing run command dispatches according to that prepared binding.
It cannot turn a direct packet into a consumer packet or silently fall back to direct execution.
Naming consumer requests use an `authorizationFile` path and literal `allowExternalModelCall: true`; direct naming requests may retain their existing inline authorization.
Supplying both authorization forms is rejected.
Native reports are never returned as authoritative outcomes: dispatch checks the retained Hadden outcome and artifact hashes.
A failed native attempt retains its claim/control evidence and must be reconciled before any fresh preparation.

Windows x64 permits consumer preparation through the qualified, packet-bound `windows-job-v2` path.
Linux assured consumer preparation remains disabled.
Deterministic transport tests compare direct and native Git policy sessions, Git fixture/controller sessions, and defining/naming follow-up traces with fake providers; those tests authorize no model call.
The separately approved [Windows real-provider campaign](evaluation-real-provider-observations.md) records operational closure and primary policy observations without establishing semantic acceptance or host activation.

## Lifecycle

Every provider session using this shared runtime crosses an explicit prepare/authorize/run boundary; a suite may insert a separately recorded zero-turn provider preflight before authorization:

1. Inspect the selected provider toolchain and build the suite-controlled inputs.
2. Call `createTransmissionPacket(transmission)` and `prepareEvidenceSession({ destination, packet, inputs })` in a new destination.
   Preparation is local-only and starts no model turn.
3. If the suite requires it, run one explicitly guarded zero-turn preflight, bind its terminal result to the prepared packet or campaign, and refuse authorization or execution after a failed, stale, or nonzero-turn result.
4. Review `packet.json`, including its provider, model, effort, capabilities, isolation, toolchain, runtime fingerprint, exact inputs, and `transmissionSha256`.
5. Create an exact authorization artifact for that packet.
6. Call `executeAuthorizedModelSession(...)`.
   The common gate acquires evidence first, validates authorization, validates current state, gives one opaque launch capability to the selected adapter, and finalizes terminal evidence.

The public provider adapters are `codexAppServerAdapter`, `claudeCliAdapter`, and `antigravityCliAdapter`.
Suites supply a controller and provider request; they do not implement provider transport, credential-home rotation, packet hashing, or run-record writes.
`preflightCodexAppServer(...)` is a separate zero-turn provider-protocol check and requires an explicit suite/operator guard. It may start the reviewed provider process and inspect authenticated metadata, but it never calls `turn/start`. Antigravity exposes no reviewed zero-turn authentication/status command, so its cached authentication is tested only by a separately authorized model launch.

`evals.json` and `trigger-evals.json` remain portable manifest surfaces.
`npm run build:check` verifies matching skill/suite names, behavioral and trigger shapes, unique normalized cases, contained fixture paths, and the deployable/evaluation boundary.
Capability contracts reside in the versioned assurance extension and enter compiled contract version 1.
Validation reads the canonical skill's standard `compatibility` field, requires an exact reviewed candidate-arm interpretation, validates every case capability declaration, and proves that the deny-by-default campaign policy permits all declared arm, compatibility, and case requirements.
Mechanical validation is not model or semantic evidence, and provider availability remains a preparation or preflight concern.

## Declarative Conversations

A behavioral case may declare a single initial prompt or a bounded scripted conversation.
The generic manifest shape is:

```json
{
  "prompt": "The initial user turn.",
  "follow_up_turns": [
    {
      "id": "stable-transition-id",
      "prompt": "The exact next user turn."
    }
  ]
}
```

`follow_up_turns` is optional.
When present, it is a nonempty array of at most 31 entries, making 32 total turns including the initial prompt.
Every entry contains exactly `id` and `prompt`; IDs are unique lowercase kebab-case identifiers and prompts are nonempty strings.
Array order is conversation order.
These turns are committed test inputs, not suggestions for a provider or controller to paraphrase.

`normalizeEvaluationConversation(...)` converts the declaration into an immutable `prompt` turn followed by the exact declared transitions.
`createScriptedContinuationPolicy(...)` binds the controller digest, total turn limit, ordered allowed transition IDs, and exact continuation templates into the transmission packet.
The packet and retained inputs therefore authorize the complete conversation rather than only its opening turn.

## Scripted Controller Boundary

`createScriptedConversationController(...)` owns only bounded conversation mechanics.
It supplies the initial text, accepts one completed nonempty final answer for the expected turn, emits the exact next committed input when one exists, and completes through a suite-provided result function after the last turn.
It rejects duplicate, skipped, failed, out-of-order, or post-completion turns and rejects every approval request.
It does not inspect domain semantics, invent clarifications, branch on answer content, grade outputs, call providers, or broaden capabilities.

Suites may wrap this controller to shape their terminal result or permission-rejection reason, but domain policy remains in the suite.
Adapters receive the same bounded controller interface.
A provider that cannot preserve the declared turn count and transition semantics must be rejected during preparation or preflight; silently truncating a scripted conversation to one turn is invalid.

## Skill Bundles and Comparison Arms

Treat a deployable skill directory as the evaluation treatment.
`captureGitSkillBundle(...)` captures ordinary UTF-8 files from one exact Git commit; `captureWorkingTreeSkillBundle(...)` captures the current canonical directory.
Both retain source identity, repository-relative file paths, exact content, byte lengths, per-file SHA-256 values, and an aggregate SHA-256 over canonical JSON.
`renderSkillBundle(...)` preserves file boundaries when presenting those bytes to a model.
A bundle must include `skills/<name>/SKILL.md`; unsupported entries, invalid UTF-8, or a digest mismatch fail closed.

Use these canonical arm names when a campaign measures both incremental skill value and a proposed revision:

- `no-skill`: the isolated task without a task-specific skill bundle;
- `current-skill`: the complete skill captured from an exact comparison Git revision; and
- `candidate-skill`: the complete proposed skill captured from the working tree when the campaign is frozen.

The prompt, provider conditions, and all non-treatment inputs remain matched across arms.
Capturing only `SKILL.md` is insufficient when the skill depends on references, scripts, or assets.
Changing candidate bytes after preparation invalidates that candidate iteration; create a new bundle and campaign rather than modifying retained evidence.
Historical two-arm names such as `with_skill` and `without_skill` remain valid only within their recorded schema and are never silently renamed.

The current Git campaign uses `no-skill`, `old-skill`, and `new-skill`; the naming runner uses `no-skill` and `candidate-skill`.
Preserve each experiment's actual arm names and meaning.
The common naming guidance above does not authorize rewriting an existing campaign or its historical evidence.

## Compatibility and Capability Reconciliation

The Agent Skills `compatibility` frontmatter field remains portable human-readable prose.
It is not a repository-specific capability expression language: do not encode vendor IDs, tool names, `allowed-tools`, MCP declarations, Boolean operators, or a private mini-grammar in it.
A capability-aware schema-v3 suite instead owns an explicit `capability_contract` in `evals.json` and copies each frozen skill-bearing arm's `compatibility` value into an exact-text interpretation.
Any changed, missing, duplicated, or unreviewed value fails closed; heuristic keyword parsing and model-based interpretation are prohibited.

Each case declares `required_capabilities`, including an empty array when it needs no additional facility.
Reconciliation unions case requirements, arm requirements, and unconditional compatibility requirements, then checks that union against the suite's explicit deny-by-default campaign policy and the selected provider's reviewed support.
Requirements never grant permission.
A successful reconciliation receipt records the exact skill-bundle digests, compatibility text and interpretations, selected cases, required and allowed capabilities, provider bindings, runtime capability object, and matched per-arm envelopes.
Its digest is bound into the campaign manifest, every session, and every transmission packet.

This split keeps the standardized skill field usable across agents while giving the evaluation harness deterministic enforcement.
The repository validator can establish declaration consistency without contacting a provider; campaign preparation additionally proves provider support and exact runtime bindings.
All comparison arms receive the same non-treatment capability envelope unless a separately designed experiment explicitly varies it.

## Provider Capability Preflight

Before preparing a campaign, compare every declared conversation and case requirement with the selected adapter's reviewed capability profile.
Freeze provider, exact model, effort, toolchain, network, web search, tools, provider facilities, isolation, and runtime fingerprint in each transmission.
Reject unsupported multi-turn conversations, tools, permissions, network requirements, or provider facilities before execution.
Do not claim that a tool is unavailable merely because it was unused, or that a capability is available because a provider normally advertises it; the packet records the reviewed session policy.

Provider-level capability discovery and session-level activation are distinct.
For Codex, `modelProvider/capabilities/read` reports facilities the provider can make available.
A `true` availability value does not mean that the packet requested or the thread activated that facility, so it must not be compared for equality with a disabled packet policy.
A facility requested by the packet must be available; actual activation is verified separately from the thread start/read state, and emitted tool, web-search, image-generation, MCP, delegation, command, and file-change events remain subject to fail-closed runtime enforcement.

Capability differences are methodologically material.
Keep matched arms on the same profile, label cross-provider evidence separately, and never infer source retrieval, validation, subagent use, or another unavailable action from fluent output.
Preparation and zero-turn preflight are not model calls and do not establish that a later authenticated provider launch will succeed.

## Transmission Packet

`packet.json` is RFC 8785 canonical JSON with `schemaVersion`, `canonicalization`, `digestAlgorithm`, `transmission`, and `transmissionSha256`.
A capability-aware transmission additionally embeds the complete reconciliation receipt and its digest.
The transmission binds:

- suite/session identity and declared suite artifacts;
- provider, model, effort, transport, and inspected toolchain;
- runtime fingerprints;
- network, web-search, tool, and provider-facility capabilities;
- sandbox, working directory, workspace roots, instruction sources, persistence, and a positive-name environment;
- every harness-controlled input, with role, media type, encoding, byte length, content, and SHA-256; and
- continuation-controller digest, turn limit, allowed transitions, and exact continuation templates.

`inputs/manifest.json` and `inputs/<ordinal>-<id>.<extension>` retain independent copies of every declared input.
Execution revalidates the canonical packet and those bytes before authorization can issue a launch capability.
Provider, model, toolchain, home, fixture, capability, input, and result paths are packet- or runtime-bound; execution flags cannot redirect them.

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

The provider, model, effort, and digest values must equal the prepared packet.
Earlier implementation approval, toolchain login, preflight approval, or authorization of another packet does not authorize a model call.
`authorization.json` is written only after exact validation.
`attempt.json` is written only when the adapter consumes the packet-bound, single-use launch capability.
If an interruption retains the exact authorization and provisional stream files but no `attempt.json` or terminal result, the same prepared session may reopen those files and continue to its first launch without overwriting retained bytes.
Once `attempt.json` exists, the packet can never launch again; another model attempt requires a new prepared session and new exact authorization.

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

`run.json` records the transmission digest, status, failure class, redacted error, safe/unsafe closure, suite result, and a SHA-256/byte-length map of every retained artifact.
`metrics.json` separates native and normalized usage.
`timing.json` records wall-clock timestamps and monotonic duration.
Adapter or infrastructure failures remain terminal records; failed and invalid attempts are retained rather than omitted from aggregates.

Codex zero-turn preflight evidence lives beneath the suite-selected preflight destination, conventionally `preflight/`, and includes its own transcript, normalized events, stderr, and terminal `preflight.json`.
Suites may declare additional artifacts in the packet; undeclared or path-escaping writes fail closed.

## Provider Adapters

OpenAI sessions use the Codex App Server adapter.
It re-inspects the exact executable/schema, launches App Server with a process-local file-credential-store override, verifies the positive-name environment and stable `CODEX_HOME`, checks authentication, the model catalog, provider capability availability, disabled hook state, and a minimal ephemeral preflight thread, normalizes approval requests through the suite controller, retains JSONL bytes, enforces capability events, and owns thread interruption/deletion and child closure.

Codex provider and host inventories describe facilities that are available to the application, not facilities activated in a particular evaluation thread.
Preflight therefore does not call or retain `skills/list` or `app/installed`; enumerating the operator's unrelated skills or apps would neither attest thread isolation nor satisfy evidence minimization.
It does inspect hooks because an enabled hook can execute independently of model tool selection: disabled hooks are acceptable, enabled hooks fail closed, and malformed hook metadata is a protocol failure.
The preflight thread is deliberately more restrictive than an execution turn: `thread/start` uses no runtime workspace roots, no instruction sources, no dynamic tools or environments, read-only sandboxing, and no process network.
The adapter enables App Server's experimental protocol surface only so the reviewed runtime-workspace-root fields are accepted; this does not activate model tools or provider facilities.
It binds native web explicitly through the supported thread configuration, using `config.web_search = "live"` when authorized and `"disabled"` otherwise.
Exact model effort, runtime workspace roots, sandbox policy, and packet input are bound at `turn/start`, while runtime event enforcement rejects any unrequested tool, search, image, MCP, delegation, command, or file-change activity.

Anthropic sessions use the Claude CLI adapter.
It pins one reviewed CLI version/capability profile, uses current documented safe-mode and output flags, preserves normal OAuth/keychain authentication, retains the provider-owned default system prompt outside the harness digest, captures provider output once, and normalizes the same result and closure interface.
Unsupported versions or required capabilities fail before execution.

Google sessions use the Antigravity CLI adapter.
It pins a reviewed version/profile, the exact executable and prefix files, and the `--help` bytes.
It uses one process with `stream-json` input and output, explicit model and version-specific effort binding, terminal sandboxing, disabled slash commands, and request-review permissions.
It never passes `--dangerously-skip-permissions`, an agent override, a conversation-resume flag, or permission allow rules.
One `init` event and one terminal `result` per turn are required; raw NDJSON and stderr are retained, while final cumulative usage is normalized.
Any observed tool or subagent step fails the run.

Antigravity's `init.tools` inventory is evidence of advertised built-in facilities, not a claim that the CLI disabled them.
The policy profile proves that no tool step appeared in a completed run; it does not prove that provider-owned tools, default instructions, global customizations, or cached account context were unavailable.
An advertised plugin or MCP tool fails closed.
Treatment activation is therefore explicit and packet-bound rather than delegated to automatic skill discovery.

Provider process launch belongs only to these three adapters.
The operator login CLI is the sole separate Codex process-launch path and performs no model run.
Suite controllers own domain conversation semantics and permission decisions; adapters contain no concept- or Git-specific parser.

### Antigravity protocol versions

Google sessions admit only the specifically qualified 1.2.17 CLI profile.
Older 1.1.19 and 1.2.16 launch profiles are retired.
A changed installed version, including a newer patch release, refuses preparation before any model call.
Requalify the adapter explicitly and prepare fresh packets; there is no automatic upgrade, version range or fallback.
Each packet pins the profile, executable, version and help bytes.
The profile uses stdin NDJSON, one process for all declared turns, per-turn result events, cumulative usage, sandbox request and disabled slash-command expansion.
It requires native initialization to confirm the exact model, workspace and `request-review`; any observed tool or subagent step fails the session.

Native 1.2.17 uses effort-bearing model slugs, so its profile binds effort through the explicit model slug instead.
Its reviewed tiers are `low`, `medium` and `high`; the slug's final tier must equal the packet effort; a missing or contradictory tier refuses before consumption.
The profile fingerprints stdout and stderr separately (native help uses stderr) and checks that help exposes the required stream, model, sandbox and slash-disable flags.
Version/profile drift and provider-control prefix overrides remain refusals.
The common runtime records an adapter return without launch consumption as `provider-failed`; no attempt or model process is created for that refusal, and its record is not a completed evaluation.

The installed 1.2.17 zero-turn probe on 2026-10-05 confirmed `gemini-3.8-flash-low`, `request-review`, EOF exit and producer quiescence.
It made no model turn and does not establish actual real-provider behavioral acceptance, instruction isolation or OS-level egress isolation.
Preparation still needs explicit model/effort and every real session still needs exact packet authorization. Protocol references: [Google headless mode](https://antigravity.google/docs/cli/headless/) and [execution modes](https://antigravity.google/docs/cli/modes).
Persistent permission or provider settings are not changed by this adapter.
The executable's observed SHA-256 was `6224a54c35d31b9b85232bbfb23e3306002c418481930442519743fab585f65a`; each preparation still fingerprints its own exact executable.
Deterministic conformance and native zero-turn inspection qualify this protocol profile, not real-provider behavior or isolation.
Older completed results remain readable; the offline generation inspector accepts exact 1.2.16 and 1.2.17 native schemas and rejects unknown versions without granting launch support.
Its 1.2.17 generation-payload checks have deterministic fixture evidence; no new real 1.2.17 generation was requested as part of this adapter change.

## Evaluation Homes

### Evaluation test fixture cleanup

The defining-concepts session-runner tests and Windows bridge matrix allocate their roots through `tests/fixtures/temporary-workspace.mjs`.
The helper records ownership at creation and registers a Node test after hook immediately.
Child processes receive fixture-local `TEMP`, `TMP` and `TMPDIR`, so their consumer and inspection scratch remains inside that owned root.
This is test fixture policy; production evaluation evidence and reusable homes retain their existing contracts.
In-process carrier allocation passes the fixture as `temporaryParent` through `prepareSessionDispatch`; omission keeps the normal OS temporary parent.
The caller owns this location and its disposal; the option grants no launch authority.

A successful fixture is eligible for disposal only after its tracked children emit `close`, its directory and owner marker retain their original identity, and a bounded inventory finds no symlinks, reparse points, multiply linked files, active home leases, consumed attempts without terminal records, or unsafe/unknown process closure.
Windows and Unix first use Node's permanent recursive deletion.
Native deletion handles read-only files on Windows and retries transient filesystem failures up to three times with linear backoff.
Only a persistent busy, access, permission or nonempty-directory error permits a recoverable fallback.
Before fallback, the helper rechecks ownership and the remaining evidence holds; changed ownership, a missing marker or unresolved remaining evidence refuses fallback.
Windows then uses the native Recycle Bin API; Unix uses installed `/usr/bin/gio trash`.
Fallback reports its reason.
If recoverable disposal is unavailable, the fixture is retained with a diagnostic; unexpected errors and disposal failures fail the test hook.
Cleanup does not elevate privileges, change ACLs or stop other processes.

Failed or cancelled tests and unfinished recovery scenarios keep their exact working payload.
`.test-workspace-retention.json` records the root, test, owner nonce, reason and reassessment condition when ownership still holds.
Changed ownership is reported without writing into the substituted directory.
A passing parent also preserves nested retention markers; an existing marker is never overwritten, including a hard link to a different file.
A passing Windows bridge matrix intentionally retains scenarios whose leases or consumed attempts remain unresolved; passing assertions alone do not release that state.
Reconcile those recorded consumers before later disposal.
The helper never adopts old directories by name, age or marker, and does not sweep Temp.

`scripts/evaluation/evaluation-homes.js` manages the reusable versioned root returned by `evaluationHomesRootFromLocalAppData(localAppData)`.
It owns exactly two stable roles: `preflight` and `execution`.
A role operation validates the approved absolute root and owner marker, acquires an exclusive lease, verifies path identity and containment, rotates the prior home into owned quarantine, creates the fresh stable path, carries forward only a validated single-link ordinary `auth.json`, binds `CODEX_HOME`, registers child processes, requires exact release evidence, retires the used generation, carries the possibly refreshed credential cache into the next clean stable path, and records immutable completion history.
Every other Codex-created file is disposable runtime residue.

Windows path attestation remains per-path and fail-closed, but it no longer starts PowerShell for every ancestor lookup.
`scripts/evaluation/windows-path-metadata.js` owns one bounded JSONL worker per public manager operation, while `scripts/evaluation/windows-path-probe.ps1` performs the same read-only drive, attribute, resolved-path, and reparse checks for each identified request.
The execution fingerprint binds both files.

The installed Codex CLI reports a successful browser login even when Windows keyring storage falls back to `auth.json`.
Deleting the disposable generation would therefore delete the credential.
Each stable `preflight` or `execution` role instead owns one file-backed credential cache inside the approved root and may require its own separately authorized one-time login through `manage-evaluation-homes.js login`.
The operator forces file storage only for the child process, rotates the cache through the ordinary lifecycle, and reports success only after `codex login status` passes in a second rotated home.
The manager never reads or copies credential bytes, never writes `config.toml`, and never modifies the OS keyring.
Tests use injected temporary roots, fake credentials, and fake executables, never the production root or real authentication material.

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

`status` is `completed` or `failed`; failure class, error, closure, and retained artifacts stay distinct.
A safe closure proves the registered child and streams reached the declared terminal state.
An unsafe release preserves the lease/owned generations for explicit recovery rather than guessing that cleanup is safe.

## Historical Results

Tracked historical results now reside under `evidence/historical/`; the relocation manifest records old paths and unchanged checkout-byte identities.
Pre-existing ignored naming results remain under `evals/naming-objects-in-software-engineering/results/`.
Both are immutable evidence for their recorded runner and schema.
Every new manifest, packet, bundle, controller policy, and derived record declares its own schema version.
Readers branch on the explicit version, preserve documented legacy branches, and reject unknown versions; they never infer a schema from absent fields.
Do not rewrite packet digests, retrofit the common envelope, rename historical arms, or make an older result claim current runtime, adapter, authorization, bundle, scripted-controller, or stable-home guarantees.

The retained `committing-to-git/results/2026-08-22-gemini-3.5-flash-low.json` record remains a legacy Antigravity 1.1.18 explicit-activation policy experiment.
It is not migrated to the 1.1.19 adapter schema and does not establish automatic discovery, dynamic approvals, Git command execution, or current-run parity.

New result sets keep raw provider evidence immutable and derived grading/aggregation separate.
Corrections create a new record that names the superseded derivation.
Every failed launch, invalid attempt, exclusion, requested model, provider-confirmed model when available, toolchain, seed, repetition, timestamp, and limitation remains visible.

## Sensitive Evidence

Authentication material never enters packet inputs, transcripts, normalized events, suite artifacts, errors, or run results.
The evidence API rejects authentication-bearing member names and scans structured values before persistence.
Adapters redact account email, tokens, login URLs, bearer values, secrets, and provider diagnostics; environment policy forbids provider API-key variables and records secret sources as an empty array.
Evaluation-home rotation identity-checks and renames `auth.json` without reading its bytes.
Antigravity uses the CLI's cached credentials without exporting or inspecting their values.

Evidence retains only what is needed to audit the session: account type/authentication-required state, toolchain identity, safe protocol metadata, bounded stderr, usage, timing, controller decisions, and artifact digests.
Keep private arm mappings separate from blinded grading packages, and treat exact packet authorization as consent to the declared provider inputs only, never as consent to persist credentials.
