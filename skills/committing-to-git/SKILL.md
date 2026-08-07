---
name: committing-to-git
description: Draft, review, create, verify, and optionally push Git commits from the current local workspace. Use when asked to draft or revise a commit message or commit current uncommitted changes. Also use when pushing a commit created by this workflow.
category: development
allowed-tools: [run_command, write_to_file, view_file]
---

# Committing To Git

When asked to draft a commit message or commit current workspace changes, follow Sections 1–3. Execute Section 4 only when the user has explicitly requested creation of the commit. Execute `git push` only when the user has explicitly requested pushing. A request to push existing commits MUST NOT implicitly authorize staging or committing uncommitted workspace changes.

## 1. Pre-Commit Verification Workflow
1. **Mandatory Execution Order**: To inspect the complete set of current uncommitted changes, you MUST:
   1. Execute `git status --untracked-files=all`.
   2. Execute `git diff HEAD` to inspect all staged and unstaged changes to tracked files.
   3. Inspect the complete contents of every untracked text file reported by `git status`; inspect the type and relevant metadata of untracked binary files sufficiently to determine their purpose.

## 2. Commit Message Composition
1. **Strict Scope Enforcement**: Base the commit message's technical scope and file modifications EXCLUSIVELY on the current uncommitted changes identified by the Pre-Commit Verification Workflow.
   - DO NOT fabricate file changes or list features drawn from conversation history, memory of earlier edits, or past prompts.
   - YOU MAY use conversation history solely to explain the rationale or context behind the changes (the "why"), provided it strictly aligns with the verified uncommitted changes.
   - DO NOT list files, features, or fixes that are already committed in previous commits, even if they were part of the same task session.
   - DO NOT mention fixes for intermediate regressions or syntax errors introduced during your own uncommitted edits.
2. **Imperative Mood Throughout**: Use the imperative, present-tense mood for the subject description and all commit-message change descriptions and bullet points (e.g., "Fix", "Add", "Update", "Suppress" — NEVER "Fixed", "Added", "Updates", or "Suppressing").
3. **Body Line Wrapping**: Wrap body prose at 72 characters. Never hard-wrap file paths, URLs, command names, identifiers, or other indivisible tokens.
4. **Structure**:
   - Separate all sections with **exactly one blank line**.
   1. **Subject Line (Header)**:
      - Format: `<type>(<scope>): <description>` or `<type>: <description>`, where `<scope>` is optional (e.g., `fix(ui): Suppress long-press menu on UI controls`). `<type>` MUST be exactly one of `build`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, or `test`.
      - Length: Target **~50 characters**, and **NEVER exceed 72 characters**.
      - Formatting: Capitalize the first word after type/scope; do NOT end with a period (`.`).
   2. **User Experience Changes Section**:
      - Include this section only when the changes have an observable impact on the end user.
      - Format:
```
User Experience Changes:
  - <first change>
  - <second change>
  - <Nth change>
```
      - **Content Scope**: Strictly describe only changes that are observable by the end user.
      - Describe each user-visible outcome as an imperative change statement beginning with a base-form verb (e.g., "Enable", "Improve", "Prevent", "Reduce", etc.).
      - Avoid technical jargon, framework details (e.g. "Jest", "Node.js heap", "OOM"), or implementation specifics in this section. Frame it purely around what the end user perceives or experiences differently as a result of these changes (e.g. "Enable the visualisation of a new file type", "Improve rendering performance").
   3. **File Changes Section**:
      - Format:
```
File Changes:
  1. `<first changed file's file path>`
     - <distinct logical change and brief rationale>
     - <Nth distinct logical change and brief rationale>
  2. `<Nth changed file's file path>`
```
      - Include every changed file exactly once.
      - Order file paths **alphabetically** using relative workspace paths (e.g., `src/app/css/toolstyle.css`).

## 3. Commit Message Review
1. **Ask For Review**: Prompt the user to review the proposed commit message before proceeding and await explicit consent to proceed.
2. **Iterate**: Do not create the commit until the user explicitly approves the proposed commit message. If the user requests changes, revise the message and request approval again.

## 4. Execution Commands
1. **Scratch File**: Write the approved commit message to a scratch file in your conversation artifacts scratch directory (`scratch/commit_msg.txt` in your artifact directory outside the workspace repository). Never create scratch files inside the repository working tree to avoid accidental staging or triggering Git file watchers.
2. **Local Git CLI Execution**: To ensure local workspace files and `.git` refs remain cleanly synchronized, you MUST run the following local Git CLI commands in order. If any command fails or exits with a non-zero status, stop immediately and DO NOT execute any subsequent command:
   1. `git add -A`
   2. `git diff --cached` to verify that the staged snapshot exactly matches the verified uncommitted changes on which the approved commit message was based. If it does not, DO NOT commit; re-run the Pre-Commit Verification Workflow, revise the commit message as necessary, and return to Section 3 for explicit user approval.
   3. `git commit -S -F <file path to scratch/commit_msg.txt>`
   4. `git verify-commit HEAD`. This command MUST exit with status 0. If verification fails, stop immediately and DO NOT push.
   5. If and only if the user explicitly requested pushing, execute `git push`.
