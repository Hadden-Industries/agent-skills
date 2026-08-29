import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { canonicalJsonBytes, sha256Hex } from "./runtime.js";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(message);
}

function freezeDeep(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      freezeDeep(child);
    }
  }
  return value;
}

function assertInputs({ repositoryRoot, skillName }) {
  if (
    typeof repositoryRoot !== "string" ||
    path.resolve(repositoryRoot) !== repositoryRoot
  ) {
    fail("repositoryRoot must be an absolute path");
  }
  if (typeof skillName !== "string" || !SKILL_NAME_PATTERN.test(skillName)) {
    fail("skillName is invalid");
  }
}

function git(repositoryRoot, arguments_, options = {}) {
  return execFileSync(
    "git",
    ["--no-lazy-fetch", "-C", repositoryRoot, ...arguments_],
    {
      windowsHide: true,
      env: {
        ...process.env,
        GIT_NO_LAZY_FETCH: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      ...options,
    },
  );
}

function decodeUtf8(bytes, relativePath) {
  let content;
  try {
    content = UTF8_DECODER.decode(bytes);
  } catch {
    fail(`${relativePath} must contain valid UTF-8`);
  }
  if (!Buffer.from(content, "utf8").equals(bytes)) {
    fail(`${relativePath} must contain round-trippable valid UTF-8`);
  }
  return content;
}

function fileRecord(relativePath, bytes) {
  return {
    path: relativePath,
    content: decodeUtf8(bytes, relativePath),
    byteLength: bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
}

function comparePaths(left, right) {
  return Buffer.compare(
    Buffer.from(left.path, "utf8"),
    Buffer.from(right.path, "utf8"),
  );
}

function finalizeBundle({ skillName, source, files }) {
  const skillPath = `skills/${skillName}/SKILL.md`;
  files.sort(comparePaths);
  if (!files.some(({ path: relativePath }) => relativePath === skillPath)) {
    fail(`${skillPath} is required`);
  }
  const payload = {
    schemaVersion: 1,
    skillName,
    source,
    files,
  };
  return freezeDeep({
    ...payload,
    aggregateSha256: sha256Hex(canonicalJsonBytes(payload)),
  });
}

function parseGitEntries(bytes) {
  const entries = [];
  for (const record of bytes.toString("utf8").split("\0")) {
    if (record.length === 0) continue;
    const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40,64})\t(.+)$/u.exec(record);
    if (match === null) {
      fail("Git returned a malformed skill-tree entry");
    }
    entries.push({
      mode: match[1],
      type: match[2],
      oid: match[3],
      path: match[4],
    });
  }
  return entries;
}

function gitSource(repositoryRoot, revision) {
  if (typeof revision !== "string" || revision.length === 0) {
    fail("revision must be a nonempty string");
  }
  const commitOid = git(
    repositoryRoot,
    ["rev-parse", "--verify", `${revision}^{commit}`],
    { encoding: "utf8" },
  ).trim();
  const treeOid = git(
    repositoryRoot,
    ["show", "-s", "--format=%T", commitOid],
    { encoding: "utf8" },
  ).trim();
  return { kind: "git", commitOid, treeOid };
}

export function captureGitSkillBundle({ repositoryRoot, revision, skillName }) {
  assertInputs({ repositoryRoot, skillName });
  const source = gitSource(repositoryRoot, revision);
  const prefix = `skills/${skillName}`;
  const entries = parseGitEntries(
    git(repositoryRoot, [
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      source.commitOid,
      "--",
      prefix,
    ]),
  );
  const files = entries.map((entry) => {
    if (entry.mode !== "100644" || entry.type !== "blob") {
      fail(
        `unsupported Git entry ${entry.mode} ${entry.type} at ${entry.path}`,
      );
    }
    const bytes = git(repositoryRoot, ["cat-file", "blob", entry.oid]);
    return fileRecord(entry.path, bytes);
  });
  return finalizeBundle({ skillName, source, files });
}

function workingTreeFiles(repositoryRoot, skillName) {
  const skillRoot = path.join(repositoryRoot, "skills", skillName);
  const files = [];

  function visit(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      fail(`unable to read skill directory: ${error.message}`);
    }
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        const relativePath = path
          .relative(repositoryRoot, absolutePath)
          .split(path.sep)
          .join("/");
        files.push(fileRecord(relativePath, readFileSync(absolutePath)));
      } else {
        fail(`unsupported filesystem entry at ${absolutePath}`);
      }
    }
  }

  visit(skillRoot);
  return files;
}

export function captureWorkingTreeSkillBundle({ repositoryRoot, skillName }) {
  assertInputs({ repositoryRoot, skillName });
  const head = gitSource(repositoryRoot, "HEAD");
  const source = {
    kind: "working-tree",
    headCommitOid: head.commitOid,
    headTreeOid: head.treeOid,
  };
  return finalizeBundle({
    skillName,
    source,
    files: workingTreeFiles(repositoryRoot, skillName),
  });
}

export function renderSkillBundle(bundle) {
  if (
    bundle === null ||
    typeof bundle !== "object" ||
    Array.isArray(bundle) ||
    bundle.schemaVersion !== 1 ||
    typeof bundle.skillName !== "string" ||
    !Array.isArray(bundle.files) ||
    bundle.files.length === 0
  ) {
    fail("bundle is malformed");
  }

  const sections = [
    `# Task-specific skill bundle: ${bundle.skillName}`,
    "",
    "Apply the following repository files as one skill. File boundaries are semantic and must be preserved.",
  ];
  for (const file of bundle.files) {
    sections.push(
      "",
      `## \`${file.path}\``,
      "",
      file.content.replace(/\n$/u, ""),
    );
  }
  return `${sections.join("\n")}\n`;
}
