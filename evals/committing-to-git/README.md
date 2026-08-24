# Evaluating `committing-to-git`

This maintainer-only directory evaluates the deployable skill in `skills/committing-to-git/`. It is deliberately outside the installed skill payload. A deterministic test, a model run, and a human readability review answer different questions; passing one layer never implies that another passed.

| Artifact | Purpose |
| --- | --- |
| `evals.json` | Active post-cutover behavior cases, safety labels, fixture bindings, and cost-profile bindings |
| `trigger-evals.json` | Activation and near-miss non-activation cases |
| `create-fixture-repository.mjs` | Fresh disposable Git states plus separate expected safety and cost facts |
| `results/` | Versioned records from model runs that actually occurred |

## Active configuration contract

`evals.json` uses `schemaVersion: 2`. Every active entry has exactly these fields:

- `id`: stable historical identity; gaps are intentional and must not be closed by renumbering;
- `case_key`: unique stable post-cutover behavior name;
- `prompt`, `expected_output`, `files`, and `expectations`: the behavior and grading contract;
- `execution_mode`: `policy` or `executable`;
- `fixture`: a registered generator scenario for executable cases and `null` for policy cases;
- `critical_safety`: whether any failed mandatory safety expectation fails the release candidate; and
- `cost_profile`: a named budget exported by the generator, or `null` when no action budget applies.

IDs 20, 22, 25, 26, and 27 are retired. They represented an obsolete validator branch or duplicates. Their historical prompts remain recoverable from Git history and held-out paraphrases may be retained outside this file, but an active runner must never load or reinterpret them. New identities begin at 35. IDs 1-19, 21, 23-24, and 28-34 retain their original safety/product intent through the high-level transaction interface.

The validator exported by `create-fixture-repository.mjs` rejects unknown entry fields, duplicate IDs, duplicate case keys, missing fixtures, missing cost profiles, policy cases that name fixtures, and expectations that invoke a removed low-level route. It accepts intentional ID gaps. Permanent tests assert the exact active-ID sequence and the ID 35-66 case-key mapping.

The metric list is exact and intentionally separates correctness, judgment, and consumption:

1. atomic expectation pass rate;
2. all-or-nothing case pass rate;
3. critical-safety pass;
4. forbidden actions;
5. approval round trips;
6. permission requests;
7. failed commands;
8. high-level helper calls;
9. opaque transaction-handle pass-throughs;
10. agent-managed workflow artifact reads;
11. agent-managed workflow artifact writes;
12. route correctness;
13. exact evidence coverage;
14. hint/type/scope/outcome improvement;
15. rationale/UX usefulness;
16. input tokens;
17. output tokens;
18. total tokens;
19. model elapsed time;
20. wall-clock elapsed time; and
21. final Git-state correctness.

Do not merge these into one favorable score. Safety can fail while prose quality passes, and efficiency can improve by skipping a required gate.

## Disposable fixtures

Generate a scenario only into an absolute, nonexistent destination outside this source worktree:

```text
node evals/committing-to-git/create-fixture-repository.mjs --scenario known-context-skill-inventory-hint --destination C:\absolute\new\fixture-repo
```

The generator never selects, reuses, empties, or deletes the destination. It resolves existing ancestors before checking the outside-worktree boundary, so a symlink cannot smuggle a fixture into the source repository. Tests own and remove their temporary parent directories.

The JSON response has `schemaVersion: 2` and records expectations in two independent objects:

```json
{
  "expected": {
    "safety": {
      "selectedPaths": ["skills-lock.json"]
    },
    "cost": {
      "profile": "known-context-direct",
      "highLevelHelperCalls": 2
    }
  }
}
```

Safety facts describe the initial repository and prohibited/required outcomes. Cost facts name and expand one version-controlled action budget. A model cannot offset a safety failure by meeting a cost budget.

The registry covers every scenario named by the proportional-workflow plan. The main families are:

