# Windows integrated bridge qualification

The Windows Job Object host has an integrated synthetic-provider contract test at `tests/scripts/windows-assured-bridge.test.mjs`. It supplements the isolated process-host tests and the existing normal transport/equivalence fixture. Production qualification remains disabled: these observations do not authorize real models, client activation, OS-level egress claims, automatic home recovery, or Linux cutover.

The test runs the pinned native skill-up executable, the actual Python host and bridge, the maintained Git suite and Hadden runtime, and a synthetic Codex App Server. It creates a disposable plain checkout with a test-only qualification override and disposable credential-free homes. It verifies the production manifest's bytes are unchanged. The normal `npm test` glob includes the test; non-Windows hosts report an explicit skip.

## Proof and independent observations

The provider proxy pauses at the first actual `turn/start`. Before interruption, the observer requires persisted consumption and an execution lease, inventories the prepared job through Windows APIs, and verifies that the synthetic provider and grandchild are members. Process identity records include executable image, PID, parent PID and losslessly encoded creation FILETIME.

Native custom-engine execution inserts Git Bash intermediaries. The test identifies the native consumer by its pinned executable image, the bridge by the provider's recorded parent, and the host by the consumer's parent, bound interpreter image and wrapper ancestry. It does not assume that the bridge's immediate parent is skill-up. The observer closes its query-only job handle before interruption so it cannot extend the job's lifetime. Microsoft's [Job Object contract](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) and [process creation attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute) define the kernel boundary.

| Scenario | Required result |
| --- | --- |
| Normal completion | Two controller turns, sealed completed Hadden outcome, completed home history, no live lease or observed surviving job member |
| Mismatched exact authorization | No provider turn or consumed launch; attempted carrier cannot replay |
| Wrapper, host, consumer or bridge abrupt death | Observed job members close within the fault's eight-second observation bound; consumed attempt bytes remain unchanged; no fabricated terminal outcome; interrupted execution lease remains retained |
| Requested consumer cancellation | Windows SIGINT terminates the consumer; the same closure, consumption and retained-lease obligations apply |
| Provider abrupt death | Truthful failed Hadden outcome with `provider-failed`; no surviving observed job member |
| Provider deadline | Truthful failed Hadden outcome with `timed-out`; existing preparation/native budgets remain unchanged; no surviving observed job member |

Concurrent wrapper attempts and subsequent replays are refused. Interrupted consumed sessions are also presented directly to the maintained execution API once: its existing evidence gate rejects `attempt.json`, without launching a provider or resetting a lease. This is a refusal test, not execution fallback. PIDs that remain present fail conservatively, including potential reuse; the observer does not treat a different process as safe to terminate.

The isolated host suite remains responsible for missing APIs, invalid invocation, nested jobs, creation-time parent loss, inherited pipes and spawn races. Integrated post-consumption scenarios contain a real descendant and grandchild with inherited output handles. They do not prove every possible startup interleaving, OS-level network isolation or recovery after a host crash.

## Discriminating negative control

For a task-owned disposable experiment only, `WINDOWS_BRIDGE_FIXTURE_SCENARIO=host-death` and `WINDOWS_BRIDGE_FIXTURE_FAULT=omit-kill-on-close` remove the host's kill-on-close flag in that copy before ordinary preparation binds its bytes. The observer must fail on surviving job members within eight seconds of the host fault. A separate fixture cleanup requests termination of that exact named job and independently checks observed PIDs are absent; this cleanup is not passing containment evidence and does not remove retained leases. The default repository verification sets neither fixture variable and exercises all scenarios.

An initial draft selected shell intermediaries for two roles and did not qualify those deaths. After correcting executable/ancestry preconditions, all nine scenarios passed in development. The negative control then showed why closure must be timed from the fault rather than after waiting for wrapper streams: a broken host can leave the native consumer running until its own deadline. The strengthened assertion detected thirteen surviving owned processes; exact-job cleanup closed them, and the unmodified host-death positive control passed. Raw fixture receipts and operator observations are retained externally under `C:/Users/maksy/.hi/w/e/operator-evidence/2026-10-04-windows-bridge-qualification/`. Final review, governed verification and publication identities are recorded there separately, rather than retrospectively relabeling development evidence.

## Remaining production gates

Kernel workload closure and Hadden completion are distinct. Abrupt termination can close every job member while leaving an incomplete Hadden run and an execution home lease. This change proves preservation and replay refusal; it does not introduce a supported lease-reconciliation command or authorize deleting leases, quarantines, homes or consumed authority. An explicit recovery design and its qualification remain necessary before production bridge enablement.

Environment/config/OTel controls retain their existing test coverage, but no complete OS-level egress isolation is claimed. Linux retains its own failed/disabled disposition and needs its separately approved lifecycle design. Real-provider acceptance and host activation remain separate prepared and authorized experiments. No configuration, runtime API, provider policy, packet schema or qualification marker changes accompany these tests.
