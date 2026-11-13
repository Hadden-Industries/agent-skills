import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { ubuntuRunner } from "../../scripts/ci/runnerPolicy.js";
import { projectUbuntuRunners } from "../../scripts/ci/syncUbuntuRunners.js";

// Native contract from 0b5193609dbfbd45bb39db1f3ca4904dbf9a7498, with approved action release pins.
const originalWorkflows = {
  "committing-to-git-linux": {
    name: "Committing-to-git Linux verification",
    "run-name": "Committing-to-git Linux verification (${{ inputs.revision }})",
    on: {
      workflow_dispatch: {
        inputs: {
          revision: {
            description: "Repository commit, tag, or branch to verify",
            required: true,
            default: "main",
            type: "string",
          },
        },
      },
    },
    permissions: {
      contents: "read",
    },
    jobs: {
      verify: {
        "runs-on": "ubuntu-24.04",
        "timeout-minutes": 30,
        defaults: {
          run: {
            shell: "bash",
          },
        },
        steps: [
          {
            name: "Check out the requested revision",
            uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
            with: {
              ref: "${{ inputs.revision }}",
              "fetch-depth": 0,
              "persist-credentials": false,
            },
          },
          {
            name: "Set up Node.js",
            uses: "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
            with: {
              "node-version": "24",
              "package-manager-cache": false,
            },
          },
          {
            name: "Record the tested revision and environment",
            run: 'VERIFICATION_OUTPUT="$RUNNER_TEMP/committing-to-git-linux"\necho "VERIFICATION_OUTPUT=$VERIFICATION_OUTPUT" >> "$GITHUB_ENV"\nmkdir -p "$VERIFICATION_OUTPUT"\n{\n  git rev-parse HEAD\n  cat /etc/os-release\n  uname -a\n  node --version\n  npm --version\n  git --version\n  ssh -V\n  command -v ssh-keygen\n} 2>&1 | tee "$VERIFICATION_OUTPUT/environment.txt"\ncat "$VERIFICATION_OUTPUT/environment.txt" >> "$GITHUB_STEP_SUMMARY"\n',
          },
          {
            name: "Install locked dependencies",
            run: 'npm ci 2>&1 | tee "$VERIFICATION_OUTPUT/install.txt"',
          },
          {
            name: "Check formatting, lint, and generated artifacts",
            run: 'npm run build:check 2>&1 | tee "$VERIFICATION_OUTPUT/build-check.txt"',
          },
          {
            name: "Run committing-to-git and native adapter tests on Linux",
            run: "node --test --test-reporter=tap \\\n  'tests/committing-to-git/**/*.test.mjs' \\\n  tests/scripts/evaluation-path-metadata.test.mjs \\\n  tests/scripts/evaluation-homes.test.mjs \\\n  2>&1 | tee \"$VERIFICATION_OUTPUT/tests.tap\"\n",
          },
          {
            name: "Retain verification output",
            if: "always()",
            uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
            with: {
              name: "committing-to-git-linux-${{ github.run_id }}-${{ github.run_attempt }}",
              path: "${{ runner.temp }}/committing-to-git-linux/",
              "if-no-files-found": "error",
              "retention-days": 30,
            },
          },
        ],
      },
    },
  },
  "evaluation-conformance": {
    name: "Evaluation consumer conformance",
    on: {
      pull_request: null,
      workflow_dispatch: null,
    },
    permissions: {
      contents: "read",
    },
    jobs: {
      conformance: {
        strategy: {
          "fail-fast": false,
          matrix: {
            os: ["windows-2025", "ubuntu-24.04"],
          },
        },
        "runs-on": "${{ matrix.os }}",
        "timeout-minutes": 20,
        defaults: {
          run: {
            shell: "pwsh",
          },
        },
        steps: [
          {
            name: "Check out the candidate",
            uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
            with: {
              "persist-credentials": false,
            },
          },
          {
            name: "Set up the assessed Node runtime",
            uses: "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
            with: {
              "node-version": "24.21.0",
              "package-manager-cache": false,
            },
          },
          {
            name: "Set up the assessed Python runtime",
            uses: "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97",
            with: {
              "python-version": "3.14.8",
            },
          },
          {
            name: "Acquire locked dependencies and pinned native consumer",
            run: "npm ci --ignore-scripts\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\npython -B scripts/set_up_evaluation_execution_tools.py\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n",
          },
          {
            name: "Verify generated distribution and deterministic consumer contracts",
            env: {
              OTEL_SDK_DISABLED: "true",
              DO_NOT_TRACK: "1",
              TMPDIR: "${{ runner.temp }}/evaluation-conformance",
              TEMP: "${{ runner.temp }}/evaluation-conformance",
              TMP: "${{ runner.temp }}/evaluation-conformance",
            },
            run: "New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null\nnode --version\npython --version\ngit rev-parse HEAD\nnpm run build:check\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\nnpm run eval:check\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\nnode --test tests/scripts/evaluation-consumers.contract.mjs tests/scripts/evaluation-toolchain.test.mjs tests/scripts/evaluation-suite-compiler.test.mjs tests/scripts/evaluation-projection.test.mjs tests/scripts/skill-up-custom-engine.test.mjs\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n",
          },
          {
            name: "Retain conformance and acquisition evidence",
            if: "always()",
            uses: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
            with: {
              name: "evaluation-conformance-${{ matrix.os }}-${{ github.run_id }}-${{ github.run_attempt }}",
              path: "${{ runner.temp }}/evaluation-conformance/\n.agent-tools/evaluation/acquisition-failures/\n",
              "if-no-files-found": "warn",
              "retention-days": 30,
            },
          },
        ],
      },
    },
  },
};
function workflows(name) {
  return {
    original: originalWorkflows[name],
    current: parse(readFileSync(`.github/workflows/${name}.yml`, "utf8")),
  };
}

