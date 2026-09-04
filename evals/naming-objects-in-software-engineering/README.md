# Evaluating `naming-objects-in-software-engineering`

This maintainer-only suite evaluates the deployable skill at `skills/naming-objects-in-software-engineering/`.

## Surfaces

| File | Purpose |
| --- | --- |
| `evals.json` | Twelve behavioral cases testing conceptual discrimination, verb precision, language profiles, and policy precedence. |
| `trigger-evals.json` | Twenty-four balanced activation and near-miss prompts. |
| `evaluation-runner.mjs` | Automated test and calibration runner utilizing Google-accessible models (`gemini-3.8-flash-low`). |
| `results/` | Retained evaluation runs and terminal evidence. |

## Calibration Cases

Cases 1, 2, 4, and 6 serve as the primary calibration set:
- **Case 1**: Vague-Token Elimination (`process_data` -> precise entity/action/representation)
- **Case 2**: Verb Taxonomy & I/O Boundary (`get` vs `fetch` vs `calculate`)
- **Case 4**: Go Idiomatic Package & Getters (`account`, getter without `Get`, initialisms)
- **Case 6**: Database Physical Schema (`customer_account` table, `is_email_verified`, `created_at_epoch_ms`)
