# Evaluation toolchain status

Observed locally on Windows x64, Node 24.21.0 and Python 3.14.7.
Exact acquisition pins live in `evaluation-toolchain.json` and `package-lock.json`.
This record separates integration from platform and behavioral acceptance.
The skills 1.7.2 installation row was rechecked on 10 October 2026 with Node 24.21.0 and npm 12.2.0; other observations retain their original qualification context.
Root registry development declarations use floating `>=` floors, while the lockfile and `evaluation-toolchain.json` bind the exact qualified versions.
Development setup now requires Python >=3.15.0; CI selects 3.15.0 exactly.
The local authoring environment was refreshed on 10 October 2026 with Python 3.15.0, pip 26.2.1, PyYAML 6.0.3, official upstream skills-ref 0.1.0 at commit `69ef37e9424c0a7ea9dd2293b559e43ec8176379`, click 8.5.0, strictyaml 1.7.3, python-dateutil 2.9.0.post0 and six 1.17.0.
These are new development-tool selections; earlier behavioral and platform observations retain their dated runtime context.

| Surface                               | Observed result                                                                                                                                                                 | Boundary                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| skill-up 0.12.0 native custom engine  | Literal fake-provider smoke and generated five-case EPUB projection pass native validation/execution                                                                            | No semantic or real-provider judgment; no assurance from native report scores                                                             |
| agent-skills-eval 0.1.1               | Public loader and static target/judge consume generated portable cases in both modes                                                                                            | Baseline omits fixtures, binary EPUB bytes are skipped, assertion judging omits expected output                                           |
| skills 1.7.2                          | All four distributions install byte-exactly through explicit, default and full-depth discovery in a disposable checkout                                                         | Local Codex installation layout; no client activation experiment                                                                          |
| skill-up to Hadden bridge             | One normal native invocation executes two fake Antigravity turns and derives an artifact-checked outcome reference                                                              | Disposable test-only qualification override; does not qualify production containment                                                      |
| Windows assured bridge                | Owner-approved `assured-qualified` for the bound `windows-job-v2` host/recorder path after synthetic closure and recovery qualification                                         | Original native-consumer failure retained; exact model authority, unknown-closure refusal and explicit recovery decisions still apply     |
| Linux assured bridge                  | Disabled; Ubuntu 24.04 CI run `37125253782` retained surviving descendants after cancellation, abrupt consumer/engine death and inherited pipes                                 | Requires a separately approved Linux lifecycle design                                                                                     |
| Network boundary                      | OTel disabled; credentials/config excluded from owned consumer environment; installer Node network APIs denied                                                                  | No complete OS-level egress observation or isolation claim                                                                                |
| Real provider operation               | Eighteen separately approved Windows policy-only sessions completed through Antigravity 1.2.16; exact input frames, artifact references and signed zero-active closure verified | [Diagnostic observations](evaluation-real-provider-observations.md); primary assessment is not independent grading or semantic acceptance |
| Host activation and live Git behavior | Not exercised by the policy-only campaign                                                                                                                                       | Require their own prepared authority and observations                                                                                     |
| Antigravity CLI adapter               | Reviewed profiles for legacy 1.1.19 and installed 1.2.16; contained 1.2.16 zero-turn probe and subsequent real-provider campaign retained separately                            | Separate native effort flag is omitted only for the 1.2.16 effort-bearing slug profile; no general sandbox/isolation claim                |

`npm run eval:check` runs deterministic consumer and installation checks, including the explicitly fake transport fixture.
It acquires no dependencies and selects no real model engine or judge.
Preparation must install the locked packages and acquire the pinned native release first.
The new CI workflow separates those acquisition steps from verification.
Missing or mismatched tooling fails closed; a clean checkout without explicit preparation does not silently download it.
The integrated verification gate supports Windows x64 and Linux x64 only; other platforms cannot claim this gate passed.
Run `npm ci --ignore-scripts`, then `python -B scripts/set_up_evaluation_execution_tools.py` during explicit preparation.
Existing authoring validators also retain their documented setup prerequisites.

## Repeatable process observations

The gate also runs `scripts/evaluation/check-consumer-process.js` against the pinned native release.
Eight disposable fake-engine scenarios cover normal exit, delayed startup, timeout, requested cancellation, abrupt consumer death, abrupt engine death, inherited pipes and cleanup overrun.
Each receipt retains platform/runtime/executable identity, consumer exit, stream closure, correlated descendant identities and heartbeats, and subsequent fixture cleanup.
Scenario evidence lives under `evaluation-process-matrix-*` temporary roots, which the existing CI artifact upload retains.