test("the single Ubuntu policy projects every managed workflow without changing other bytes", () => {
  const selectors = {
    "committing-to-git-linux": 1,
    "defining-concepts-linux": 1,
    "evaluation-conformance": 3,
    "markdown-quality": 1,
  };
  const alternate =
    ubuntuRunner === "ubuntu-24.04" ? "ubuntu-26.04" : "ubuntu-24.04";
  for (const [name, count] of Object.entries(selectors)) {
    const path = ".github/workflows/" + name + ".yml";
    const current = readFileSync(path, "utf8");
    const stale = current.replaceAll(ubuntuRunner, alternate);
    assert.equal(current.split(ubuntuRunner).length - 1, count, path);
    assert.equal(projectUbuntuRunners(name, current), current);
    assert.equal(projectUbuntuRunners(name, current, alternate), stale);
    assert.equal(projectUbuntuRunners(name, stale), current);
  }
});

test("the Ubuntu projector rejects matrix entries that change its job coverage", () => {
  const name = "evaluation-conformance";
  const current = readFileSync(".github/workflows/" + name + ".yml", "utf8");
  const changed = current.replace(
    "os: [windows-2025, " + ubuntuRunner + "]",
    "os: [windows-2025, " +
      ubuntuRunner +
      "]\n        include: [{os: ubuntu-22.04}]",
  );
  assert.notEqual(changed, current);
  assert.throws(
    () => projectUbuntuRunners(name, changed),
    /exactly Ubuntu and Windows/u,
  );
});

test("the Ubuntu projector rejects a new job outside the managed selectors", () => {
  const name = "defining-concepts-linux";
  const current = readFileSync(".github/workflows/" + name + ".yml", "utf8");
  const changed =
    current.trimEnd() +
    "\n  extra:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo extra\n";
  assert.throws(
    () => projectUbuntuRunners(name, changed),
    /job inventory differs/u,
  );
});

