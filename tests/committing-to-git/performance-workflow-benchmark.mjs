// One isolated cold, signed consumer journey. Fixture setup is outside timing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2]);
const count = Number(process.argv[3]);
const attributionDirectory = process.argv[4];
assert.ok([1, 12, 1000].includes(count));
const harness = await import(
  pathToFileURL(join(root, "tests/committing-to-git/harness.mjs"))
);
const callbacks = [];
const t = {
  after: (callback) => callbacks.push(callback),
  skip: (reason) => {
    throw new Error(reason);
  },
};
const fixture = harness.createRepositoryFixture(t, "performance-cold-");
try {
  for (let index = 0; index < count; index += 1)
    harness.writeRepositoryFile(
      fixture.repo,
      `unit-${String(index).padStart(6, "0")}.txt`,
      "before\n",
    );
  harness.commitAll(fixture.repo);
  assert.equal(harness.configureSshSigning(t, fixture), true);
  const publicKey = readFileSync(
    join(fixture.scratch, "signing-key.pub"),
    "utf8",
  ).trim();
  const trust = join(fixture.scratch, "allowed-signers");
  writeFileSync(trust, `tests@example.invalid ${publicKey}\n`);
  harness.git(["config", "gpg.ssh.allowedSignersFile", trust], fixture.repo);
  const parent = harness.git(["rev-parse", "HEAD"], fixture.repo).stdout.trim();
  for (let index = 0; index < count; index += 1)
    harness.writeRepositoryFile(
      fixture.repo,
      `unit-${String(index).padStart(6, "0")}.txt`,
      "after\n",
    );
  const environment = { TEMP: fixture.scratch, TMP: fixture.scratch };
  const stages = [];
  const invoke = (command, args) => {
    const start = performance.now();
    const result = attributionDirectory
      ? spawnSync(
          process.execPath,
          [
            "--cpu-prof",
            "--cpu-prof-dir",
            attributionDirectory,
            "--import",
            pathToFileURL(join(attributionDirectory, "..", "cli-resource.mjs"))
              .href,
            join(root, "skills/committing-to-git/scripts/commitWorkflow.mjs"),
            ...command.split(" "),
            ...args,
          ],
          {
            cwd: fixture.repo,
            encoding: "utf8",
            windowsHide: true,
            env: {
              ...process.env,
              ...environment,
              TASK_PERFORMANCE_OUTPUT: attributionDirectory,
              GIT_TRACE2_EVENT: join(attributionDirectory, "git-trace2.ndjson"),
            },
          },
        )
      : harness.runCommitWorkflow(command, args, fixture.repo, {
          env: environment,
        });
    const durationMs = performance.now() - start;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    stages.push({
      command,
      durationMs,
      stdoutBytes: Buffer.byteLength(result.stdout),
      stderrBytes: Buffer.byteLength(result.stderr),
      exitCode: result.status,
    });
    return JSON.parse(result.stdout);
  };
  const prepared = invoke("workflow prepare", [
    "--mode",
    "actual",
    "--scope",
    "full",
    "--evidence",
    "reuse",
    "--basis",
    "authored-current-task",
    "--verification",
    "required",
    "--result-detail",
    "summary",
  ]);
  assert.equal(prepared.changeUnitCount, count);
  const committed = invoke("workflow commit", [
    "--transaction",
    prepared.transaction,
    "--message",
    "perf(fixtures): Record equivalent unit changes",
    "--result-detail",
    "summary",
  ]);
  assert.equal(committed.commitState, "created");
  assert.equal(committed.reportSummary.comparison.treeMatches, true);
  assert.equal(committed.reportSummary.comparison.messageMatches, true);
  assert.equal(committed.reportSummary.comparison.parentMatches, true);
  assert.equal(
    committed.reportSummary.verification.attempts.at(-1).status,
    "verified",
  );
  assert.equal(
    harness.git(["rev-parse", "HEAD^"], fixture.repo).stdout.trim(),
    parent,
  );
  assert.equal(harness.git(["status", "--porcelain"], fixture.repo).stdout, "");
  const payload = join(
    root,
    "skills/committing-to-git/scripts/commitWorkflow.mjs",
  );
  process.stdout.write(
    JSON.stringify({
      root,
      count,
      node: process.version,
      execPath: process.execPath,
      platform: process.platform,
      arch: process.arch,
      payloadSha256: createHash("sha256")
        .update(readFileSync(payload))
        .digest("hex"),
      stages,
      durationMs: stages.reduce((sum, stage) => sum + stage.durationMs, 0),
      safety: {
        treeMatches: true,
        messageMatches: true,
        parentMatches: true,
        signatureVerified: true,
        workspaceClean: true,
      },
      resourceUsage: process.resourceUsage(),
    }) + "\n",
  );
} finally {
  for (const callback of callbacks.reverse()) callback();
}