The Windows observation on 2026-10-03 found live descendant heartbeats after consumer timeout, SIGINT termination, abrupt consumer death and cleanup overrun.
Normal and delayed runs completed; abrupt engine death and inherited-pipe cases observed closed descendants.
Every observed owned PID was absent after cleanup, whose duration and cooperative-stop/self-expiry markers are retained separately.
These are failed containment observations, not expected-success exceptions that qualify production.
A passing conformance command means the experiment completed and retained its negative evidence; the receipt separately reports `assured-cutover-blocked`.
Ubuntu CI run `37125253782` subsequently retained failures after cancellation, abrupt consumer death, abrupt engine death and inherited pipes; normal, delayed, timeout and cleanup-overrun rows observed closure.

## Approved Windows host revision

The owner approved a per-invocation Python/Windows Job Object host on 2026-10-03, initially without production enablement. `windows-job-host.py` creates the native consumer already inside its kill-on-close, non-breakaway job using `PROC_THREAD_ATTRIBUTE_JOB_LIST`. `process-host.js` binds and verifies host/interpreter identity and keeps the parent-liveness pipe open.
The prepared receipt also binds the fresh job name; the bridge checks actual membership before provider execution.
Nested-job incompatibility and missing Windows APIs fail before workload creation.

`tests/scripts/windows-job-host.contract.mjs` exercises normal completion, timeout, abrupt consumer/host/wrapper death, inherited output pipes, grandchild creation, nested jobs, identity drift and invalid invocation.
It checks retained process identities are absent after closure; host death remains an incomplete observation even when the test observer proves the workload died.
The normal native transport fixture additionally exercises the prepared host and bridge with fake providers.
These checks do not establish complete Hadden lease reconciliation, startup-race coverage, real-provider acceptance or OS-level egress isolation, and do not change qualification flags.

The subsequent [integrated Windows qualification](evaluation-windows-bridge-qualification.md) adds the real pinned consumer, Git controller, Hadden runtime and synthetic Codex provider to the fault boundary.
Barriers prove launch consumption and home-lease acquisition before interruption.
Kernel process inventories distinguish Git Bash intermediaries from the actual native consumer and host.
The original single-host negative control demonstrated surviving members when kill-on-close was removed; that observation remains historical evidence.

