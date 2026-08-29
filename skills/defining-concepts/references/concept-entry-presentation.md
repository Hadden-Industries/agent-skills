# Concept-Entry Presentation

Choose one human renderer after validation and project only useful fields from the shared concept-entry record. The first substantive block is the definition or revised definition whenever responsible formulation is possible; an optional concept-name heading is not substantive.

A warning or clarification may appear before the definition only when omission would materially mislead, and a blocker may appear first when no responsible definition can yet be supplied. Omit empty sections, internal research diaries, generic numbering, compliance theater, and evidence that does not help the reader decide or act.

## Definition answer

Use for a direct request whose main need is a usable definition. A compact answer may contain only the definition plus one sentence of scope, source basis, status, or limitation.

Project in this order when populated:

1. **Definition:** State the definition first, without a preamble that makes the reader hunt for it.
2. **Scope and status:** State the subject field, jurisdiction, time, standpoint, provisional status, or disposition only when needed to interpret the sentence.
3. **Boundaries:** Give the one or more inclusion, exclusion, positive example, negative example, counterexample, or near miss that most usefully tests the extension; label the role explicitly.
4. **Source basis:** Place concise citations beside the claims they support and distinguish adopted or adapted wording from constituent semantic evidence.
5. **Open decision:** State a blocker, review need, or user decision only when material.

Do not display a full ConceptBrief, audit checklist, standards table, claim ledger, or every considered alternative unless the user requests it or the risk and decision require it.

## Revision audit

Use when the user supplies a definition, suspects a semantic defect, or asks for an audit. Preserve both the intended original concept identity and the revised concept identity so a wording correction does not silently redefine the target.

Project in this order when populated:

1. **Revised definition:** Put the best responsible revision first.
2. **Audit verdict:** State whether the original was usable, materially defective, scope-dependent, provisional, or blocked and name the decisive issue.
3. **What changed and why:** For each material defect use `defect -> consequence -> remedy`, covering category shifts, circularity, hidden definitions, scope errors, accidental representation detail, non-discriminating characteristics, unsupported evidence, or designation problems as applicable.
4. **Boundary tests:** Show the decisive sibling, inclusion, exclusion, counterexample, or near miss and whether the revision passes it.
5. **Evidence and profile checks:** Report only material source, edition, licensing, mapping, standards-profile, governance, or tool-dependent results.
6. **Unresolved decisions:** Expose remaining evidence, authority, review, or user decisions.

An audit verdict is not a bare pass/fail label. Explain enough causal reasoning for the user to judge the repair and its consequence.

## Concept package

Use for a reusable terminology or registry entry, mapping decision, ontology work, multilingual entry, authority-sensitive concept, substantive governance record, or an explicit full-package request.

For a concept package whose request makes a boundary or reuse decision material, expose the selected `Adopt`, `Adapt`, `Formulate`, or `Defer` disposition and label at least one concrete positive instance, one concrete negative instance or explicit exclusion, and one near miss; add a counterexample when it supplies a distinct test. Use an explicit `Disposition: Adopt`, `Disposition: Adapt`, `Disposition: Formulate`, or `Disposition: Defer` label rather than leaving the decision implicit in prose. Do not omit these observable decisions merely because a prose summary makes them seem implicit.

Project populated groups in this reader-facing order: definition; identity and designations; purpose, scope, stakeholders, and competency questions; characteristics, boundaries, positive and negative examples, counterexamples, and near misses; typed relations, reuse disposition, and mappings; evidence, provenance, and licensing; named active-profile results; and status, contested matters, maintenance, review, and next action.

Use descriptive headings rather than a generic extension section. Separate a concept's label inventory from its identity, within-system relations from cross-system mappings, examples from members of an exhaustive extension, and evidential status from local lifecycle status.

Keep citations adjacent to supported claims. A fuller evidence ledger may appear when source conflicts, consequential use, authority, mapping, or wording permission makes it useful; otherwise summarize the decisive source basis and link to exact destinations. Present a validation result with the actor or method that actually performed it; label a check as human review only when a human reviewed this result, never when the assistant merely checked its own work.

## Blocker behavior

If no responsible definition can be supplied, lead with the exact blocker and its consequence, then give the smallest useful boundary, evidence, alternatives, and next action. Do not put a polished placeholder under a Definition heading.

If a definition can be supplied only provisionally, put it first only after any indispensable warning, label its scope or standpoint in plain language, and preserve the unresolved decision nearby.

## Cross-renderer consistency

All three projections come from one entry. The same definition text, concept identity, Adopt/Adapt/Formulate/Defer disposition, qualitative status, evidence relationship, mapping relationship, and unresolved blocker must remain consistent when moving between definition answer, revision audit, and concept package.

Compression may omit supported detail but must not reverse it, strengthen provisional evidence, hide a critical failure, turn an example into an exhaustive extension, convert a broader or close mapping into identity, or imply validation that was not run.

## Accessibility and economy

Use informative headings only when they help scanning. Prefer plain status language before specialist notation, short paragraphs, meaningful link text, and lists whose items have genuinely parallel roles. Do not rely on color or layout alone to distinguish examples, exclusions, warnings, or status.
