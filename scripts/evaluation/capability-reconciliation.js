import { canonicalJsonBytes, sha256Hex } from "./runtime.js";

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const SKILL_ARMS = Object.freeze(["current-skill", "candidate-skill"]);
const CANONICAL_ARMS = Object.freeze([
  "no-skill",
  "current-skill",
  "candidate-skill",
]);

function fail(message) {
  throw new Error(message);
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((name, index) => name !== wanted[index])
  ) {
    fail(`${label} contains missing or unknown members`);
  }
}

function assertNonemptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a nonempty string`);
  }
}

function sortedUniqueCapabilities(
  value,
  label,
  declared,
  allowUndeclared = false,
) {
  if (!Array.isArray(value)) {
    fail(`${label} must be an array`);
  }
  const capabilities = [];
  const seen = new Set();
  for (const capability of value) {
    if (
      typeof capability !== "string" ||
      !CAPABILITY_ID_PATTERN.test(capability)
    ) {
      fail(`${label} contains an invalid capability ID`);
    }
    if (seen.has(capability)) {
      fail(`${label} contains duplicate capability ${capability}`);
    }
    if (!allowUndeclared && !declared.has(capability)) {
      fail(`${label} contains undeclared capability ${capability}`);
    }
    seen.add(capability);
    capabilities.push(capability);
  }
  return capabilities.sort((left, right) => left.localeCompare(right, "en"));
}

function canonicalSnapshot(value) {
  return JSON.parse(canonicalJsonBytes(value).toString("utf8"));
}

function freezeDeep(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function assertBundleIntegrity(bundle) {
  assertExactKeys(
    bundle,
    ["aggregateSha256", "files", "schemaVersion", "skillName", "source"],
    "skill bundle",
  );
  if (bundle.schemaVersion !== 1) fail("skill bundle schema is unsupported");
  assertNonemptyString(bundle.skillName, "skill bundle skillName");
  if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
    fail("skill bundle files must be nonempty");
  }
  for (const [index, file] of bundle.files.entries()) {
    assertExactKeys(
      file,
      ["byteLength", "content", "path", "sha256"],
      `skill bundle file ${index}`,
    );
    assertNonemptyString(file.path, `skill bundle file ${index} path`);
    if (typeof file.content !== "string") {
      fail(`skill bundle file ${index} content must be a string`);
    }
    const bytes = Buffer.from(file.content, "utf8");
    if (
      file.byteLength !== bytes.byteLength ||
      file.sha256 !== sha256Hex(bytes)
    ) {
      fail(`skill bundle file ${index} digest does not match its content`);
    }
  }
  const payload = {
    schemaVersion: bundle.schemaVersion,
    skillName: bundle.skillName,
    source: bundle.source,
    files: bundle.files,
  };
  if (bundle.aggregateSha256 !== sha256Hex(canonicalJsonBytes(payload))) {
    fail("skill bundle aggregate digest does not match its content");
  }
}

function compatibilityFromSkillSource(source) {
  const lines = source.split(/\r?\n/u);
  if (lines[0] !== "---") {
    fail("SKILL.md must begin with standard frontmatter");
  }
  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex < 0) fail("SKILL.md frontmatter is not closed");
  const matches = lines
    .slice(1, closingIndex)
    .filter((line) => line.startsWith("compatibility:"));
  if (matches.length === 0) fail("SKILL.md compatibility is required");
  if (matches.length !== 1) {
    fail("SKILL.md compatibility must appear exactly once");
  }
  const suffix = matches[0].slice("compatibility:".length);
  if (!suffix.startsWith(" ") || suffix.trim().length === 0) {
    fail("SKILL.md compatibility must be a nonempty plain scalar");
  }
  if (suffix !== ` ${suffix.trim()}`) {
    fail("SKILL.md compatibility contains noncanonical whitespace");
  }
  return suffix.trim();
}

export function extractSkillCompatibility(bundle) {
  assertBundleIntegrity(bundle);
  const skillPath = `skills/${bundle.skillName}/SKILL.md`;
  const skillFiles = bundle.files.filter(({ path }) => path === skillPath);
  if (skillFiles.length !== 1) {
    fail(`skill bundle must contain exactly one ${skillPath}`);
  }
  return freezeDeep({
    text: compatibilityFromSkillSource(skillFiles[0].content),
    skillFileSha256: skillFiles[0].sha256,
  });
}

function normalizedContract(value, arms) {
  assertExactKeys(
    value,
    [
      "arm_requirements",
      "campaign_policy",
      "capability_ids",
      "compatibility_interpretations",
      "schema_version",
    ],
    "capability contract",
  );
  if (value.schema_version !== 1) {
    fail("capability contract schema_version must be 1");
  }
  const capabilityIds = sortedUniqueCapabilities(
    value.capability_ids,
    "capability contract capability_ids",
    new Set(),
    true,
  );
  if (capabilityIds.length === 0) {
    fail("capability contract capability_ids must be nonempty");
  }
  const declared = new Set(capabilityIds);

  assertExactKeys(value.arm_requirements, arms, "arm requirements");
  const armRequirements = arms.map((arm) => ({
    arm,
    capabilities: sortedUniqueCapabilities(
      value.arm_requirements[arm],
      `arm requirements for ${arm}`,
      declared,
    ),
  }));

  if (!Array.isArray(value.compatibility_interpretations)) {
    fail("compatibility interpretations must be an array");
  }
  const interpretationsByArm = new Map();
  for (const [
    index,
    interpretation,
  ] of value.compatibility_interpretations.entries()) {
    const label = `compatibility interpretation ${index}`;
    assertExactKeys(
      interpretation,
      [
        "always_required_capabilities",
        "arm",
        "conditional_case_capabilities",
        "exact_text",
      ],
      label,
    );
    if (!SKILL_ARMS.includes(interpretation.arm)) {
      fail(`${label} has an unsupported arm`);
    }
    if (interpretationsByArm.has(interpretation.arm)) {
      fail(
        `compatibility interpretation for ${interpretation.arm} is duplicate`,
      );
    }
    assertNonemptyString(interpretation.exact_text, `${label} exact_text`);
    interpretationsByArm.set(interpretation.arm, {
      arm: interpretation.arm,
      exactText: interpretation.exact_text,
      alwaysRequiredCapabilities: sortedUniqueCapabilities(
        interpretation.always_required_capabilities,
        `${label} always_required_capabilities`,
        declared,
      ),
      conditionalCaseCapabilities: sortedUniqueCapabilities(
        interpretation.conditional_case_capabilities,
        `${label} conditional_case_capabilities`,
        declared,
      ),
    });
  }
  for (const arm of SKILL_ARMS) {
    if (!interpretationsByArm.has(arm)) {
      fail(`compatibility interpretation for ${arm} is required`);
    }
  }

  assertExactKeys(
    value.campaign_policy,
    ["allowed_capabilities", "default", "uniform_across_arms"],
    "campaign policy",
  );
  if (value.campaign_policy.default !== "deny") {
    fail("campaign policy default must be deny");
  }
  if (value.campaign_policy.uniform_across_arms !== true) {
    fail("campaign policy must apply uniformly across arms");
  }
  const policy = {
    default: "deny",
    allowedCapabilities: sortedUniqueCapabilities(
      value.campaign_policy.allowed_capabilities,
      "campaign policy allowed_capabilities",
      declared,
    ),
    uniformAcrossArms: true,
  };
  return {
    schemaVersion: 1,
    capabilityIds,
    armRequirements,
    interpretations: SKILL_ARMS.map((arm) => interpretationsByArm.get(arm)),
    policy,
  };
}

function normalizedCases(cases, declared) {
  if (!Array.isArray(cases) || cases.length === 0) {
    fail("selected cases must be a nonempty array");
  }
  const seen = new Set();
  return cases
    .map((evaluationCase, index) => {
      assertPlainObject(evaluationCase, `selected case ${index}`);
      if (!Number.isSafeInteger(evaluationCase.id) || evaluationCase.id <= 0) {
        fail(`selected case ${index} has an invalid ID`);
      }
      if (seen.has(evaluationCase.id)) {
        fail(`selected cases contain duplicate ID ${evaluationCase.id}`);
      }
      seen.add(evaluationCase.id);
      return {
        caseId: evaluationCase.id,
        capabilities: sortedUniqueCapabilities(
          evaluationCase.required_capabilities,
          `case ${evaluationCase.id} required_capabilities`,
          declared,
        ),
      };
    })
    .sort((left, right) => left.caseId - right.caseId);
}

function normalizedProviderResolution(value, declared, required) {
  assertExactKeys(
    value,
    [
      "bindings",
      "enabledCapabilities",
      "provider",
      "runtimeCapabilities",
      "supportedCapabilities",
    ],
    "provider resolution",
  );
  assertNonemptyString(value.provider, "provider resolution provider");
  const supportedCapabilities = sortedUniqueCapabilities(
    value.supportedCapabilities,
    "provider resolution supportedCapabilities",
    declared,
    true,
  );
  const supported = new Set(supportedCapabilities);
  for (const capability of required) {
    if (!supported.has(capability)) {
      fail(`provider capability unavailable: ${capability}`);
    }
  }

  const enabledCapabilities = sortedUniqueCapabilities(
    value.enabledCapabilities,
    "provider resolution enabledCapabilities",
    declared,
  );
  const enabled = new Set(enabledCapabilities);
  for (const capability of required) {
    if (!enabled.has(capability)) {
      fail(`provider resolution omitted required capability ${capability}`);
    }
  }
  for (const capability of enabledCapabilities) {
    if (!required.has(capability)) {
      fail(`provider resolution enabled extra capability ${capability}`);
    }
  }

  if (!Array.isArray(value.bindings)) {
    fail("provider resolution bindings must be an array");
  }
  const bindings = value.bindings.map((binding, index) => {
    const label = `provider resolution binding ${index}`;
    assertExactKeys(binding, ["capability", "mechanism"], label);
    if (!enabled.has(binding.capability)) {
      if (!declared.has(binding.capability)) {
        fail(
          `provider resolution binding contains undeclared capability ${binding.capability}`,
        );
      }
      fail(
        `provider resolution binding contains extra capability ${binding.capability}`,
      );
    }
    assertNonemptyString(binding.mechanism, `${label} mechanism`);
    return {
      capability: binding.capability,
      mechanism: binding.mechanism,
    };
  });
  bindings.sort((left, right) =>
    left.capability.localeCompare(right.capability, "en"),
  );
  if (
    bindings.length !== enabledCapabilities.length ||
    bindings.some(
      ({ capability }, index) => capability !== enabledCapabilities[index],
    )
  ) {
    fail("provider resolution must bind each enabled capability exactly once");
  }
  assertPlainObject(value.runtimeCapabilities, "provider runtime capabilities");
  canonicalJsonBytes(value.runtimeCapabilities);
  return {
    provider: value.provider,
    supportedCapabilities,
    enabledCapabilities,
    bindings,
    runtimeCapabilities: canonicalSnapshot(value.runtimeCapabilities),
  };
}

function assertCanonicalArms(arms) {
  if (
    !Array.isArray(arms) ||
    arms.length !== CANONICAL_ARMS.length ||
    arms.some((arm, index) => arm !== CANONICAL_ARMS[index])
  ) {
    fail(
      "arms must use the canonical no-skill/current-skill/candidate-skill order",
    );
  }
}

export function assertEvaluationCapabilityDefinition({
  definition,
  skillSource,
}) {
  assertPlainObject(definition, "evaluation definition");
  const evaluations = Array.isArray(definition.evals) ? definition.evals : [];
  const hasContract = Object.hasOwn(definition, "capability_contract");
  const hasCaseDeclarations = evaluations.some(
    (evaluationCase) =>
      evaluationCase !== null &&
      typeof evaluationCase === "object" &&
      !Array.isArray(evaluationCase) &&
      Object.hasOwn(evaluationCase, "required_capabilities"),
  );
  const usesCapabilitySchema =
    definition.schema_version === 3 || hasContract || hasCaseDeclarations;

  if (!usesCapabilitySchema) return null;
  if (definition.schema_version !== 3) {
    fail("capability declarations require evals schema_version 3");
  }
  if (!hasContract) {
    fail("evals schema_version 3 requires capability_contract");
  }
  if (typeof skillSource !== "string") {
    fail("canonical SKILL.md source is required for capability reconciliation");
  }

  const contract = normalizedContract(
    definition.capability_contract,
    CANONICAL_ARMS,
  );
  const declared = new Set(contract.capabilityIds);
  const cases = normalizedCases(definition.evals, declared);
  const canonicalCompatibility = compatibilityFromSkillSource(skillSource);
  const candidateInterpretation = contract.interpretations.find(
    ({ arm }) => arm === "candidate-skill",
  );
  if (candidateInterpretation.exactText !== canonicalCompatibility) {
    fail(
      "candidate-skill compatibility interpretation does not exactly match SKILL.md",
    );
  }

  for (const interpretation of contract.interpretations) {
    const interpretedCapabilities = new Set([
      ...interpretation.alwaysRequiredCapabilities,
      ...interpretation.conditionalCaseCapabilities,
    ]);
    for (const evaluationCase of cases) {
      for (const capability of evaluationCase.capabilities) {
        if (!interpretedCapabilities.has(capability)) {
          fail(
            `${interpretation.arm} does not declare ${capability} for case requirements`,
          );
        }
      }
    }
  }

  const required = new Set();
  for (const { capabilities } of contract.armRequirements) {
    for (const capability of capabilities) required.add(capability);
  }
  for (const interpretation of contract.interpretations) {
    for (const capability of interpretation.alwaysRequiredCapabilities) {
      required.add(capability);
    }
  }
  for (const evaluationCase of cases) {
    for (const capability of evaluationCase.capabilities) {
      required.add(capability);
    }
  }
  const allowed = new Set(contract.policy.allowedCapabilities);
  for (const capability of required) {
    if (!allowed.has(capability)) {
      fail(`campaign policy denied required capability ${capability}`);
    }
  }

  return freezeDeep({
    schemaVersion: 3,
    canonicalCompatibility,
    declaredCapabilities: contract.capabilityIds,
    requiredCapabilities: [...required].sort((left, right) =>
      left.localeCompare(right, "en"),
    ),
  });
}

export function reconcileEvaluationCapabilities({
  suite,
  contract,
  cases,
  arms,
  skillBundles,
  providerResolution,
}) {
  assertNonemptyString(suite, "suite");
  assertCanonicalArms(arms);
  const normalized = normalizedContract(contract, arms);
  const declared = new Set(normalized.capabilityIds);
  const caseRequirements = normalizedCases(cases, declared);
  assertExactKeys(skillBundles, SKILL_ARMS, "skill bundles");

  const compatibility = normalized.interpretations.map((interpretation) => {
    const bundle = skillBundles[interpretation.arm];
    const extracted = extractSkillCompatibility(bundle);
    if (extracted.text !== interpretation.exactText) {
      fail(
        `unreviewed compatibility text for ${interpretation.arm}; exact interpretation required`,
      );
    }
    for (const caseRequirement of caseRequirements) {
      const declaredForArm = new Set([
        ...interpretation.alwaysRequiredCapabilities,
        ...interpretation.conditionalCaseCapabilities,
      ]);
      for (const capability of caseRequirement.capabilities) {
        if (!declaredForArm.has(capability)) {
          fail(
            `${interpretation.arm} does not declare ${capability} for case requirements`,
          );
        }
      }
    }
    return {
      arm: interpretation.arm,
      bundleSha256: bundle.aggregateSha256,
      skillFileSha256: extracted.skillFileSha256,
      exactText: extracted.text,
      interpretation: {
        alwaysRequiredCapabilities: interpretation.alwaysRequiredCapabilities,
        conditionalCaseCapabilities: interpretation.conditionalCaseCapabilities,
      },
    };
  });

  const required = new Set();
  for (const { capabilities } of normalized.armRequirements) {
    for (const capability of capabilities) required.add(capability);
  }
  for (const interpretation of normalized.interpretations) {
    for (const capability of interpretation.alwaysRequiredCapabilities) {
      required.add(capability);
    }
  }
  for (const { capabilities } of caseRequirements) {
    for (const capability of capabilities) required.add(capability);
  }
  const requiredCapabilities = [...required].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
  const allowed = new Set(normalized.policy.allowedCapabilities);
  for (const capability of requiredCapabilities) {
    if (!allowed.has(capability)) {
      fail(`campaign policy denied required capability ${capability}`);
    }
  }
  const resolution = normalizedProviderResolution(
    providerResolution,
    declared,
    required,
  );
  const receipt = canonicalSnapshot({
    schemaVersion: 1,
    suite,
    contractSha256: sha256Hex(canonicalJsonBytes(normalized)),
    selectedCaseIds: caseRequirements.map(({ caseId }) => caseId),
    arms: [...arms],
    compatibility,
    armRequirements: normalized.armRequirements,
    caseRequirements,
    requiredCapabilities,
    policy: normalized.policy,
    providerResolution: {
      provider: resolution.provider,
      supportedCapabilities: resolution.supportedCapabilities,
      enabledCapabilities: resolution.enabledCapabilities,
      bindings: resolution.bindings,
    },
    runtimeCapabilities: resolution.runtimeCapabilities,
    armEnvelopes: arms.map((arm) => ({
      arm,
      capabilities: requiredCapabilities,
    })),
  });
  return freezeDeep({
    schemaVersion: 1,
    receipt,
    receiptSha256: sha256Hex(canonicalJsonBytes(receipt)),
  });
}

export function assertCapabilityReconciliation(value) {
  assertExactKeys(
    value,
    ["receipt", "receiptSha256", "schemaVersion"],
    "capability reconciliation",
  );
  if (value.schemaVersion !== 1) {
    fail("capability reconciliation schemaVersion must be 1");
  }
  assertPlainObject(value.receipt, "capability reconciliation receipt");
  if (
    typeof value.receiptSha256 !== "string" ||
    value.receiptSha256 !== sha256Hex(canonicalJsonBytes(value.receipt))
  ) {
    fail("capability reconciliation receipt digest does not match");
  }
  return value;
}
