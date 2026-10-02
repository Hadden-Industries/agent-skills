# Evaluating `naming-objects-in-software-engineering`

This maintainer-only suite evaluates the deployable skill at `skills/naming-objects-in-software-engineering/`.

The runner is a legacy diagnostic, not an implementation of the [shared assured runtime](../README.md). It directly invokes an operator-local Antigravity executable, applies keyword-based grading, and asks a model which skill it would select for trigger diagnostics. Those results do not establish exact packet-bound authorization, semantic correctness, or actual host skill activation. The [modernization plan](../../docs/plans/evaluation-modernization/05-naming-and-trigger-contracts.md) specifies its replacement for new runs while preserving existing cases and evidence; that replacement is not yet implemented.

## Surfaces

| File | Purpose |
| --- | --- |
| `evals.json` | Eighteen behavioral cases testing conceptual discrimination, verb precision, web stacks, Python typing, PowerShell cmdlets, XSLT namespaces, and policy precedence. |
| `trigger-evals.json` | Thirty-two balanced positive and negative selection queries; the dataset itself does not prove activation. |
| `evaluation-runner.mjs` | Legacy direct-provider calibration and selection diagnostics with configured branches (`--branch judge`, `--branch default`, `--branch stress`). |
| `results/` | Ignored local historical outputs, not automatically part of tracked evidence or a new migration commit. |

## Model Tiers & Roles

The runner records three configured model branches. These strings and role labels are not a fresh provider-availability check, a comparative quality finding, or proof of independent judging:

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
