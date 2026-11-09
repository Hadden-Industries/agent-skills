# Publication Recovery

A pre-execution guard denial is not a rejected or uncertain publication: the denied command did not run.
If the host denied the helper itself, no new helper result or attempt record exists.
Preserve prior evidence and stop that operation without retries, equivalent commands, alternate executables or a manual bypass request.
An optional transport-identity probe may remain unavailable while the already-authorized ordinary route continues; do not prompt solely to improve that evidence.
Escalate only a concrete mandatory prerequisite.
See [publication routing](publication-routing.md#supplementary-git-transport-evidence).

Read this reference after a known rejection or unknown publication result, when retargeting or a separately authorized retry is requested, or when a later push request has no matching transaction capsule.
Pushing always requires explicit authorization separate from commit creation.
For new commit-and-publish requests, first use [publication routing](publication-routing.md) before drafting; rejection is recovery, not policy discovery.
Reuse an already approved route/fallback within its exact scope rather than requesting the same approval again.

## Known rejection

A durable Git rejection, such as a protected-branch hook rejection, returns `status: rejected`, `phase: reported`.
The recorded commit remains available.
Use these returned fields to distinguish rejection from an unknown transport outcome; remote error text alone does not establish the state.

After separate push authorization for the exact OID, remote, and destination, publish the same transaction again.
For an authorized feature branch instead of the rejected protected branch:

```text
node <skill>/scripts/commitWorkflow.mjs workflow publish --transaction <opaque-transaction> --remote origin --destination refs/heads/feature-name
```

This starts a new journaled attempt.
Omit `--retry-after-attempt` for a `reported` transaction, whether the destination changes or stays the same; the helper rejects that flag here.
It binds only retries on the resolved-uncertainty recovery route below.
Do not create another commit or force push to evade branch protection.
A known rejection grants no new push authority; obtain only the missing authorization if the alternate destination is not already covered.
If the helper reports an unknown result instead, recover it before retrying or retargeting.

## Unknown result

Run `workflow recover --transaction <opaque-transaction>`.
Recovery performs at most one bounded, read-only `ls-remote` observation for the exact configured remote and full destination ref. It never pushes.
A success witnessed by the original child is `witnessed-success`; a matching remote OID found later is `observed-matching`.
Report the distinction.

If the remote matches the exact recorded commit, publication is complete by observation.
If the ref differs or is absent while the journal was `launching` or `running`, the result remains unknown because the child may still be live or delayed.
Do not retry, change destination, or infer failure from an unchanged ref.

`confirmed-no-live-child` may resolve that uncertainty only after the user explicitly confirms that the Git process and its credential/signing children ended or that the host restarted.
Once the helper records the resolution, a retry still requires new explicit push authorization for the same OID, remote, and destination.
The fresh attempt must bind its predecessor:

```text
node <skill>/scripts/commitWorkflow.mjs workflow publish --transaction <opaque-transaction> --remote <name> --destination <refs/heads/name> --retry-after-attempt <resolved-attempt-id>
```

Never reuse an attempt ID, omit the binding, force push, or retry automatically.
A known rejection is also not authorization to retry.

## No matching transaction

When a user asks to push an existing local commit but no matching transaction capsule survives, do not claim snapshot, exact-message approval, comparison, signature-policy, or report assurance that cannot be recovered.
Do not inspect, stage, commit, or alter current workspace changes.
Use the existing exact OID with the read-only memory preparation below, reusing actual task evidence and authority.
The fresh Git observations do not reconstruct missing approval or historical helper receipts.
Explain a material assurance gap; resolve only missing evidence or authority before the actual push.

## Memory publication

Memory publication supports local commits from current and earlier helper versions without creating a disk transaction or recreating the signed commit.
Use the successful commit result's `publicationPreparation.arguments`, or prepare an earlier exact OID directly:

```text
node <skill>/scripts/commitWorkflow.mjs workflow publish --commit-oid <full-oid> --remote <name> --destination <refs/heads/name> [--verification <required|advisory|skipped>]
```

This is read-only.
It independently observes the existing commit's tree, parents, raw-message digest, signature header and signature verification under the selected policy.
Reuse the authorized policy; do not silently weaken required verification.
It observes the effective push URL, live destination and complete outgoing commit membership, streaming the full graph into a count and digest without writing state.
The live destination must be absent or a locally available ancestor of the selected OID; reconcile missing/divergent ancestry separately before preparing again.
Shallow and grafted history cannot establish complete outgoing ancestry and are refused.
Multiple effective push URLs and credential-bearing URLs cannot enter a memory binding.
The result's `historicalAssurance: not-attested` means no supplied token/report is treated as an authenticated past helper result or user approval.
Reuse genuine task evidence for exact message/scope approval and checks; observe missing Git facts without inventing receipts.

Retain `publicationProposal` opaque.
Review `binding`, `verification` and every `outgoingCommitOids` member against authorized scope, signer requirements and current content policy.
For more than 256 outgoing commits, `outgoingCommitOids` is null and `outgoingInspection` gives the exact read-only native command and environment for the complete range.
The bound count and digest still cover every commit; the result never substitutes a truncated list or requires disk for a larger graph.
Complete that inspection using applicable task-lineage evidence and missing evidence deltas before executing the publish arguments.
The helper binds membership; this does not establish that every outgoing commit's content, identity, signatures, checks or reviews satisfy provider policy.
Complete [publication discovery and before-publication checks](publication-routing.md) for the current payload and live refs.
Tokens and `publicationAllowed: false` never grant push permission; reuse separate explicit user authority for the exact OID, configured remote and full destination.
Then execute `publish.arguments`:

```text
node <skill>/scripts/commitWorkflow.mjs workflow publish --publication-proposal <opaque-proposal>
```

The helper re-observes the binding and rejects drift before launch.
It rechecks the effective push endpoint immediately before launching through the authorized configured remote, preserving native URL rewriting, remote-specific transport settings and hook arguments.
Read-only destination observations use an independently resolved operand for that same push endpoint, including when fetch and push URLs differ; an unresolved rewrite remains a prerequisite.
The exact OID targets one full branch ref and permits only creation or a verified fast-forward.
Git's explicit expected-value lease requires the previously observed tip or absence, so a concurrent deletion, creation or move cannot change the approved update.
Mirror mode, follow-tags and submodule pushes are disabled, and native hooks remain enabled.
Configuration is observed before launch without claiming a concurrent configuration lock; known changes require a fresh binding.
It changes no local index, HEAD, working files or workflow files; native Git hooks and transport can have their ordinary effects.
A destination already at that OID is `observed-matching`, with no ref update and no witnessed-success claim.
This includes Git reporting the destination up to date during the push.
Only a successful child witnessed by the current invocation is `succeeded` with `witnessedOutcome: witnessed-success`.
A complete native rejection is `rejected`; refresh policy and prepare a fresh binding before a separately authorized retry or covered fallback.
Do not reuse an attempted proposal.

Memory mode has no crash-durable transcript, child journal, cross-process consumption lock or authenticated token origin.
The current process rejects consumed proposals, but a new process cannot establish whether an old token was already attempted.
Never treat a token's presence, a missing result or an unchanged remote ref as proof that no push ran.
After interruption, lost output or `PUBLICATION_OUTCOME_UNKNOWN`, preserve the commit and original binding and run only the observation command returned in `recovery.commands`:

```text
node <skill>/scripts/commitWorkflow.mjs workflow publish --observe-publication <opaque-proposal>
```

This command never pushes, including with forged caller data.
A current exact match is `observed-matching`, with `witnessedOutcome: null`; it is not authenticated evidence that a prior invocation succeeded.
An absent, different or unavailable destination remains `unknown`; changed repository/endpoint bindings also preserve uncertainty.
No recovery observation grants retry permission.
Before a new attempt after ambiguity, obtain explicit confirmation that the prior Git process and its children ended or the host restarted, reconcile observed remote state, refresh applicable policy and obtain new explicit push authority.
Only then prepare a fresh binding; do not automatically retry or retarget.
If durable crash recovery is a verified requirement, explain the disk journal's storage effects and let the user choose it before starting the workflow.
Existing disk publication keeps its durable journals, locks, reports and separately bound retry protocol.
