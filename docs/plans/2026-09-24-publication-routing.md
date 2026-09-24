# Publication routing implementation

## Accepted baseline

Decision: the user requested "Implement this refined proposal using HISEW" in
Codex task 01a0d290-a321-7b23-828f-4a9c3eff3b9e after accepting the following
requirements. This implementation does not authorize publishing this repository.

- Before drafting for commit-and-publish intent, inspect local readiness and
  publication feasibility. Draft-only and local-only requests remain offline.
- Prefer direct signed publication, then normal PR merge, then disclosed squash.
  Repository policy and explicit personal-signature requirements take precedence.
- Combine classic protection, active inherited rulesets, source-branch and push
  restrictions, permissions, merge methods, signature constraints, and queues.
- Distinguish viable, viable-with-prerequisites, blocked, and unknown. An unknown
  policy is not permission. Pending checks/reviews are prerequisites.
- Disclose route and signature effects with the initial exact-message proposal.
  Reuse explicit authorization for commit, push, PR creation, and merge within
  its scope; a commit-only request grants no publication authority.
- Refresh observations before mutation. Bind merge to the reviewed head, obey
  queues, and never use administrative bypass or force publication.
- Verify source signers, exact source ancestry for direct/normal merge, and final
  content/message/signature separately for squash. No automatic rebase fallback.
- Reconcile uncertain remote effects before retries. Preserve user-owned work.
- GitHub is the first provider; unsupported providers have unknown feasibility.

## Risk route

Risk class: R2.
Decision owner: repository owner, in the task above.
Reasoning: cross-system publication, authorization, identity, and recovery.
Potential blast radius: consumers publishing the wrong commits or destination.
Reversibility: local implementation reversible; remote publication may not be.
Principal unknowns: provider policy visibility, credential differences, queue state.
Required artifacts: this accepted baseline, source/tests, published skill, review evidence.
Required specialist lenses: authorization/signature security and independent verification.
Required verification: test-first route/CLI tests, pressure scenarios, full npm verify,
ordinary review, independent verification, and scoped security review.
Required human approvals: implementation granted; only the two generated plugin
manifest version fields additionally approved. Commits/pushes not requested.
Maximum sensible autonomy: implement and verify locally; no installation or remote writes.
Next lifecycle step: capture baseline, start execution, implement vertical slices.

## Reuse selection

Reuse the existing signed transaction and journaled explicit-OID publisher.
Use installed GitHub CLI for native authenticated API queries and PR operations;
do not introduce an HTTP client, token store, or replacement merge queue.
GitHub CLI 2.101.0 and Node 24.21.0 are observed locally. GitHub CLI is an external
MIT-licensed executable, not redistributed. Existing Node and cross-spawn remain
the package dependencies. The residual custom gap is bounded policy discovery
and route selection; the skill orchestrates native PR delivery and reconciliation.

Authoritative inputs checked 2026-09-24:
- https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch
- https://docs.github.com/en/rest/branches/branch-protection
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification
- https://cli.github.com/manual/gh_pr_merge

## Implementation slices

1. Add `workflow preflight`, a read-only, transaction-free observation with explicit
   remote and optional destination/source branch. Keep four feasibility states and
   policy reasons visible; select routes without bypassing unknown restrictions.
   Tests exercise actual CLI parsing and policy evaluation with recorded-shape API
   fixtures, including permission failures, pagination, queue and signature cases.
2. Document native PR delivery before prepare/approval in the canonical skill and
   a focused reference: scoped approval, exact-OID publication, native head-bound
   merge, queue completion, uncertain-outcome reconciliation and final verification.
   Preserve existing transaction recovery; do not fabricate transaction assurances
   for external PR operations.
3. Add consumer-boundary tests and pressure scenarios. Regenerate shipped helper
   and plugin copies; update only approved generated manifest versions. Freeze the
   candidate and complete governed full verification and review.

## Constraints

Preserve the pre-existing skills-lock.json change. No package, lockfile, CI,
repository-policy or persistent Git configuration changes. Canonical SKILL.md
remains ASCII. Never test by mutating a live GitHub repository.