test("defining-concepts Linux route provisions the supported tools before the scoped verifier", () => {
  const workflow = parse(
    readFileSync(".github/workflows/defining-concepts-linux.yml", "utf8"),
  );
  assert.deepEqual(
    workflow.on,
    originalWorkflows["committing-to-git-linux"].on,
  );
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs.verify;
  assert.equal(job["runs-on"], ubuntuRunner);
  assert.equal(job["timeout-minutes"], 30);
  assert.equal(job.defaults.run.shell, "bash");
  assert.equal(job.env.VERIFICATION_REVISION, "${{ inputs.revision }}");
  const checkout = job.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with.ref, "${{ inputs.revision }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with["fetch-depth"], 0);
  assertCanonicalPython(job);

  for (const step of job.steps.filter((step) => step.uses)) {
    if (step.uses === "./.github/actions/setup-npm") continue;
    assert.match(
      step.uses,
      /^actions\/(?:checkout|setup-node|setup-python)@[0-9a-f]{40}$/u,
    );
  }
  const scripts = job.steps.map((step) => step.run ?? "").join("\n");
  const sequence = [
    "--stage environment -- bash -e -o pipefail -c",
    "--stage install -- npm ci",
    "--stage acquisition -- bash -e -o pipefail -c",
    "python -B scripts/set_up_evaluation_tools.py",
    ".venv/bin/python -m pip show skills-ref",
    "--stage tests -- npm run verify:skill -- --skill defining-concepts",
  ];
  let previous = -1;
  for (const command of sequence) {
    const position = scripts.indexOf(command);
    assert.ok(position > previous, command);
    previous = position;
  }
  assert.match(scripts, /git rev-parse HEAD/u);
  assert.match(scripts, /python --version/u);
  assert.match(scripts, /direct_url.json/u);
  assert.doesNotMatch(
    scripts,
    /\$\{\{|\btee\b|set_up_development_environment|set_up_mcp_servers|eval:run/u,
  );
  assert.equal(job.steps.at(-1).if, "${{ !cancelled() }}");
  assert.match(
    job.steps.at(-1).run,
    /report --verification-kind defining-concepts/u,
  );
  assert.equal(
    job.steps.some((step) => /artifact/u.test(step.uses ?? "")),
    false,
  );
});

for (const name of ["committing-to-git-linux", "evaluation-conformance"]) {
  test(`${name} preserves action identities and unrelated job policy`, () => {
    const { original, current } = workflows(name);
    // CI reuse adds main push plus strategy/aggregate jobs; the native matrix is preserved.
    assert.deepEqual(
      current.on,
      name === "evaluation-conformance"
        ? { ...original.on, push: { branches: ["main"] } }
        : original.on,
    );
    assert.deepEqual(current.permissions, original.permissions);
    assert.deepEqual(
      Object.keys(current.jobs),
      name === "evaluation-conformance"
        ? ["verification", "conformance", "required"]
        : Object.keys(original.jobs),
    );
    for (const jobId of Object.keys(original.jobs)) {
      const before = structuredClone(original.jobs[jobId]);
      if (before["runs-on"] === "ubuntu-24.04")
        before["runs-on"] = ubuntuRunner;
      if (before.strategy?.matrix?.os) {
        before.strategy.matrix.os = before.strategy.matrix.os.map((label) =>
          label === "ubuntu-24.04" ? ubuntuRunner : label,
        );
      }
      const after = current.jobs[jobId];
      for (const field of [
        "runs-on",
        "timeout-minutes",
        "strategy",
        "defaults",
      ]) {
        assert.deepEqual(after[field], before[field], field);
      }
      const retainedActionSteps = (workflowJob) =>
        workflowJob.steps
          .filter(
            (step) =>
              step.uses &&
              step.uses !== "./.github/actions/setup-npm" &&
              !/^(?:actions\/(?:upload-artifact|setup-python)|astral-sh\/setup-uv)@/u.test(
                step.uses,
              ),
          )
          .map((step) =>
            step.uses.startsWith("actions/setup-node@")
              ? {
                  ...step,
                  with: Object.fromEntries(
                    Object.entries(step.with).filter(
                      ([key]) =>
                        !["node-version", "node-version-file"].includes(key),
                    ),
                  ),
                }
              : step,
          );
      assert.deepEqual(retainedActionSteps(after), retainedActionSteps(before));
      if (name === "evaluation-conformance") assertCanonicalPython(after);
      assert.equal(
        after.steps.some((step) =>
          /(?:upload|download)-artifact/u.test(step.uses ?? ""),
        ),
        false,
      );
      assert.equal(after.steps.at(-1).if, "${{ !cancelled() }}");
      assert.match(after.steps.at(-1).run, /verificationEvidence.js report/u);
      assert.doesNotMatch(JSON.stringify(after.env ?? {}), /runner\.temp/u);
      for (const step of after.steps) {
        assert.doesNotMatch(step.run ?? "", /npm run ci:evidence/u);
      }
    }
  });
}

test("Linux commands keep their native arguments and protect all diagnostic output", () => {
  const { current } = workflows("committing-to-git-linux");
  const scripts = current.jobs.verify.steps
    .map((step) => step.run ?? "")
    .join("\n");
  assert.match(scripts, /--stage install -- npm ci(?:\n|$)/u);
  assert.match(scripts, /--stage build-check -- npm run build:check/u);
  assert.match(scripts, /--stage tests -- node --test --test-reporter=tap/u);
  for (const target of [
    "tests/committing-to-git/**/*.test.mjs",
    "tests/scripts/evaluation-path-metadata.test.mjs",
    "tests/scripts/evaluation-homes.test.mjs",
  ]) {
    assert.ok(scripts.includes(target));
  }
  assert.match(scripts, /--stage environment -- bash -e -o pipefail -c/u);
  assert.match(scripts, /git rev-parse HEAD/u);
  assert.doesNotMatch(scripts, /\btee\b|cat .*GITHUB_STEP_SUMMARY/u);
});

test("conformance reuse has bounded reads, scoped attestation writes and cannot mask failures", () => {
  const { current } = workflows("evaluation-conformance");
  const strategy = current.jobs.verification;
  assert.deepEqual(strategy.permissions, {
    contents: "read",
    actions: "read",
    attestations: "read",
    "pull-requests": "read",
  });
  assert.equal(strategy["timeout-minutes"], 4);
  assert.equal(strategy.outputs.reuse, "${{ steps.verify.outputs.reuse }}");
  assert.equal(strategy.outputs.proof, "${{ steps.verify.outputs.proof }}");
  const select = strategy.steps.find((step) => step.id === "select");
  const verify = strategy.steps.find((step) => step.id === "verify");
  const download = strategy.steps.find((step) => step.id === "download");
  assert.equal(select.run, "node scripts/ci/conformanceReuse.js select");
  assert.equal(verify.run, "node scripts/ci/conformanceReuse.js verify");
  assert.equal(
    verify.env.PROOF_DOWNLOAD_OUTCOME,
    "${{ steps.download.outcome }}",
  );
  assert.equal(download.if, "steps.select.outputs.available == 'true'");
  assert.equal(download["continue-on-error"], true);
  assert.equal(
    download.with["artifact-ids"],
    "${{ steps.select.outputs.artifact_id }}",
  );
  assert.equal(download.with["run-id"], "${{ steps.select.outputs.run_id }}");
  assert.equal(download.with["digest-mismatch"], "error");
  assert.equal(download.with.repository, "${{ github.repository }}");
  assert.equal(
    download.with.path,
    "${{ runner.temp }}/conformance-reuse/download",
  );
  assert.equal(current.jobs.conformance.needs, "verification");
  assert.equal(
    current.jobs.conformance.if,
    "${{ !cancelled() && needs.verification.outputs.reuse != 'true' }}",
  );
  const aggregate = current.jobs.required;
  assert.equal(aggregate.if, "${{ always() }}");
  assert.deepEqual(aggregate.needs, ["verification", "conformance"]);
  assert.equal(aggregate.env.REQUIRED_JOB_RESULTS_JSON, "${{ toJSON(needs) }}");
  const requireStep = aggregate.steps.find((step) =>
    step.run?.endsWith("conformanceReuse.js require"),
  );
  assert.ok(requireStep);
  assert.equal(requireStep.if, undefined);
  assert.equal(requireStep["continue-on-error"], undefined);
  const record = aggregate.steps.find((step) => step.id === "receipt");
  assert.equal(record.if, "github.event_name == 'pull_request'");
  assert.equal(record.run, "node scripts/ci/conformanceReuse.js record");
  const upload = aggregate.steps.at(-1);
  assert.equal(upload.if, "steps.receipt.outputs.recorded == 'true'");
  assert.equal(upload["continue-on-error"], true);
  assert.equal(
    upload.with.path,
    "${{ runner.temp }}/conformance-reuse/receipt.json",
  );
  assert.equal(
    upload.with.name,
    "conformance-proof-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  assert.equal(upload.with["retention-days"], 7);
  assert.equal(upload.with.overwrite, false);
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with["include-hidden-files"], false);
  for (const job of [strategy, aggregate]) {
    assert.equal(job["runs-on"], ubuntuRunner);
    assert.doesNotMatch(JSON.stringify(job.env ?? {}), /runner\.temp/u);
    for (const step of job.steps.filter((entry) => entry.uses)) {
      assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/u);
    }
    const checkout = job.steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    assert.equal(checkout.with["persist-credentials"], false);
    assert.equal(checkout.with.ref, undefined);
    assert.equal(
      job.steps.some((step) => /npm ci|eval:run/u.test(step.run ?? "")),
      false,
    );
  }
  assert.deepEqual(aggregate.permissions, {
    contents: "read",
    "id-token": "write",
    attestations: "write",
  });
  const attest = aggregate.steps.find((step) =>
    step.uses?.startsWith("actions/attest@"),
  );
  assert.equal(
    attest.uses,
    "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
  );
  assert.equal(attest.if, "steps.receipt.outputs.recorded == 'true'");
  assert.equal(attest["continue-on-error"], true);
  assert.equal(attest["timeout-minutes"], 1);
  assert.deepEqual(attest.with, {
    "subject-path": "${{ runner.temp }}/conformance-reuse/receipt.json",
    "create-storage-record": false,
    "show-summary": false,
  });
  assert.equal(current.jobs.conformance.permissions, undefined);
});

test("evaluation retains the native sequence, telemetry and isolated fixture temp root", () => {
  const { original, current } = workflows("evaluation-conformance");
  const before = original.jobs.conformance.steps.find((step) =>
    step.name.startsWith("Verify generated"),
  );
  const after = current.jobs.conformance.steps.find((step) =>
    step.name.startsWith("Verify generated"),
  );
  assert.deepEqual(after.env, before.env);
  const scripts = current.jobs.conformance.steps
    .map((step) => step.run ?? "")
    .join("\n");
  const expectedOrder = [
    "--stage install -- npm ci --ignore-scripts",
    "--stage acquisition -- python -B scripts/set_up_evaluation_execution_tools.py",
    "--stage build-check -- npm run build:check",
    "--stage conformance -- npm run eval:check",
    "--stage tests -- node --test",
  ];
  let previousPosition = -1;
  for (const command of expectedOrder) {
    const position = scripts.indexOf(command);
    assert.ok(position > previousPosition, command);
    previousPosition = position;
  }
  const originalTargets = before.run.match(/node --test ([^\n]+)/u)[1];
  assert.ok(
    scripts.includes(`--stage tests -- node --test ${originalTargets}`),
  );
  assert.equal(
    (
      scripts.match(
        /if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/gu,
      ) ?? []
    ).length,
    6,
  );
  assert.match(
    scripts,
    /--temporary-root "\$env:RUNNER_TEMP\/evaluation-conformance"/u,
  );
  assert.match(
    scripts,
    /--acquisition-root \.agent-tools\/evaluation\/acquisition-failures/u,
  );
});

test("verification retains complete Markdown checking and the evidence generator", () => {
  const current = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(current.overrides?.minimatch, "^11.0.1");
  assert.equal(
    current.scripts["ci:evidence"],
    "node scripts/ci/verificationEvidence.js",
  );
  assert.equal(
    current.scripts.verify,
    "npm run diff:check && npm run build:check && npm run check:markdown && npm run skills:validate && npm run skills:lint && npm run eval:check && npm test",
  );
});

test("Markdown workflow checks the complete installed graph on both supported platforms", () => {
  const workflow = parse(
    readFileSync(".github/workflows/markdown-quality.yml", "utf8"),
  );
  assert.deepEqual(Object.keys(workflow.on).sort(), [
    "pull_request",
    "push",
    "workflow_dispatch",
  ]);
  assert.deepEqual(workflow.permissions, {});
  const job = workflow.jobs.markdown;
  assert.deepEqual(job.permissions, { contents: "read" });
  assert.deepEqual(job.strategy.matrix.os, [ubuntuRunner, "windows-2025"]);
  const commands = job.steps.filter((step) => step.run);
  assert.deepEqual(
    commands.map((step) => step.run),
    [
      "npm ci --include=dev --ignore-scripts",
      "npm run check:markdown",
      "npm run test:markdown",
    ],
  );
  assert.equal(job.steps[2].uses, "./.github/actions/setup-npm");
  for (const step of commands) {
    assert.equal(step.if, undefined);
    assert.equal(step["continue-on-error"], undefined);
  }
  assert.equal(job.if, undefined);
  assert.equal(job["continue-on-error"], undefined);
  for (const step of job.steps.filter((entry) => entry.uses)) {
    if (step.uses === "./.github/actions/setup-npm") continue;
    assert.match(step.uses, /^actions\/[a-z-]+@[a-f0-9]{40}$/u);
  }
  assert.equal(job.steps[0].with["persist-credentials"], false);
});

test("every Node workflow selects its runtime from .node-version", () => {
  const version = readFileSync(".node-version", "utf8").trim();
  assert.match(version, /^\d+\.\d+\.\d+$/u);
  let consumers = 0;
  for (const file of readdirSync(".github/workflows").filter((entry) =>
    /\.ya?ml$/u.test(entry),
  )) {
    const workflow = parse(
      readFileSync(join(".github/workflows", file), "utf8"),
    );
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses?.startsWith("actions/setup-node@")) continue;
        consumers += 1;
        assert.equal(step.with["node-version-file"], ".node-version", file);
        assert.equal(step.with["node-version"], undefined, file);
        assert.ok(
          job.steps.some(
            (previous, index) =>
              index < job.steps.indexOf(step) &&
              previous.uses?.startsWith("actions/checkout@"),
          ),
          `${file} must check out the version file before selecting Node`,
        );
      }
    }
  }
  assert.ok(consumers > 0);
});

