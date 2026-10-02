# Phase 1: Freeze existing contracts, qualify tooling, preserve history

Parent: [master plan](../2026-10-03-evaluation-modernization.md). Slices: SLICE-001 and SLICE-002. Ledger: KEEP-005, 009-011, 020, 023, 036. Decisions: DEC-006 through DEC-009.

## Entry and outcome

Start from the accepted dossier revision and a fresh status/HEAD inventory. Preserve all existing user changes and ignored results. Obtain the exact dependency/toolchain and history-policy approvals from the master plan before touching those settings. This phase produces evidence that the current contracts are understood, that actual selected consumers can be exercised without model calls, and that historical paths can move without changing observations.

No model authorization, provider login, downloaded runtime execution or general cleanup follows merely from approval of a plan. Confirm rights and the exact bootstrap action before acquiring/using new tools. The existing authoring bootstrap remains untouched.

## Predicted files and ownership

| Path | Work and boundary |
| --- | --- |
| `tests/scripts/evaluation-runtime.test.mjs` | Preserve and strengthen independent literals for packet canonicalization, exact authorization, both evidence layouts, pre-consumption reopening and consumed-packet replay rejection. |
| `tests/scripts/evaluation-capability-reconciliation.test.mjs` | Freeze exact compatibility interpretation, arm/case requirement and uniform envelope behavior. |
| `tests/scripts/evaluation-scripted-conversation.test.mjs` | Freeze ordered exact follow-ups, transition identities, maximum turns and completion rules. |
| `tests/scripts/evaluation-skill-bundle.test.mjs` | Freeze complete treatment files, source identities, canonical ordering and rendering boundaries. |
| `tests/committing-to-git/evaluation-runner.test.mjs`, `eval-fixtures.test.mjs` | Capture the current selected schedule, stable IDs, fixture facts and independent expected results. |
| `tests/evals/defining-concepts/evaluation-runner.test.mjs`, `evaluation-trial.test.mjs` | Freeze campaign identity, bound deadline, execution-start/outcome reconciliation and historical non-resumability. |
| `tests/fixtures/evaluation-contracts/` (new) | Small independently reviewed contract fixtures, including multi-turn inputs and failed/unsafe outcomes. No real credentials, private mappings or copied bulk provider logs. |
| `evaluation-toolchain.json`, `package.json`, `package-lock.json` | Only exact approved pins/dependencies; retain native npm graph and selected release/source/asset identities. |
| `scripts/set_up_evaluation_execution_tools.py` (new) | Explicit platform-aware installation from reviewed pins, checksum/length checks, native package acquisition and post-install identity observation. Reuse existing repository download/process helpers where suitable. Do not extend current-tracking authoring behavior. |
| `scripts/evaluation/check-conformance.js` (new) | Read-only missing/mismatch preflight and isolated real-consumer validation/fake-provider execution. No acquisition, ambient credentials or model judge. |
| `tests/scripts/evaluation-toolchain.test.mjs`, `evaluation-consumers.test.mjs` (new) | Negative tool identity/ambient environment controls and real pinned consumer observations. |
| `evidence/migrations/2026-10-03-historical-results.json` (new at migration) | Old/new paths, byte lengths, SHA-256 and Git blob identities; schema version and baseline revision. Name/date must match actual execution if later. |
| `evals/committing-to-git/results/**`, `evals/defining-concepts/results/**` -> `evidence/historical/<suite>/**` | Tracked byte-preserved relocation only. No filename, internal relative path, record field or line-ending edits. |
| Current historical readers, suite READMEs and root README | Update live locators and tests in the same migration. Historical dated plans and embedded paths remain untouched. |
| `.gitignore`, `.gitattributes` | Only the exact approved evidence-location rules. No broad unignore, renormalization or deletion. |

## Work and demonstrations

First inventory production exports, active/retired IDs, prompts/assertions/follow-ups, capability declarations, expected package files, all evidence schemas and callers. Record source versus installed test ownership. Freeze behavior through the existing test surfaces before moving code. Failure cases are part of the baseline, including unknown outcome, unsafe closure, absent Pandoc and ungraded trial integrity.

Resolve the refreshed stable tool candidates to exact native package locks and archive/executable identities. Inventory actual licenses/required notices and supported platforms. Bootstrap into repository-managed execution-tool storage with no provider credentials. Preserve a prior installation on failed validation; never use an unchecked partial download or fall back to a different executable found on PATH.

Exercise skill-up's actual `validate` entry point and fake custom-engine path from a clean working directory. Use deterministic rules/scripts for judging. Exercise agent-skills-eval's public loading/discovery and static target/judge providers independently; it must consume generated portable fixtures itself. Test its known fixture asymmetry, expected-output omission and binary/text limitations as explicit observed coverage, not as silent success.

At this phase, those workspaces are small independently specified test fixtures, not a premature conversion of all repository suites or a second production projector. Phase 2 connects the real compiler and source cases to the same consumer checks. Keep the conformance command outside the default `verify` sequence until its integrated prerequisites are qualified and the exact script change is approved.

Prove isolation with sentinel ambient configuration, `.env`, telemetry and credential inputs. Observe child processes and network attempts within the disposable test boundary. No-model intent alone does not prove no network. Refuse unsupported or uncertain control surfaces and record the gap. Do not run a built-in engine that may bootstrap a real agent just to check configuration.

Perform the historical move as a separate checkpoint. Baseline observations were 412 tracked files / 6,028,581 bytes, plus 19 ignored naming files / 4,726,489 bytes outside that tracked scope. Recompute the inventories before acting. Record any drift and its owner; do not restore absent files. Validate destinations are confined, non-overwriting and free of redirected components. Copy/move exact bytes, compare every source/destination hash and staged Git blob, then update only live reader paths. A full pass includes missing/unexpected file detection, not just matching the files that happened to be copied.

## Proof

Existing focused command, before adding new test files:

```powershell
node --test tests/scripts/evaluation-runtime.test.mjs tests/scripts/evaluation-skill-bundle.test.mjs tests/scripts/evaluation-scripted-conversation.test.mjs tests/scripts/evaluation-capability-reconciliation.test.mjs
```

After proposed tests exist:

```powershell
node --test tests/scripts/evaluation-toolchain.test.mjs tests/scripts/evaluation-consumers.test.mjs
```

Run historical reader tests after their locator update. Retain complete before/after inventories and an independently reviewed sample of each layout. Run `npm run verify` for the changed scripts/tests and inspect the exact diff. No result from this phase establishes real model behavior or native host activation.

## Recovery, exit and handoff

On tool acquisition or conformance failure, keep the failure/identity record and prior qualified mode. On historical mismatch, stop cleanup and retain both inventories; repair or reverse only the exact owned path move through its mapping. Never regenerate a historical result or add ignored naming evidence to Git as a workaround.

Exit when baseline invariants are traceable, tool rights/integration statuses are explicit, no-model consumer checks have actual evidence, and the tracked migration is fully reconciled. A blocked tool does not require moving history anyway; the two slices are independently demonstrable. Record any retained scratch with owner, purpose and removal trigger. Commit only with separate authorization and a detailed per-file message; keep the path-only history checkpoint distinct.
