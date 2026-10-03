# Evaluating `naming-objects-in-software-engineering`

This maintainer-only suite evaluates the deployable skill at `skills/naming-objects-in-software-engineering/`.

New sessions use the [shared runtime](../../../docs/evaluation-runtime.md), its existing Antigravity adapter, exact authorization and scripted conversation controller. The hardcoded executable and direct launch loop have been removed. The native skill-up assured bridge remains disabled on unqualified platforms; select direct Hadden execution explicitly. Historical keyword scores and classifier selections are diagnostics, not semantic correctness or actual host activation.

## Surfaces

| File                                                                    | Purpose                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evals.json`                                                            | Eighteen behavioral cases testing conceptual discrimination, verb precision, web stacks, Python typing, PowerShell cmdlets, XSLT namespaces, and policy precedence. |
| `trigger-evals.json`                                                    | Thirty-two balanced positive and negative selection queries; the dataset itself does not prove activation.                                                          |
| `extensions/v1/suite.json`                                              | Preserved calibration IDs and exact follow-up turns, bound to portable case identity.                                                                               |
| `assurance/v1/evaluation-runner.mjs`, `profile.mjs`                     | Prepared sessions through the shared runtime; explicit model, effort, executable, environment and deadline.                                                         |
| `assurance/v1/grading-contract.mjs`                                     | Complete, ordered reviewed semantic judgments tied to authoritative outcome identity.                                                                               |
| `analysis/legacy-diagnostics.mjs`                                       | Retained keyword heuristic without a provider-launch path.                                                                                                          |
| Repository-root `evals/naming-objects-in-software-engineering/results/` | Pre-existing ignored historical outputs retained at their original paths, not new-run output.                                                                       |

## Model Tiers & Roles

`HISTORICAL_MODEL_PROFILES` retains three configured model strings and their aliases. Preparation requires an explicit model and effort; these historical labels are not defaults, a fresh provider-availability check, a comparative quality finding, or proof of independent judging:

- **High-Powered (The Judge)**: `gemini-3.1-pro-high` (`--branch judge` / `--branch high`)
  - Intended higher-capability comparison branch; the label does not make its outputs an independent grading authority.
- **Default (The Worker)**: `gemini-3.8-flash-medium` (`--branch default` / `--branch worker` / `--branch standard`)
  - Configured default comparison branch.
- **Low-Powered (The Stress Tester)**: `gemini-3.6-flash-low` (`--branch stress` / `--branch low`)
  - Intended lower-capability stress comparison branch; success still requires actual observed and appropriately graded evidence.

## Calibration Cases

The current manifest selects cases 1, 2, 4, 6, and 7. With `no-skill` and `candidate-skill` and one repetition, the runner schedules ten sessions per selected model profile:

- **Case 1**: Vague-Token Elimination (`process_data` -> precise entity/action/representation)
- **Case 2**: Verb Taxonomy & I/O Boundary (`get` vs `fetch` vs `calculate`)
- **Case 4**: Broad Bucket Nouns and Bounded Responsibility (`UserManager`, `data_helper`), followed by exact senior-lead pushback
- **Case 6**: Database Physical Schema (`customer_account` table, `is_email_verified`, `created_at_epoch_ms`)
- **Case 7**: Negative Boolean and External-Contract Boundary (`is_not_expired`), followed by exact legacy-database pushback

The case 4 and 7 follow-ups are normative ordered inputs. First-turn-only execution or concatenating both turns into one prompt is not equivalent coverage. Historical heuristic scores remain diagnostic records; structural migration must not rewrite them or silently change assertion meaning.

## Prepare, authorize and run

`assurance/v1/evaluation-runner.mjs` accepts `schedule`, `prepare`, or `run`, followed by a JSON request file. `schedule` accepts an empty object and returns the ten fixed cells; scheduling starts no model. Prepare each selected cell independently into a new absolute evidence destination. A preparation request contains `destination`, numeric `caseId`, `arm`, exact `model`, `effort`, absolute `command`, `prefixArguments`, explicit `environment`, an existing empty non-repository `workingDirectory`, and positive `timeoutMs`. Never copy the complete ambient environment. Preparation probes only the reviewed toolchain version/help and binds the full generated skill bundle, source/compiler identity, execution policy and ordered inputs.

The supported protocol is Google Antigravity CLI's reviewed streamed conversation contract. The uniform policy enables packet-injected bundle text with no tools or web search. The optional Python checker is not executed by that treatment. Candidate instructions include all bundle files; the no-skill arm receives none. A model answer cannot prove that a reference or checker was used.

Review `packet.json` and create the exact authorization described in the shared runtime guide. A run request contains `preparedSession`, the authorization object, and literal `allowExternalModelCall: true`; optional `evidenceLayout` is `legacy-v1` or `evaluation-trial-v1`. No default model, command, authority or retry is inferred. Failed or consumed sessions retain evidence and cannot be relaunched by resubmitting the request.

Preparation also accepts `executionMode: "direct"` (the default) or `executionMode: "skill-up"`. Consumer mode binds a carrier receipt before sealing the packet and remains disabled on unqualified production platforms. Its run request uses `authorizationFile` instead of an inline `authorization` object, plus literal `allowExternalModelCall: true`. Both forms together are rejected. A consumer-bound packet cannot use the inline direct route. Direct requests retain their existing interface; neither mode retries failed or consumed sessions. Keep the sibling `<preparedSession>.consumer.json` locator and its referenced carrier with the evidence.

## Separate evidence categories

The installed Python checker reports lexical validity and always `semantic_certified: false`. `validateSemanticGrade` accepts reviewed judgments for every unchanged assertion in order, binds the authoritative outcome hash, and retains failure or unknown judgments. Historical keyword grades remain reproducible diagnostics. None of these imply host activation.

`scripts/evaluation/trigger-contract.js` distinguishes dataset conformance, selection diagnostics, and host activation experiments. Actual activation requires a separately authorized host run with client/model/artifact identity, competing skills, environment and capability policy, original or held-out query identity, repetition, observable load evidence and answer. Missing load evidence remains unknown. No real-provider behavior or host activation was established by the deterministic fake-provider tests.