for (const name of ["defining-concepts-linux", "evaluation-conformance"]) {
  test(`${name} propagates the canonical Python target without acquiring uv`, (t) => {
    const workflow = workflows(name).current;
    const job = workflow.jobs.conformance ?? workflow.jobs.verify;
    assertCanonicalPython(job);
    const target = job.steps.find((step) => step.id === "python-target");
    assert.equal(target.shell, "bash");
    const command = /^node --input-type=module -e '([^']+)'$/u.exec(target.run);
    assert.ok(command, "Run the workflow's actual runtime-reading program");
    const root = mkdtempSync(join(tmpdir(), "workflow-runtime-targets-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const canonical = JSON.parse(
      readFileSync(".development-runtimes.json", "utf8"),
    );
    const changed = Object.fromEntries(
      Object.entries(canonical).map(([key, version]) => {
        assert.match(version, /^\d+\.\d+\.\d+$/u);
        const parts = version.split(".").map(Number);
        parts[2] += 1;
        return [key, parts.join(".")];
      }),
    );
    for (const [index, targets] of [canonical, changed].entries()) {
      writeFileSync(
        join(root, ".development-runtimes.json"),
        JSON.stringify(targets),
      );
      const output = join(root, `outputs-${index}`);
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", command[1]],
        {
          cwd: root,
          env: { ...process.env, GITHUB_OUTPUT: output },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(output, "utf8"), `python=${targets.python}\n`);
    }
  });
}

