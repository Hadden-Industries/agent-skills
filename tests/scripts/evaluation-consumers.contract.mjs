import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkConformance } from "../../scripts/evaluation/check-conformance.js";
import { repositoryRoot } from "../../scripts/evaluation/toolchain.js";

test("pinned consumers independently load and execute deterministic fixtures", async () => {
  const receipt = await checkConformance();
  const report = JSON.parse(
    readFileSync(
      join(receipt.root, "skill-up-results/iteration-1/report.json"),
      "utf8",
    ),
  );
  assert.equal(report.case_results.length, 1);
  const result = report.case_results[0];
  assert.equal(result.case_id, "marker");
  assert.equal(result.status, "PASS");
  assert.equal(result.response, "qualification-marker");
  assert.equal(result.prompt, "Reply with the literal qualification marker.");
  assert.equal(result.grading.summary.total, 1);
  assert.equal(result.grading.summary.passed, 1);
  assert.equal(receipt.independent.withSkillFileCount, 2);
  assert.equal(receipt.independent.withoutSkillFileCount, 0);
  assert.notEqual(receipt.status, "qualified");
});

for (const fakeOutcome of ["wrong-marker", "error"]) {
  test(`consumer smoke cannot pass when fake engine returns ${fakeOutcome}`, async () => {
    await assert.rejects(
      checkConformance({ fakeOutcome }),
      /skill-up run failed|FAIL.*PASS|ERROR.*PASS/su,
    );
  });
}

test("ambient credentials, config and dotenv sentinels do not reach consumer workspace", (t) => {
  const ambient = mkdtempSync(join(tmpdir(), "consumer-ambient-"));
  t.after(() => rmSync(ambient, { recursive: true, force: true }));
  const sentinel = "AMBIENT_MUST_NOT_REACH_ENGINE";
  mkdirSync(join(ambient, ".config/skill-up"), { recursive: true });
  writeFileSync(join(ambient, ".config/skill-up/config.yaml"), "invalid: [");
  writeFileSync(join(ambient, ".skill-up.yaml"), "invalid: [");
  writeFileSync(
    join(ambient, ".env"),
    `OPENAI_API_KEY=${sentinel}\nANTHROPIC_API_KEY=${sentinel}\n`,
  );
  const result = spawnSync(
    process.execPath,
    [join(repositoryRoot, "scripts/evaluation/check-conformance.js")],
    {
      cwd: ambient,
      encoding: "utf8",
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: ambient,
        USERPROFILE: ambient,
        XDG_CONFIG_HOME: ambient,
        SKILL_UP_CONFIG: join(ambient, ".skill-up.yaml"),
        OPENAI_API_KEY: sentinel,
        ANTHROPIC_API_KEY: sentinel,
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:1",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(sentinel));
  assert.equal(JSON.parse(result.stdout).status, "consumer-smoke-passed");
});
