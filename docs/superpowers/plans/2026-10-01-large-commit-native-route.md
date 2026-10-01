# Large Commit Native Route Implementation Plan

> **For agentic workers:** Execute the accepted steps inline using the installed HISEW implementation procedure. Independent review follows the frozen candidate.

**Goal:** Complete issue #10 without losing scope, message coverage, signing or recovery when recorded snapshots exceed 8 MiB.

**Architecture:** Separate internal snapshot capacity from caller message limits. Expose native execution through the existing journaled commit operation, automatically selecting it for oversized snapshots, with an explicit `--execution native` selector. Use the same verification and recovery implementation so native execution retains helper receipts.

**Tech Stack:** Existing Node.js filesystem APIs, Git, SSH signing and node:test. No dependencies or configuration changes.

**Spec:** Issue #10 and the native-route design approved in this chat on 2026-10-01; protected HISEW snapshot `91529b96-937e-4c3f-91e5-f7736eaee69f`.

## Global Constraints

- Preserve the pre-existing skills-lock.json change.
- Preserve exact inventory, staged hunks, exclusions, evidence, canonical message bytes and signature policy.
- Keep message input limits unchanged; bound internal snapshots independently at 64 MiB.
- Refuse oversized snapshots before index installation and evidence preparation; preserve existing transaction state on reader failures.
- Never retry a pending or uncertain commit automatically, bypass hooks or treat capacity as permission.
- No repository commit, push, configuration change or installation refresh is authorized.

## Task 1: Reproduce the failing consumer journey

Files: `tests/committing-to-git/native-snapshot.test.mjs`.

- [ ] Create a realistic staged inventory, assert `statSync(snapshot.path).size > 8 * 1024 * 1024`, and finalize complete bulk content.
- [ ] Run `node --test tests/committing-to-git/native-snapshot.test.mjs`; retain the actual snapshot-capacity failure.
- [ ] Verify signed commit, parent/tree/message equality, complete inventory, excluded changes, partial staging and a single commit after recovery.

## Task 2: Bounded snapshot access and native execution

Files: `snapshot/recordedSnapshot.js`, `snapshot/createSnapshot.js`, snapshot consumers in `workflow/`, `message/canonicalMessageState.js`, and CLI argument/help sources under `src/committing-to-git/`.

Interfaces: `readRecordedSnapshotFile(transactionPath)` returns the stable transaction-owned bytes; `snapshotExecution(byteCount)` returns a bounded native route description; `assertSnapshotCapacity(byteCount)` rejects unsupported capacity.

- [ ] Introduce a separate 64 MiB internal snapshot budget and snapshot-specific actionable diagnostics.
- [ ] Bound descriptor reads even if a file grows while open; retain identity, digest and anchor checks.
- [ ] Select the native route before evidence work; use the existing signed Git executor and recovery journal for `workflow commit --execution native`.
- [ ] Run the focused regression and affected message, promotion, check, commit and recovery tests.

## Task 3: Documentation and final assurance

Files: canonical `skills/committing-to-git/SKILL.md`, its native-route reference, generated helper/plugin copies, this plan.

- [ ] Document capacity selection, unchanged authority, complete bulk coverage and unknown-outcome recovery. Keep canonical SKILL.md ASCII-only.
- [ ] Build with `npm run build`, inspect the complete diff and preserve unrelated changes.
- [ ] Run `npm run verify` through the configured HISEW full profile and obtain required independent review/verification of the frozen candidate.
- [ ] Record actual results and any unavailable assurance without claiming publication.
