# Committing-to-git recovery qualification

The [accepted plan](../plans/2026-09-21-committing-to-git-recovery.md) is implemented as a direct diagnostic-contract cutover across dispatch and all 15 command routes. The [producer inventory](2026-09-21-committing-to-git-diagnostic-inventory.md) records ownership and controlled consumers. There are no compatibility adapters; persisted transaction version 4 and semantic content version 3 remain unchanged.

Implementation, deterministic verification, ordinary/security review and bounded independent R2 static assurance are complete. The candidate is ready for controlled adoption under the accepted single-host threshold, with native POSIX execution explicitly unobserved. Repository commits/publication and HISEW dependency-pin updates are authorized delivery steps; this record does not claim those effects already occurred.

## Frozen candidate and evidence

Evidence is retained locally under `C:/Users/maksy/.codex/task-evidence/agent-skills-issue-3-20260921/`. Native HISEW and security evidence also retain their original stores. These local records have not been published with the source.

| Item | Identity |
| --- | --- |
| Base revision | `c278b72587a4deaec9a6c7e0c538fa5f640d681f` |
| Final package | `committing-to-git-0.1.0-dev.g1570fc9854432271-antigravity-desktop.zip` |
| Archive SHA-256 | `0226905fca4de698a555280c27b24d607c9d0005f24e759708ceed1ed096ed3f` |
| Packaged helper SHA-256 | `7f582db20da5d6ccf5342b8e9eed361578b6122ccb6ce2e602fa7db9fcb36396` |
| Final implementation manifest | `review-final-manifest.json`, SHA-256 `2d7a32d066eb92a2d2ed6b8be0a927451f0d85ba2d29ea45056538d0d2efd73f` |
| HISEW execution | `9ab9a2ba-27b2-4838-89af-a7dc2a4fb131`, R2, generation 1 |
| Passing full verification run | `bfde790c-fe40-4760-ae4c-16b5fd2d3486` |

The final manifest covers 68 implementation, test, generated and inventory files. This subsequent qualification record is outside that frozen implementation manifest. The final review used a plain clone at `C:/Users/maksy/.codex/review-issue3-final`; all 68 file hashes matched. Archives were extracted outside a Git checkout with the platform archive tool.

## Verification and public behavior

The native HISEW full profile executed `npm run verify`: 1,022 tests, 1,016 passed, zero failed, six platform-specific skips. Formatting, lint, generated-artifact freshness, canonical skill validation, skill lint and `git diff --check HEAD` passed. The retained command output SHA-256 is `69e3e5f2b38e142614b668abc02c46c6c51070eff1e6d0feb62e6235b1b6aa09`. An earlier full run failed one stale help-syntax expectation; the test was corrected to check the separate accepted options and their mutual exclusion before this passing run.

Supervised public-only trials retain argv, working directories, streams, exits, simulated fixture decisions and final Git observations. They use Windows 11, Node 24.21.0, Git 2.55.0.windows.5 and Codex's GPT-6 family; the exact serving model build was not exposed. No trial read product implementation or opaque transaction journals.

| Evidence | Observed result |
| --- | --- |
| Baseline fresh agent | All four original endpoints passed. Lineage shape required indirect discovery, and multiline rejection lacked the direct input path. This is not evidence of four initially failing endpoints. |
| `candidate-1/public-trial` | Fresh agent passed all four journeys, unknown-mutation recovery, and terminal/internal failure observations. Zero source inspection, opaque-journal inspection or coaching requests. |
| `candidate-2/public-trial` | Another fresh agent passed all four journeys, same-OID advisory verification and terminal rejection. Unknown-mutation fixture setup was blocked by DCG before the process launched; it is not a passing result. |
| `candidate-3/public-trial` | Final-package repeat qualification passed all four journeys, same-OID verification, terminal rejection and interrupted-mutation recovery. Unknown outcome remained exit 4 until explicit fixture process termination was confirmed; recovery then observed `COMMIT_NOT_CREATED`, exit 1, unchanged HEAD and no retry. |
| Case 5, candidate 2 | `message-ready` in three helper calls, no commit or staging calls, unchanged index/HEAD and unrelated lockfiles. The message addressed ESM configuration loading. |
| Trigger classification, candidate 2 | All 22 supplied classifications matched the retained expected labels. This establishes classification only, not automatic host routing. |

Candidate 3 reused the candidate-2 agent and fixture harness with fresh repositories and outputs. It is final-package regression qualification, not another independent fresh-agent discovery. The candidate-2 setup denial was addressed with literal fixture-local Node file operations, without shell redirection or disabling controls. Missing additional-host trials are non-blocking under the accepted plan. Native POSIX execution remains unobserved: WSL and Docker were unavailable locally; Windows skips are not POSIX passes.

