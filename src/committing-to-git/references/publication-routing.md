# Publication Routing

Use for commit-and-publish intent before message drafting or `workflow prepare`. Discover once per task, then reuse the observed route under the contract below. GitHub is the supported first provider. Draft-only and local-commit-only requests do not require remote access. The preflight command is read-only and creates no transaction or approval.

## Discover before drafting

Record the authorized endpoint before selecting refs: source publication or integration into the named final target. Resolve an unspecified destination before publication; the provider default branch alone does not supply integration authority. Keep this endpoint in task evidence until readback verifies it or a concrete prerequisite blocks completion. Source publication and pending CI/review are intermediate states for an authorized integration request.

Resolve the intended configured remote from task evidence and Git configuration. Do not assume `origin`, `main`, the current branch, or the API actor is the Git transport actor. A supplied target overrides the provider default branch. Inspect the effective push URL; a different fetch URL is not authority for publication. Choose a unique prospective source branch when PR delivery is possible, then run:

```text
node <skill>/scripts/commitWorkflow.mjs workflow preflight --remote <name> [--destination <refs/heads/target>] [--source-branch <name>] [--require-personal-signature] [--task-id <current-task>] [--transport-probe <auto|reuse-only>] [--reuse-discovery <retained-result.json>] [--authorized-transport-actor <login>]
```

`--require-personal-signature` requires original signed commits in target ancestry; it does not claim the user personally signs GitHub's integration commit. Supply it only for an explicit requirement, not the default preference for normal merge.

Read `feasibility`, not common `route` (which remains the message route). `publicationAllowed: false` is intentional: observations never authorize effects.

| Feasibility | Action |
| --- | --- |
| `viable` | A route exists under observed policy; still verify the concrete payload. |
| `viable-with-prerequisites` | Continue drafting; resolve each prerequisite before its corresponding effect. |
| `blocked` | Explain the concrete conflict before drafting. |
| `unknown` | Resolve missing evidence through bounded native read-only inspection; never test permission with a push. |

The helper observes local identity/signing configuration, active Git operations, effective push URL, API actor, target SHA, classic protection, inherited active branch rules, push rules and allowed methods. It does not prove signing-key availability, token mutation permissions, future CI success, or selected content compliance. Inspect returned rules against exact paths, sizes, messages, identity, outgoing commits and branch names before mutation. An unrecognized rule, incomplete pagination, failed API query or inaccessible policy remains unknown. A 404 alone does not establish the absence of protection. Unsupported providers and transports need an explicit separately evidenced route; do not infer support or install tools.

For classic wildcard protection on a not-yet-existing source branch, use native provider evidence of its effective rule or select a source branch whose policy can be established. Do not approximate provider matching with a different glob engine. Do not create a branch just to probe its protection.

Select direct signed publication when ordinary permissions and satisfied rules permit it, otherwise a normal PR merge, otherwise squash. Satisfying checks can require publishing to a permitted source branch first, even without a PR rule. Intersect repository and branch merge-method restrictions. Required queues own the integration method: select a compatible queue route and report that method. Do not use admin/bypass permissions, rebase as an automatic fallback, force pushes, or policy edits to manufacture a route. Explicit requirements override defaults.

## Reuse discovery within the task

Retain the successful result in task context. `feasibility.discoveryReuse` supplies the observed binding, refresh triggers and before-publication checks. It is advisory guidance, not a persisted cache, permission or proof of current policy. `eligible: false` means resolve blocked/unknown discovery before publication.

Reuse requires the same task, local/provider repository, configured remote, effective push URL, target/source refs, API account and signing requirements. Preserve any established Git identity evidence and its limitations; absence of optional identity evidence does not invalidate an otherwise usable route. Rediscover policy when its binding changes, a policy change is known, a definitive publication rejection occurs, or prior context is unavailable. Resolve a changed destination or method's authorization before acting. Starting preparation, creating a commit, reaching publication, or elapsed time alone does not invalidate discovery.

With `--task-id`, a supported context returns `feasibility.discoveryEvidence`. Retain the witnessed result privately in task evidence and supply that JSON through `--reuse-discovery` with the same task ID. The helper compares the binding and native configuration/environment fingerprint, refreshes API identity, and reuses unchanged policy without credential access. A changed binding invalidates reuse; it does not automatically repeat identity collection. The receipt's integrity digest detects accidental edits, not authorship. Never manufacture a receipt or accept an arbitrary file/account assertion as authenticated evidence. The fingerprint cannot detect credential-store rotation, SSH agent key changes, or server policy changes: known or suspected changes invalidate the relevant evidence. No file is written by preflight.

## Supplementary Git transport evidence

Do not turn identity discovery into a new prerequisite for previously authorized ordinary publication. A missing tool, unsupported context, timeout, ambiguous observation, or DCG denial yields unavailable supplementary evidence and a warning. Continue the established authorized route, retaining exact-payload, signer, ancestry, live-ref, policy and recovery checks. Never present that continuation as proof of current transport identity or permission, and never use publication merely to test an unresolved route.

