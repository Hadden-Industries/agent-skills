# Phase 4: Preserve defining-concepts campaigns through the new boundary

Parent: [master plan](../2026-10-03-evaluation-modernization.md). Slice: SLICE-005. Ledger: KEEP-017 through KEEP-020, KEEP-027 through KEEP-030. Decisions: DEC-002 through DEC-005, DEC-010.

## Entry and outcome

Use the already-migrated source cases and a platform-qualified bridge. The delivered path prepares, preflights, executes fake campaign sessions, resumes interrupted progress, prepares blind grading and aggregates independently supplied grades with the same meaning as the current defining-concepts suite. Real calibration and confirmatory execution remain separately authorized.

The current runner is substantial implemented functionality. Do not replace it with a generic loop or implement a hypothetical source verifier in its name. This phase moves responsibilities behind clear interfaces while preserving its durable records and domain protocol.

## Predicted file work

| End-state path | Work |
| --- | --- |
| `src/defining-concepts/evals/evals.json` and `extensions/v1/suite.json` | Preserve all 16 cases, renderer/profile/stratum/dimension metadata, critical indexes, exact follow-up and capability requirements. Phase 2 performed the spelling/path conversion; do not optimize prompts here. |
| `src/defining-concepts/evals/assurance/v1/evaluation-runner.mjs` | Keep `prepareCampaign`, `preflightPreparedCampaign`, `inspectCampaignExecution`, `runPreparedCampaign`, `prepareCampaignGrading`, `aggregateCampaignGrades`. Separate selection/durable reconciliation from the execution call so it can choose direct or qualified bridge mode explicitly. |
| `src/defining-concepts/evals/assurance/v1/evaluation-trial.mjs` | Preserve diagnostic trial lifecycle, exact frozen settings, verifier and evidence-layout behavior. Expose only the prepared-session execution seam needed by the profile. |
| `src/defining-concepts/evals/assurance/v1/session-controller.mjs`, `run-evaluation-session.mjs` | Keep suite result mapping while reusing shared scripted-conversation mechanics and provider adapters. Update actual operator command paths coherently. |
| `src/defining-concepts/evals/assurance/v1/profile.mjs` (new if needed) | Narrow compiled-case-to-current-preparation and sealed-result mapping; no second campaign, capability or authorization engine. |
| Shared compiler, registry and bridge | Register this real profile and its supported capabilities/evidence layout. New shared extraction needs demonstrated second-consumer use. |
| Existing `tests/evals/defining-concepts/*.test.mjs` | Keep definition, structure, trial, runner and historical-result tests; add seam tests in the relevant existing files. |
| Current defining suite README and concept design links | Correct live paths and precisely state execution/grade/capability limits. Keep historical concept plans as historical records. |

## Preserved experimental and execution contract

The calibration set remains `1, 3, 8, 9, 10, 11, 12, 13, 14, 15`, with `no-skill`, `current-skill`, `candidate-skill` and one repetition: 30 sessions per model/effort profile. Preserve the independently specified model profiles; no inferred provider equivalence or changed repetition denominator. Confirmation uses independently selected scenarios under a fresh preparation and authorization.

Capture current/candidate treatment bundles from the actual generated distribution and the declared historical Git revision. Reconcile exact compatibility text, required case capabilities and uniform arm policy through the existing module. Cases 1/3/8 require web-search and URL-fetch capabilities. Requirements do not grant them. Provider support, preflight availability and observed activation are distinct checks. Preserve Claude's current multi-turn limitation and Antigravity's inability to establish live-source retrieval.

Case 10 retains its exact committed second turn. Requesting the specified clarification is a grading requirement. The existing scripted controller checks a completed, nonempty response and the expected transition; it does not interpret whether the answer actually asked the right question. Preserve that distinction when Hadden supplies the frozen next turn. No portable projection may concatenate both turns into one initial instruction or grade a first-turn-only run as complete.

Keep mandatory zero-turn preflight, positive whole-session execution timeout, frozen runner-settings version and packet/hash binding. The consumer's outer budget cannot change this timeout. Historical campaigns/trials without a bound deadline are non-resumable under the current protocol.

Preserve immutable execution-start identity and immediate per-session outcome retention. The next session is considered only after the previous terminal outcome is reconciled. An interruption between provider consumption and campaign outcome persistence requires observation/reconciliation, never provider relaunch. A new packet, model, candidate, capability, timeout or authorization identity starts a new campaign, not an in-place rewrite.

## Grading boundary

Retain complete blinded critical/dimension/pairwise packets, separate private identity mapping, applicable-dimension rules, cited grade evidence, critical-failure handling and aggregate completeness. The integrity verifier remains `not-graded` until actual grades exist.

Source checking has three roles: what exact destination the executor retrieved; independent reachability/version inspection; and whether the evidence supports the semantic claim. Current code prepares and validates grading evidence but does not implement a general automatic URL/entailment verifier. Keep that manual/authorized-grader procedure explicit. Any future automation is separate researched functionality and its own external-call scope.

## Proof

Compare direct and bridged fake executions for identical schedule cells, prepared inputs/continuation policy, capability receipt, controller events and normalized outcome. Expected values come from Phase 1 fixtures and existing independent tests. Whole packet digests may intentionally change when bound source paths/toolchain inputs change; compare the classified semantic fields and require a new packet/authorization, rather than claiming unchanged old authority.

Exercise: preflight rejection; missing/extra/wrong authorization; crash before consumption; crash after consumption but before outcome retention; invalid next sequence; changed bundle or follow-up; incomplete critical grades; missing dimensions/pairwise citation; historical unknown schema; and report failure after a sealed run. All failed/invalid attempts remain in denominators and evidence.

Existing command after imports/path updates:

```powershell
node --test "tests/evals/defining-concepts/*.test.mjs"
```

Run impacted shared runtime/conversation/capability/bridge tests, then `npm run verify`. If separately authorized, prepare a bounded real-provider equivalence experiment using the exact new candidate/profile; retain inputs, actual model confirmation, source volatility and limitations. Do not run a 30-session campaign merely because the code can prepare it.

## Exit and recovery

Exit requires preserved deterministic campaign/recovery/grading behavior and an accurate supported-mode matrix. Retain diagnostic trial commands, direct execution where needed and all live historical readers. An unsupported bridge or provider does not justify reducing the case set silently. Reverse only unconsumed preparation or owned code changes; retain consumed session evidence and private mappings. Record per-file changes and proof at the separately authorized commit checkpoint.