## Review findings and repairs

OpenAI's installed Review Agent inspected the frozen complete change and ran 84 focused tests. Five actionable findings were accepted:

| Finding | Repair and independent oracle |
| --- | --- |
| Promotion recovery requirements were placed in details and lost from common state. | Domain errors now supply `state.recoveryRequired`; pending promotion is observed as recovery-required. The ambiguous-index regression checks the public result and unchanged real index. |
| More than 31 failed receipts exceeded the recovery-input limit. | Use two constant required inputs, at most 32 exact receipt IDs, missing/omitted counts, and explicit approved-acknowledgement continuation. The 33-receipt test proves both bounded pages remain blocked without creating a commit. |
| Journal failure after a retained commit OID incorrectly returned unknown outcome. | Preserve created state, exact OID, exit 3 and recovery requirement. Fault injection makes the journal unavailable after observing the OID and verifies exactly one commit launch. |
| An exhausted remaining selector became an internal exception. | Both selection and evidence-plan paths now return `EMPTY_SELECTION`, exit 2. |
| The narrative bullet example lost its literal spaces. | Canonical and generated references contain exactly two spaces, hyphen and space. |

The author reproduced the selector, known-OID and large-receipt failures before correcting their implementations. The promotion finding was corroborated by source tracing and an executable post-fix regression. A bounded reviewer follow-up verified all five repairs, the exact manifest, four focused regression tests and two build/freshness tests: six passed, none skipped, no remaining findings. It did not repeat unrelated review. Cited files and test names were checked against the frozen target; no schema identifiers were invented.

Native Codex Security scan `9f6b1935-685f-44a2-b261-b029755f70cd` completed on the earlier frozen review target with no findings or deferred candidates. Coverage accounted for all 38 native source-like entries and all 68 changed/untracked files; 11 diagnostic boundary tests passed and bundle regeneration matched. Its helper identity was `5f8f120c867fb92241856dd8bf5c2e84c7c2ccc86dac7927f52210e044c9f8fc`. The final five correctness repairs received bounded ordinary review; this record does not mislabel the earlier security scan as a scan of later bytes. Those repairs change result classification, bounded approval reporting and examples, without introducing a new execution or trust boundary.

## Remaining acceptance and resource disposition

HISEW's R2 independent-verifier procedure requires another vendor's headless CLI on the frozen clone. Claude Code 2.1.272 failed before model execution with an expired OAuth session. Antigravity CLI 1.2.7 was already authenticated; explicitly adding the frozen directory with `--add-dir` resolved its initial read-access gap without persistent permission changes. An attempted terminal action still required unavailable escalation and returned an empty report. Neither failed attempt counts as verification.

Antigravity's static-only route then completed with Gemini 3.8 Flash (High), independently identified through the CLI's `/model` command. The first report was rejected for invented function names, incorrect limits and unsupported completeness claims. A fresh corrected assignment produced `antigravity-corrected-review.json`, conversation `3a2c39c1-ee2c-4de1-a981-b7f7efab4bf5`. Its eleven requirement rows cite actual source/test identities. The parent checked the excerpts; two Markdown snippets double-escape literal newline tokens, a retained transcription limitation. All other quoted sequences match after indentation normalization. All 68 frozen file hashes also matched the author's checkout. The retained admission record distinguishes this parent check from reviewer observations.

The corrected report is accepted as bounded static independent assurance under HISEW's permitted sandboxed read-and-reason option. It ran no commands or tests. Its observations confirm existing caller-authorization and local-filesystem trust boundaries, unobserved POSIX execution, and the disclosed repeated final trial; no new implementation defect was demonstrated. Its suggestion that multiple vendors are needed for behavioral acceptance is rejected against the user's explicit single-host threshold. The earlier fabricated report remains rejected, not silently replaced or counted as a pass.

Diagnostic contract version 2 is frozen after the complete migration and qualification, without compatibility shims. Delivery creates the preauthorized signed scoped commit, publishes its exact OID, and updates HISEW's two committing-to-git marketplace pins to that published revision. Adoption can be held by retaining the prior exact pin; any discovered diagnostic defect requires a scoped forward fix and affected qualification. Existing user-owned HISEW pin edits remain preserved until that authorized replacement is ready.

Retain the baseline, all three candidate archives/trials, both complete review clones, the failed long-path clone, native check/security records and all failed/rejected/corrected verifier outputs through publication and consumer adoption. They support review and interruption evidence. Fixtures contain only disposable signing identities. At this record's creation no real repository commit, push, user-file cleanup or HISEW pin edit had occurred; actual delivery effects belong to subsequent Git/native receipts. The task owner should reassess retention after publication and consumer adoption; no deletion is authorized by this record.