Identity becomes required only when an explicit user account constraint or actor-specific provider restriction makes it material. Supply `--authorized-transport-actor` only for that concrete user requirement; do not infer it from the API login, author, signer, URL username or an account preference. Positively established lack of ordinary write permission or a conflict with the required principal is material. An API account's repository permissions belong to that API account; they neither grant nor deny another transport account's permissions. PR creation and integration still require their own API authority. Different API and transport accounts are legitimate and do not alone require another approval.

An older preflight result may list API/transport account equality as a blanket prerequisite. That inferred equality requirement is superseded by this contract; retain valid policy observations and enforce only a concrete account constraint or restriction. Do not rerun a denied probe just to satisfy the older wording.

`transportIdentity` reports `established`, `ambiguous`, `unavailable` or `binding-changed`, a projected principal/method, whether evidence is required, and any sanitized command failure. `transportPermissions` reports separately observed write permission or unavailable. Even an established permission observation does not prove token push scope or guarantee a future push. Classic actor-specific restrictions remain unresolved until relevant native provider evidence establishes their applicability; an authenticated greeting alone cannot clear them.

`auto` performs one optional collection only with a task ID and supported context. HTTPS collection uses native Git with the single configured GCM helper to select an existing credential noninteractively. A short-lived worker verifies that credential with GitHub `/user` and reads repository permission metadata using the same credential. The credential stays in worker memory; raw credential output, provider bodies and native errors are never returned. Unknown helper chains, HTTP overrides, login requirements and unsupported environment/configuration remain unavailable. GCM account lists and credential usernames are not authentication proof. No browser login, credential/configuration write, tool installation or push probe is authorized by this command.

The initial SSH lane supports default native OpenSSH on non-Windows hosts without user/system SSH config files or Git SSH wrappers. It requires existing host trust, disables interaction/forwarding/host-key updates, and recognizes GitHub's authenticated greeting with exit status 1. Deploy-key greetings are repository principals, not user accounts. Configured aliases, proxies, Windows executable-selection ambiguity and other unqualified contexts remain unavailable rather than approximating Git's transport. These narrow support limits must not block ordinary publication solely to improve identity evidence.

New identity commands pass native DCG classification before execution. If DCG denies one, that observation stops: no retry, alternate executable, equivalent command or manual request to bypass the denial. Missing or invalid classifier output also prevents the optional child from running. `--transport-probe reuse-only` suppresses fresh credential/SSH collection; it can reuse witnessed evidence but does not manufacture it. A retained denied observation is not retried during reuse.

If the host rejects the outer command, no helper result exists. Record the denial as pre-execution, preserve prior admissible evidence and do not fabricate helper fields, a failed push or an authentication failure. Assess whether the missing operation was actually necessary: optional identity failure needs no user prompt. Only a concrete unresolved mandatory requirement warrants a concise explanation or user decision. Never send the user the denied command to run manually merely to satisfy optional discovery.

Before every publication or integration, verify the exact authorized payload, expected signer, all outgoing ancestry and live destination/source refs. Re-evaluate observed content restrictions against that payload and satisfy checks/reviews for the current head. A moved ref requires ancestry/scope reconciliation; it does not by itself require fetching unchanged policy again. The server enforces current permissions and rules on the actual authorized attempt; never use a push to probe an unresolved route.

On a definitive rejection, preserve the commit and refresh discovery before deciding another attempt or an already-authorized fallback. On an ambiguous network/process outcome, use [publication recovery](publication-recovery.md) first; neither fresh discovery nor a changed route resolves the existing attempt. Never broaden authority, bypass rules, force push or replay the commit to recover publication.

## One informed approval

Complete the message, scope and reviewable delivery proposal before requesting approval. State repository, remote, full target/source refs, selected method, any permitted fallback, prerequisites, and signature effects. Commit, push, PR creation and merge require distinct explicit authority but may be approved in one response. "Commit" alone authorizes none of the later effects. Reuse earlier authority covering those effects; do not ask again merely at a phase boundary.

Example for squash-only policy: "Commit the reviewed changes with the displayed message, publish that exact resulting commit to refs/heads/<source>, create its PR into refs/heads/<target>, and squash merge after requirements pass. The source will retain your signature; GitHub creates and signs a different final commit. Your signature does not transfer."

Bind advance publication authority to the exact commit produced from the approved tree/message, its named remote/ref and any expressly covered fallback. Verify that binding once its OID exists; a replacement commit is not automatically authorized. Keep exact message approval separate from GitHub's default merge-message settings. For normal merge, propose a distinct integration message rather than presenting it as a second copy of the original change. For squash, explicitly supply the approved final message instead of accepting a generated PR title/body concatenation.

