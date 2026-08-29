import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import {
  captureGitSkillBundle,
  captureWorkingTreeSkillBundle,
  renderSkillBundle,
} from "../../scripts/evaluation/skill-bundle.js";

function git(repositoryRoot, ...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function createRepository(t) {
  const repositoryRoot = mkdtempSync(joinTemp("skill-bundle-"));
  const skillRoot = path.join(repositoryRoot, "skills", "example-skill");

  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  mkdirSync(path.join(skillRoot, "references"), { recursive: true });
  git(repositoryRoot, "init", "--initial-branch=main");
  git(repositoryRoot, "config", "user.name", "Skill Bundle Test");
  git(repositoryRoot, "config", "user.email", "bundle@example.invalid");
  writeFileSync(
    path.join(skillRoot, "SKILL.md"),
    "---\nname: example-skill\ndescription: Use when testing bundles.\n---\n\n# Example\n",
  );
  writeFileSync(
    path.join(skillRoot, "references", "details.md"),
    "# Details\n\nCommitted details.\n",
  );
  git(repositoryRoot, "add", "skills/example-skill");
  git(repositoryRoot, "commit", "-m", "test: Add example skill");

  return { repositoryRoot, skillRoot };
}

function joinTemp(prefix) {
  return path.join(tmpdir(), prefix);
}

test("committed and working-tree captures preserve different exact bytes without mutation", (t) => {
  const { repositoryRoot, skillRoot } = createRepository(t);
  const committedRevision = git(repositoryRoot, "rev-parse", "HEAD");
  writeFileSync(
    path.join(skillRoot, "SKILL.md"),
    "---\nname: example-skill\ndescription: Use when testing changed bundles.\n---\n\n# Candidate\n",
  );
  const before = git(repositoryRoot, "status", "--short");

  const committed = captureGitSkillBundle({
    repositoryRoot,
    revision: committedRevision,
    skillName: "example-skill",
  });
  const working = captureWorkingTreeSkillBundle({
    repositoryRoot,
    skillName: "example-skill",
  });

  assert.match(committed.files[0].content, /# Example/u);
  assert.match(working.files[0].content, /# Candidate/u);
  assert.notEqual(committed.aggregateSha256, working.aggregateSha256);
  assert.equal(git(repositoryRoot, "status", "--short"), before);
});

test("capture includes every regular skill file in stable path order", (t) => {
  const { repositoryRoot, skillRoot } = createRepository(t);
  writeFileSync(path.join(skillRoot, "z-last.txt"), "last\n");
  writeFileSync(path.join(skillRoot, "a-first.txt"), "first\n");

  const bundle = captureWorkingTreeSkillBundle({
    repositoryRoot,
    skillName: "example-skill",
  });

  assert.deepEqual(
    bundle.files.map(({ path: relativePath }) => relativePath),
    [
      "skills/example-skill/SKILL.md",
      "skills/example-skill/a-first.txt",
      "skills/example-skill/references/details.md",
      "skills/example-skill/z-last.txt",
    ],
  );
  for (const file of bundle.files) {
    assert.equal(file.byteLength, Buffer.byteLength(file.content, "utf8"));
    assert.match(file.sha256, /^[0-9a-f]{64}$/u);
  }
});

test("bundle aggregate changes with path, content, or source revision", (t) => {
  const { repositoryRoot, skillRoot } = createRepository(t);
  const original = captureWorkingTreeSkillBundle({
    repositoryRoot,
    skillName: "example-skill",
  });

  writeFileSync(path.join(skillRoot, "references", "details.md"), "changed\n");
  const changedContent = captureWorkingTreeSkillBundle({
    repositoryRoot,
    skillName: "example-skill",
  });
  assert.notEqual(changedContent.aggregateSha256, original.aggregateSha256);

  rmSync(path.join(skillRoot, "references", "details.md"));
  writeFileSync(path.join(skillRoot, "references", "renamed.md"), "changed\n");
  const changedPath = captureWorkingTreeSkillBundle({
    repositoryRoot,
    skillName: "example-skill",
  });
  assert.notEqual(changedPath.aggregateSha256, changedContent.aggregateSha256);

  git(repositoryRoot, "add", "skills/example-skill");
  git(repositoryRoot, "commit", "-m", "test: Change example skill");
  const firstCommit = captureGitSkillBundle({
    repositoryRoot,
    revision: "HEAD",
    skillName: "example-skill",
  });
  git(
    repositoryRoot,
    "commit",
    "--allow-empty",
    "-m",
    "test: New source identity",
  );
  const secondCommit = captureGitSkillBundle({
    repositoryRoot,
    revision: "HEAD",
    skillName: "example-skill",
  });
  assert.notEqual(firstCommit.aggregateSha256, secondCommit.aggregateSha256);
  assert.deepEqual(firstCommit.files, secondCommit.files);
});

test("rendering preserves file boundaries and duplicate basenames", (t) => {
  const { repositoryRoot, skillRoot } = createRepository(t);
  mkdirSync(path.join(skillRoot, "other"));
  writeFileSync(
    path.join(skillRoot, "other", "details.md"),
    "Other details.\n",
  );
  const bundle = captureWorkingTreeSkillBundle({
    repositoryRoot,
    skillName: "example-skill",
  });

  const rendered = renderSkillBundle(bundle);

  assert.match(
    rendered,
    /## `skills\/example-skill\/references\/details\.md`/u,
  );
  assert.match(rendered, /## `skills\/example-skill\/other\/details\.md`/u);
  assert.match(rendered, /Committed details\./u);
  assert.match(rendered, /Other details\./u);
  assert.ok(rendered.endsWith("\n"));
});

test("captures reject missing SKILL.md, invalid UTF-8, and invalid skill names", (t) => {
  const { repositoryRoot, skillRoot } = createRepository(t);
  rmSync(path.join(skillRoot, "SKILL.md"));

  assert.throws(
    () =>
      captureWorkingTreeSkillBundle({
        repositoryRoot,
        skillName: "example-skill",
      }),
    /SKILL\.md is required/u,
  );

  writeFileSync(path.join(skillRoot, "SKILL.md"), Buffer.from([0xff, 0xfe]));
  assert.throws(
    () =>
      captureWorkingTreeSkillBundle({
        repositoryRoot,
        skillName: "example-skill",
      }),
    /valid UTF-8/u,
  );

  assert.throws(
    () =>
      captureWorkingTreeSkillBundle({
        repositoryRoot,
        skillName: "../escape",
      }),
    /skillName is invalid/u,
  );
  assert.throws(
    () =>
      captureGitSkillBundle({
        repositoryRoot,
        revision: "HEAD",
        skillName: "",
      }),
    /skillName is invalid/u,
  );
});

test("committed capture rejects a symbolic-link entry", (t) => {
  const { repositoryRoot } = createRepository(t);
  const targetBlob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    cwd: repositoryRoot,
    input: "SKILL.md",
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  git(
    repositoryRoot,
    "update-index",
    "--add",
    "--cacheinfo",
    `120000,${targetBlob},skills/example-skill/link.md`,
  );
  git(repositoryRoot, "commit", "-m", "test: Add skill symlink entry");

  assert.throws(
    () =>
      captureGitSkillBundle({
        repositoryRoot,
        revision: "HEAD",
        skillName: "example-skill",
      }),
    /unsupported Git entry/u,
  );
});

test("bundle source and file records are deeply frozen", (t) => {
  const { repositoryRoot } = createRepository(t);
  const bundle = captureGitSkillBundle({
    repositoryRoot,
    revision: "HEAD",
    skillName: "example-skill",
  });

  assert.ok(Object.isFrozen(bundle));
  assert.ok(Object.isFrozen(bundle.source));
  assert.ok(Object.isFrozen(bundle.files));
  assert.ok(bundle.files.every((file) => Object.isFrozen(file)));
  assert.equal(
    readFileSync(
      path.join(repositoryRoot, "skills", "example-skill", "SKILL.md"),
      "utf8",
    ),
    bundle.files[0].content,
  );
});
