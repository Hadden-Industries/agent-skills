# Evaluating `defining-concepts`

This maintainer-only suite evaluates the deployable skill at
`skills/defining-concepts/`. It is not installed with the skill. The suite
defines representative cases and a reproducible grading protocol. Versioned
run evidence lives under `results/`; its presence records what occurred and
does not by itself support a measured-improvement claim.

## Shared Runtime

The repository-wide [Shared Runtime](../README.md) defines packet preparation, exact external-call authorization, evidence files, provider adapters, stable evaluation homes, failure classes, historical-schema handling, and sensitive-data rules. This document defines only the `defining-concepts` cases, controller/capability deviations, grading, and suite commands.

## Evaluation status

**Calibration and revised regression completed; candidate not accepted.** On
2026-08-24, one matched repetition of cases 1, 4, 7, and 8 was first used to
find grading and runner defects. After the expectations were frozen and the
skill's source-evidence workflow was revised, the same four development cases
were run once more with and without the working-tree candidate on one requested
Codex model. Neither run set is a performance estimate; each has only one
repetition per arm, no repetition-based variance, and no provider-confirmed
actual model identifier. Cases 2, 3, 5, and 6 remain held out and unrun.

The initial calibration showed that bundled source assertions obscured three
different questions: whether the executor performed a URL-specific action,
whether the URL was independently reachable, and whether its content supported
the stated semantic role. It also showed that Codex JSONL can omit returned
page content and the actual model identifier. The revised protocol below grades
those facts separately and labels unavailable provider evidence explicitly.

The revised regression passed 42 of 49 atomic treatment expectations, used the
required five-section format in all four treatment runs, and retained 10 final
destinations that all passed independent reachability and semantic checks. It
nevertheless failed the critical gate in every treatment case: only two of the
10 exact final URLs were visibly named by completed URL-specific events in the
retained trace. Empty-query web events are not credited as exact-URL evidence.
The working-tree candidate therefore does not pass the acceptance rules.

Raw model outputs are retained under the timestamped maintainer-only result
bundles at `results/2026-08-24T092645.127Z/` and
`results/2026-08-24T141214.748Z/`. Any reported run must record the exact skill
revision, requested and provider-confirmed model identifiers, host, CLI and web
tool versions, run date, randomization seed, repetitions, raw outputs,
transcripts, usage reports, grades, and failed launches. Never replace a failed
run silently.

## What each file measures

| File                         | Question                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `evals.json`                 | Once activated, does the skill produce a semantically sound, ISO/IEC 11179-4-compliant, source-grounded artifact? |
| `trigger-evals.json`         | Does the description activate on standardized concept-definition work and stay out of adjacent tasks?             |
| `run-evaluation-session.mjs` | Can a matched run be isolated and retained with prompt, skill, transcript, timing, and failure metadata?          |
| `results/`                   | What immutable raw evidence, grading, derived analysis, and invalid attempts were retained from actual runs?      |
| `README.md`                  | How must matched runs be isolated, graded, compared, and reported?                                                |

Passing trigger cases says nothing about definition quality. Passing
behavioral cases says nothing about whether the skill activates reliably.

## Behavioral coverage

The eight cases vary the failure mode rather than merely changing the noun.

|  ID | Design pressure                         | Discriminating behavior                                      |
| --: | --------------------------------------- | ------------------------------------------------------------ |
|   1 | Established public vocabulary           | Reuse judgment and dataset/distribution separation           |
|   2 | Enumerated status values                | Concept/value-domain/code separation                         |
|   3 | Representation-specific starter         | Code/language/document/field separation                      |
|   4 | Process-result confusion                | Outcome/process separation                                   |
|   5 | Negative, circular, abbreviated starter | Positive and standalone definition                           |
|   6 | Closely related date concepts           | Immediate genus and sibling discrimination                   |
|   7 | Polysemous designation                  | Context-sensitive terminology and quantity/unit separation   |
|   8 | Prompt-supplied irrelevant provenance   | Source resistance, honest Path C reasoning, and verification |

Every case exercises live research because source selection and final-link
verification are core behavior. There are no static source fixtures: a snapshot
could prove that an agent can quote a supplied file while evading the skill's
requirement to search current vocabularies and open the cited destinations.

## Critical gates

Expectations prefixed `[CRITICAL]` protect integrity and ontology. Grade them
before fluency, style, or resource use.

