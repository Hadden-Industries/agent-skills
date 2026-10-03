import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  authoredRuntimeFiles,
  regularFileInventory,
} from "../skillDistribution.js";
import { readContract, freezeContract } from "./json-contract.js";
import { evaluationProfile } from "./profile-registry.js";
import { canonicalJsonBytes, sha256Hex } from "./runtime.js";
import { assertRegularPath } from "./toolchain.js";
import { validateEvaluationConfiguration } from "../../src/committing-to-git/evals/assurance/v1/create-fixture-repository.mjs";
import { assertEvaluationCapabilityDefinition } from "./capability-reconciliation.js";

const ajv = new Ajv2020({ strict: true, allErrors: true });
const validators = Object.fromEntries(
  ["portable", "extension"].map((name) => [
    name,
    ajv.compile(
      readContract(new URL(`./schemas/${name}.schema.json`, import.meta.url)),
    ),
  ]),
);
const digest = (value) => sha256Hex(canonicalJsonBytes(value));
const compare = (a, b) =>
  Buffer.compare(Buffer.from(a.relativePath), Buffer.from(b.relativePath));

function inventory(files) {
  return [...files]
    .map(([relativePath, bytes]) => ({
      relativePath,
      byteLength: bytes.length,
      sha256: sha256Hex(bytes),
    }))
    .sort(compare);
}

export function portableCaseIdentity(evaluationCase, skillRoot) {
  const files = evaluationCase.files
    .map((relativePath) => {
      if (
        !/^evals\/files\//u.test(relativePath) ||
        relativePath.includes("\\") ||
        relativePath
          .split("/")
          .some(
            (part) =>
              !part || part === "." || part === ".." || part.includes(":"),
          )
      )
        throw new Error(`Unconfined fixture: ${relativePath}`);
      const path = resolve(skillRoot, relativePath);
      assertRegularPath(path);
      const bytes = readFileSync(path);
      return {
        relativePath,
        byteLength: bytes.length,
        sha256: sha256Hex(bytes),
      };
    })
    .sort(compare);
  const definitionSha256 = digest(evaluationCase);
  const inputSetSha256 = digest(files);
  return {
    definitionSha256,
    inputSetSha256,
    portableCaseSha256: digest({
      schemaVersion: 1,
      definitionSha256,
      inputSetSha256,
    }),
    files,
  };
}

function validate(name, value) {
  if (!validators[name](value))
    throw new Error(
      `Invalid ${name} contract: ${ajv.errorsText(validators[name].errors)}`,
    );
}

