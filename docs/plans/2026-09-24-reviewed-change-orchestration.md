# Reviewed-change orchestration

## Accepted baseline

Issue: https://github.com/Hadden-Industries/agent-skills/issues/5.
Decision: the user accepted the proposed implementation in Codex task
01a0d403-701c-73f2-aa2b-d0cd18614331, explicitly identifying commit
606922bf404729c8a267b2574a81dcdbb47b19fe as the updated starting point.
Its merged-stream capture guidance and regression tests remain authoritative.
The unrelated existing skills-lock.json modification is excluded.

REQ-001 / AC-001: A requested detailed message with reusable evidence reaches
structured authoring from one preparation, without an extension or worksheet
read for a bounded five-file scope. Subject-only preparation remains supported.
REQ-002 / AC-002: Public compact results preserve state, exact displayed message,
signature and recovery facts; full retained evidence remains publicly accessible.
REQ-003 / AC-003: The skill selects references and checks from concrete missing
facts, reuses applicable evidence and authority, and reports completion against
the explicitly authorized final destination.
REQ-004 / AC-004: An opt-in host evaluation defines matched concise/detailed and
source/main cases, preserves safety oracles, and measures orchestration separately
from helper runtime, host overhead and hosted waiting. Unrun trials stay unrun.

QA-001: Scope, head, prepared tree, canonical message and signature invalidation
remain enforced; the unrelated modified lockfile survives byte-for-byte.
QA-002: Interrupted preparation retains requested authoring intent; unknown
commit/publication outcomes never cause automatic mutation replay.
QA-003: Evaluation metadata identifies host, model, HISEW and treatment bytes;
missing telemetry is unknown rather than zero, and failed safety cannot be offset
by lower latency.

## Risk and authority

Risk class: R2, inferred from public CLI and durable recovery contracts and
cross-system publication guidance. Decision owner: repository owner in this task.
Potential blast radius: skill consumers selecting the wrong authoring route or
misreading publication completion. Local code changes are reversible; commits
and remote effects are separate authorities and are not requested here.
Required evidence: focused public-interface tests, full npm run verify, semantic
review, and host behavior evidence before claiming measured latency improvement.
Specialist questions: preservation of authorization, signature, scope and recovery
boundaries; evaluation validity and attribution. No automatic scans or delegation.
The user separately approved only generated version fields in the two host plugin
manifests and the new reviewed-change-host.json evaluation definition. No other
configuration, installation or remote mutation is authorized.

## Native reuse and implementation

Reuse the existing structured renderer, evidence catalog, transaction journal,
result contract, report access, fixture generator and evaluation evidence runtime.
No new dependency or third-party code is required. Existing owner-authored MPL-2.0
source supplies these interfaces; installed Node/Git are the current repository
toolchain. The residual gap is earlier authoring selection and host measurement.

| Slice | Traceability | Proof | Delivery consequence |
| --- | --- | --- | --- |
| Preparation | REQ-001, AC-001, QA-001, QA-002 | New public preparation/finalization and interruption regressions | Preserve default route and existing capture behavior |
| Results and guidance | REQ-002, REQ-003, AC-002, AC-003, QA-001 | Compact/full contract and safety regressions; semantic review | Preserve exact message and required publication refreshes |
| Host evaluation | REQ-004, AC-004, QA-003 | Fixture/metric tests and opt-in campaign validation | Exact model and hosted-target authorization before live trials |

Work proceeds sequentially in the existing checkout. Tests establish failing
behavior before source changes. Generated bundles and host packages are rebuilt
after canonical edits. Final npm run verify covers the complete candidate.
Host trials use the issue's captured baseline plus the updated 606922b build to
separate the shell-capture repair from this change; no speed improvement is claimed
from deterministic tests. The default offline evaluation lane remains offline.

Replan if output compaction hides required decision evidence, the requested format
cannot fit existing presentation limits, recovery requires migration of existing
attempts, or the chosen host cannot expose trustworthy timing. Preserve failed
trial evidence. Release, installation and external evaluation remain separately
authorized; the prepared local candidate is the implementation deliverable.
