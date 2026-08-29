import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCapabilityReconciliation,
  extractSkillCompatibility,
  reconcileEvaluationCapabilities,
} from "../../scripts/evaluation/capability-reconciliation.js";
import {
  canonicalJsonBytes,
  sha256Hex,
} from "../../scripts/evaluation/runtime.js";

const currentCompatibility =
  "Requires an agent with web search and URL-fetching tools for vocabulary research and source verification; no bundled scripts or additional runtimes.";
const candidateCompatibility =
  "Requires access to bundled skill files. Tasks that require current external evidence also require web search and URL fetching.";
const arms = Object.freeze(["no-skill", "current-skill", "candidate-skill"]);

function bundle(arm, compatibility) {
  const sourceKind = arm === "current-skill" ? "git" : "working-tree";
  const content = `---\nname: defining-concepts\ndescription: Fixture skill.\ncompatibility: ${compatibility}\n---\n\n# Fixture\n`;
  const bytes = Buffer.from(content, "utf8");
  const payload = {
    schemaVersion: 1,
    skillName: "defining-concepts",
    source:
      sourceKind === "git"
        ? {
            kind: sourceKind,
            commitOid: "1".repeat(40),
            treeOid: "2".repeat(40),
          }
        : {
            kind: sourceKind,
            headCommitOid: "3".repeat(40),
            headTreeOid: "4".repeat(40),
          },
    files: [
      {
        path: "skills/defining-concepts/SKILL.md",
        content,
        byteLength: bytes.byteLength,
        sha256: sha256Hex(bytes),
      },
    ],
  };
  return {
    ...payload,
    aggregateSha256: sha256Hex(canonicalJsonBytes(payload)),
  };
}

function contract() {
  return {
    schema_version: 1,
    capability_ids: ["bundled-skill-files", "url-fetch", "web-search"],
    arm_requirements: {
      "no-skill": [],
      "current-skill": ["bundled-skill-files"],
      "candidate-skill": ["bundled-skill-files"],
    },
    compatibility_interpretations: [
      {
        arm: "current-skill",
        exact_text: currentCompatibility,
        always_required_capabilities: [],
        conditional_case_capabilities: ["url-fetch", "web-search"],
      },
      {
        arm: "candidate-skill",
        exact_text: candidateCompatibility,
        always_required_capabilities: ["bundled-skill-files"],
        conditional_case_capabilities: ["url-fetch", "web-search"],
      },
    ],
    campaign_policy: {
      default: "deny",
      allowed_capabilities: ["bundled-skill-files", "url-fetch", "web-search"],
      uniform_across_arms: true,
    },
  };
}

function selectedCases() {
  return [
    {
      id: 1,
      required_capabilities: ["url-fetch", "web-search"],
    },
    { id: 2, required_capabilities: [] },
  ];
}

function providerResolution() {
  return {
    provider: "openai",
    supportedCapabilities: ["bundled-skill-files", "url-fetch", "web-search"],
    enabledCapabilities: ["bundled-skill-files", "url-fetch", "web-search"],
    bindings: [
      {
        capability: "bundled-skill-files",
        mechanism: "harness-controlled-input",
      },
      { capability: "url-fetch", mechanism: "native-web-search" },
      { capability: "web-search", mechanism: "native-web-search" },
    ],
    runtimeCapabilities: {
      network: false,
      webSearch: true,
      tools: [],
      providerFacilities: [],
    },
  };
}

function rehashBundle(value) {
  for (const file of value.files) {
    const bytes = Buffer.from(file.content, "utf8");
    file.byteLength = bytes.byteLength;
    file.sha256 = sha256Hex(bytes);
  }
  value.aggregateSha256 = sha256Hex(
    canonicalJsonBytes({
      schemaVersion: value.schemaVersion,
      skillName: value.skillName,
      source: value.source,
      files: value.files,
    }),
  );
}

function inputs(overrides = {}) {
  return {
    suite: "defining-concepts",
    contract: contract(),
    cases: selectedCases(),
    arms,
    skillBundles: {
      "current-skill": bundle("current-skill", currentCompatibility),
      "candidate-skill": bundle("candidate-skill", candidateCompatibility),
    },
    providerResolution: providerResolution(),
    ...overrides,
  };
}

test("extractSkillCompatibility reads the exact standard frontmatter value", () => {
  const candidate = inputs().skillBundles["candidate-skill"];

  assert.deepEqual(extractSkillCompatibility(candidate), {
    text: candidateCompatibility,
    skillFileSha256: candidate.files[0].sha256,
  });
});

test("reconciliation emits one frozen canonical campaign receipt", () => {
  const reconciliation = reconcileEvaluationCapabilities(inputs());

  assert.equal(Object.isFrozen(reconciliation), true);
  assert.equal(Object.isFrozen(reconciliation.receipt), true);
  assert.equal(reconciliation.schemaVersion, 1);
  assert.equal(
    reconciliation.receiptSha256,
    sha256Hex(canonicalJsonBytes(reconciliation.receipt)),
  );
  assert.deepEqual(reconciliation.receipt.selectedCaseIds, [1, 2]);
  assert.deepEqual(reconciliation.receipt.arms, arms);
  assert.deepEqual(reconciliation.receipt.requiredCapabilities, [
    "bundled-skill-files",
    "url-fetch",
    "web-search",
  ]);
  assert.deepEqual(reconciliation.receipt.runtimeCapabilities, {
    network: false,
    providerFacilities: [],
    tools: [],
    webSearch: true,
  });
  assert.deepEqual(
    reconciliation.receipt.compatibility.map(({ arm, exactText }) => ({
      arm,
      exactText,
    })),
    [
      { arm: "current-skill", exactText: currentCompatibility },
      { arm: "candidate-skill", exactText: candidateCompatibility },
    ],
  );
  assert.equal(assertCapabilityReconciliation(reconciliation), reconciliation);
});