Reuse discovery under the task contract above. An already disclosed and authorized squash fallback needs an update, not another approval. Ask only for a material scope, message, destination, signature requirement or effect outside existing authority. Checks/reviews waiting on another person are pending prerequisites, not invitations to waive them.

## Commit and publish the exact source

Use the ordinary preparation, message, signed-commit and verification commands. Keep their snapshot and recovery invariants. Never change branches under a prepared transaction. Source branch publication does not require a local checkout switch: the existing publisher sends the exact recorded OID to the named remote ref. Preserve any local default-branch commit after squash; do not reset or rewrite it as automatic cleanup. Report remaining local divergence accurately.

Before pushing, inspect the remote target/source refs and all outgoing ancestry. The PR must contain only the authorized changes; unrelated commits already on the local branch are not authorized by approval of its latest commit. Check that a new source name is unused, or that an existing source ref is the expected task-owned fast-forward predecessor. Resolve drift without force or history rewriting. Use `workflow publish` with the exact transaction, remote and destination. Its `published` phase proves source publication only, not PR creation or integration. Unknown push outcomes use [publication recovery](publication-recovery.md).

## Native GitHub delivery

Use GitHub CLI or an available native GitHub connector with equivalent controls. Always specify repository and exact PR identity; do not rely on current-branch inference. Prepare the complete PR title/body and final integration message before external writes. Use structured tool arguments or a UTF-8 body file, never shell interpolation of commit/provider content. Attach the created PR to the host task when that capability is available.

1. Read existing PRs for the exact base/head repository and branch pair, including closed and merged states. Reuse the task-owned open PR only when its head SHA and scope match. A closed/merged PR is not permission to create another.
2. Create the PR only with existing authorization. Record its number/URL, repository identities, base/head refs and reviewed head SHA in task evidence.
3. Inspect actual required checks, approvals, unresolved conversations and mergeability on that head. A green local suite or `MERGEABLE` alone is not enough.
4. Refresh the PR head and required checks/reviews immediately before merging; reuse route discovery unless its contract is invalidated. For ordinary merges use `gh pr merge <number> --repo <owner/repo> --merge --match-head-commit <oid>`; for squash use `--squash` instead. Pass the approved `--subject` and `--body-file`. Never add `--admin` or `--delete-branch` implicitly.
5. When a queue is required, use the native queue route with `--match-head-commit`; inspect and disclose its configured method rather than overriding it with a client preference. Confirm eventual merge method/message/content. If the queue cannot provide the approved message or signature semantics, resolve that conflict before enqueueing. Queue admission or auto-merge enabled is pending.
6. Auto-merge is allowed only when the user's authorization covers deferred merge and its actual provider binding. `--match-head-commit` protects the enqueue request; do not assume it freezes a later head change. If approval must bind one immutable head and the provider cannot enforce that, wait and perform a head-bound immediate merge instead; a required incompatible queue is a blocker. If the head changes while queued, suspend further effects and inspect whether a merge remains pending. Do not treat the replacement as approved delivery; resolve its authority. Cancellation also requires applicable authorization.

For a lost PR-create, merge or enqueue response, first reconcile the exact PR and remote state. Record attempted action and identity before the call in retained task evidence. Do not launch a duplicate operation while the original may still run. A matching observed PR or merge is observation, not a witnessed successful response. If the outcome remains ambiguous, preserve the known source commit and report the uncertainty. Native operations are not journaled by `workflow publish`; never claim its transaction authenticates or recovers those external effects.

## Verify delivery

Read back the actual target ref and PR merge result. If the branch advanced after delivery, check reachability of the delivered commit rather than requiring it to remain the tip. Distinguish source publication, waiting for requirements, queue admission and completed integration in every status report.

- Direct: verify the exact source OID is in the target ancestry and its signature matches the expected trusted signing identity, not just the configured author.
- Normal merge: verify the exact reviewed source head and its introduced signed commits are ancestors of the actual merge commit; inspect parent identities, integration tree/message and the separate integration signer.
- Squash: verify the merged PR's reviewed head, base at integration, resulting combined tree, approved message, author attribution and GitHub signature. Compare the combined result with the reviewed change applied to that base, not blindly with the source tree when the base advanced. Ambiguous comparison is incomplete verification. Retain links/OIDs for source commits and PR; their signatures have not become signatures on the squash commit.
- Report `Partially verified` and `Unverified` literally and inspect the signer/key and verification reason. A valid signature is not evidence that every author consented. Satisfying GitHub's signing rule does not replace the expected-signer check. Independently verifying final content is required for all merge routes.

Preserve diagnostic/recovery evidence. Branch deletion, local synchronization, history rewriting and release remain separately authorized effects. End with the delivered OID(s), method, signature identities, verification result and any pending requirements. Never describe preflight or queue admission as completed delivery.
