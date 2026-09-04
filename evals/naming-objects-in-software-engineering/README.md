# Evaluating `naming-objects-in-software-engineering`

This maintainer-only suite evaluates the deployable skill at `skills/naming-objects-in-software-engineering/`.

## Surfaces

| File | Purpose |
| --- | --- |
| `evals.json` | Eighteen behavioral cases testing conceptual discrimination, verb precision, web stacks, Python typing, PowerShell cmdlets, XSLT namespaces, and policy precedence. |
| `trigger-evals.json` | Thirty-two balanced activation and near-miss discrimination prompts. |
| `evaluation-runner.mjs` | Automated test and calibration runner utilizing Google-accessible models across three operational tiers (`--branch judge`, `--branch default`, `--branch stress`). |
| `results/` | Retained evaluation runs and terminal evidence. |

## Model Tiers & Roles

The evaluation suite is adapted across three distinct operational tiers:

- **High-Powered (The Judge)**: `gemini-3.1-pro-high` (`--branch judge` / `--branch high`)
  - Evaluates complex architectural edge cases, nuanced semantic trade-offs, and policy hierarchy resolution requiring deep reasoning.
- **Default (The Worker)**: `gemini-3.8-flash-medium` (`--branch default` / `--branch worker` / `--branch standard`)
  - The standard daily driver for maintainer verification, calibration runs, and multi-language test campaigns.
- **Low-Powered (The Stress Tester)**: `gemini-3.6-flash-low` (`--branch stress` / `--branch low`)
  - Rigorous stress testing on lightweight models to ensure negative constraints (e.g. anti-pattern rejection, vague-token elimination, avoiding forbidden prefixes) are strictly honored without regression.

## Calibration Cases

Cases 1, 2, 4, and 6 serve as the primary calibration set:
- **Case 1**: Vague-Token Elimination (`process_data` -> precise entity/action/representation)
- **Case 2**: Verb Taxonomy & I/O Boundary (`get` vs `fetch` vs `calculate`)
- **Case 4**: Go Idiomatic Package & Getters (`account`, getter without `Get`, initialisms)
- **Case 6**: Database Physical Schema (`customer_account` table, `is_email_verified`, `created_at_epoch_ms`)
