# Policy input rendering and helper source assessment

The committing-to-git policy harness previously dumped every packaged file into
one prompt in path order. Its 840,837-byte executable preceded the skill entry
and exact task. Antigravity 1.2.16 retained the complete raw user step but clipped
the inspected generation input before both. New policy campaigns use
`markdown-guidance-v2` and preserve the full package separately from the prompt.

## Why the dump is inappropriate

Package identity answers which skill implementation was supplied. Model-visible
guidance answers which instructions the agent was asked to apply. They are
different contracts: retaining executable bytes for provenance does not require
asking a language model to read all of them. A bundled helper is an execution
interface; its implementation, including bundled dependencies, should normally
remain behind that interface. Dumping it increases context and processing cost,
exposes incidental internals as apparent policy, and makes the evaluation depend
on code reconstruction rather than the published caller instructions.

This follows the [Agent Skills specification](https://agentskills.io/specification):
load the skill entry on activation, additional resources as needed, and execute
scripts when required. Google likewise recommends targeted context and
[verification loops](https://www.antigravity.google/docs/cli/best-practices/).
These sources support reducing irrelevant context; the actual cause here is
the retained native generation evidence, not a general long-context heuristic.

The large executable remains appropriate as a self-contained distribution and
as an input to focused implementation review. This repair changes neither its
implementation nor package ownership/build output. A helper contract test should
run the helper; an independent source review should read the relevant source and
dependencies; a text-only policy trial should receive caller-facing guidance.
These claims must not be merged into one score.

## Scope across the current evaluation suites

| Consumer | Current behavior | Assessment |
| --- | --- | --- |
| Git executable benchmark | Installs the pinned skill and exposes controlled local tools | Appropriate boundary for helper execution; not changed here |
| Git policy-only harness | Previously inlined all 11 package files; now includes Markdown only | Full executable dump was inappropriate; repaired with a new campaign protocol |
| Defining-concepts harness | Shared renderer eagerly includes its 10 packaged Markdown files, about 86 KB | No executable dump currently; eager resources still differ from normal host disclosure |
| Naming harness | Shared renderer eagerly includes 24 package files, about 163 KB including about 12 KB of code and 43 KB of other resources | Same architectural concern; JSON naming-policy data may be necessary guidance, so blanket Markdown filtering would be wrong without a separately versioned treatment |
| EPUB suite | Deterministic converter contracts rather than this policy prompt renderer | No demonstrated equivalent inline-dump defect; executing conversion tools remains appropriate |

The shared `renderSkillBundle` function still includes every file for its existing
consumers. Its semantic contract is preserved rather than silently changing
other suites' prepared authority and experimental treatment. A future naming
renderer should explicitly classify normative policy data, callable tools and
documentation, version the selection, and bound the complete transmitted input.
Do not infer that Markdown is the only policy-bearing format for every skill.

## New deterministic contract

Schema-3 Git policy campaigns bind `markdown-guidance-v2`, all-package Markdown
selection, task/entry/reference ordering and a 128,000-byte UTF-8 prompt limit.
The full immutable treatment is extracted and hashed as before. The packet's
suite context records every selected and excluded file identity, full package
inventory digest, prompt length and hash. No executable contents are inserted
into the prompt, including in the baseline arm. The control arm has no treatment.
Overflow fails preparation; it does not remove references or clip strings.

The size limit leaves margin below the locally observed clipping boundary. It is
not an upstream documented maximum or a claim of complete model input retention.
All Markdown resources are supplied eagerly so selection does not depend on the
visible test oracle. This isolates text guidance in a one-turn no-tool profile;
it does not qualify progressive disclosure, host discovery or helper execution.

Historical schema-2 campaigns remain readable for selection. New preparation
refuses those campaigns and asks for a new policy plan, preserving the original
full-package treatment identity. Existing packets, results and authority remain
unchanged; no consumed approval can authorize the revised prompt.

## Inspecting local generation fidelity

After an authorized completed 1.2.16 or 1.2.17 trial, run the documented
`scripts/evaluation/inspect-policy-generation.js` command with its explicit
prepared-session directory and exact conversation database. It verifies the
retained packet/transcript hashes and native conversation identity, opens that
database read-only with extension loading disabled, and reads only the initial
user step and single generation record. Node's maintained
[SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
provides this capability without a new dependency or runtime installation.

The report exports only identity, length, digest and public input-occurrence
facts. It never exports private generation text, discovers other conversations,
reads credential files, launches a model or rewrites the prepared trial. The CLI
exits nonzero for input loss or unavailable/unsupported evidence. Local exact
prompt occurrence is not authenticated proof of the final service context, and
does not establish correctness of an answer. A completed transport with known
input loss is unsuitable for scoring the complete supplied guidance.

## Remaining semantic and live qualification boundaries

The scratch-allocation cases 17, 23 and 24 concern behavior now largely delegated
to the opaque helper. Its implementation preserves UUID-v4 allocation, exclusive
creation and bounded collision retries, while the published prose does not state
all of those details as a caller contract. Removing the dump does not make these
assertions obsolete or authorize adding an implementation-derived answer key to
the prompt. Reconcile their accepted intent with caller-facing guidance or test
the executable contract before interpreting future text-only scores. The other
sampled cases have substantial direct policy guidance in the current prose.

No skill policy or assertion meaning changes here. The original 18 sessions and
their diagnosed input loss remain historical evidence. Two subsequently approved
current-guidance diagnostics, cases 3 then 24, completed with the complete prompt
present in both inspected native generation records. Case 3 substantially applied
the explicit prose with one spacing-formula inconsistency; case 24 still missed
requirements of its unchanged complete contract. See the
[diagnostic readback](evaluation-real-provider-observations.md#revised-guidance-diagnostic-readback)
for exact identities, scope and limitations.

Those two selected cells establish local input retention for that treatment and
pinned Antigravity 1.2.16 executable. They are not a matched six-case contrast,
independent semantic acceptance, or a live qualification of the subsequently
admitted 1.2.17 CLI. Their authority is consumed. Further experiments require a
new question, fresh exact packets and separate call authorization. Deciding new
caller policy or changing assertion meaning is outside the original preservation
plan; unchanged failures remain failures. Source changes, build checks, local
inspection and independent code review authorize no inference or judge call.