A case fails the critical gate if any of these occurs:

- section 3 contains no formulated definition;
- the final definition has the wrong ontological category;
- a concept is conflated with a process, artifact, carrier, code, field, unit,
  or value domain contrary to the case;
- `Repositories Queried` is absent, empty, or names a repository with no
  visible pre-answer action;
- a final URL has no completed URL-specific retrieval action in the retained
  trace;
- an independent verifier cannot reach accessible content at a final URL;
- an independently opened destination does not support the exact affirmative
  or refutational semantic role attributed to it;
- an irrelevant or failed source is presented as authoritative provenance.

Do not offset a critical failure with a high qualitative score. Report the
critical result separately.

## Grading protocol

### 1. Assemble the evidence packet

For each run, retain:

1. the exact user prompt and input files;
2. the skill revision or baseline identity;
3. the complete final answer;
4. the complete tool transcript, including search queries, exact URL actions,
   redirects and tool errors, plus a note describing any response data the
   transcript schema omits;
5. the independent source-verification record;
6. the model's usage and elapsed-time report;
7. the run timestamp, executor version, and web-tool identity.

A final answer without its transcript cannot prove repository queries or
URL-specific retrieval actions and is not gradable for those expectations. A
transcript that omits response bodies does not prove source semantics; the
independent verifier supplies that evidence.

### 2. Keep evidence layers separate

Grade source integrity in three layers. A pass in one layer never substitutes
for another.

| Evidence layer                 | What it proves                                                                                 | What it does not prove                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Retained run trace             | The executor searched a repository or completed an action naming an exact URL before answering | HTTP liveness or the page's semantic content when the schema omits those results |
| Independent reachability check | The final URL currently resolves to accessible source content                                  | That the executor opened it during the run or interpreted it correctly           |
| Independent semantic check     | The destination supports the exact source role attributed in the answer                        | That the executor actually queried or opened it                                  |

For this suite, a **completed URL-specific retrieval action** is a completed,
non-error tool event that names the exact URL or redirect destination. A topical
query, site-restricted query, search-result excerpt, vocabulary homepage, or an
empty tool event does not count for a deeper term-bearing destination.

If an executor cannot retain exact URLs for retrieval actions, use a different
executor or mark the affected trace expectations ungradable and rerun. Do not
infer a page body, response status, or semantic claim from a completed action
when the transcript schema does not expose those facts.

### 3. Grade atomic expectations

Grade every string in `expectations` as `passed: true` or `passed: false` and
record concise evidence. Do not award partial credit to a binary expectation.
If one sentence combines two claims, both must be satisfied for that
expectation to pass.

Use the repository grading record shape:

```json
{
  "text": "The expectation exactly as committed.",
  "passed": true,
  "evidence": "The transcript fetched source X, and section 3 contains Y."
}
```

Compute both:

- **Atomic expectation pass rate** = passed expectations / graded
  expectations.
- **All-or-nothing case pass rate** = cases with every expectation passing /
  graded cases.

The all-or-nothing rate prevents several easy formatting checks from hiding
one decisive semantic or provenance failure.

### 4. Grade semantic quality blindly

Remove arm labels and randomize output order before a human grades the five
dimensions below. The grader may inspect source material but must not know
whether an answer came from the baseline, current skill, or candidate skill.

| Dimension            | 0                                           | 1                                                     | 2                                                                                 |
| -------------------- | ------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Genus quality        | Missing or wrong category                   | Defensible but remote or imprecise                    | Immediate and ontologically correct                                               |
| Differentia quality  | Missing, accidental, or non-discriminating  | Partly distinguishes siblings                         | Essential and decisively distinguishes siblings                                   |
| Category correctness | Material conflation remains                 | Main category is right but boundary language is loose | Concept, representation, process, carrier, and value domain are cleanly separated |
| Reuse judgment       | Unsupported path or fabricated provenance   | Defensible path with incomplete comparison            | Path follows authoritative evidence and semantic fit                              |
| Definition economy   | Circular, dependent, procedural, or bloated | Usable with minor excess or ambiguity                 | Standalone, positive, precise, concise, and non-circular                          |

Report the five scores and their 0-10 sum, but keep them separate from binary
expectation and critical-gate results. A subjective score must not turn a
source-integrity failure into a pass.

### 5. Verify every source independently

Use a verifier other than the agent that produced the answer:

1. Extract every repository, source, URL, and semantic attribution from
   sections 2 and 5.
2. Match every claimed repository query to a visible pre-answer search or
   completed URL-specific retrieval action in the transcript.
3. Match every URL retained in section 5 to its own completed URL-specific
   retrieval action; do not treat a topical search as an open.
4. Open every final URL independently and follow redirects to the final
   destination.
5. Confirm that the destination is accessible content rather than a search
   result, generic homepage, authentication wall, or error page.
6. Locate the exact term or constituent concept and confirm that the page says
   what the answer attributes to it.
7. Record the source's role: exact reused definition, adapted definition,
   constituent semantics, etymology, or methodological support.
8. Fail any citation whose attributed role is stronger than its content.

An active URL is not automatically a valid source. Conversely, a source may
support a constituent concept without supporting the compound designation; the
answer must label that limited role honestly.

If shared infrastructure prevents all matched arms from retrieving a source,
mark the matched block invalid and rerun it. If the final answer claims a URL
was verified but its exact URL has no completed run-trace action, fail the
trace expectation even when the independent verifier can open it. Conversely,
an evidenced run-trace action does not make an inaccessible or semantically
irrelevant destination pass the independent checks.

### 6. Check the final artifact

The final answer must have these numbered top-level sections in order:

1. Semantic Analysis
2. Standardization & Reuse Check
3. The Formulated Definition
4. ISO/IEC 11179-4 Compliance Audit
5. Verified Sources

The definition belongs in section 3. Progress narration, search notes, and
conversational filler outside this artifact fail the relevant format
expectation. Commentary emitted by a host while work is in progress is not
part of the final-answer format.

For the mandatory audit, verify the actual definition rather than trusting the
agent's pass table. Re-check singularity, positive declaration, descriptive
form, abbreviations, and embedded definitions directly.

## Run protocol

Prepare one fresh arm at a time. `--working-dir` must name an empty,
non-repository directory; `--destination` must not exist. Use `--skill-file`
only with `with_skill`:

```text
node evals/defining-concepts/run-evaluation-session.mjs prepare --prompt-file <prompt.txt> --destination <new-session> --working-dir <empty-dir> --arm <with_skill|without_skill> --provider <codex|claude|antigravity> --model <model> --effort <effort> --eval-id <id> --repetition <n> [--skill-file <SKILL.md>] [--evaluation-homes-root <root>] [--antigravity-command <absolute-agy.exe>]
node evals/defining-concepts/run-evaluation-session.mjs run --prepared-session <new-session> --authorization <authorization.json> --allow-external-model-call [--timeout-ms <ms>]
```

Preparation prints the packet digest and starts no model turn. Review and
authorize the resulting session through the common boundary before `run`.
Antigravity preparation requires the absolute reviewed CLI executable. It
pins version `1.1.19`, executable and help bytes, and performs no authentication
or model probe. Repeatable `--antigravity-prefix-arg` is available for a
repository-owned launcher or deterministic fake; each prefix file is included
in the toolchain fingerprint and executable prefix paths must be absolute.

### Comparison arms

To establish the current skill's incremental value, run the same prompt in
fresh sessions under two arms:

```text
representative prompt
    -> isolated no-skill baseline
    -> canonical defining-concepts skill
```

For a future skill change, preserve the old skill and compare:

```text
representative prompt
    -> old skill at recorded revision
    -> proposed skill at recorded revision
```

Do not compare a proposed revision only with no skill when the question is
whether the revision improves the existing skill.

### Baseline isolation

The no-skill arm must work from first principles and must not be able to find
the canonical skill through its working directory, repository name, prompt,
available-skills list, or file paths. Instruct it to report whether it
encountered relevant skill material. Discard a contaminated baseline.

The treatment arm must receive the canonical deployable directory and the same
task prompt, files, web tools, permissions, locale, and time budget. The prompt
must not coach the treatment with expectations that the baseline does not see.

### Suite capabilities

Each prepared session uses a fresh, empty, non-repository working directory,
disabled persistence, a read-only sandbox, packet-bound instructions, and
exactly one controller turn. OpenAI runs select the `execution` home role;
Anthropic runs use the pinned Claude CLI profile. Both retain explicit network
and live-search capabilities. Their controller rejects every permission request
and never emits a continuation.