test("the Linux probe shell fails on an early command or pipeline failure", (t) => {
  const gitPaths = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  const shell =
    process.platform === "win32"
      ? join(dirname(dirname(dirname(gitPaths.stdout.trim()))), "bin/bash.exe")
      : "bash";
  const positive = spawnSync(
    shell,
    ["-e", "-o", "pipefail", "-c", "printf native-shell"],
    { encoding: "utf8" },
  );
  if (positive.error?.code === "ENOENT" && process.platform === "win32") {
    t.skip("Native Git Bash is unavailable on this Windows host");
    return;
  }
  assert.equal(positive.status, 0, positive.stderr);
  assert.equal(positive.stdout, "native-shell");
  for (const script of [
    "false; printf masked-failure",
    "false | true; printf masked-failure",
  ]) {
    const result = spawnSync(shell, ["-e", "-o", "pipefail", "-c", script], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /masked-failure/u);
  }
});

function assertCanonicalPython(job) {
  const target = job.steps.find((step) => step.id === "python-target");
  assert.match(target.run, /readFileSync\("\.development-runtimes\.json"/u);
  assert.match(target.run, /GITHUB_OUTPUT/u);
  const provision = job.steps.find((step) =>
    step.uses?.startsWith("actions/setup-python@"),
  );
  assert.equal(
    provision.uses,
    "actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0",
  );
  assert.deepEqual(provision.with, {
    "python-version": "${{ steps.python-target.outputs.python }}",
  });
  const base = job.steps.find(
    (step) => step.name === "Verify the canonical base Python interpreter",
  );
  assert.match(base.run, /python -c/u);
  assert.match(base.run, /sys\.prefix == sys\.base_prefix/u);
  assert.doesNotMatch(base.run, /uv python|GITHUB_PATH/u);
  assert.doesNotMatch(base.run, /venv/u);
  assert.ok(job.steps.indexOf(target) < job.steps.indexOf(provision));
  assert.ok(job.steps.indexOf(provision) < job.steps.indexOf(base));
}
