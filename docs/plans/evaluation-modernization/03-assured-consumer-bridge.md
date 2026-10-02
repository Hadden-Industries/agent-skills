# Phase 3: A qualified consumer bridge around the existing runtime

Parent: [master plan](../2026-10-03-evaluation-modernization.md). Slice: SLICE-004. Ledger: KEEP-009 through KEEP-020. Decisions: DEC-003 through DEC-006, DEC-009, DEC-011.

## Entry and outcome

Enter with frozen baseline tests, compiled contracts and the exact selected consumer toolchain. The outcome is one fake prepared session that passes through the real skill-up custom-engine boundary into the existing Hadden runtime, retaining all authority, evidence and closure behavior. Per-platform qualification is explicit. No real provider session is needed to build or negatively test the bridge.

Keep direct Hadden execution available. A failed Windows or Linux gate blocks only that platform's assured cutover; it cannot be hidden behind a generic "supports Windows" claim. Any new process-host service, transport, sandbox mode, permission or provider setting would require a revised design and its specific approval.

## Predicted files

| File | Responsibility |
| --- | --- |
| `scripts/evaluation/skill-up-custom-engine.js` (new) | Read selected-release input/output format, validate public correlation against the frozen invocation, resolve only a registered prepared-session profile, call existing execution, return limited SessionResult. It does not create a packet or choose policy. |
| `scripts/evaluation/run-skill-up.js` (new) | Materialize and run exactly one frozen session projection; control executable/config/cwd/environment and accepted options; reject expansion flags. Retain invocation identity and report failures without rewriting Hadden evidence. |
| `scripts/evaluation/derive-reports.js` (new) | Versioned, one-way mapping of sealed Hadden outcome to consumer/reference artifacts and later reports, keeping failures/unknowns and private mapping boundaries. |
| `scripts/evaluation/profile-registry.js`, `project-skill-up.js`, `consumer-workspace.js` | Registered execution interfaces, exact one-case batch projection, public correlation, acyclic receipt dependencies, confined output files. |
| `scripts/evaluation/runtime.js` | Keep authoritative execution. Modify only a demonstrably necessary narrow interface, with characterization tests; do not move authorization into the bridge. |
| Existing provider/home/capability/conversation modules | Reuse contracts. Their behavior changes only if an independently reproduced integration issue demands a scoped repair, never as an incidental wrapper refactor. |
| `tests/scripts/skill-up-custom-engine.test.mjs`, `skill-up-invocation.test.mjs`, `evaluation-derived-reports.test.mjs` (new) | Boundary and protocol tests, including real pinned consumer invocation with fake providers and deterministic judging. |
| `tests/scripts/evaluation-consumer-process.test.mjs` and fake process fixtures (new) | Controlled parent/child/grandchild, lingering pipe, cancel/timeout and abrupt-death experiments; use task-owned disposable roots. |

## Interface and authority work

Establish profile contracts for prepare, execute-prepared and derive. Preparation is zero-model work and produces the existing canonical packet/input evidence. Execution accepts already-frozen paths, exact authorization and an abort signal. Derivation consumes sealed outcomes. Git and defining-concepts provide real implementation examples; naming later reuses the scripted profile. Reading is not forced through an assurance interface without a requirement.

Generate the exact expected initial message and public case/session correlation. In skill-up 0.12.0, `kwargs` is present in the payload; treat it as visible, untrusted data. Batch mode rejects continuation `session_id`. Do not put authorizations, private arm mappings or credentials in kwargs, prompt, workspace files or exported artifacts.

Allocate destinations before sealing execution configuration. Bind the actual YAML/configuration receipt into the prepared packet; create the packet-hash/authorization execution index afterward. Assert that no record hashes itself or a future dependent record. Preserve absolute run-local identity separately from reproducible static template identity.

