# Assurance Case: `committing-to-git` Skill

Date: 2026-08-22

Status: PASS

## 1. Assurance claim

The revised `committing-to-git` skill is fit for installation as an opinionated, safety-first workflow for drafting commit messages, creating a new signed root or ordinary one-parent commit from an approved Git index tree, reporting whether the resulting commit matches that approval, and optionally publishing the exact resulting commit.

This is a bounded assurance argument, not a mathematical proof that every present or future agent will behave correctly. The claim is supported by:

1. traceability from primary-source requirements and documented local policy to the public instructions;
2. deterministic helper behavior and artifact schemas for mechanically decidable rules;
3. regression and integration tests for known failure modes;
4. fresh-context adversarial reviews of the instructions; and
5. explicit disclosure of judgment-dependent requirements and residual limitations.

The claim does not extend to amend/fixup/squash/merge commits, active merge/rebase/cherry-pick/revert continuation, empty commits, history rewriting, automatic rollback, arbitrary repository-specific message grammars, or an agent that deliberately ignores the documented workflow.

## 2. Meaning of "best practice"

The phrase is used in four distinct senses. Keeping them separate prevents local product choices from being misrepresented as universal Git rules.

| Evidence class | Meaning in this assurance case | Examples |
| --- | --- | --- |
| Normative or authoritative | Directly supported by a current specification or official documentation | Agent Skills metadata and progressive disclosure; Git index, path, signature, and refspec behavior |
| Engineering inference | A design derived from authoritative primitives and tested against stated risks | Temporary-index preparation before real-index installation; write-ahead publication journal |
| Local product policy | A deliberate review-interface decision that Git does not require | Type whitelist, capitalized subject description, `File Changes:`, numbering, 50-file bulk threshold |
| Agent judgment | A semantic decision that cannot be proven from syntax alone | Imperative mood, truthful WHY, coherent domain boundaries, actual artifact reading |

The skill now labels this enforcement boundary directly. It does not call its local numbering or message-body format "Git best practice."

## 3. Primary-source basis

### 3.1 Agent Skill design

