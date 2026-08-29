import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  validateCanonicalSkillAscii,
  validateCanonicalSkillMarkdownWrapping,
} from "../../../scripts/validateSkillRepository.js";

const root = path.resolve(import.meta.dirname, "../../..");
const skillsRoot = path.join(root, "skills");
const skillRoot = path.join(skillsRoot, "defining-concepts");
const referencesRoot = path.join(skillRoot, "references");
const plannedReferences = [
  "concept-entry-model.md",
  "concept-entry-presentation.md",
  "concept-entry-serialization.md",
  "evidence-and-provenance.md",
  "profiles/data-definitions.md",
  "profiles/epistemic-governance.md",
  "profiles/formal-ontology.md",
  "profiles/knowledge-organization-systems.md",
  "profiles/multilingual-terminology.md",
];

function read(relativePath) {
  return readFileSync(path.join(skillRoot, relativePath), "utf8");
}

function assertMatchesAll(source, patterns) {
  for (const pattern of patterns) {
    assert.match(source, pattern, pattern.toString());
  }
}

test("router: the canonical graph has nine conditional lower-kebab-case references", () => {
  const skill = read("SKILL.md");
  for (const relativePath of plannedReferences) {
    assert.ok(
      existsSync(path.join(referencesRoot, relativePath)),
      relativePath,
    );
    assert.match(
      relativePath,
      /^(?:profiles\/)?[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u,
    );
    assert.match(
      skill,
      new RegExp(
        `\\[.*?\\]\\(references/${relativePath.replace("/", "\\/")}\\)`,
        "u",
      ),
    );
  }
  assert.doesNotMatch(skill, /read (?:all|every) reference/iu);
  assert.equal(
    existsSync(path.join(referencesRoot, "judicial_plea_status_definition.md")),
    false,
  );
  assert.doesNotMatch(skill, /judicial_plea_status_definition/iu);
});

test("router: every local Markdown link resolves within the skill", () => {
  for (const relativePath of [
    "SKILL.md",
    ...plannedReferences.map((item) => `references/${item}`),
  ]) {
    const absolutePath = path.join(skillRoot, relativePath);
    const source = readFileSync(absolutePath, "utf8");
    const links = source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu);
    for (const [, destination] of links) {
      if (/^(?:https?:|#)/u.test(destination)) continue;
      const [filePart] = destination.split("#", 1);
      assert.ok(
        existsSync(path.resolve(path.dirname(absolutePath), filePart)),
        `${relativePath} -> ${destination}`,
      );
    }
  }
});

test("router: source files preserve canonical ASCII and human-readable physical lines", async () => {
  assert.equal(
    validateCanonicalSkillAscii(skillsRoot, {
      skillNames: ["defining-concepts"],
    }),
    1,
  );
  assert.equal(
    await validateCanonicalSkillMarkdownWrapping(skillsRoot, {
      skillNames: ["defining-concepts"],
    }),
    10,
  );
});

test("router: compatibility is exact portable Agent Skills prose", () => {
  const skill = read("SKILL.md");
  const frontmatter = skill.split("---", 3)[1];
  const compatibilityLines = frontmatter
    .split("\n")
    .filter((line) => line.startsWith("compatibility:"));

  assert.deepEqual(compatibilityLines, [
    "compatibility: Requires access to bundled skill files. Tasks that require current external evidence also require web search and URL fetching.",
  ]);
  assert.doesNotMatch(
    frontmatter,
    /allowed-tools|mcp|codex|claude|antigravity|capabilities\s*:|requires\s*\[/iu,
  );
});

test("router: trigger boundary and universal workflow are explicit", () => {
  const skill = read("SKILL.md");
  assertMatchesAll(skill, [
    /define.*audit.*compare.*map.*formaliz.*multilingual.*governance/isu,
    /dictionary.*code.*product naming.*copyedit.*implementation-only/isu,
    /Route -> Frame -> Research -> Model -> Decide -> Define -> Validate -> Present/u,
    /ConceptBrief/u,
    /routine.*consequential.*authority-sensitive/isu,
    /one focused clarification/iu,
    /terminology core.*data-definitions fallback/isu,
    /ISO\/IEC 11179.*data and metadata.*(?:scope|compliance)/isu,
  ]);
});

test("router: non-negotiable output gates precede the long workflow", () => {
  const skill = read("SKILL.md");
  const gateStart = skill.indexOf("## Non-negotiable output gates");
  const workflowStart = skill.indexOf("## Universal workflow");

  assert.ok(gateStart > 0, "missing non-negotiable output gates");
  assert.ok(
    gateStart < workflowStart,
    "critical gates must precede workflow detail",
  );
  assertMatchesAll(skill.slice(gateStart, workflowStart), [
    /every.*final.*source claim.*cited.*destination.*directly retrieved.*current task/isu,
    /unvisited.*destination.*discovery-only.*not.*verified source/isu,
    /affirmative.*permission.*forbidden.*exact.*permission destination.*cited.*final answer.*directly retrieved.*current task/isu,
    /never.*(?:construct|invent).*license.*URL/isu,
    /concept package.*boundary.*positive instance.*negative instance.*near miss.*unresolved.*omit/isu,
    /explicitly label.*disposition.*Adopt.*source wording.*unchanged.*permission.*verified.*Adapt.*Formulate.*Defer/isu,
  ]);
});

test("router: decisions, strategies, renderers, and completion gates remain discoverable", () => {
  const skill = read("SKILL.md");
  assertMatchesAll(skill, [
    /Adopt.*Adapt.*Formulate.*Defer/isu,
    /intensional.*extensional.*partitive.*mixed.*operational.*formal.*perspectival/isu,
    /definition-answer.*revision-audit.*concept-package/isu,
    /definition first/iu,
    /established.*adopted.*adapted.*proposed.*provisional.*contested.*deprecated.*blocked/isu,
    /never invent.*identifier/isu,
    /parser result.*conformance/isu,
    /wrong identity|wrong concept identity/iu,
    /circular|non-discriminating/iu,
    /unsupported.*evidence/isu,
    /licensing problem/iu,
    /false exact mapping/iu,
    /illegitimate authority/iu,
    /compare every.*final.*source claim.*cited.*destination.*retrieval record.*unvisited.*discovery-only/isu,
    /before presenting.*wording-permission.*cited.*URL.*retrieval record.*unresolved/isu,
  ]);
  assert.doesNotMatch(
    skill,
    /exactly (?:these )?five|five[- ]section|section 3/iu,
  );
  assert.doesNotMatch(
    skill,
    /numeric confidence|confidence score|probability/iu,
  );
});

test("router: profiles compose behind explicit activation conditions", () => {
  const skill = read("SKILL.md");
  const routes = [
    [
      "profiles/data-definitions.md",
      /data elements?|metadata registr|fields?|codes?|value domains?/iu,
    ],
    [
      "profiles/knowledge-organization-systems.md",
      /thesaur|taxonom|classification|controlled vocabular|concept scheme|mapping/iu,
    ],
    ["profiles/formal-ontology.md", /class|propert|individual|axiom|reason/iu],
    [
      "profiles/multilingual-terminology.md",
      /multilingual|language|script|translat|equivalence/iu,
    ],
    [
      "profiles/epistemic-governance.md",
      /contested|situated|normative|community|authority/iu,
    ],
  ];
  for (const [reference, activation] of routes) {
    const row = skill
      .split("\n")
      .find((line) => line.includes(`references/${reference}`));
    assert.ok(row, reference);
    assert.match(row, activation);
  }
  assert.match(skill, /multiple profiles may compose/iu);
  assert.match(skill, /fallback.*must not force.*data-specific.*compliance/isu);
});

test("router: parallel research is capability-aware and coordinator-owned", () => {
  const skill = read("SKILL.md");
  assertMatchesAll(skill, [
    /optional.*environment permits.*at least two.*bounded.*non-overlapping.*savings.*overhead/isu,
    /batched tool calls.*shallow.*subagents.*multi-step/isu,
    /give every worker.*ConceptBrief/isu,
    /exact destination.*role.*edition.*version.*retrieval.*claim.*boundary.*licen.*conflict.*uncertainty/isu,
    /coordinator.*identity.*routing.*disposition.*mapping.*synthesis.*conflict.*draft.*final validation/isu,
    /reverif.*material.*evidence/isu,
    /sequential.*(?:fallback|when)/isu,
    /quality.*not.*subagent/isu,
  ]);
});

test("evidence: the claim contract separates eligibility, semantics, and permission", () => {
  const source = read("references/evidence-and-provenance.md");
  assertMatchesAll(source, [
    /## Evidence-lane planning/u,
    /governing rules.*registries.*domain.*neighbor(?:ing)?.*mappings.*versions.*licensing.*jurisdiction/isu,
    /## Source eligibility and roles/u,
    /claim-relative authority|authority is claim-relative/iu,
    /exact destination.*title.*publisher.*role.*claim.*edition.*version.*jurisdiction.*retrieval.*locator.*authority.*relationship.*permission.*conflict.*reverified/isu,
    /search result.*citation record.*worker summary.*inaccessible.*discovery evidence/isu,
    /final source claim.*cited destination.*retrieval record.*unvisited.*discovery-only.*(?:omit|not checked)/isu,
    /unsuccessful search.*does not prove absence/isu,
    /same.*broader.*narrower.*overlapping.*related.*constituent-only.*conflicting.*unresolved/isu,
    /verbatim.*attributed quotation.*paraphrase.*link.*unresolved/isu,
    /exact.*license.*permission.*URL.*final answer.*completed.*direct retrieval.*current task.*applicab/isu,
    /policy.*hub.*footer.*discovered link.*not.*substitute/isu,
    /adopt.*adapt.*formulate.*defer/isu,
    /## Parallel worker contract/u,
    /## Conflict resolution and synthesis/u,
  ]);
});

test("concept-entry-model: one format-neutral record owns ten semantic groups and missing states", () => {
  const source = read("references/concept-entry-model.md");
  assert.match(source, /format-neutral.*not an executable schema/isu);
  const groups = [
    "Definition",
    "Identity and designations",
    "ConceptBrief",
    "Characteristics and boundaries",
    "Typed concept system",
    "Reuse, formulation, and mapping",
    "Evidence and provenance",
    "Validation",
    "Active-profile extensions",
    "Governance and maintenance",
  ];
  for (const group of groups)
    assert.match(source, new RegExp(`## [0-9]+\\. ${group}`, "iu"));
  assertMatchesAll(source, [
    /preferred.*alternative.*hidden.*deprecated.*forbidden.*candidate/isu,
    /positive examples.*negative examples.*counterexamples.*near misses/isu,
    /superordinate.*broader.*narrower.*coordinate.*partitive.*associative.*causal.*temporal.*agent-role.*quality-bearer.*information-content.*carrier/isu,
    /absent.*unknown.*not applicable.*contested.*intentionally withheld.*not checked.*unsupported/isu,
    /never mint.*identifier/isu,
  ]);
});

test("presentation: three projections are definition-first, proportional, and blocker-aware", () => {
  const source = read("references/concept-entry-presentation.md");
  assertMatchesAll(source, [
    /## Definition answer/u,
    /## Revision audit/u,
    /## Concept package/u,
    /first substantive block.*definition/isu,
    /warning.*clarification.*before the definition.*materially mislead|no responsible definition/isu,
    /omit empty sections/iu,
    /defect.*consequence.*remedy/isu,
    /definition.*identity and designations.*purpose.*scope.*characteristics.*typed relations.*evidence.*profile.*status.*maintenance/isu,
    /concept package.*boundary.*reuse.*Adopt.*Adapt.*Formulate.*Defer.*positive.*negative.*near miss/isu,
    /explicit.*label.*Disposition.*Adopt.*Adapt.*Formulate.*Defer.*not.*implicit/isu,
    /same.*concept identity.*disposition.*status.*evidence.*blocker/isu,
  ]);
  assert.doesNotMatch(
    source,
    /exactly five|five[- ]section|generic numbered/iu,
  );
});

test("serialization: machine output is conditional, versioned, state-preserving, and honest", () => {
  const source = read("references/concept-entry-serialization.md");
  assertMatchesAll(source, [
    /only when.*explicit.*machine-readable/isu,
    /without a representation.*versioned plain JSON/isu,
    /JSON-LD.*RDF.*SKOS.*OWL.*TBX.*OntoLex-Lemon/isu,
    /absent.*unknown.*not applicable.*contested.*intentionally withheld.*not checked.*unsupported/isu,
    /never mint.*identifier/isu,
    /parser.*schema.*SHACL.*reasoner.*performed.*failed.*not run.*not applicable/isu,
    /must not claim.*conformance.*resemblance/isu,
    /definition text.*concept identity.*disposition.*status.*evidence.*blocker/isu,
  ]);
});

test("profiles: every specialist file follows the common composable contract", () => {
  const profilePaths = plannedReferences.filter((item) =>
    item.startsWith("profiles/"),
  );
  const headings = [
    "Activation",
    "Additional questions",
    "Semantic distinctions",
    "Evidence",
    "Validation",
    "Prohibited claims",
    "Completion additions",
    "Reviewed sources",
    "Composition notes",
  ];
  for (const profilePath of profilePaths) {
    const source = read(`references/${profilePath}`);
    for (const heading of headings)
      assert.match(
        source,
        new RegExp(`^## ${heading}$`, "imu"),
        `${profilePath}: ${heading}`,
      );
    assert.match(source, /terminology core/iu);
  }
});

test("profiles: specialist semantics remain additive and scope-safe", () => {
  const data = read("references/profiles/data-definitions.md");
  const kos = read("references/profiles/knowledge-organization-systems.md");
  const ontology = read("references/profiles/formal-ontology.md");
  const multilingual = read("references/profiles/multilingual-terminology.md");
  const governance = read("references/profiles/epistemic-governance.md");
  assertMatchesAll(data, [
    /ISO\/IEC 11179-4:2004/u,
    /ISO\/IEC 11179-5:2015/u,
    /data element concept.*object class.*property.*conceptual domain.*value domain.*permissible value.*representation/isu,
    /fallback.*must not.*compliance.*registry acceptance/isu,
  ]);
  assertMatchesAll(kos, [
    /ISO 25964-1:2011/u,
    /ISO 25964-2:2013/u,
    /SKOS.*18 August 2009/isu,
    /broader.*narrower.*partitive.*associative/isu,
    /exact.*close.*broad.*narrow.*related.*mapping/isu,
    /SKOS concept.*OWL class/isu,
  ]);
  assertMatchesAll(ontology, [
    /competency questions.*intended inferences/isu,
    /class.*individual.*property.*role.*quality.*process.*information object.*carrier/isu,
    /necessary.*sufficient.*constraint.*mapping/isu,
    /OntoClean/iu,
    /OBO.*CIDOC CRM/isu,
    /proposed.*parser.*SHACL.*reasoner.*conceptual correctness/isu,
  ]);
  assertMatchesAll(multilingual, [
    /concept orientation.*translation/isu,
    /language variety.*script.*jurisdiction.*designation status/isu,
    /full.*partial.*directional.*pragmatic.*absent equivalence/isu,
    /ISO 30042:2019.*TBX/isu,
    /OntoLex-Lemon.*Community Group Report/isu,
    /native.*community review.*not.*occurred/isu,
  ]);
  assertMatchesAll(governance, [
    /whose knowledge.*standpoint.*jurisdiction.*authority.*affected/isu,
    /empirical.*terminological.*normative.*perspective-dependent/isu,
    /CARE.*collective benefit.*authority.*responsibility.*ethics/isu,
    /FAIR.*does not.*legitimacy/isu,
    /provisional.*co-governance.*defer/isu,
  ]);
  assert.match(data, /compose.*multilingual/iu);
  assert.match(kos, /compose.*multilingual/iu);
  assert.match(ontology, /compose.*epistemic governance/iu);
  assert.match(data, /ordinary concept.*must not.*data-specific/isu);
});