Keep Hadden schedule selection outside skill-up and execute one cell per call. Disable baseline expansion, retries and additional iterations; force parallelism one. The outer carrier variant is not the Hadden arm. No framework-managed skill installation can alter Hadden's bound treatment. Reject unsupported consumer settings rather than insert a placeholder treatment.

The wrapper rejects CLI model, engine, provider, retry, baseline, iteration and parallelism overrides. Tests also invoke the bridge directly with tampered inputs: wrapper policy alone is insufficient. The runtime must still validate current packet/input/provider identity and consume launch authority once. A consumer output does not authorize another call.

Hadden's controller owns all continuation messages and provider turn limits. skill-up receives one initial message and one bridge invocation. Freeze the internal execution deadline, outer startup/cleanup allowance, and accepted remaining-time range; fail before launch when consumer deadline clamping leaves insufficient time. Keep cleanup independently bounded and observable.

## Evidence and failure mapping

Retain current runtime failure-class values and both evidence layouts. The bridge never edits a finalized run/trial result. Before-consumption reopening retains exact provisional streams under current runtime rules; after consumption, a missing result is an uncertain attempted execution, not permission to retry. Campaign advancement depends on existing outcome reconciliation.

Emit an explicit SessionResult exit code and final message. Fill usage only from actual measurements; unknown tokens/cost stay unknown. Export a small schema-versioned reference containing authoritative record identity/digest, profile and outcome. A consumer-side invocation or report error has its own derived diagnostic. It does not synthesize a Hadden terminal record or turn a safely completed Hadden session into a different historical result.

Keep raw transcripts, stream closure, controller decisions and private mappings in their existing evidence boundaries. Test malformed output, truncation, omitted artifacts, path escape and report generation failure. A pretty consumer report is never the source of truth for assurance.

## Required proof matrix

| Boundary | Positive and negative controls |
| --- | --- |
| Release input | Actual 0.12.0 payload, omitted-empty fields, exact messages/kwargs/model/variant mapping; reject unknown or changed correlation |
| Authority | Valid single use; absent/false flag, wrong exact statement, changed packet/input/toolchain, consumed replay, concurrent calls, extra iteration/baseline and all override paths |
| Controller | Correct initial-only input, exact later turns, no upfront future-message leakage, max-turn mapping and invalid transition rejection |
| Evidence | Both layouts, provisional reopen before consumption, terminal-last, failed/unsafe cases, no false result promotion, unavailable native usage |
| Processes | Normal exit, timeout, cancellation, abrupt skill-up/bridge death, grandchild, inherited pipe, delayed startup and cleanup overrun on Windows and Linux |
| Environment | Ambient `.env`, user/project config, OTel, API key and PATH sentinels; no unreviewed binary/model/bootstrap action |
| Privacy | Private mapping and authorization absent from model-readable input/consumer report; credential redaction and owned path confinement preserved |

After the proposed test files exist:

```powershell
node --test tests/scripts/skill-up-custom-engine.test.mjs tests/scripts/skill-up-invocation.test.mjs tests/scripts/evaluation-derived-reports.test.mjs tests/scripts/evaluation-consumer-process.test.mjs
```

Run all impacted existing runtime/provider/home tests and `npm run verify`. Independently inspect actual process observations and terminal evidence; a test that only mocks `kill()` does not prove Windows descendant closure. The upstream non-Unix no-op is a known risk, so the failure experiment must be discriminating rather than assume platform parity.

## Exit, abort and recovery

Publish a qualification matrix by consumer release, runtime, shell and operating system. An unsafe/indeterminate child outcome must retain its lease/evidence, stop progression and name recovery ownership. If the direct local bridge cannot satisfy containment, leave it disabled for assured use on that platform and retain the direct Hadden mode. Record the failed experiment as the basis for a separate lifecycle design revision.

Remove only closed, task-owned scratch after durable proof is retained. Do not reset homes, kill unrelated processes or discard failed runs to obtain a green matrix. An authorized per-file commit covers the bridge and tests; no provider acceptance claim accompanies it.