Google runs use the capability-scoped Antigravity profile: no network, web
search, tool, or subagent use is permitted. The runner composes the isolation
harness, exact skill text for the treatment arm, and user task into one
packet-bound user message. It does not depend on workspace/global automatic
skill discovery. The adapter retains the native `init` tool inventory and fails
if a tool or subagent step occurs; the inventory itself is not misreported as
disabled.

This difference is methodologically material. All active behavioral cases
require live research and exact-URL evidence, so an Antigravity no-tool run
cannot be pooled with or substituted for the web-capable OpenAI/Anthropic
matrix and is expected to fail the live-source critical gates. Use it for
transport, explicit-activation, and policy-reasoning diagnostics until the
headless CLI exposes a packet-scoped web capability that does not require
global permission mutation. Label every such result with its capability
profile.

Retain the full developer input and its digest for both arms. The same baseline
digest must recur across cases, and the same treatment digest must recur when
the skill revision is unchanged. If the provider does not echo the actual
model identifier in JSONL, record the requested model separately and mark the
actual identifier as unconfirmed rather than copying the request into an
`actual_model` field.

### Models and repetitions

At minimum, use one weaker and one stronger supported web-capable model. Add a
middle tier when the skill is intended for it. Use exact model identifiers,
not labels such as "small" or "best."

Run at least three independent repetitions per case and arm before reporting a
comparative direction. Block-randomize arm order with a recorded seed so time,
source availability, and caching do not consistently favor one arm. Use a
fresh context for every repetition.

Three repetitions remain directional evidence, not statistical power. Report
sample size, individual failures, mean, standard deviation, and range; do not
claim significance without an appropriately powered design.

A one-repetition pilot may calibrate prompts, trace capture, and graders. Do not
report its arm delta as measured skill performance, and freeze revised
expectations before running held-out cases.

### Stable execution conditions

Within a matched block, keep constant:

- system and repository instructions other than the intentional skill arm;
- web-search and URL-fetching capabilities;
- network and permission policy;
- user prompt bytes and input files;
- locale, timezone, and output-token limit;
- grader rubric and source-verification procedure.

Record source volatility rather than silently updating the expected answer.
The expectations intentionally grade semantic properties and source roles,
not exact prose or a permanently fixed search ranking.

### Resource accounting

Capture input, output, and total tokens; tool calls; web searches; completed
URL-specific retrieval actions; failed calls; model elapsed time; and
wall-clock elapsed time from the run's own reports.

Use the run's `timing.json` total-token value when it is available. Never
substitute output character count for tokens. If an aggregation tool cannot
carry the run's token or repetition metadata faithfully, correct or discard the
derived aggregate before analysis and retain the raw timing files as authority.

When making an efficiency claim, include the skill's trigger and invocation
cost. A treatment that saves work after activation may still cost more across
all sessions if its always-loaded description or invoked body outweighs the
run saving. Do not infer resource use from transcript length when the host
provides actual usage data.

## Retained result layout

Store each run set under `results/<run-set-id>/`. The run-set ID is the
filename-safe UTC timestamp of the first accepted run, using
`YYYY-MM-DDTHHmmss.SSSZ`. For example, the first accepted calibration run began
at `2026-08-24T09:26:45.127Z`, so its directory is
`2026-08-24T092645.127Z`. Millisecond precision reduces collisions, `Z` removes
timezone ambiguity, and omitting colons keeps the name portable to Windows.
The runner must refuse to reuse a non-empty destination; do not add an
arbitrary suffix to overwrite or merge evidence.

Do not repeat provider, model, or purpose in the directory name. Record those
facts in `manifest.json`, along with a `run_set_id` matching the directory and
the full RFC 3339 `started_at` timestamp. This keeps the manifest authoritative
if a requested model or run classification later needs correction.

Use this hierarchy:

```text
results/<run-set-id>/
    manifest.json
    analysis.json
    aggregate.generated.json
    aggregate.generated.md
    runs/
        case-<zero-padded-id>-<semantic-name>/
            case.json
            with-skill/
                repetition-<zero-padded-number>/
            without-skill/
                repetition-<zero-padded-number>/
    invalid-attempts/
        attempt-<zero-padded-number>/
            attempt.json
            cases/
```

Each repetition directory contains the common runtime evidence plus the
suite-owned `grading.json`. Raw runs are immutable inputs to grading;
corrections create a new grading record naming the superseded derivation.
Retain every failure and exclusion, including baseline contamination and
shared web outages, rather than selecting only favorable repetitions.