test("canonical identity is independent of input object insertion order", () => {
  const firstInputs = inputs();
  const secondInputs = inputs({
    providerResolution: {
      runtimeCapabilities: {
        tools: [],
        providerFacilities: [],
        webSearch: true,
        network: false,
      },
      bindings: [...providerResolution().bindings].reverse(),
      enabledCapabilities: ["web-search", "bundled-skill-files", "url-fetch"],
      supportedCapabilities: ["web-search", "url-fetch", "bundled-skill-files"],
      provider: "openai",
    },
  });

  assert.equal(
    reconcileEvaluationCapabilities(firstInputs).receiptSha256,
    reconcileEvaluationCapabilities(secondInputs).receiptSha256,
  );
});

for (const [name, mutate, expected] of [
  [
    "missing compatibility",
    (value) => {
      value.skillBundles["candidate-skill"].files[0].content =
        "---\nname: defining-concepts\n---\n\n# Fixture\n";
    },
    /compatibility.*required/iu,
  ],
  [
    "duplicate compatibility",
    (value) => {
      value.skillBundles["candidate-skill"].files[0].content =
        value.skillBundles["candidate-skill"].files[0].content.replace(
          "---\n\n# Fixture",
          `compatibility: ${candidateCompatibility}\n---\n\n# Fixture`,
        );
    },
    /compatibility.*exactly once/iu,
  ],
  [
    "changed compatibility",
    (value) => {
      value.contract.compatibility_interpretations[1].exact_text =
        "Different reviewed text.";
    },
    /unreviewed|exact/iu,
  ],
  [
    "missing arm interpretation",
    (value) => {
      value.contract.compatibility_interpretations.pop();
    },
    /interpretation.*candidate-skill/iu,
  ],
]) {
  test(`reconciliation fails closed for ${name}`, () => {
    const value = structuredClone(inputs());
    mutate(value);
    rehashBundle(value.skillBundles["current-skill"]);
    rehashBundle(value.skillBundles["candidate-skill"]);
    assert.throws(() => reconcileEvaluationCapabilities(value), expected);
  });
}

test("suggestive unreviewed prose never grants or infers a capability", () => {
  const value = structuredClone(inputs());
  const candidate = value.skillBundles["candidate-skill"];
  candidate.files[0].content = candidate.files[0].content.replace(
    candidateCompatibility,
    "Web search and URL fetch are definitely available.",
  );
  rehashBundle(candidate);

  assert.throws(
    () => reconcileEvaluationCapabilities(value),
    /unreviewed.*compatibility/iu,
  );
});

for (const [name, mutate, expected] of [
  [
    "a denied requirement",
    (value) => {
      value.contract.campaign_policy.allowed_capabilities = [
        "bundled-skill-files",
        "web-search",
      ];
    },
    /denied.*url-fetch/iu,
  ],
  [
    "an unavailable requirement",
    (value) => {
      value.providerResolution.supportedCapabilities = [
        "bundled-skill-files",
        "web-search",
      ];
    },
    /unavailable.*url-fetch/iu,
  ],
  [
    "an undeclared enabled capability",
    (value) => {
      value.providerResolution.enabledCapabilities.push("image-generation");
      value.providerResolution.bindings.push({
        capability: "image-generation",
        mechanism: "provider-facility",
      });
    },
    /undeclared.*image-generation/iu,
  ],
  [
    "an extra enabled capability",
    (value) => {
      value.cases[0].required_capabilities = ["web-search"];
      value.contract.compatibility_interpretations[0].conditional_case_capabilities =
        ["web-search"];
      value.contract.compatibility_interpretations[1].conditional_case_capabilities =
        ["web-search"];
      value.contract.campaign_policy.allowed_capabilities = [
        "bundled-skill-files",
        "web-search",
      ];
      value.contract.capability_ids = [
        "bundled-skill-files",
        "web-search",
        "url-fetch",
      ];
    },
    /extra.*url-fetch/iu,
  ],
]) {
  test(`reconciliation rejects ${name}`, () => {
    const value = structuredClone(inputs());
    mutate(value);
    assert.throws(() => reconcileEvaluationCapabilities(value), expected);
  });
}

test("a case requirement must be declared by every skill interpretation", () => {
  const value = structuredClone(inputs());
  value.contract.compatibility_interpretations[0].conditional_case_capabilities =
    ["web-search"];

  assert.throws(
    () => reconcileEvaluationCapabilities(value),
    /current-skill.*url-fetch.*case/iu,
  );
});

test("no-skill has no compatibility source while every arm shares one envelope", () => {
  const reconciliation = reconcileEvaluationCapabilities(inputs());

  assert.equal(
    reconciliation.receipt.compatibility.some(({ arm }) => arm === "no-skill"),
    false,
  );
  assert.deepEqual(
    reconciliation.receipt.armEnvelopes,
    arms.map((arm) => ({
      arm,
      capabilities: ["bundled-skill-files", "url-fetch", "web-search"],
    })),
  );
});

test("receipt validation detects any changed authenticated field", () => {
  const reconciliation = reconcileEvaluationCapabilities(inputs());
  const changed = structuredClone(reconciliation);
  changed.receipt.runtimeCapabilities.webSearch = false;

  assert.throws(
    () => assertCapabilityReconciliation(changed),
    /receipt digest/iu,
  );
});
