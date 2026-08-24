# Evaluating `defining-concepts`

This maintainer-only suite evaluates the deployable skill at
`skills/defining-concepts/`. It is not installed with the skill. The suite
defines representative cases and a reproducible grading protocol; it does not
contain model outputs or claim measured improvement.

## Contents

- [Evaluation status](#evaluation-status)
- [What each file measures](#what-each-file-measures)
- [Behavioral coverage](#behavioral-coverage)
- [Critical gates](#critical-gates)
- [Grading protocol](#grading-protocol)
- [Run protocol](#run-protocol)
- [Trigger protocol](#trigger-protocol)
- [Decision rules](#decision-rules)
- [Deterministic validation](#deterministic-validation)
- [Known limitations](#known-limitations)

## Evaluation status

**Not yet run.** No baseline, treatment, trigger, latency, or token result is
retained here. `evals.json` contains prospective expectations, not evidence
that the current skill passes them.

When results are eventually retained, record the exact skill revision, model
identifiers, host, web tools, run date, randomization seed, repetitions, raw
outputs, transcripts, usage reports, grades, and failed runs. Never replace a
failed run silently.

## What each file measures

| File                 | Question                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `evals.json`         | Once activated, does the skill produce a semantically sound, ISO/IEC 11179-4-compliant, source-grounded artifact? |
| `trigger-evals.json` | Does the description activate on standardized concept-definition work and stay out of adjacent tasks?             |
| `README.md`          | How must matched runs be isolated, graded, compared, and reported?                                                |

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
- a repository is reported as queried without transcript evidence;
- a URL is reported as verified without a successful destination fetch;
- a cited destination does not support the exact semantic role attributed to
  it;
- an irrelevant or failed source is presented as authoritative provenance.

Do not offset a critical failure with a high qualitative score. Report the
critical result separately.

## Grading protocol

### 1. Assemble the evidence packet

For each run, retain:

1. the exact user prompt and input files;
2. the skill revision or baseline identity;
3. the complete final answer;
4. the complete tool transcript, including searches, opens, redirects, and
   failed fetches;
5. the model's usage and elapsed-time report;
6. the run timestamp and web-tool identity.

A final answer without its transcript cannot prove repository queries or link
verification and is not gradable for the corresponding expectations.

### 2. Grade atomic expectations

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

### 3. Grade semantic quality blindly

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

### 4. Verify every source independently

Use a verifier other than the agent that produced the answer:

1. Extract every repository, source, URL, and semantic attribution from
   sections 2 and 5.
2. Match every claimed repository query to a visible search or fetch in the
   transcript.
3. Open every final URL independently and follow redirects to the final
   destination.
4. Confirm that the destination is accessible content rather than a search
   result, generic homepage, authentication wall, or error page.
5. Locate the exact term or constituent concept and confirm that the page says
   what the answer attributes to it.
6. Record the source's role: exact reused definition, adapted definition,
   constituent semantics, etymology, or methodological support.
7. Fail any citation whose attributed role is stronger than its content.

An active URL is not automatically a valid source. Conversely, a source may
support a constituent concept without supporting the compound designation; the
answer must label that limited role honestly.

If shared infrastructure prevents all matched arms from fetching a source,
mark the run invalid and rerun it. If only the agent claims verification after
a failed or absent fetch, grade the critical expectation as failed.

### 5. Check the final artifact

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

Capture input, output, and total tokens; tool calls; web searches; destination
fetches; failed calls; model elapsed time; and wall-clock elapsed time from the
run's own reports.

When making an efficiency claim, include the skill's trigger and invocation
cost. A treatment that saves work after activation may still cost more across
all sessions if its always-loaded description or invoked body outweighs the
run saving. Do not infer resource use from transcript length when the host
provides actual usage data.

### Retained results

Keep raw and derived evidence distinct. Raw outputs, transcripts, and usage
reports are immutable inputs to grading. Corrections produce a new grading
record that names the superseded record; they do not rewrite raw runs.

Retain every failure and document exclusions with a reason such as baseline
contamination or shared web outage. Never retain only the best repetition.

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
node --test tests/scripts/build-skill-bundles.test.mjs
npm run verify
```

These commands do not evaluate semantic quality, web research, triggering, or
model behavior. They only prove that the committed artifacts satisfy the local
deterministic contract.

## Known limitations

- Live pages, redirects, vocabulary versions, and search rankings change. A run
  is evidence for its recorded time and environment.
- Several cases admit more than one defensible definition. Exact-string grading
  would reward imitation rather than semantic quality.
- Human judgments about the immediate genus and essential differentia can
  disagree. Blind grading and written evidence reduce but do not remove that
  subjectivity.
- The suite emphasizes English compound designations and does not establish
  multilingual terminology quality.
- Eight cases cannot cover every domain, category error, or source-failure
  mode.
- No model or trigger run has been performed as part of creating this suite.