The [Agent Skills specification](https://agentskills.io/specification) requires a `name` and a description explaining what the skill does and when to use it. It recommends progressive disclosure, an instruction body below approximately 5,000 tokens, a main file below 500 lines, focused references, and helpful self-contained scripts.

Anthropic's [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) reinforce WHAT-plus-WHEN descriptions, clear workflows, one-level references, concrete examples, explicit error handling, verification feedback loops, and at least three evaluations.

OpenAI's current [model guidance](https://developers.openai.com/api/docs/guides/latest-model) recommends lean prompts, stating each instruction once, preserving examples only when they encode a product requirement or measured gap, defining approval boundaries, and validating changes on representative tasks.

Applied result:

- The frontmatter says what the skill does, when to use it, and which history-changing operations are excluded.
- The main file is a numbered transaction state machine.
- Detailed message policy, signature semantics, and publication recovery are one-level, conditionally loaded references.
- The canonical main file is 278 lines, 2,673 whitespace-delimited words, and 19,918 bytes. The repository skill linter does not emit its approximately-5,000-token warning.
- Thirty-three scenario evaluations are present, exceeding the three-evaluation minimum.
- Every CLI subcommand now documents purpose, effects or read-only behavior, outputs, and exit semantics.

### 3.2 Git index and path behavior

The official [`git add` documentation](https://git-scm.com/docs/git-add) defines the index as the staging area, documents `--pathspec-from-file`, and states that `--pathspec-file-nul` makes all non-NUL characters literal. The official [`git diff` documentation](https://git-scm.com/docs/git-diff) documents cached index-to-tree comparisons, NUL-terminated raw/name/numstat output, machine-readable numstat, rename/copy forms, extended mode/type summaries, and upper- or lowercase `--diff-filter` selection and exclusion. The [diff-options documentation](https://git-scm.com/docs/diff-options) states that binary numstat uses `-`/`-`, not fabricated zero line counts. The official [`git cat-file` documentation](https://git-scm.com/docs/git-cat-file) defines object-type checking and exact object-content output. Git's [`GIT_NO_LAZY_FETCH` documentation](https://git-scm.com/docs/git#Documentation/git.txt-codeGITNOLAZYFETCHcode) states that the setting prevents on-demand retrieval of missing objects from a promisor remote. The official [`gitdiffcore` documentation](https://git-scm.com/docs/gitdiffcore) explains that copy detection is a transformation which pairs an added file with another file when content similarity exceeds a threshold; it is not recorded authorship or editing provenance.

The official [`git write-tree` documentation](https://git-scm.com/docs/git-write-tree) defines that plumbing command as creating tree objects from the current index. Git's [upstream cache-tree implementation](https://github.com/git/git/blob/master/cache-tree.c) acquires an index lock when it needs to update cached tree data. OpenAI's [sandbox documentation](https://learn.chatgpt.com/docs/sandboxing) states that spawned Git processes inherit the host sandbox and that scoped approval is the control for crossing a declared boundary. Its [command-rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules) supports exact argument-prefix decisions, which is evidence for narrow exceptions rather than broad Git or shell elevation.

Applied result:

- Path scopes use global `--literal-pathspecs` with NUL-delimited standard input.
- Tests cover a leading-dash filename containing pathspec metacharacters beside a similar sibling.
- Additions, renames, mode changes, symlinks, type changes, submodule gitlinks, and binary statistics are normalized explicitly.
- Required patch generation excludes only `D` change units and keeps every deletion in the exhaustive inventory with its full old object ID, old mode, path, and available line count. Modified-to-empty paths remain required patch content because they are retained modifications, not whole-file deletions.
- A content-level deletion review reads only the full old blob ID recorded in the manifest, with replacement objects and lazy fetching disabled, and appends bounded hash-addressed units to the same ledger. It never resolves a mutable `HEAD:<path>` expression, never silently fetches a missing promisor object, and leaves rendering blocked until the appended units are acknowledged.
- Authoritative facts do not enable copy detection: a similar destination whose possible source remains is an addition, its complete new-file patch is inspected, and any known "adapted from" lineage is stated only as grounded semantic rationale.
- Actual `full` and `paths` prepare a complete tree in a temporary index, write the snapshot, recheck repository state, and only then install the tree into the real index.
- A regression test proves an output failure leaves real-index entries and the staged tree unchanged.
- Snapshot creation is classified as repository-metadata-writing in every mode because a temporary index does not redirect the object database. A declared read-only `.git` boundary therefore triggers scoped execution on the first attempt rather than a deliberate failed probe.
- Inspection preparation and precommit snapshot verification compare the current index directly with the manifest tree by using cached `git diff` with optional locks disabled. Git Trace2 integration tests prove that neither command invokes `git write-tree` for a matching snapshot and that verification also avoids it for drift; type regressions reject a commit OID where a literal tree object is required. These tests establish the invoked-command contract, not an operating-system proof against every possible metadata write.
- Execution elevation is explicitly separated from scope, staging, exact-message, commit, verification-policy, and publication authorization. Permission denial and a live `index.lock` collision have different recovery branches.

### 3.3 Commit-message content

Git's current [SubmittingPatches guidance](https://git-scm.com/docs/SubmittingPatches) recommends a short first line, no final period, imperative mood, and a body that explains the problem, why the solution is better, and relevant rejected alternatives. It explicitly says the goal is to convey WHY for future developers.

The [Conventional Commits 1.0.0 specification](https://www.conventionalcommits.org/en/v1.0.0/) defines `type`, optional scope, description, optional body, and optional footers. It permits types beyond `feat` and `fix`; it does not mandate this skill's whitelist, capitalization rule, numbered inventory, or footer omission.

Applied result:

- WHY-first rationale is authoritative in spirit and is made operational with five accepted rationale categories.
- The subject target of about 50 characters, imperative phrasing, and no final period follow official Git project guidance.
- Capitalization, the exact eight-type whitelist, the 72-character maximum, section order, numbered file inventory, right alignment, and 50-unit bulk threshold are explicitly disclosed local product policies.
- Git's own project guidance prefers lowercase after its `area:` prefix, demonstrating why this skill must not claim its capitalization choice as universal Git practice.
- Incompatible repository requirements such as mandatory `chore` or `Reviewed-by:` stop the workflow before staging; the skill does not silently substitute or bypass policy.

### 3.4 Signing and verification

The official [`git commit` documentation](https://git-scm.com/docs/git-commit) defines `-S` signing and file-backed commit messages. The official [`git verify-commit` documentation](https://git-scm.com/docs/git-verify-commit) states that it validates signatures created by `git commit -S` and that `--raw` emits backend status output.

The official [`git config` documentation](https://git-scm.com/docs/git-config) distinguishes OpenPGP trust levels from SSH verification. It states that `gpg.ssh.allowedSignersFile` maps principals to accepted public keys and that SSH verification fails when the key is not in that file. It also documents `gpg.minTrustLevel`, showing that a generic OpenPGP exit-zero result must not be described as independent identity authorization unless policy adds that requirement.

Applied result:

- Every workflow-created commit uses `git commit -S`; an unsigned retry is forbidden.
- Signing, cryptographic verification, and identity authorization are explained as different facts.
- SSH allowed-signers access has one narrow remediation path and a user-overridable required/advisory/skipped policy.
- OpenPGP reports Git's UID and full `VALIDSIG` primary fingerprint but explicitly does not claim an independently enforced ownertrust level or signer allowlist.
- `verification.json` records the full commit OID, and report creation rejects cross-commit reuse.
- A policy change after an earlier run requires a replacement artifact for the same OID.

### 3.5 Publication

The official [`git push` documentation](https://git-scm.com/docs/git-push) defines `<src>:<dst>` refspecs, makes the optional leading `+` equivalent to force, describes branch fast-forward safety, and defines `--porcelain` as machine-readable full-ref output.

Applied result:

- The helper accepts only a full 40- or 64-hex commit OID, a configured remote name, and a full `refs/heads/...` destination.
- It uses exactly `<oid>:<destination>`, omits force and set-upstream behavior, and records stdout, stderr, and exit code.
- "Exact" is defined as the destination tip, not a false claim that Git transfers only one object.
- A `.pending` write-ahead journal is created before the network mutation. Invalid or pre-existing output paths are rejected before Git runs.
- A post-invocation local artifact failure is reported as unknown remote outcome, never as proof of failure; recovery uses exact remote observation and never automatic retry.

## 4. Local policy register

These decisions are intentional and testable, but are not universal Git requirements:

| Policy | Decision | Reason | Mechanical enforcement |
| --- | --- | --- | --- |
| Subject grammar | Eight allowed types; optional scope; capitalized imperative description; about 50 target; 72 maximum; no period | Stable, readable cross-repository interface | Type, syntax, initial capitalization, maximum, and period are enforced; imperative semantics are agent-reviewed |
| Body structure | Optional `Rationale:`, optional `User Experience Changes:`, required `File Changes:` | Separates shared motivation, user-visible effect, and change navigation | Renderer owns structure and wrapping |
| Detailed numbering | Number every change unit for 1-49 units | Supports count-at-a-glance and place-keeping among similar paths | Renderer binary-sorts paths, right-aligns to widest ordinal, and derives nested indentation |
| No heading total | Keep heading exactly `File Changes:` | Avoids duplicating the visible numbered count | Renderer-enforced |
| Bulk threshold | Switch at 50 change units | Prevents hundreds or thousands of narrated entries while preserving full scope | Scaffold selects mode from manifest count |
| Bulk domains | Counted semantic domains, no `Other`, directory-only, alphabetical, or fixed-size buckets | Preserves reviewer comprehension by reason rather than storage layout | ID coverage/counts enforced; semantic coherence agent-reviewed |
| Copy similarity | Treat a new destination with a retained similar source as an addition; put known lineage only in grounded rationale | Similarity is useful for comparison but does not establish provenance | Copy detection is disabled for authoritative facts; schema, snapshot, inspection, renderer, report, and behavior regressions enforce the boundary |
| Whole-file deletion bodies | Require structured deletion facts, but materialize an exact historical body only when rationale, effect, risk, or an explicit audit requires it | Repeated `-` lines reproduce old blobs and can dominate large reviews without adding evidence for a grounded bulk migration rationale | Lowercase `--diff-filter=d` omits only `D` bodies; manifest facts remain inventoried; exact old-blob expansion appends pending units to ledger schema v2 |
| Signed creation | All commits created by the workflow use `-S` | Stable product guarantee for created commits | Agent command/order requirement; report independently detects signature presence |
| Verification policy | Required by default; user may choose advisory or skipped at any point | High-assurance default without overriding user authority | Artifact and report schema enforce selected policy; agent enforces pre-push gate |

No authoritative Git source mandates or forbids numbering changed files in a custom commit body. The defensible claim is therefore not that experienced Git users never number files; it is that numbering is a local navigation aid whose deterministic behavior is disclosed and tested.

## 5. Claim-to-evidence traceability

| Claim ID | Claim | Instruction evidence | Executable/test evidence |
| --- | --- | --- | --- |
| C1 | Drafting never changes staged entries or the staged tree | Mode/scope table distinguishes staged cache updates from temporary-index scopes | Draft temporary-index integration tests and exact staged-scope implementation disclosure |
| C2 | Actual scope is fixed before approval without partial staging on helper failure | Transactional actual-mode description | Temporary preparation index; output-failure regression; index-tree comparisons |
| C3 | Paths are exact and hostile names cannot broaden scope | `scope.json` and literal NUL rules | Leading-dash/metacharacter sibling test |
| C4 | Active operations and conflicts cannot enter ordinary-commit flow | Snapshot rejection and unsupported transaction text | Merge, rebase, cherry-pick, revert, sequencer, and conflict checks |
| C5 | Large diffs are fully inspectable without one truncated response | Bounded deletion-aware ledger workflow | 200-line/16-KiB chunking, UTF-8 boundary, exact required-patch reconstruction, and 1,000-unit inventory tests |
| C6 | Every normalized tree change is counted consistently | Change-unit definition | Retained-source addition, rename, binary, mode, symlink, type, and submodule tests in snapshot and final report |
| C7 | Message mechanics cannot drift through hand formatting | Scaffold/render/manifest-backed validation | Canonical renderer, schemas, duplicate/omission/order/placeholder tests |
| C8 | Message meaning contributes information absent from the diff | Message-format reference | Explicit agent-review boundary; concrete warning-driven example; semantic eval assertions |
| C9 | Approval binds the exact message and repository state | Authorization, validation, and precommit verify gates | HEAD/tree/root/operation drift checks; fresh-attempt rule |
| C10 | Hooks cannot silently invalidate the approval claim | Enforcement boundary and post-commit report | Exact parent count/OID, tree, and message comparisons; merge rejection test |
| C11 | Signature evidence belongs to the reported commit | Signature policy and OID statement | Full-OID verification artifact schema and cross-commit report rejection |
| C12 | SSH and OpenPGP claims do not exceed backend evidence | Signature reference | SSH signer/fingerprint, unreadable allowed-signers, OpenPGP primary-fingerprint, and report-wording tests |
| C13 | Checks and post-commit state are reported without invention | Checks/report section | Exact check vocabulary/schema, actual commit facts, binary stats, workspace porcelain tests |
| C14 | Publication targets one explicit branch tip without force | Push section | Full-OID/full-ref validation and local bare-remote integration tests |
| C15 | Publication artifact failure cannot be mistaken for remote failure | Publication recovery reference | Preflight output test and `.pending` write-ahead journal |
| C16 | Missing historical artifacts cannot be silently reconstructed | Reduced-assurance recovery branch | Exact source/destination rules and fresh-agent scenario evaluation |
| C17 | Content similarity cannot be presented as known copy provenance | Change-unit definition and message-format reference | Schema v2, complete added-file inspection, destination-only rendering, report-count regressions, legacy-manifest compatibility, and KRSS2 behavior evaluation |
| C18 | A declared read-only `.git` boundary is handled without a known-doomed probe or authorization expansion | Execution-permissions section and conditional reference | Trace2 no-`write-tree` regressions for post-snapshot checks and behavior evaluations 28-31 |
| C19 | Whole-file deletions retain mandatory mechanical coverage without forcing review of every historical line, while consequential ambiguity can reopen the ledger with exact old-blob content | Change-inspection section and conditional reference | Mixed deletion/retained-change reconstruction, modified-to-empty, exact expansion, duplicate, non-blob, binary, and gitlink boundary tests; behavior evaluations 32-33 |

## 6. Ambiguity and misuse analysis

| Hypothesized confusion | Resolution now present |
| --- | --- |
| "Draft all changes" authorizes staging | Draft `full` and `paths` use a temporary index; authorization text says drafts do not authorize staging or commit |
| Actual `paths` may merge with an unrelated staged subset | The helper rejects any pre-existing staged change for actual `paths` |
| A staged rename should be restaged using its vanished source | Staged rename uses `staged`; only an unstaged path scope names both vanished source and destination |
| `-literal[1].txt` is an option or glob | Global literal pathspec mode plus NUL input; regression excludes the similar sibling |
| A file with staged and unstaged hunks can be safely handled by whole-path scope | The skill requires an intentional index and `staged` scope |
| A huge diff may be sampled or silently truncated | Exhaustive bounded inventory, required patch, metadata, and any requested deletion-expansion units must all be read and hash-acknowledged |
| Every `-` line of every deleted file must be read to prove inspection completeness | The inventory makes path, status, old object, mode, and statistics mandatory; whole-file bodies are summarized unless meaning or risk requires exact expansion |
| A deleted filename is enough to explain why removal is safe | Filename inference is forbidden; expand the recorded old blob when its content may resolve consequential ambiguity, then ask the user if the reason remains unknown |
| A file changed to empty is equivalent to a whole-file deletion | Only a tree transition to an absent path is summarized; a retained empty file remains in the required patch |
| Binary `0/0` means no content changed | Binary line counts are unavailable, not zero, and metadata cannot prove unseen content |
| A rename counts as two files | It is one change unit with source and destination |
| Git reports `C80`, so the destination is known to have been copied or adapted from the source | Copy similarity is not provenance; authoritative facts treat a retained-source destination as an addition, while user- or repository-grounded lineage belongs in semantic rationale |
| A 1,000-file commit requires 1,000 prose entries or scope reduction | Bulk mode assigns all IDs to counted semantic domains; scope reduction is forbidden |
| Attempt artifacts can be placed inside the repository | Absolute out-of-worktree location is mandatory; helper cleanup is explicitly absent |
| Snapshot output failure may leave helper-created staging behind | Actual `full`/`paths` prepare elsewhere and install only after successful snapshot creation/state recheck |
| An absent `snapshot.json` means the same attempt is safe to retry | Recovery also checks fixed `temporary-index` and `preparation-index` intermediates; either occupied file forces preservation and a fresh UUID attempt |
| Exit-zero validation means no review remains | JSON `manualReviewRequired` and all review issues must still be read |
| "Immutable manifest" means tamper-evident evidence | Term replaced with manifest-backed; artifacts are explicitly described as mutable workflow records |
| Approval remains valid after `HEAD` moves | Precommit verification rejects identity drift even when the index tree is unchanged |
| A hook-altered commit can be amended automatically | Mismatch is preserved and reported; no amend/reset/replace is permitted |
| OpenPGP `GOODSIG` proves an independently authorized identity | Report uses the primary `VALIDSIG` fingerprint and explicitly limits the identity claim |
| Unreadable SSH trust data means an invalid signature | It is the narrow `unavailable` state; required policy may be overridden without pressure |
| Changing to advisory can reuse a stale required-policy artifact | Verification must rerun for the same OID and replace the artifact |
| A verification artifact can be reused for another commit | The artifact records the OID and report validation rejects a mismatch |
| Initial commit-and-push authorization requires a redundant second push prompt | One request may authorize both; only target ambiguity triggers another question |
| Push exit `2` proves nothing reached the remote | `.pending` means unknown outcome and invokes a defined read-only recovery procedure |
| A later "push it" request permits guessing current `HEAD` | `HEAD` is allowed only when explicitly selected; otherwise the source must be clarified |
| Repository policy requiring `chore` or a trailer can be approximated | The skill stops before staging because its renderer cannot satisfy that contract |
| `git write-tree` is read-only because it prints an object ID | It can create tree objects and update cache-tree data under `index.lock`; snapshot creation is classified as metadata-writing |
| `Permission denied` proves that a stale `index.lock` exists | The permission branch forbids deletion and uses scoped execution only after checking target occupancy and state |
| An existing lock plus a confirmed Git process can be solved with broader permission | The concurrency branch preserves the lock and serializes same-worktree mutation |
| Tool-level elevation also authorizes staging, commit creation, or push | Execution capability and workflow authorization remain independent gates |

## 7. Size and human-readability assessment

The pre-audit main file contained 307 lines, approximately 2,081 whitespace-delimited words, and 15,060 bytes. During hardening it temporarily exceeded the recommended token budget. The release candidate uses progressive disclosure:

| File | Role | Load condition |
| --- | --- | --- |
| `SKILL.md` | Public contract and complete transaction state machine | On skill activation |
| `references/change-inspection.md` | Mandatory deletion facts, historical-content decision rule, and exact-blob expansion | When inspection reports summarized deletions, binary changes, or submodules |
| `references/execution-permissions.md` | Host boundary, command capability, lock classification, and safe retry | Before snapshot creation in a restricted host or after a permission/lock error |
| `references/message-format.md` | Subject, WHY, detailed numbering, and bulk-domain policy | Before semantic message authoring |
| `references/signature-verification.md` | Backend-specific signing, trust, and policy semantics | After an actual commit, before verification |
| `references/publication-recovery.md` | Standard exact publication plus unknown-outcome and missing-artifact recovery | Before any publication or later incomplete push |
| `references/transaction-artifacts.md` | Attempt allocation, same-worktree serialization, artifact mutability, and retention | Before every snapshot attempt |

The main file is now 278 lines, below both the 500-line recommendation and the repository linter's estimated 5,000-token warning threshold. It is larger in bytes than the early draft because it states authorization, side effects, failure states, and enforcement limits that were previously absent; deletion expansion, host-specific error classification, transaction-artifact lifecycle, and optional publication recovery are progressively disclosed instead of being paid on every activation.

Human readability is supported by outcome-led headings, one ordered state machine, a single mode/scope table, local-policy disclosure before operational detail, concrete command forms, direct references, and no hard wrapping of semantic prose lines. The cost is that this is a transactional skill rather than a short style guide; removing the remaining state transitions would reintroduce material ambiguity.

## 8. Independent evaluation evidence

Five independent fresh-context reviews or behavior checks were used:

1. A behavior pressure test executed seven adversarial scenarios. It initially found ambiguity in advisory-policy transitions and standalone publication. After the text was revised, it returned no remaining material ambiguity.
2. A blind before/after comparator scored the revised safety-critical workflow materially higher, especially for state verification, exact-OID publication, bounded inspection, path safety, authorization, and reporting. It also identified density and a weakened semantic-rationale invariant; progressive disclosure and the stronger "must add" invariant addressed those findings.
3. A skeptical installer review initially failed the skill for overclaimed guarantees, unsafe attempt placement, staging-before-output failure, validation review semantics, OpenPGP identity wording, cross-commit verification provenance, publication unknown outcome, and sparse CLI help. Each material finding produced either an executable regression test, a code change, or an explicit enforcement-boundary disclosure. After a source/bundle alignment recheck, the reviewer returned a strict PASS with no material install-readiness blockers.
4. A fresh-context replay of the KRSS2 copy-similarity incident returned PASS with no material ambiguity. It selected destination-only addition headings, kept user-grounded adaptation in semantic rationale, reused the completed manifest and inspection ledger, rerendered and revalidated canonical output, and rejected restaging, reinspection, and direct editing of the generated message.
5. A paired `gpt-5.6-luna` low-reasoning smoke test exercised the declared read-only-`.git` boundary. Both arms avoided the explicitly known failed probe, so that isolated expectation was non-discriminating. The treatment scored 8/8 by using the canonical literal-path snapshot, bounded inspection, read-only precommit verification, and signed file-backed commit command; the no-skill control scored 6/8 after substituting direct `git add` and omitting canonical snapshot verification. After attempt and recovery detail moved into focused references, a second treatment remained 8/8 and explicitly applied both references. One control, two treatments, and primary-agent grading make this directional rather than conclusive evidence. Recovery and live-lock pressure cases 29-31 remain defined but unexecuted.

One additional real-workflow incident supplied the deletion-density regression: a 59-change-unit snapshot with 34 whole-file deletions produced 76 text chunks, largely so an agent could observe repeated `-` markers across 13,474 removed lines. That observation motivated cases 32-33 and the deterministic deletion-aware tests. It demonstrates the prior usability failure, not yet a measured with-skill model result; both behavioral cases remain explicitly unexecuted.

These reviews are qualitative evidence, not a substitute for deterministic tests. Their value is hypothesis generation: they exposed plausible interpretations that the original author and implementation tests had not considered.

## 9. Residual limitations

The following limits are intentional and remain visible to installers:

- No prompt can prove that an agent truly read an artifact; the helper proves only that the correct ID/hash was acknowledged.
- Imperative mood, factual rationale, outcome-before-mechanism ordering, and semantic domain coherence remain agent-reviewed judgments.
- Workflow records are mutable and are not signed or otherwise tamper-evident.
- The index is not locked for the whole approval interval; immediate precommit verification detects drift instead.
- Draft `full` and `paths` leave the real index untouched, but their temporary index does not isolate the object database and may add unreachable blobs or trees. Draft `staged` preserves staged entries and tree semantics but may lock the real index to update cache metadata.
- When a host does not declare its permission boundary, one unexpected permission failure may be unavoidable. The recovery contract prevents blind retry or authorization expansion but cannot predict an undisclosed boundary.
- Hooks can reject or alter a commit. The workflow reports the resulting mismatch and will not repair it automatically.
- Binary and submodule metadata do not expose unseen contents. Separate inspection is required when a rationale depends on those contents.
- Summarized whole-file deletion facts establish mechanical scope coverage, not semantic review of the old body. An agent that fails to expand a consequentially ambiguous deletion can still invent an unsupported rationale; the decision rule and behavior eval catch this only when followed and tested.
- Rename detection is a content-and-path comparison heuristic used for navigation; it does not prove which filesystem or Git command created the relationship.
- OpenPGP exit-zero verification establishes the backend result for the key/fingerprint Git reports; it does not independently establish real-world identity authorization.
- Remote state can change after `ls-remote`; unknown-outcome recovery is an observation, not a transaction log from the server.
- The helper publication command can be invoked out of order. Authorization and pre-push gates are workflow requirements enforced by the invoking agent, not by that standalone subcommand.
- The opinionated message grammar is deliberately incompatible with some repository policies; stopping is safer than pretending compatibility.
- Finite tests and current-model evaluations cannot prove behavior for every future Git version, platform, model, repository hook, or adversarial environment.

## 10. Verification record and disposition

Release disposition: PASS.

The following gates must all pass on the final source and rebuilt published bundle:

| Gate | Required result | Final result |
| --- | --- | --- |
| Focused committing workflow tests | All pass | 99/99 passed |
| Build and bundle drift check | Format, ESLint, ASCII, bundle generation/check pass | Passed |
| Repository skill validator | All canonical skills valid | Passed; 3 canonical skills validated |
| Repository skill lint | No `committing-to-git` size warning | Passed |
| Full repository tests | No failures | Passed; 218 tests, 217 passed, 1 conditionally skipped, 0 failed |
| Git whitespace check | No errors in authored diff | Passed |
| ASCII gate | Every canonical `skills/**/SKILL.md` contains only ASCII bytes | Passed through the build/validation gate and dedicated regression tests |
| Skeptical installer re-review | No material blocker | Strict PASS |

The complete `npm run verify` pipeline passed on the final source and rebuilt published bundle with the narrow filesystem permission needed to traverse installed build dependencies. Formatting, ESLint, ASCII validation, bundle drift, repository tests, canonical skill validation, skill lint, and Git whitespace checks all passed; `committing-to-git` emitted no size warning.

No commit or push was part of this assurance exercise.
