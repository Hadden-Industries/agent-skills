# `defining-concepts` regression calibration

Run set: `2026-08-24T141214.748Z`

This is a one-repetition calibration of cases 1, 4, 7, and 8 on the requested
`gpt-5.6-sol` model with live web search. The provider did not expose the
actual model identifier. These observations are descriptive only and are not a
performance estimate.

## Summary

| Metric | With skill | Without skill | Observed difference |
| --- | ---: | ---: | ---: |
| Atomic expectations | 42/49 (85.7%) | 20/49 (40.8%) | +44.9 percentage points |
| All-or-nothing cases | 0/4 | 0/4 | 0 |
| Critical-gate cases | 0/4 | 0/4 | 0 |
| Required five-section format | 4/4 | 0/4 | +4 cases |
| Trace-verified final URLs | 2/10 (20.0%) | 1/6 (16.7%) | +3.3 percentage points |
| Independently reachable final URLs | 10/10 (100%) | 5/6 (83.3%) | +16.7 percentage points |
| Semantically supported final URLs | 10/10 (100%) | 5/6 (83.3%) | +16.7 percentage points |
| Mean total tokens | 170,645.5 | 43,100.0 | +127,545.5 |
| Mean elapsed time | 67.873 s | 29.881 s | +37.993 s |
| Mean tool calls | 4.0 | 1.0 | +3.0 |

The treatment's exact URLs were independently good, but that does not satisfy
the retained-trace layer. Only two of ten treatment URLs were visibly named by
completed URL-specific events. Every treatment case therefore failed at least
one critical provenance expectation.

## Per-case outcomes

| Case | With skill | Without skill | Treatment critical failure |
| --- | ---: | ---: | --- |
| 1 - Dataset | 11/12 | 5/12 | Distribution URL absent from completed trace events |
| 4 - Identity Verification Outcome | 11/12 | 4/12 | None of three final NIST URLs named in completed trace events |
| 7 - Charge | 10/13 | 5/13 | No authoritative term URL or final URL named in completed trace events |
| 8 - Evidence Retention Authorization Status | 10/12 | 6/12 | Evidence Management Institute repository and URL absent from visible actions |

Case 7 also failed a noncritical economy assertion because the treatment
included the exact elementary-charge constant and a unit equation even though
the prompt did not require them.

## Interpretation limits

- One repetition per arm is suitable for grader and trace calibration, not a
  claim that the skill improves behavior.
- The run order was preselected and has no retained randomization seed.
- Standard deviations in the JSON aggregate describe variation across four
  different cases, not repeated-run variance.
- The actual model identifier was not exposed by the provider.
- Empty-query completed web events count as tool calls but cannot be credited
  as exact-URL actions.
- Blind semantic scoring was not performed because no independent blinded
  human grade was available after arm identities had been seen.

The revised candidate does not meet the suite's acceptance gate. The next
iteration should address the mismatch between the model's claimed exact-URL
retrievals and the exact destinations retained by the executor trace before
another model run is authorized.
