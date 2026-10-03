import { parse, stringify } from "yaml";
import { canonicalJsonBytes, sha256Hex } from "./runtime.js";
import { freezeContract } from "./json-contract.js";

/** Static projection never authorizes a target or converts prose into rules. */
export function projectSkillUp(compiled, { caseIds } = {}) {
  const selected = caseIds ?? compiled.cases.map(({ id }) => id);
  if (!selected.length || new Set(selected).size !== selected.length)
    throw new Error("Select distinct cases");
  const cases = selected.map((id) => {
    const value = compiled.cases.find((candidate) => candidate.id === id);
    if (!value) throw new Error(`Unknown projected case: ${id}`);
    const document = {
      id: `case-${id}`,
      title: `${compiled.skill_name}/${id}`,
      description: JSON.stringify({
        expected_output: value.expected_output,
        assertions: value.assertions,
      }),
      input: { prompt: value.prompt },
      constraints: { max_turns: 1 },
      expect: { exit_code: 0 },
    };
    const yaml = stringify(document, { lineWidth: 0 });
    if (!canonicalJsonBytes(parse(yaml)).equals(canonicalJsonBytes(document)))
      throw new Error(`Lossy YAML projection: ${id}`);
    return {
      id,
      path: `evals/cases/case-${id}.yaml`,
      yaml,
      identity: value.identity.completeCaseSha256,
      coverage: {
        id: "emitted: case id",
        prompt: "emitted: input.prompt",
        files: "enforced: confined workspace fixture inventory",
        expected_output:
          "retained: description judge context; rule judge does not grade it",
        assertions:
          "retained: description judge context; natural-language grading unsupported by rule judge",
        follow_up_turns: value.follow_up_turns
          ? "unsupported: initial-turn projection cannot claim full conversation"
          : "absent",
        required_capabilities: value.required_capabilities
          ? "unsupported: portable consumer grants no capabilities"
          : "absent",
        assurance:
          "retained: compiled identity; portable consumer does not enforce Hadden assurance",
      },
      eligibleClaims: ["format-conformance", "initial-input-delivery"],
    };
  });
  const receipt = {
    schemaVersion: 1,
    projectorVersion: 1,
    consumer: "skill-up@0.12.0",
    compiledSuiteSha256: compiled.compiledSuiteSha256,
    profile: compiled.profile,
    cases: cases.map(({ yaml, ...value }) => ({
      ...value,
      sha256: sha256Hex(Buffer.from(yaml)),
    })),
  };
  return freezeContract({
    cases,
    receipt,
    receiptSha256: sha256Hex(canonicalJsonBytes(receipt)),
  });
}
