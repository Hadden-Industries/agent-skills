import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";

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
              "python-version": "3.14.7",
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
const originalPackageDigest =
  "41fb07ea52c337a02507c5adf2e08336296a983a48072936c63c8f53b2673592";
function workflows(name) {
  return {
    original: originalWorkflows[name],
    current: parse(readFileSync(`.github/workflows/${name}.yml`, "utf8")),
  };
}

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
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 30);
  assert.equal(job.defaults.run.shell, "bash");
  assert.equal(job.env.VERIFICATION_REVISION, "${{ inputs.revision }}");
  const checkout = job.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with.ref, "${{ inputs.revision }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.equal(checkout.with["fetch-depth"], 0);
  assert.ok(
    job.steps.some((step) => step.uses?.startsWith("actions/setup-python@")),
  );
  for (const step of job.steps.filter((step) => step.uses)) {
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
  test(`${name} preserves existing runtimes, action identities and job policy`, () => {
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
      const before = original.jobs[jobId];
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
        workflowJob.steps.filter(
          (step) =>
            step.uses && !step.uses.startsWith("actions/upload-artifact@"),
        );
      assert.deepEqual(retainedActionSteps(after), retainedActionSteps(before));
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
    assert.equal(job["runs-on"], "ubuntu-24.04");
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

test("evidence and Markdown entry points retain the root dependency graph and existing verification order", () => {
  const current = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(
    current.scripts["ci:evidence"],
    "node scripts/ci/verificationEvidence.js",
  );
  delete current.scripts["ci:evidence"];
  assert.equal(
    current.scripts.verify,
    "npm run diff:check && npm run build:check && npm run check:markdown && npm run skills:validate && npm run skills:lint && npm run eval:check && npm test",
  );
  current.scripts.verify = current.scripts.verify.replace(
    " && npm run check:markdown",
    "",
  );
  for (const name of [
    "setup:markdown",
    "check:markdown",
    "format:markdown",
    "inspect:markdown",
    "test:markdown",
  ]) {
    delete current.scripts[name];
  }
  assert.equal(
    createHash("sha256").update(JSON.stringify(current)).digest("hex"),
    originalPackageDigest,
  );
});

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
