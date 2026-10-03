# Evaluation toolchain status

Observed locally on Windows x64, Node 24.21.0 and Python 3.14.7. Exact acquisition pins live in `evaluation-toolchain.json` and `package-lock.json`. This record separates integration from platform and behavioral acceptance.

| Surface | Observed result | Boundary |
| --- | --- | --- |
| skill-up 0.12.0 native custom engine | Literal fake-provider smoke and generated five-case EPUB projection pass native validation/execution | No semantic or real-provider judgment; no assurance from native report scores |
| agent-skills-eval 0.1.1 | Public loader and static target/judge consume generated portable cases in both modes | Baseline omits fixtures, binary EPUB bytes are skipped, assertion judging omits expected output |
| skills 1.7.0 | All four distributions install byte-exactly through explicit, default and full-depth discovery in a disposable checkout | Local Codex installation layout; no client activation experiment |
| skill-up to Hadden bridge | One normal native invocation executes two fake Antigravity turns and derives an artifact-checked outcome reference | Disposable test-only qualification override; does not qualify production containment |
| Windows assured bridge | Disabled after engine and grandchild heartbeats continued after abrupt consumer death | Task-owned processes were subsequently stopped and all three observed PIDs were absent on readback |
| Linux assured bridge | Disabled; archive and executable identity inspected, runtime not yet observed on Linux | CI conformance cannot establish the full process-failure matrix by itself |
| Network boundary | OTel disabled; credentials/config excluded from owned consumer environment; installer Node network APIs denied | No complete OS-level egress observation or isolation claim |
| Real models and host activation | Not run | Require their own prepared authority and observations |

`npm run eval:check` runs deterministic consumer and installation checks, including the explicitly fake transport fixture. It acquires no dependencies and selects no real model engine or judge. Preparation must install the locked packages and acquire the pinned native release first. The new CI workflow separates those acquisition steps from verification. Missing or mismatched tooling fails closed; a clean checkout without explicit preparation does not silently download it. The integrated verification gate supports Windows x64 and Linux x64 only; other platforms cannot claim this gate passed. Run `npm ci --ignore-scripts`, then `python -B scripts/set_up_evaluation_execution_tools.py` during explicit preparation. Existing authoring validators also retain their documented setup prerequisites.

The verification sequence settles whitespace, formatting, lint and structural/build checks before consumer experiments and the full test suite. This ordering avoids invalidating expensive evidence with mechanical repairs. The native carrier always uses `with_skill` for transport; that label is not the Hadden experimental arm. Consult the authoritative packet and permitted blinded mapping for treatment identity.

The wrapper records an exclusive invocation claim before starting the native process. A retained claim blocks retry even if no final consumer report exists. Reconcile Hadden evidence before preparing a fresh authorized attempt. Catchable bridge termination signals request shared-runtime cancellation, and the outer wrapper leaves additional cleanup time beyond the native case deadline. Neither mechanism establishes descendant containment under abrupt termination.

The native report may render omitted usage as zero. That is a consumer presentation default, not measured zero tokens or cost. Hadden outcome references omit unavailable usage, retain execution/failure/closure status, and remain ungraded. Only independently measured usage can support resource comparisons.

## License and notice inventory

The new packages are development and evaluation tools, excluded from all generated skill payloads and the Git plugin. Original upstream license files remain with the installed tools. Acquisition verifies the native release license alongside archive and executable hashes.

| Tool | Installed license | Retained license SHA-256 |
| --- | --- | --- |
| skill-up 0.12.0 | Apache-2.0 | `c417f515c774c00d0c6c8e6f84d3993c3e87c78e316fac6d03ea5606e20b683d` |
| agent-skills-eval 0.1.1 | MIT, Rishabh Mehan | `725b6ad1dda1cbc479d11053df393f3bf27c479c7aea1d5651538163aa0259ef` |
| skills 1.7.0 | MIT, Vercel | `661142e53c313d2bb5e1b055f5c0a39001450ff1b5e27b89dc4bc7de9a6352ca` |
| yaml 2.9.1 | ISC | `5bba27375d93e9119f76c1015f7672cf9ad5f70952296e0842fb2243d6376869` |
| ajv 8.20.0 | MIT | `a05350a88e318e4f5f2c2a1ff1e2e88daa4dd38e6e78b71cccae422bdc762cc3` |

The skills CLI's `ThirdPartyNoticeText.txt` is retained with SHA-256 `ad017718e485f2d634341e32e91c4e48feee89db01f04b17e4db6c4c912339a6`. The published Git plugin retains the repository license and its existing six dependency notices: cross-spawn, isexe, path-key, shebang-command, shebang-regex, and which. No new evaluation dependency is bundled into that runtime.

## Retained temporary resources

Acquired binaries remain under `.agent-tools/evaluation/skill-up-<version>-<platform>/` for deterministic verification. Acquisition failures and local review/check logs remain under `.agent-tools/evaluation/`. Pre-existing EPUB bytecode is preserved under `.agent-tools/evaluation/preexisting-runtime-cache/`, with its original/new paths and hashes also recorded in `evidence/migrations/2026-10-03-preexisting-runtime-cache.json`; it is not cleanup fodder.

Consumer conformance, installer and fake bridge experiments retain UUID temporary roots and receipts. Each receipt identifies its root and tested identity. Failed or uncertain execution evidence must be reconciled before removal. Closed test-only roots may be removed after the required evidence has been retained; no automatic cleanup touches pre-existing naming results, homes, credentials, or user artifacts.