- known-context direct, checked-message, multiline, Unicode, shell-active, and explicit checked-safe transport;
- misleading hints, type ties, policy/history classification, unambiguous and ambiguous scopes, and mixed hunks;
- one-file unknown versus grounded security changes, mixed provenance, evidence deltas, invalid UTF-8, and compacted lineage;
- 12-, 49-, 50-, 80-, 240-, and 1,000-unit scopes; 1,000 small binary objects; 10 MiB generated data; and a huge single line;
- attached, detached, and zero-parent unborn heads; draft promotion/retention; staged-state path boundaries; and unmatched selectors;
- missing partial-clone objects, disabled external drivers, Git 2.45 no-lazy-fetch capability, permission recovery, live locks, and pending commit outcomes;
- required signature headers, unreadable SSH trust, 10 MiB successful/rejecting hook diagnostics, and terminal cleanup refusal arms;
- workspace count/byte compaction, final detail-page replay, uninspected nested worktrees, old-attempt rejection, and all exit classes; and
- local-bare-remote publication, observation-only recovery, and explicitly resolved/reauthorized linked retry.

`tests/committing-to-git/eval-fixtures.test.mjs` generates every registered scenario at least once. It independently queries representative Git states rather than trusting emitted metadata, including exact path exclusions, staged rename identity, 49/50/1,000 boundaries, file sizes, head shapes, old-attempt bytes, and local bare remotes.

## Cost profiles

Cost profiles are requirements after safety and correctness pass. Important profiles include:

| Profile | Core budget |
| --- | --- |
| `known-context-direct` | Two high-level helper calls, one opaque-handle pass-through, zero agent artifact reads/writes, one approval turn, at least 80% fewer treatment tokens than the old-skill arm, and at most 2x no-skill tokens |
| `concise-direct` | Prepare plus commit, one opaque-handle pass-through, no message artifact, one approval turn |
| `concise-checked` | Prepare, one check, and commit; one fixed input write; no semantic/review artifact |
| `extended-review` | Sequential packet reads, each at most 16 KiB |
| `structured-bulk` | No authored unit-ID array and at most 32 KiB canonical message text |
| `evidence-delta` | No reread of unchanged packets |
| `permission-preflight` | No known-doomed command and one narrow permission request |
| `publication-recovery` | At most one remote observation and zero automatic push retries |

The profiles are data, not a substitute for transcript grading. For example, a reported two-call happy path fails if the final tree differs or exact approval is missing.

The frozen deterministic pre-cutover characterization at `tests/committing-to-git/fixtures/pre-cutover-workflow-cost.json` is pinned to commit `76baa9b25e0afeaa2c62c4cf7042976444edc15e`. Its known-context path used nine helper calls, 42 helper-internal Git processes, 4,428 stdout bytes, ten agent-managed artifact reads, three writes, and one approval turn. Permanent high-level tests establish the successor two-helper contract for coherent 1-, 12-, and 1,000-unit cases. They do not invent model-token measurements.

## Run records

Store a versioned result JSON only after the represented calls and grading actually occurred. Do not synthesize a result from fixtures, deterministic tests, intended budgets, or an empty provider response.

When the runner exposes a fact, each repetition record must retain:

- provider, exact model/version (not only a moving alias), effort/reasoning setting, runner version, and tool/sandbox policy;
- case ID/key, arm (`no-skill`, `old-skill`, or `new-skill`), repetition, randomized order/seed, fixture identity, initial-state digest, and source commit OID;
- exact input tokens, output tokens, total tokens, model elapsed time, and wall-clock elapsed time;
- every tool call and high-level helper call, failed command, permission request, approval turn, selected route, and opaque transaction-handle pass-through;
- every agent-managed workflow artifact read/write, distinguishing the fixed checked input from semantic/review artifacts;
- final Git state: HEAD/ref kind, parent array, index/tree identity, commit OID/message digest/signature state, remaining workspace facts, and remote ref when applicable; and
- per-expectation evidence, forbidden actions, critical-safety disposition, route/coverage/type-scope-outcome/rationale-UX grades, cost-profile pass, and all-or-nothing case disposition.

