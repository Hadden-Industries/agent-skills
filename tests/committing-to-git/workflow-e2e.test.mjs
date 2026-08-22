import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  commitAll,
  createRepositoryFixture,
  git,
  readJson,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("actual workflow carries one approved tree through commit and report", (t) => {
  const fixture = createRepositoryFixture(t, "commit-workflow-e2e-");
  const snapshotPath = join(fixture.scratch, "snapshot.json");
  const inspectionDir = join(fixture.scratch, "inspection");
  const ledgerPath = join(inspectionDir, "ledger.json");
  const contentPath = join(fixture.scratch, "content.json");
  const templatePath = join(fixture.scratch, "template.txt");
  const messagePath = join(fixture.scratch, "message.txt");
  const verificationPath = join(fixture.scratch, "verification.json");
  const checksPath = join(fixture.scratch, "checks.json");
  const reportJson = join(fixture.scratch, "report.json");
  const reportText = join(fixture.scratch, "report.txt");

  writeRepositoryFile(fixture.repo, "seed.txt", "seed\n");
  commitAll(fixture.repo);
  writeRepositoryFile(fixture.repo, "Dockerfile", "COPY vite.config.mjs ./\n");
  writeRepositoryFile(
    fixture.repo,
    "vite.config.mjs",
    "export default { root: new URL('.', import.meta.url).pathname };\n",
  );

  const stage = runCommitWorkflow(
    "snapshot create",
    ["--mode", "actual", "--scope", "full", "--output", snapshotPath],
    fixture.repo,
  );

  assert.equal(stage.status, 0, stage.stderr);
  assert.equal(
    runCommitWorkflow(
      "inspection prepare",
      ["--manifest", snapshotPath, "--output-dir", inspectionDir],
      fixture.repo,
    ).status,
    0,
  );

  for (const unit of readJson(ledgerPath).units) {
    assert.equal(
      runCommitWorkflow(
        "inspection acknowledge",
        ["--ledger", ledgerPath, "--id", unit.id, "--sha256", unit.sha256],
        fixture.repo,
      ).status,
      0,
    );
  }

  assert.equal(
    runCommitWorkflow(
      "message scaffold",
      [
        "--manifest",
        snapshotPath,
        "--output",
        contentPath,
        "--template",
        templatePath,
      ],
      fixture.repo,
    ).status,
    0,
  );

  const snapshot = readJson(snapshotPath);
  const reasons = new Map([
    [
      "Dockerfile",
      "Keep container builds aligned with the renamed Vite config",
    ],
    [
      "vite.config.mjs",
      "Declare ESM path handling so native config loading succeeds",
    ],
  ]);

  writeJson(contentPath, {
    subject: {
      type: "build",
      scope: "vite",
      description: "Prevent native config loader warnings",
    },
    rationale: [],
    userExperienceChanges: [],
    mode: "detailed",
    changeEntries: snapshot.changeUnits.map((unit) => ({
      changeUnitId: unit.id,
      reasons: [reasons.get(unit.destinationPath)],
    })),
  });

  assert.equal(
    runCommitWorkflow(
      "message render",
      [
        "--manifest",
        snapshotPath,
        "--content",
        contentPath,
        "--ledger",
        ledgerPath,
        "--output",
        messagePath,
      ],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(
    runCommitWorkflow(
      "message validate",
      [
        "--manifest",
        snapshotPath,
        "--content",
        contentPath,
        "--ledger",
        ledgerPath,
        messagePath,
      ],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(
    git(["write-tree"], fixture.repo).stdout.trim(),
    snapshot.indexTreeOid,
  );

  git(
    ["commit", "--quiet", "--cleanup=verbatim", "-F", messagePath],
    fixture.repo,
  );
  const commitOid = git(
    ["rev-parse", "--verify", "HEAD"],
    fixture.repo,
  ).stdout.trim();

  assert.equal(
    runCommitWorkflow(
      "signature verify",
      [
        "--commit",
        commitOid,
        "--initial-policy",
        "skipped",
        "--policy",
        "skipped",
        "--output",
        verificationPath,
      ],
      fixture.repo,
    ).status,
    0,
  );
  assert.equal(readJson(verificationPath).commitOid, commitOid);
  writeJson(checksPath, { schemaVersion: 1, checks: [] });
  assert.equal(
    runCommitWorkflow(
      "report create",
      [
        "--commit",
        commitOid,
        "--manifest",
        snapshotPath,
        "--approved-message",
        messagePath,
        "--verification",
        verificationPath,
        "--checks",
        checksPath,
        "--output-json",
        reportJson,
        "--output-text",
        reportText,
      ],
      fixture.repo,
    ).status,
    0,
  );

  const finalReport = readJson(reportJson);

  assert.equal(finalReport.commit.treeMatches, true);
  assert.equal(finalReport.commit.messageMatches, true);
  assert.deepEqual(finalReport.workspace, {
    staged: [],
    unstaged: [],
    untracked: [],
    conflicted: [],
  });
  assert.match(
    readFileSync(reportText, "utf8"),
    /build\(vite\): Prevent native config loader warnings/u,
  );
});
