# Reviewed-change host evaluation

This opt-in lane measures issue #5 in Codex Desktop with HISEW active. Its
definition is `reviewed-change-host.json`. It leaves the existing offline
app-server controller and its prohibition on pushing unchanged. The measurement
CLI consumes evidence after a trial; it never launches a model or publishes.

## Prepare matched trials

Reuse the approved host, signing, evaluation homes and evidence retention in
`../README.md` and this suite's `README.md`. The common runtime's exact
prepare/authorize/run boundary remains the supported external-provider route.
A CLI/app-server run without desktop/plugin/HISEW context cannot establish desktop
performance; this addition supplies no new desktop launch adapter.

Freeze the post-capture-fix baseline at
`606922bf404729c8a267b2574a81dcdbb47b19fe`. Capture baseline and candidate treatment
bytes using `captureGitSkillBundle` or `captureWorkingTreeSkillBundle` from
`scripts/evaluation/skill-bundle.js`. Retain bundle hashes, helper digest, host
version, exact model, effort, HISEW version, tool policy, initial Git state,
fixture metadata, prompt, authority and signing/protection observations.
Keep the issue's historical aggregate separate: it cannot isolate the capture fix
or attribute unaccounted time.

Generate a fresh fixture for each arm into a new absolute path outside this
source worktree using the existing generator:

```text
node evals/committing-to-git/create-fixture-repository.mjs --scenario reviewed-docs-orchestration --destination C:\absolute\new\fixture
```

The fixture contains five changed docs, a separately modified tracked lockfile,
a disposable SSH key/trust source in `.git`, and an actually executed whitespace
check with path/blob bindings. It creates no remote and returns
`protectedMainVerified: false`. Do not transmit its private key. The whitespace
check is task evidence, not a helper receipt or proof of broader product coverage.
Supply the reviewed five-path task context in each trial prompt.

Before live trials, obtain exact approval for model inputs and for the named
disposable hosted repository, refs, protection/check configuration and effects.
Source cases authorize commit/push to the named source only. Main cases explicitly
authorize the selected PR/merge route and require actual target readback. The
fixture key is not a GitHub-verified identity; hosted signing rules need a
separately approved supported signing setup.

Run all four cases for both arms sequentially in a preregistered randomized order.
Retain failures and blocked prerequisites. Match host/model/HISEW, fixture,
destination semantics and authority. A baseline may exceed the new helper budget.
Use separately authorized repetitions to estimate variance before choosing a
seconds budget; one matched screen supports only raw case comparisons.

## Rehearse without changing remote data

A linked worktree shares its parent repository's refs, remotes and configuration.
It is not an isolation boundary. For a no-remote-write rehearsal, place the entire
disposable Git common directory and worktree inside the evaluation sandbox. Seed
that private repository from a local revision or the fixture above; do not grant
writes to a maintained checkout's Git common directory. Check the effective
remote/push URLs, hooks, credential helpers and Git directory paths before launch.
Do not use personal signing material: keep the fixture key inside the disposable
sandbox and exclude its bytes from the model-input packet.

Use the existing app-server controller's network-disabled, fixture-scoped policy
for local model rehearsals. It denies network and out-of-fixture permissions and
authorizes no push. Check the prepared packet, provider sandbox attestation and
controller decisions, rather than trusting a prompt prohibition or an absent
`origin`. An unattested or broadened policy must block the run. No GitHub connector,
credentialed shell escape or remote-writing tool may be available to the trial.

This lane can exercise both message formats and safe refusal at source/main
publication boundaries. It cannot pass the four hosted cases' `finalDestination`
expectation, establish actual branch protection, or measure hosted wait time. Keep
those results incomplete; do not label app-server timing as Codex Desktop/HISEW
performance. The host observation command deliberately accepts desktop identity
only. A desktop host with no attested network/write isolation must not execute
these publication trials under a no-remote-write constraint.

## Measure native evidence

Retain native task transcripts and merged-stream capture envelopes. Annotate
events from these records, each with its source reference. An observation is a
derivative of evidence, not executable policy. An independent grader uses final
Git/provider facts and the complete transcript rather than completion prose.

Measurement input has `schemaVersion: 1`, `caseId`, `wallTimeMs`, `identity`,
`observedKinds`, `events`, and `safety`:

- `identity`: `host` (`codex-desktop`), `hostVersion`, exact `model`, `effort`,
  `hisewVersion`, `helperSha256` and `skillBundleSha256`.
- `observedKinds`: only kinds with complete collection coverage. An empty covered
  kind means zero; an uncovered kind stays unknown.
- Events: unique `id`, `kind`, `startMs`, `endMs` relative to run start, and
  nonempty `evidence` reference. Point events have equal start/end. Helper events
  add the public `operation`; output events add measured `bytes`; reference reads
  add `resource`.
- `safety`: findings keyed by the definition's expectations, each with `verdict`
  (`pass`, `fail`, `unknown`) and `evidence`. Missing findings are unknown. For main
  delivery, source publication, green CI or queue admission alone cannot pass
  `finalDestination`; verify the integrated content, message and signature.

Supported kinds are `tool`, `shell`, `helper`, `reference-read`, `output`,
`host-overhead`, `hosted-wait`, `approval`, and `check`. Count shell invocations
separately from tool round trips, including batched shells. Count output once at
the measured host boundary. Capture helper runtime from actual child measurements.
Helper duration sums and occupied interval unions are separate. Unattributed wall
time subtracts the union of observed shell/helper/wait/overhead intervals; it is
never renamed model, hook or host overhead. `unattributedTimeCoverage` lists both
accounted and missing categories: the residual includes missing telemetry and
does not imply any missing category took zero time.

```text
node evals/committing-to-git/reviewed-change-host.mjs --record C:\absolute\observation.json
```

Output binds to the observation using the shared runtime's canonical JSON/hash
functions and reports safety separately from cost. Concise local authoring targets
two helper calls; detailed targets three. Publication preflights, mandatory
refreshes, pushes and native PR operations remain separate costs. Budgets never
permit skipping controls. Every other public helper operation, including checks,
report reads and recovery, counts against the local helper budget. Unknown helper
operation names are rejected. Missing telemetry remains null.

Adding this lane records no live trials or before/after results. Deterministic
tests validate fixtures and aggregation only. Actual latency, agent compliance,
cross-agent portability and protected-main delivery remain unmeasured until the
authorized trials run.
