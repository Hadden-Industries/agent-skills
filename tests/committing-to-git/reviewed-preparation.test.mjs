import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { schemaErrors } from "../helpers/json-schema.mjs";
import {
  parsePrepareArguments,
  prepareWorkflow,
} from "../../src/committing-to-git/workflow/prepareWorkflow.js";
import { resumePreparationWorkflow } from "../../src/committing-to-git/workflow/resumePreparationWorkflow.js";
import {
  commitAll,
  configureSshSigning,
  createRepositoryFixture,
  git,
  runCommitWorkflow,
  writeRepositoryFile,
} from "./harness.mjs";

const paths = ["docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md", "docs/e.md"];

function reviewedFixture(t) {
  const fixture = createRepositoryFixture(t, "reviewed-preparation-");
  for (const path of paths) writeRepositoryFile(fixture.repo, path, "Before\n");
  writeRepositoryFile(fixture.repo, "skills-lock.json", "original lock\n");
  commitAll(fixture.repo);
  for (const path of paths)
    writeRepositoryFile(fixture.repo, path, "Reviewed change\n");
  writeRepositoryFile(
    fixture.repo,
    "skills-lock.json",
    "unrelated user edit\n",
  );
  return fixture;
}

function argumentsFor(mode = "actual") {
  return [
    "--mode",
    mode,
    "--scope",
    "paths",
    ...paths.flatMap((path) => ["--path", path]),
    "--evidence",
    "reuse",
    "--basis",
    "authored-current-task",
    "--message-format",
    "detailed",
  ];
}

function invoke(fixture, command, args) {
  const child = runCommitWorkflow(command, args, fixture.repo);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  return JSON.parse(child.stdout);
}

