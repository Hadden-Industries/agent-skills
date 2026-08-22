#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { renderCommitMessage } from "./commitMessageRenderer.js";

const ALLOWED_TYPES = [
  "build",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "test",
];

const ALLOWED_TYPE_SET = new Set(ALLOWED_TYPES);
const SUBJECT_TARGET = 50;
const MAX_LINE_LENGTH = 72;

function characterLength(text) {
  let length = 0;

  for (const _ of text) {
    length += 1;
  }

  return length;
}

function splitNul(text) {
  return text.split("\0").filter(Boolean);
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function repositoryRoot() {
  return runGit(["rev-parse", "--show-toplevel"], process.cwd()).trim();
}

function worktreeChangedFiles(root) {
  const tracked = splitNul(
    runGit(["-C", root, "diff", "--name-only", "-z", "HEAD", "--"]),
  );

  const untracked = splitNul(
    runGit(["-C", root, "ls-files", "--others", "--exclude-standard", "-z"]),
  );

  return [...new Set([...tracked, ...untracked])];
}

function stagedChangedFiles(root) {
  return splitNul(
    runGit(["-C", root, "diff", "--name-only", "--cached", "-z", "HEAD", "--"]),
  );
}

/**
 * Determines which files the commit message is expected to describe.
 *
 * A partial commit is legitimate: the author may stage a subset of the changed
 * files and commit only those. Comparing the message against every change in
 * the working tree would reject that, so the index is the authority whenever it
 * holds staged changes. This mirrors `git commit`, which commits the index.
 */
function resolveScope(root, requested) {
  if (requested === "worktree") {
    return { resolved: "worktree", files: worktreeChangedFiles(root) };
  }

  const staged = stagedChangedFiles(root);

  if (requested === "staged") {
    if (staged.length === 0) {
      throw new Error(
        "scope 'staged' was requested but nothing is staged; " +
          "stage the files to commit, or use --scope worktree.",
      );
    }

    return { resolved: "staged", files: staged };
  }

  return staged.length > 0
    ? { resolved: "staged", files: staged }
    : { resolved: "worktree", files: worktreeChangedFiles(root) };
}

function compareBinary(a, b) {
  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

function isCapitalizedDescription(description) {
  const [first = ""] = description;

  return (
    first !== "" &&
    first === first.toLocaleUpperCase("en-US") &&
    first !== first.toLocaleLowerCase("en-US")
  );
}

function issue(severity, code, message, extra = {}) {
  return {
    severity,
    code,
    message,
    ...extra,
  };
}

function normalizeMessage(text) {
  const normalized = text.replace(/\r\n?/g, "\n");

  return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
}

function validateMessage(text, expectedFiles, fileScope) {
  const issues = [];
  const message = normalizeMessage(text);
  const lines = message.split("\n");
  const subject = lines[0] ?? "";
  const subjectLength = characterLength(subject);

  const subjectMatch =
    /^(?<type>[a-z]+)(?:\((?<scope>[^()\r\n]+)\))?: (?<description>.+)$/u.exec(
      subject,
    );

  let normalizedType = null;
  let scope = null;

  if (!subjectMatch) {
    issues.push(
      issue(
        "error",
        "SUBJECT_FORMAT_INVALID",
        "Subject must match <type>: <description> or " +
          "<type>(<scope>): <description>.",
        { line: 1 },
      ),
    );
  } else {
    const { type, description } = subjectMatch.groups;
    scope = subjectMatch.groups.scope ?? null;

    if (ALLOWED_TYPE_SET.has(type)) {
      normalizedType = type;
    } else {
      issues.push(
        issue(
          "error",
          "SUBJECT_TYPE_NOT_ALLOWED",
          `Subject type ${JSON.stringify(type)} is not allowed.`,
          { line: 1 },
        ),
      );
    }

    if (!isCapitalizedDescription(description)) {
      issues.push(
        issue(
          "error",
          "SUBJECT_DESCRIPTION_NOT_CAPITALIZED",
          "Subject description must begin with a capitalized word.",
          { line: 1 },
        ),
      );
    }
  }

  if (subject.endsWith(".")) {
    issues.push(
      issue(
        "error",
        "SUBJECT_TRAILING_PERIOD",
        "Subject must not end with a period.",
        { line: 1 },
      ),
    );
  }

  if (subjectLength > MAX_LINE_LENGTH) {
    issues.push(
      issue(
        "error",
        "SUBJECT_TOO_LONG",
        `Subject is ${subjectLength} characters; ` +
          `maximum is ${MAX_LINE_LENGTH}.`,
        { line: 1 },
      ),
    );
  }

  const uxHeading = "User Experience Changes:";
  const fileHeading = "File Changes:";

  const uxIndices = lines
    .map((line, index) => (line === uxHeading ? index : -1))
    .filter((index) => index >= 0);

  const fileIndices = lines
    .map((line, index) => (line === fileHeading ? index : -1))
    .filter((index) => index >= 0);

  const uxPresent = uxIndices.length > 0;

  let uxStructureValid = true;
  let fileStructureValid = true;

  if (uxIndices.length > 1) {
    uxStructureValid = false;

    issues.push(
      issue(
        "error",
        "UX_SECTION_DUPLICATE",
        "User Experience Changes section appears more than once.",
      ),
    );
  }

  if (fileIndices.length !== 1) {
    fileStructureValid = false;

    issues.push(
      issue(
        "error",
        fileIndices.length === 0
          ? "FILE_SECTION_MISSING"
          : "FILE_SECTION_DUPLICATE",
        fileIndices.length === 0
          ? "File Changes section is required."
          : "File Changes section appears more than once.",
      ),
    );
  }

  const uxIndex = uxIndices[0] ?? -1;
  const fileIndex = fileIndices[0] ?? -1;
  const expectedFirstHeadingIndex = 2;

  if (
    lines[1] !== "" ||
    (uxPresent ? uxIndex : fileIndex) !== expectedFirstHeadingIndex
  ) {
    issues.push(
      issue(
        "error",
        "SECTION_SPACING_INVALID",
        "Subject and first body section must be separated " +
          "by exactly one blank line.",
      ),
    );
  }

  const permittedBlankLines = new Set([1]);

  if (uxPresent && fileIndex >= 0) {
    if (
      uxIndex !== 2 ||
      fileIndex <= uxIndex + 2 ||
      lines[fileIndex - 1] !== ""
    ) {
      uxStructureValid = false;

      issues.push(
        issue(
          "error",
          "SECTION_ORDER_INVALID",
          "User Experience Changes must precede File Changes " +
            "and contain at least one change.",
        ),
      );
    } else {
      permittedBlankLines.add(fileIndex - 1);

      if (fileIndex >= 2 && lines[fileIndex - 2] === "") {
        issues.push(
          issue(
            "error",
            "SECTION_SPACING_INVALID",
            "Sections must be separated by exactly one blank line.",
          ),
        );
      }
    }

    const uxEnd = fileIndex > uxIndex ? fileIndex - 1 : lines.length;

    const uxLines = lines.slice(uxIndex + 1, uxEnd);
    let sawBullet = false;

    for (let offset = 0; offset < uxLines.length; offset += 1) {
      const line = uxLines[offset];
      const lineNumber = uxIndex + offset + 2;

      if (/^ {2}- \S/u.test(line)) {
        sawBullet = true;
      } else if (/^ {4,}\S/u.test(line) && sawBullet) {
        // Wrapped continuation of the preceding bullet.
      } else {
        uxStructureValid = false;

        issues.push(
          issue(
            "error",
            "UX_ENTRY_FORMAT_INVALID",
            "User Experience Changes entries must use " +
              "two-space-indented bullets.",
            { line: lineNumber },
          ),
        );
      }
    }

    if (!sawBullet) {
      uxStructureValid = false;

      issues.push(
        issue(
          "error",
          "UX_SECTION_EMPTY",
          "User Experience Changes must contain at least one bullet.",
        ),
      );
    }
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === "" && !permittedBlankLines.has(index)) {
      issues.push(
        issue(
          "error",
          "UNEXPECTED_BLANK_LINE",
          "Blank lines are permitted only between " +
            "commit-message sections.",
          { line: index + 1 },
        ),
      );
    }
  }

  const listedFiles = [];
  const fileEntryLineNumbers = [];

  if (fileIndex >= 0) {
    let currentFileIndex = -1;
    let currentFileHasBullet = false;

    function finalizeCurrentFile() {
      if (currentFileIndex >= 0 && !currentFileHasBullet) {
        fileStructureValid = false;

        issues.push(
          issue(
            "error",
            "FILE_ENTRY_MISSING_CHANGE",
            "Each File Changes entry must contain at least " +
              "one logical-change bullet.",
            {
              line: fileEntryLineNumbers[currentFileIndex],
            },
          ),
        );
      }
    }

    for (let index = fileIndex + 1; index < lines.length; index += 1) {
      const line = lines[index];
      const entryMatch = /^ {2}(\d+)\. `([^`]+)`$/u.exec(line);

      if (entryMatch) {
        finalizeCurrentFile();

        const number = Number(entryMatch[1]);
        const path = entryMatch[2];

        listedFiles.push(path);
        fileEntryLineNumbers.push(index + 1);
        currentFileIndex = listedFiles.length - 1;
        currentFileHasBullet = false;

        if (number !== listedFiles.length) {
          fileStructureValid = false;

          issues.push(
            issue(
              "error",
              "FILE_ENTRY_NUMBERING_INVALID",
              `File entry number must be ${listedFiles.length}.`,
              {
                line: index + 1,
                path,
              },
            ),
          );
        }

        continue;
      }

      if (/^ {5}- \S/u.test(line) && currentFileIndex >= 0) {
        currentFileHasBullet = true;
        continue;
      }

      if (
        /^ {7,}\S/u.test(line) &&
        currentFileIndex >= 0 &&
        currentFileHasBullet
      ) {
        continue;
      }

      fileStructureValid = false;

      // Provide specific feedback for under-indented wrapped lines
      if (
        /^ {1,6}\S/u.test(line) &&
        currentFileIndex >= 0 &&
        currentFileHasBullet
      ) {
        issues.push(
          issue(
            "error",
            "FILE_ENTRY_FORMAT_INVALID",
            "Wrapped lines under a bullet must be indented by at least 7 spaces to align properly.",
            { line: index + 1 },
          ),
        );
      } else {
        issues.push(
          issue(
            "error",
            "FILE_ENTRY_FORMAT_INVALID",
            "File Changes entries must match the required " +
              "numbered path and nested-bullet structure.",
            { line: index + 1 },
          ),
        );
      }
    }

    finalizeCurrentFile();

    if (listedFiles.length === 0) {
      fileStructureValid = false;

      issues.push(
        issue(
          "error",
          "FILE_SECTION_EMPTY",
          "File Changes must contain at least one file entry.",
        ),
      );
    }
  }

  const duplicateFiles = listedFiles.filter(
    (path, index) => listedFiles.indexOf(path) !== index,
  );

  for (const path of [...new Set(duplicateFiles)]) {
    issues.push(
      issue(
        "error",
        "FILE_DUPLICATE",
        "Each changed file must appear exactly once.",
        { path },
      ),
    );
  }

  const uniqueListedFiles = [...new Set(listedFiles)];

  const sortedFiles = [...uniqueListedFiles].sort(compareBinary);

  const orderValid = uniqueListedFiles.every(
    (path, index) => path === sortedFiles[index],
  );

  if (!orderValid) {
    issues.push(
      issue(
        "error",
        "FILE_ORDER_INVALID",
        "File paths are not in the validator's " + "strict binary sort order.",
      ),
    );
  }

  const expectedSet = new Set(expectedFiles);
  const listedSet = new Set(uniqueListedFiles);

  const staged = fileScope.resolved === "staged";

  for (const path of expectedFiles) {
    if (!listedSet.has(path)) {
      issues.push(
        issue(
          "error",
          "FILE_MISSING_FROM_MESSAGE",
          staged
            ? "A file staged for this commit is missing from " + "File Changes."
            : "A currently changed file is missing from File Changes.",
          { path },
        ),
      );
    }
  }

  for (const path of uniqueListedFiles) {
    if (!expectedSet.has(path)) {
      issues.push(
        issue(
          "error",
          "FILE_NOT_CURRENTLY_CHANGED",
          staged
            ? "File Changes contains a path that is not staged " +
                "for this commit."
            : "File Changes contains a path that is not currently " +
                "changed relative to HEAD.",
          { path },
        ),
      );
    }
  }

  for (let index = 1; index < lines.length; index += 1) {
    const length = characterLength(lines[index]);

    if (length > MAX_LINE_LENGTH) {
      issues.push(
        issue(
          "review",
          "BODY_LINE_OVER_LIMIT",
          `Body line is ${length} characters; review whether ` +
            "an indivisible token requires the excess length.",
          { line: index + 1 },
        ),
      );
    }
  }

  const errorCount = issues.filter(
    ({ severity }) => severity === "error",
  ).length;

  const reviewCount = issues.filter(
    ({ severity }) => severity === "review",
  ).length;

  return {
    schemaVersion: 2,
    valid: errorCount === 0,
    manualReviewRequired: reviewCount > 0,
    canonical: null,
    mode: "legacy",
    inspection: null,

    scope: {
      requested: fileScope.requested,
      resolved: fileScope.resolved,
      indexTreeOid: null,
    },

    manifest: {
      schemaVersion: null,
      indexTreeOid: null,
    },

    subject: {
      type: normalizedType,
      scope,
      length: subjectLength,
      target: SUBJECT_TARGET,
      maximum: MAX_LINE_LENGTH,
    },

    sections: {
      rationale: {
        present: false,
        structureValid: true,
      },
      userExperience: {
        present: uxPresent,
        structureValid: uxStructureValid,
      },
      fileChanges: {
        present: fileIndices.length > 0,
        structureValid: fileStructureValid,
      },
    },

    files: {
      expectedCount: expectedFiles.length,
      listedCount: listedFiles.length,
      setMatches:
        expectedFiles.length === listedSet.size &&
        expectedFiles.every((path) => listedSet.has(path)),
      orderValid,
      unique: duplicateFiles.length === 0,
    },

    summary: {
      errors: errorCount,
      reviews: reviewCount,
    },

    issues,
  };
}

function validateManifestMessage(text, manifest, content, ledger) {
  const message = normalizeMessage(text);
  const expectedMessage = normalizeMessage(
    renderCommitMessage(manifest, content),
  );
  const canonical = message === expectedMessage;
  const issues = [];
  const subjectText = message.split("\n")[0] ?? "";
  const subjectLength = characterLength(subjectText);

  if (!canonical) {
    issues.push(
      issue(
        "error",
        "MESSAGE_NOT_CANONICAL",
        "Message differs from the deterministic rendering of its manifest and content.",
      ),
    );
  }

  const inspectionComplete = ledger.complete === true;
  const inspectionTreeMatches = ledger.indexTreeOid === manifest.indexTreeOid;

  if (!inspectionComplete || !inspectionTreeMatches) {
    issues.push(
      issue(
        "error",
        "INSPECTION_INCOMPLETE",
        "Inspection ledger must be complete and match the approved index tree.",
      ),
    );
  }

  const lines = message.split("\n");

  for (let index = 1; index < lines.length; index += 1) {
    const length = characterLength(lines[index]);

    if (length > MAX_LINE_LENGTH) {
      issues.push(
        issue(
          "review",
          "BODY_LINE_OVER_LIMIT",
          `Body line is ${length} characters; review whether ` +
            "an indivisible token requires the excess length.",
          { line: index + 1 },
        ),
      );
    }
  }

  const errorCount = issues.filter(
    ({ severity }) => severity === "error",
  ).length;
  const reviewCount = issues.filter(
    ({ severity }) => severity === "review",
  ).length;
  const listedCount =
    content.mode === "bulk"
      ? (content.domains ?? []).reduce(
          (total, domain) => total + (domain.changeUnitIds?.length ?? 0),
          0,
        )
      : (content.changeEntries?.length ?? 0);

  return {
    schemaVersion: 2,
    valid: errorCount === 0,
    manualReviewRequired: reviewCount > 0,
    canonical,
    mode: content.mode,
    inspection: {
      complete: inspectionComplete,
      treeMatches: inspectionTreeMatches,
    },
    scope: {
      requested: "manifest",
      resolved: "snapshot",
      indexTreeOid: manifest.indexTreeOid,
    },
    manifest: {
      schemaVersion: manifest.schemaVersion,
      indexTreeOid: manifest.indexTreeOid,
    },
    subject: {
      type: ALLOWED_TYPE_SET.has(content.subject?.type)
        ? content.subject.type
        : null,
      scope: content.subject?.scope ?? null,
      length: subjectLength,
      target: SUBJECT_TARGET,
      maximum: MAX_LINE_LENGTH,
    },
    sections: {
      rationale: {
        present: (content.rationale?.length ?? 0) > 0,
        structureValid: canonical,
      },
      userExperience: {
        present: (content.userExperienceChanges?.length ?? 0) > 0,
        structureValid: canonical,
      },
      fileChanges: {
        present: true,
        structureValid: canonical,
      },
    },
    files: {
      expectedCount: manifest.changeUnitCount,
      listedCount,
      setMatches: listedCount === manifest.changeUnitCount,
      orderValid: canonical,
      unique: listedCount === manifest.changeUnitCount,
    },
    summary: {
      errors: errorCount,
      reviews: reviewCount,
    },
    issues,
  };
}

const ALLOWED_SCOPES = ["auto", "staged", "worktree"];

function usageError(message) {
  console.error(message);
  console.error(
    "Usage: node commitWorkflow.mjs message validate " +
      "[--scope auto|staged|worktree] [--manifest <snapshot.json> " +
      "--content <content.json> --ledger <ledger.json>] <commit-message-file>",
  );

  process.exit(2);
}

function parseArguments(argv) {
  let requestedScope = "auto";
  let manifestPath = null;
  let contentPath = null;
  let ledgerPath = null;
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--scope") {
      requestedScope = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument.startsWith("--scope=")) {
      requestedScope = argument.slice("--scope=".length);
      continue;
    }

    if (argument === "--manifest") {
      manifestPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--content") {
      contentPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (argument === "--ledger") {
      ledgerPath = argv[index + 1];
      index += 1;
      continue;
    }

    positional.push(argument);
  }

  if (positional.length !== 1) {
    usageError("Expected exactly one commit-message file path.");
  }

  if (!ALLOWED_SCOPES.includes(requestedScope)) {
    usageError(
      `Unknown scope '${requestedScope}'. ` +
        `Expected one of: ${ALLOWED_SCOPES.join(", ")}.`,
    );
  }

  const manifestInputs = [manifestPath, contentPath, ledgerPath];
  const suppliedManifestInputs = manifestInputs.filter(
    (value) => value !== null,
  ).length;

  if (
    suppliedManifestInputs !== 0 &&
    suppliedManifestInputs !== manifestInputs.length
  ) {
    usageError(
      "--manifest, --content, and --ledger must be supplied together.",
    );
  }

  return {
    messagePath: positional[0],
    requestedScope,
    manifestPath,
    contentPath,
    ledgerPath,
  };
}

const { messagePath, requestedScope, manifestPath, contentPath, ledgerPath } =
  parseArguments(process.argv.slice(2));

try {
  const root = repositoryRoot();
  const message = readFileSync(messagePath, "utf8");
  let result;

  if (manifestPath) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const content = JSON.parse(readFileSync(contentPath, "utf8"));
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));

    result = validateManifestMessage(message, manifest, content, ledger);
  } else {
    const { resolved, files } = resolveScope(root, requestedScope);

    result = validateMessage(message, files, {
      requested: requestedScope,
      resolved,
    });
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  process.exit(result.valid ? 0 : 1);
} catch (error) {
  const detail = error?.stderr?.toString?.().trim() || error.message;

  console.error(`Commit-message validation could not run: ${detail}`);

  process.exit(2);
}