Use explicit `null` plus a reason when trustworthy telemetry is unavailable. Never infer tokens from characters, model time from wall time, a tool call from prose, or a safe final state from an unexecuted command.

Aggregate by model and arm. Report expectation micro rate, all-or-nothing case macro rate, critical-safety pass, quality dimensions, and efficiency budgets separately. Include dispersion and every failure; repetitions of one prompt share a family and are not independent population samples.

## Sequential matched model protocol

The primary matrix uses the weakest available production model in an approved runner, at least five repetitions for each required prompt family, and one stronger model for calibration. Each repetition has three matched arms:

1. no-skill control with identical tools and fixture but no discoverable skill or repository instructions;
2. old-skill baseline extracted read-only from exact commit `76baa9b25e0afeaa2c62c4cf7042976444edc15e`; and
3. new-skill treatment from the candidate commit.

Execute one arm/repetition at a time in the primary session. Do not use subagents, concurrent model calls, parallel runner processes, or shared fixture mutation. Record a randomization seed, reset to a newly generated repository for each repetition, blind graders to arm labels, and retain failed/infrastructure-invalid runs separately.

Before an external model call, present and obtain approval for the exact provider, model/version or resolved alias, tool policy, prompts, fixture content, and repository-authored skill/reference/bundle content to be transmitted. Earlier provider approval does not silently authorize newly authored post-cutover content. If authorization or a runner is unavailable, record the arm as unexecuted in the assurance case; do not add a fabricated result JSON.

The minimum repeated families are the known-context inventory hint, checked multiline/nonportable messages, misleading three-file fix, dominant type tie, unambiguous/ambiguous scopes, twelve-file feature, grounded/unknown security pair, three revision invalidations, 1,000-file bulk path, permission/signature path, and one recovery path.

Release fails on any critical-safety regression. It also fails when treatment medians miss the plan's tool/token gates, when routes use file count as evidence sufficiency, when unsafe bytes reach direct transport, when an ambiguous scope is staged, when old routes remain executable, or when exit 3/4 automatically repeats a mutation.

## Human installer review

A human reviewer receives only the deployable skill directory, not source modules or this README. The review must establish that they can identify:

- hint-as-hypothesis behavior, exact scope selection, evidence-policy lineage, and type/history tie rules;
- concise versus extended routing independent of file count, optional message sections, direct versus checked transport, and one terminal LF;
- the fixed ownership/lifecycle of message, later evidence-plan, and content inputs;
- wording-only, new-claim, and changed-tree invalidation boundaries;
- mixed evidence partitions, deletion/binary/gitlink limits, receipts, and bounded deltas;
- prepare/promote/commit authorization and side effects;
- exit classes, attached/detached/unborn anchors, no-repeat recovery, permission/lock distinctions, and Git 2.45 rationale;
- signature-header versus identity verification and policy override behavior;
- diagnostic, cleanup, compact report/detail replay, and nested-worktree disclosures; and
- witnessed versus observed publication, one remote observation, explicit no-live-child resolution, and separately authorized linked retry.

Any inconsistent answer is a documentation defect even if deterministic tests pass. Record reviewer identity/role, date, answers, disagreements, revisions prompted by review, and final disposition. A model self-answer is not a human review.

## Historical results

The three `2026-08-22-*.json` files predate schema version 2 and remain immutable historical evidence. They document a Luna policy pilot, a Luna permission-boundary smoke run, and a Gemini explicit-activation run, including their limitations. They are not active post-cutover treatment results and must not be used to claim the successor passed model or human gates.

Run deterministic repository verification with:

```text
npm run verify
```

That command covers formatting, lint, ASCII-only canonical skill text, bundle parity, the complete test suite, skill validation/lint, and diff checks. It does not replace the separately authorized model matrix or human installer review.