test("five reviewed files finalize from one preparation and preserve an unrelated lockfile", (t) => {
  const fixture = reviewedFixture(t);
  if (!configureSshSigning(t, fixture)) return;
  const publicKey = readFileSync(
    join(fixture.scratch, "signing-key.pub"),
    "utf8",
  ).trim();
  const signers = join(fixture.scratch, "allowed-signers");
  writeFileSync(signers, `tests@example.invalid ${publicKey}\n`);
  git(["config", "gpg.ssh.allowedSignersFile", signers], fixture.repo);
  const prepared = invoke(fixture, "workflow prepare", argumentsFor());
  const transaction = JSON.parse(readFileSync(prepared.transaction, "utf8"));
  const schema = JSON.parse(
    readFileSync(
      new URL(
        "../../src/committing-to-git/schema/commitTransaction.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(schemaErrors(transaction, schema), []);
  assert.equal(prepared.nextAction, "author-content");
  assert.equal(prepared.reviewRequired, false);
  assert.equal(prepared.contentContract.mode, "detailed");
  assert.equal(prepared.capsule.unresolved.length, 0);
  const content = prepared.contentTemplate;
  assert.equal(content.authoringState, "draft");
  content.authoringState = "complete";
  content.subject = {
    type: "docs",
    scope: null,
    description: "Clarify reviewed documentation",
  };
  content.fileNotes = paths.map((path) => ({
    selection: { destinationPaths: [path] },
    reasons: ["Clarify the documented behavior"],
  }));
  writeFileSync(prepared.contentPath, JSON.stringify(content));
  const finalized = invoke(fixture, "message finalize", [
    "--transaction",
    prepared.transaction,
  ]);
  assert.equal(finalized.status, "message-ready");
  const committed = invoke(fixture, "workflow commit", [
    "--transaction",
    prepared.transaction,
  ]);
  assert.equal(committed.commitState, "created");
  assert.equal(committed.publicationAllowed, true);
  assert.equal(
    git(["verify-commit", committed.commitOid], fixture.repo).status,
    0,
  );
  assert.deepEqual(
    git(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"],
      fixture.repo,
    )
      .stdout.trim()
      .split("\n"),
    paths,
  );
  assert.equal(
    readFileSync(join(fixture.repo, "skills-lock.json"), "utf8"),
    "unrelated user edit\n",
  );
  assert.equal(
    git(["status", "--porcelain"], fixture.repo).stdout.trim(),
    "M skills-lock.json",
  );
});

test("recovery preserves an edited worksheet instead of offering a blank replacement", (t) => {
  const fixture = reviewedFixture(t);
  const prepared = invoke(fixture, "workflow prepare", argumentsFor("draft"));
  const content = prepared.contentTemplate;
  content.authoringState = "complete";
  content.subject = {
    type: "docs",
    scope: null,
    description: "Preserve authored notes",
  };
  content.sharedRationales = [
    { selection: { all: true }, reasons: ["Retain this authored rationale"] },
  ];
  content.userExperienceChanges = [null];
  const authored = JSON.stringify(content);
  writeFileSync(prepared.contentPath, authored);
  const rejected = runCommitWorkflow(
    "message finalize",
    ["--transaction", prepared.transaction],
    fixture.repo,
  );
  const diagnostic = JSON.parse(rejected.stdout);
  assert.equal(diagnostic.code, "INVALID_MESSAGE_CONTENT");
  assert.equal(diagnostic.details[0].contentTemplate, null);
  const resumed = invoke(fixture, "workflow resume", [
    "--transaction",
    prepared.transaction,
  ]);
  assert.equal(resumed.contentTemplate, null);
  assert.match(resumed.contentTemplateOmittedReason, /worksheet|contentPath/u);
  assert.equal(readFileSync(prepared.contentPath, "utf8"), authored);
});

test("interrupted preparation retains detailed authoring without accepting new inputs", async (t) => {
  const fixture = reviewedFixture(t);
  let interruption;
  try {
    await prepareWorkflow({
      options: parsePrepareArguments([
        ...argumentsFor(),
        "--verification",
        "skipped",
      ]),
      cwd: fixture.repo,
      temporaryRoot: fixture.scratch,
      indexFailureInjector(stage) {
        if (stage === "after-index-replacement")
          throw new Error("injected interruption");
      },
    });
  } catch (error) {
    interruption = error;
  }
  assert.equal(interruption?.code, "INDEX_INSTALLATION_INTERRUPTED");
  const resumed = await resumePreparationWorkflow({
    transactionPath: interruption.state.transaction,
  });
  assert.equal(resumed.nextAction, "author-content");
  assert.equal(resumed.contentTemplate.mode, "detailed");
  assert.equal(resumed.reviewRequired, false);
});

test("detailed preparation preserves required evidence traversal", async (t) => {
  const fixture = reviewedFixture(t);
  writeRepositoryFile(fixture.repo, paths[0], "Unknown change\n".repeat(10000));
  const args = argumentsFor("draft");
  args[args.indexOf("reuse")] = "review";
  args[args.indexOf("authored-current-task")] = "unknown-preexisting";
  const prepared = await prepareWorkflow({
    options: parsePrepareArguments(args),
    cwd: fixture.repo,
    temporaryRoot: fixture.scratch,
  });
  assert.equal(prepared.nextAction, "review-next");
  assert.equal(prepared.reviewRequired, true);
  assert.equal(prepared.contentPath, null);
});

test("an unsupported message format is rejected before staging", (t) => {
  const fixture = reviewedFixture(t);
  const args = argumentsFor();
  args[args.indexOf("detailed")] = "invented";
  const result = runCommitWorkflow("workflow prepare", args, fixture.repo);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).code, "INVALID_MESSAGE_FORMAT");
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "",
  );
});