The `.generated` infix marks derived aggregation output. The initial
`2026-08-24T092645.127Z` aggregate came from the generic aggregation tool and
contains known repetition and token-accounting errors; its `manifest.json`,
individual `run.json` files, and `timing.json` files remain authoritative. The
`2026-08-24T141214.748Z` aggregate uses the retained one-repetition metadata and
raw timing token totals. Invalid service or launcher attempts stay under
`invalid-attempts/` and never enter the successful run count.

## Trigger protocol

`trigger-evals.json` contains 12 positive and 12 negative development cases.
The positives vary formal, casual, direct, and indirect standardized-definition
requests. The negatives are near-misses that share terms such as definition,
concept, semantic, standard, and status while asking for code, explanation,
translation, formatting, naming, or value-domain work.

Evaluate the skill description, not the already-loaded skill body. For each
query, record the model's activation decision and compute:

- precision = true positives / all predicted positives;
- recall = true positives / all actual positives;
- false-positive rate = false positives / all actual negatives;
- false-negative rate = false negatives / all actual positives.

Run each query three times when estimating activation reliability. A query
that activates once in three attempts is not equivalent to a deterministic
pass.

Before optimizing the description, create a separate held-out set of realistic
paraphrases. Do not use held-out cases to propose revisions. Select a candidate
from development performance, evaluate it once on the held-out set, and report
both results. Reusing the committed development prompts as the only test set
measures memorization of the suite.

## Decision rules

For a current-skill versus no-skill study, claim benefit only when:

- no critical-integrity rate regresses;
- ontological category correctness improves or remains perfect;
- the all-or-nothing case rate or blind semantic score improves on more than a
  single isolated run;
- the cost of carrying and invoking the skill is reported beside any resource
  saving.

For an old-skill versus proposed-skill change, accept the proposal only when:

- every critical behavior is non-inferior;
- no case-specific gain is purchased with a new category or provenance
  failure;
- trigger recall improves without an unacceptable precision loss, or remains
  unchanged when triggering was not modified;
- any deliberate tradeoff is reported explicitly rather than averaged away.

One fluent example is illustrative, not evidence.

## Deterministic validation

The repository build validates the mechanical contract shared by every suite:
behavioral case shape and identity, non-empty prompts and expectations,
in-suite file references, trigger shape, normalized trigger uniqueness, and
the presence of both activation classes.

Run:

```powershell
node --test tests/scripts/skill-repository-validation-contracts.test.mjs
node --test tests/scripts/build-repository.test.mjs
node --test tests/evals/defining-concepts/results.test.mjs
node --test tests/evals/defining-concepts/run-evaluation-session.test.mjs
npm run verify:skill -- --skill defining-concepts
npm run verify
```

The scoped command is the target-only inner loop and reports the global checks
it omits. The final `npm run verify` remains the whole-repository integration
gate. These commands do not evaluate semantic quality, web research,
triggering, or model behavior. They only prove that the committed artifacts
satisfy the local deterministic contract.

## Known limitations

- Live pages, redirects, vocabulary versions, and search rankings change. A run
  is evidence for its recorded time and environment.
- Codex JSONL may expose a completed exact-URL action without its HTTP status or
  returned page content. This is sufficient only for the run-trace layer; an
  independent verifier must grade reachability and semantics.
- Some providers do not echo the actual model identifier in their retained
  event stream. A requested model is not provider-confirmed execution evidence.
- Antigravity 1.1.19 has no reviewed zero-turn authentication/status command.
  Preparation confirms only executable/version/help identity; an authentication
  failure consumes the separately authorized attempt and remains provider
  evidence.
- Antigravity headless permissions cannot accept controller approval responses.
  Its no-tool profile measures explicit policy reasoning, not the suite's live
  web-research behavior.
- Several cases admit more than one defensible definition. Exact-string grading
  would reward imitation rather than semantic quality.
- Human judgments about the immediate genus and essential differentia can
  disagree. Blind grading and written evidence reduce but do not remove that
  subjectivity.
- The suite emphasizes English compound designations and does not establish
  multilingual terminology quality.
- Eight cases cannot cover every domain, category error, or source-failure
  mode.
- The two 2026-08-24 single-repetition run sets covered only cases 1, 4, 7, and
  8 on one requested model. They support rubric, runner, and candidate
  regression diagnosis only; no trigger study or comparative performance study
  has been completed.