/** Join authored inputs once. No provider choice or execution authority is inferred. */
export function compileSuite({
  repositoryRoot,
  skillName,
  distributionFiles: intendedDistribution,
}) {
  const profile = evaluationProfile(skillName);
  const sourceRoot = join(repositoryRoot, "src", skillName);
  const portablePath = join(sourceRoot, "evals", "evals.json");
  const extensionPath = join(
    sourceRoot,
    "evals",
    "extensions",
    "v1",
    "suite.json",
  );
  assertRegularPath(portablePath);
  assertRegularPath(extensionPath);
  const portable = readContract(portablePath);
  const extension = readContract(extensionPath);
  validate("portable", portable);
  validate("extension", extension);
  if (
    portable.skill_name !== skillName ||
    extension.skill_name !== skillName ||
    extension.profile !== profile.id
  )
    throw new Error("Suite/profile identity mismatch");
  const ids = new Set();
  const cases = portable.evals.map((evaluationCase) => {
    if (ids.has(evaluationCase.id))
      throw new Error(`Duplicate case ID: ${evaluationCase.id}`);
    ids.add(evaluationCase.id);
    if (
      profile.retiredIds?.includes(evaluationCase.id) ||
      (profile.nextUnusedId && evaluationCase.id >= profile.nextUnusedId)
    )
      throw new Error(`Unregistered or retired case ID: ${evaluationCase.id}`);
    const identity = portableCaseIdentity(evaluationCase, sourceRoot);
    const protocol = extension.protocol.cases[evaluationCase.id] ?? {};
    const assurance = extension.assurance.cases[evaluationCase.id] ?? {};
    for (const attached of [protocol, assurance]) {
      if (
        Object.keys(attached).length &&
        attached.portableCaseSha256 !== identity.portableCaseSha256
      )
        throw new Error(`Stale portable case digest: ${evaluationCase.id}`);
    }
    const followUpIds = protocol.follow_up_turns?.map((turn) => turn.id) ?? [];
    if (new Set(followUpIds).size !== followUpIds.length)
      throw new Error(`Duplicate follow-up ID: ${evaluationCase.id}`);
    for (const index of assurance.critical_assertion_indexes ?? []) {
      if (index >= evaluationCase.assertions.length)
        throw new Error(
          `Critical assertion index outside case: ${evaluationCase.id}`,
        );
    }
    if (profile.id === "git-v1") {
      for (const field of [
        "case_key",
        "execution_mode",
        "fixture",
        "critical_safety",
        "cost_profile",
      ])
        if (!Object.hasOwn(assurance, field))
          throw new Error(`Missing Git case ${field}: ${evaluationCase.id}`);
      if (
        (assurance.execution_mode === "policy") !==
        (assurance.fixture === null)
      )
        throw new Error(
          `Fixture/execution mode mismatch: ${evaluationCase.id}`,
        );
    }
    if (
      profile.id === "defining-v1" &&
      !Object.hasOwn(protocol, "required_capabilities")
    )
      throw new Error(
        `Missing case capability declaration: ${evaluationCase.id}`,
      );
    const { portableCaseSha256: protocolBinding, ...protocolValues } = protocol;
    const { portableCaseSha256: assuranceBinding, ...assuranceValues } =
      assurance;
    void protocolBinding;
    void assuranceBinding;
    return {
      ...evaluationCase,
      ...protocolValues,
      ...assuranceValues,
      identity: {
        ...identity,
        completeCaseSha256: digest({
          portableCaseSha256: identity.portableCaseSha256,
          protocol,
          assurance,
          profile,
        }),
      },
    };
  });
  for (const section of [extension.protocol.cases, extension.assurance.cases])
    for (const id of Object.keys(section))
      if (!ids.has(Number(id))) throw new Error(`Orphan extension case: ${id}`);
  const suite = extension.assurance.suite;
  for (const campaign of Object.values(suite.campaigns ?? {}))
    for (const id of campaign.case_ids)
      if (!ids.has(id)) throw new Error(`Unknown campaign case: ${id}`);
  for (const id of suite.calibration_case_ids ?? [])
    if (!ids.has(id)) throw new Error(`Unknown calibration case: ${id}`);
  const sourceFiles = authoredRuntimeFiles(repositoryRoot, skillName);
  const distributionFiles =
    intendedDistribution ??
    regularFileInventory(join(repositoryRoot, "skills", skillName));
  for (const [path, bytes] of sourceFiles)
    if (!distributionFiles.get(path)?.equals(bytes))
      throw new Error(`Stale runtime distribution: ${skillName}/${path}`);
  const allowed = new Set(sourceFiles.keys());
  if (skillName === "committing-to-git")
    allowed.add("scripts/commitWorkflow.mjs");
  if (
    allowed.size !== distributionFiles.size ||
    [...distributionFiles.keys()].some((path) => !allowed.has(path))
  )
    throw new Error(`Unexpected or missing runtime payload: ${skillName}`);
  const distribution = inventory(distributionFiles);
  const source = inventory(regularFileInventory(sourceRoot));
  const result = {
    contractVersion: 1,
    skill_name: skillName,
    profile,
    portable,
    extension,
    definition: {
      contractVersion: 1,
      skill_name: skillName,
      ...(extension.provenance.notes
        ? { notes: extension.provenance.notes }
        : {}),
      ...suite,
      evals: cases.map(({ identity, ...values }) => {
        void identity;
        return values;
      }),
    },
    cases,
    source,
    distribution,
  };
  if (profile.id === "git-v1")
    validateEvaluationConfiguration(result.definition);
  assertEvaluationCapabilityDefinition({
    definition: result.definition,
    skillSource: sourceFiles.get("SKILL.md").toString("utf8"),
  });
  return freezeContract({ ...result, compiledSuiteSha256: digest(result) });
}