test("a new evidence requirement retains detailed authoring without replaying stale preparation evidence", (t) => {
  const fixture = reviewedFixture(t);
  const prepared = invoke(fixture, "workflow prepare", argumentsFor("draft"));
  const content = prepared.contentTemplate;
  content.authoringState = "complete";
  content.subject = {
    type: "docs",
    scope: null,
    description: "Clarify documented behavior",
  };
  content.evidenceGroups = [
    {
      selection: { all: true },
      policy: "review",
      basis: {
        kind: "unknown-preexisting",
        note: "A new claim needs content evidence",
      },
    },
  ];
  writeFileSync(prepared.contentPath, JSON.stringify(content));
  const delta = runCommitWorkflow(
    "message finalize",
    ["--transaction", prepared.transaction],
    fixture.repo,
  );
  assert.equal(delta.status, 5, delta.stdout + delta.stderr);
  assert.equal(JSON.parse(delta.stdout).status, "evidence-required");
  let reviewed;
  let cursor = null;
  do {
    reviewed = invoke(fixture, "workflow review-next", [
      "--transaction",
      prepared.transaction,
      ...(cursor ? ["--cursor", cursor] : []),
    ]);
    cursor = reviewed.reviewProgress.nextCursor;
  } while (!reviewed.reviewProgress.complete);
  assert.equal(reviewed.nextAction, "author-content");
  assert.equal(reviewed.contentTemplate, null);
  assert.equal(reviewed.capsule, undefined);
  const finalized = invoke(fixture, "message finalize", [
    "--transaction",
    prepared.transaction,
  ]);
  assert.equal(finalized.status, "message-ready");
});

test("compact commit results retain exact display and expose the recorded full report without replay", (t) => {
  const fixture = reviewedFixture(t);
  if (!configureSshSigning(t, fixture)) return;
  const args = argumentsFor().slice(0, -2);
  const prepared = invoke(fixture, "workflow prepare", [
    ...args,
    "--verification",
    "skipped",
  ]);
  const committed = invoke(fixture, "workflow commit", [
    "--transaction",
    prepared.transaction,
    "--message",
    "docs: Clarify reviewed documentation",
    "--result-detail",
    "summary",
  ]);
  assert.equal(committed.commitState, "created");
  assert.equal(committed.report, undefined);
  assert.equal(committed.reportSummary.verification.finalPolicy, "skipped");
  assert.equal(committed.reportSummary.commit.messageMatches, true);
  const detail = invoke(fixture, "workflow report-detail", [
    "--transaction",
    prepared.transaction,
    "--section",
    "report",
  ]);
  assert.equal(detail.displayText, committed.displayText);
  assert.equal(detail.report.commit.oid, committed.commitOid);
  assert.equal(
    git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
    committed.commitOid,
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(committed)) <
      Buffer.byteLength(JSON.stringify(detail)),
  );
  assert.equal(detail.report.checks.receipts.length, 0);
  const retained = JSON.parse(readFileSync(prepared.transaction, "utf8"));
  writeFileSync(retained.report.jsonPath, "{}\n");
  const replaced = runCommitWorkflow(
    "workflow report-detail",
    [
      "--transaction",
      prepared.transaction,
      "--section",
      "report",
      "--result-detail",
      "summary",
    ],
    fixture.repo,
  );
  assert.equal(replaced.status, 2, replaced.stdout + replaced.stderr);
  const rejected = JSON.parse(replaced.stdout);
  assert.equal(rejected.code, "DETAIL_STATE_INVALID");
  assert.equal(rejected.commitState, "created");
  assert.equal(rejected.reportSummary, undefined);
  assert.equal(
    git(["rev-parse", "HEAD"], fixture.repo).stdout.trim(),
    committed.commitOid,
  );
});

test("detailed format limits fail before an actual index is installed", async (t) => {
  const fixture = createRepositoryFixture(t, "detailed-format-limit-");
  writeRepositoryFile(fixture.repo, "seed.md", "Seed\n");
  commitAll(fixture.repo);
  for (let i = 0; i < 50; i++)
    writeRepositoryFile(fixture.repo, `docs/${i}.md`, "Reviewed\n");
  await assert.rejects(
    prepareWorkflow({
      options: parsePrepareArguments([
        "--mode",
        "actual",
        "--scope",
        "full",
        "--evidence",
        "reuse",
        "--basis",
        "authored-current-task",
        "--verification",
        "skipped",
        "--message-format",
        "detailed",
      ]),
      cwd: fixture.repo,
      temporaryRoot: fixture.scratch,
    }),
    (error) =>
      error.code === "PREPARATION_STOPPED" &&
      error.cause?.code === "DETAILED_MESSAGE_LIMIT_EXCEEDED",
  );
  assert.equal(
    git(["diff", "--cached", "--name-only"], fixture.repo).stdout,
    "",
  );
});