The owner then approved the independent closure recorder and explicit state-bound Windows execution-home recovery, delivered through [PR #17](https://github.com/Hadden-Industries/agent-skills/pull/17) at `6bd15b3dd22200fba058be1b8c46c1739a240487`.
The revised matrix covers normal completion, invalid authority, wrapper/host/recorder/simultaneous-host-and-recorder/consumer/bridge/provider death, cancellation and timeout.
The current negative control omits recorder termination and must fail on missing signed zero-active proof; eventual kernel closure is a separate observation.
Eligible interrupted execution homes can be recovered explicitly without reviving consumed authority or creating evaluation results; unknown or unsupported states remain retained.
Canonical Windows verification passed 1,300 tests with six explicit skips; Windows/Ubuntu consumer CI and CodeQL passed.
One consolidated and one narrow Antigravity static review passed within their approved scope.
Original receipts and recovery limits are recorded in `C:/Users/maksy/.hi/w/e/operator-evidence/2026-10-05-evaluation-home-recovery/`.

On 2026-10-05 the owner separately approved changing only the Windows x64 qualification marker to `assured-qualified`, with a bounded configuration/documentation review and verification cycle. This admits explicitly selected Windows assured dispatch, not an automatic model run. Linux remains `pending`; real-provider acceptance, real-home recovery, host activation and OS-level egress isolation remain separate authority/acceptance boundaries.
Use fresh prepared packets; original failed or consumed packets cannot replay.
The enablement candidate's own review, full verification and delivery receipts belong to `C:/Users/maksy/.hi/w/e/operator-evidence/2026-10-05-windows-bridge-enablement/`, not the earlier PR17 receipts.

The prior Windows CI timeout recurred in run `37125253782`: the fake Git controller completed its two provider turns but did not retain a terminal Hadden result before the native 30-second deadline.
Its failure-only diagnostic contained no home-journal phases.
The host revision is not evidence of a root-cause fix for that intermittent failure; deadlines remain unchanged.

The bounded worker trace in CI run `37152143364` localized the subsequent delay: the native Git worker reached its script in 187 ms, then spent 29.22 seconds on its first `ConvertFrom-Json`; `Get-Item` took 75 ms and drive inspection 1.5 ms.
This identifies the first JSON cmdlet boundary, but does not distinguish all internal module-discovery and initialization costs.
The repair imports the Utility and Management modules from the selected Windows PowerShell executable's `PSHOME` paths before reading requests, following [Microsoft's explicit module-file import guidance](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/import-module?view=powershell-5.1).
It retains the metadata queries and protocol.
A fresh-worker regression disables autoloading and ambient module lookup: it failed before this repair and passes afterward.
Diagnostic profiling, worker tracing and the disposable deadline extension have been removed.
Normal-budget [Windows/Linux CI](https://github.com/Hadden-Industries/agent-skills/actions/runs/37157238453) and final governed verification subsequently passed on `e2c00f5e6267f7d4747c3e404b835dc0d0b33ac2`; see [final implementation evidence](evaluation-modernization-implementation.md#final-delivery-identities-and-disposition) for exact receipts.
That deterministic acceptance does not change the production containment or egress limits.

The inherited-pipe case covers the engine-to-grandchild pipe, not inherited consumer stdout/stderr.
Cleanup overrun explicitly starts a six-second fake cleanup through a fixture control marker before the three-second consumer deadline; the receipt records that start and any native signal observed.
It does not assume Windows delivers POSIX cleanup signals.
This is a discriminating native-host experiment, not a claim that Hadden implements that fixture control protocol.

The fixture expires independently after 15 seconds and accepts a stop marker only in its unique owned root.
The observer never kills a PID read from a file; it signals only the consumer handle it created.
Fresh token/PID-correlated heartbeats prove survival; a present PID without progress is indeterminate. Neither absence observations nor this fake engine establish Hadden lease recovery or OS-level network isolation. Node's [documented Windows signal emulation](https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events) makes programmatic SIGINT unconditional termination, so that row does not claim a real console Ctrl+C experiment.
A failed or indeterminate observation cannot enable a manifest qualification flag.

The verification sequence settles whitespace, formatting, lint and structural/build checks before consumer experiments and the full test suite.
This ordering avoids invalidating expensive evidence with mechanical repairs.
The native carrier always uses `with_skill` for transport; that label is not the Hadden experimental arm.
Consult the authoritative packet and permitted blinded mapping for treatment identity.

The wrapper records an exclusive invocation claim before starting the native process.
A retained claim blocks retry even if no final consumer report exists.
Reconcile Hadden evidence before preparing a fresh authorized attempt.
Catchable bridge termination signals request shared-runtime cancellation, and the outer wrapper leaves additional cleanup time beyond the native case deadline.
Neither mechanism establishes descendant containment under abrupt termination.

The native report may render omitted usage as zero.
That is a consumer presentation default, not measured zero tokens or cost.
Hadden outcome references omit unavailable usage, retain execution/failure/closure status, and remain ungraded.
Only independently measured usage can support resource comparisons.

## License and notice inventory

The new packages are development and evaluation tools, excluded from all generated skill payloads and the Git plugin.
Original upstream license files remain with the installed tools.
Acquisition verifies the native release license alongside archive and executable hashes.

| Tool                    | Installed license  | Retained license SHA-256                                           |
| ----------------------- | ------------------ | ------------------------------------------------------------------ |
| skill-up 0.12.0         | Apache-2.0         | `c417f515c774c00d0c6c8e6f84d3993c3e87c78e316fac6d03ea5606e20b683d` |
| agent-skills-eval 0.1.1 | MIT, Rishabh Mehan | `725b6ad1dda1cbc479d11053df393f3bf27c479c7aea1d5651538163aa0259ef` |
| skills 1.7.2            | MIT, Vercel        | `661142e53c313d2bb5e1b055f5c0a39001450ff1b5e27b89dc4bc7de9a6352ca` |
| yaml 2.9.1              | ISC                | `5bba27375d93e9119f76c1015f7672cf9ad5f70952296e0842fb2243d6376869` |
| ajv 8.20.0              | MIT                | `a05350a88e318e4f5f2c2a1ff1e2e88daa4dd38e6e78b71cccae422bdc762cc3` |

The skills CLI's `ThirdPartyNoticeText.txt` is retained with SHA-256 `ad017718e485f2d634341e32e91c4e48feee89db01f04b17e4db6c4c912339a6`.
The published Git plugin retains the repository license and its existing six dependency notices: cross-spawn, isexe, path-key, shebang-command, shebang-regex, and which.
No new evaluation dependency is bundled into that runtime.

## Retained temporary resources

Acquired binaries remain under `.agent-tools/evaluation/skill-up-<version>-<platform>/` for deterministic verification.
Acquisition failures and local review/check logs remain under `.agent-tools/evaluation/`. Pre-existing EPUB bytecode is preserved under `.agent-tools/evaluation/preexisting-runtime-cache/`, with its original/new paths and hashes also recorded in `evidence/migrations/2026-10-03-preexisting-runtime-cache.json`; it is not cleanup fodder.

Consumer conformance, installer and fake bridge experiments retain UUID temporary roots and receipts.
Each receipt identifies its root and tested identity.
Failed or uncertain execution evidence must be reconciled before removal.
Closed test-only roots may be removed after the required evidence has been retained; no automatic cleanup touches pre-existing naming results, homes, credentials, or user artifacts.

The task owner retains the frozen review checkout and native experiment roots for reproducibility and the open draft PR's review/qualification work. Reassess task-owned working copies after integration or an explicit abandonment decision and after their evidence consumers finish; preserve the durable external evidence, pinned tools needed for offline verification and the separately owned pre-existing cache. Latest review/full-gate/CI evidence and the reproduced archive are retained externally at the locations in the implementation handoff.
No broad cleanup or personal installation change is part of this delivery.
