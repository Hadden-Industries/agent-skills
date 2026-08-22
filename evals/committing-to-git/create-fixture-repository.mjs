#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export function resolveSourceWorktree() {
  return realpathSync(resolve(SCRIPT_DIRECTORY, "..", ".."));
}

const SOURCE_WORKTREE = resolveSourceWorktree();

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (!flag?.startsWith("--") || value === undefined) {
      fail(
        "Usage: create-fixture-repository.mjs --scenario NAME --destination ABSOLUTE_PATH",
      );
    }

    options[flag.slice(2)] = value;
  }

  if (!options.scenario || !options.destination) {
    fail("Both --scenario and --destination are required");
  }

  return options;
}

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);

  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

function resolveProspectivePath(destination) {
  const unresolvedSegments = [];
  let ancestor = destination;

  while (!existsSync(ancestor)) {
    unresolvedSegments.unshift(ancestor.slice(dirname(ancestor).length + 1));
    ancestor = dirname(ancestor);
  }

  return resolve(realpathSync(ancestor), ...unresolvedSegments);
}

function validateDestination(rawDestination) {
  if (!isAbsolute(rawDestination)) {
    fail("The fixture destination must be an absolute path");
  }

  const destination = resolve(rawDestination);

  if (existsSync(destination)) {
    fail(`The fixture destination already exists: ${destination}`);
  }

  const prospectiveDestination = resolveProspectivePath(destination);

  if (isWithin(SOURCE_WORKTREE, prospectiveDestination)) {
    fail("The fixture destination must be outside the source worktree");
  }

  return destination;
}

function git(repository, args, { allowFailure = false, input } = {}) {
  const result = spawnSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    input,
    windowsHide: true,
  });

  if (result.error) {
    fail(`Could not start git ${args.join(" ")}: ${result.error.message}`);
  }

  if (!allowFailure && result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }

  return result;
}

function writeRepositoryFile(repository, relativePath, contents) {
  const target = join(repository, relativePath);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function commitAll(repository, message) {
  git(repository, ["add", "-A"]);
  git(repository, ["commit", "--quiet", "-m", message]);
}

function initializeRepository(repository) {
  mkdirSync(repository);
  git(repository, ["init", "--quiet", "-b", "main"]);
  git(repository, ["config", "user.email", "evals@example.invalid"]);
  git(repository, ["config", "user.name", "Committing To Git Evals"]);
  git(repository, ["config", "commit.gpgsign", "false"]);
  git(repository, ["config", "core.autocrlf", "false"]);
}

function createStagedRename(repository) {
  writeRepositoryFile(
    repository,
    "Dockerfile",
    "FROM node:24\nCOPY vite.config.js /app/vite.config.js\n",
  );
  writeRepositoryFile(repository, "vite.config.js", "export default {};\n");
  writeRepositoryFile(
    repository,
    "package-lock.json",
    '{"lockfileVersion": 3}\n',
  );
  writeRepositoryFile(repository, "skills-lock.json", '{"skills": []}\n');
  commitAll(repository, "seed staged rename fixture");

  renameSync(
    join(repository, "vite.config.js"),
    join(repository, "vite.config.mjs"),
  );
  writeRepositoryFile(
    repository,
    "Dockerfile",
    "FROM node:24\nCOPY vite.config.mjs /app/vite.config.mjs\n",
  );
  git(repository, ["add", "-A"]);

  writeRepositoryFile(
    repository,
    "package-lock.json",
    '{"lockfileVersion": 3, "packages": {"": {}}}\n',
  );
  writeRepositoryFile(
    repository,
    "skills-lock.json",
    '{"skills": ["local-only"]}\n',
  );

  return {
    excludedPaths: ["package-lock.json", "skills-lock.json"],
    stagedPaths: ["Dockerfile", "vite.config.js", "vite.config.mjs"],
  };
}

function createLiteralPath(repository) {
  writeRepositoryFile(repository, "-literal[1].txt", "baseline\n");
  commitAll(repository, "seed literal path fixture");

  writeRepositoryFile(repository, "-literal[1].txt", "target update\n");
  writeRepositoryFile(repository, "-literal1.txt", "unrelated sibling\n");

  return {
    literalPath: "-literal[1].txt",
    excludedPath: "-literal1.txt",
  };
}

function bulkDomainFor(index, count) {
  const parserCount = 20;
  const integrationCount = 12;
  const fixtureCount = 10;

  if (index < parserCount) {
    return ["src/parser", "Parser and ingestion"];
  }

  if (index < parserCount + integrationCount) {
    return ["src/integration", "Integration"];
  }

  if (index < parserCount + integrationCount + fixtureCount) {
    return ["fixtures", "Fixtures"];
  }

  if (index < count) {
    return ["docs", "Documentation"];
  }

  fail(`Bulk fixture index ${index} exceeds ${count}`);
}

function createBulk(repository, count) {
  writeRepositoryFile(repository, "README.md", "# Bulk eval fixture\n");
  commitAll(repository, "seed bulk fixture");

  const domainCounts = new Map();

  for (let index = 0; index < count; index += 1) {
    const [directory, domain] = bulkDomainFor(index, count);
    const ordinal = String(index + 1).padStart(3, "0");

    writeRepositoryFile(
      repository,
      join(directory, `change-${ordinal}.txt`),
      `change unit ${index + 1}\n`,
    );
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  git(repository, ["add", "-A"]);

  return {
    changeUnitCount: count,
    messageMode: count < 50 ? "detailed" : "bulk",
    domains: [...domainCounts].map(([name, files]) => ({ name, files })),
  };
}

function createStaleHead(repository) {
  writeRepositoryFile(repository, "feature.txt", "baseline\n");
  commitAll(repository, "seed stale parent fixture");

  writeRepositoryFile(repository, "feature.txt", "approved staged update\n");
  git(repository, ["add", "--", "feature.txt"]);

  const approvedHead = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
  const approvedIndexTree = git(repository, ["write-tree"]).stdout.trim();
  const currentHeadTree = git(repository, [
    "rev-parse",
    "HEAD^{tree}",
  ]).stdout.trim();
  const currentHead = git(repository, [
    "commit-tree",
    currentHeadTree,
    "-p",
    approvedHead,
    "-m",
    "concurrent empty-tree commit",
  ]).stdout.trim();

  git(repository, ["update-ref", "HEAD", currentHead, approvedHead]);

  return {
    approvedHead,
    approvedIndexTree,
    currentHead,
    currentHeadTree,
    currentIndexTree: git(repository, ["write-tree"]).stdout.trim(),
  };
}

function createActiveCherryPick(repository) {
  writeRepositoryFile(repository, "shared.txt", "base\n");
  commitAll(repository, "seed cherry-pick fixture");

  git(repository, ["switch", "--quiet", "-c", "topic"]);
  writeRepositoryFile(repository, "shared.txt", "topic change\n");
  commitAll(repository, "topic change");
  const topicCommit = git(repository, ["rev-parse", "HEAD"]).stdout.trim();

  git(repository, ["switch", "--quiet", "main"]);
  writeRepositoryFile(repository, "shared.txt", "main change\n");
  commitAll(repository, "main change");

  const cherryPick = git(repository, ["cherry-pick", topicCommit], {
    allowFailure: true,
  });

  if (cherryPick.status === 0) {
    fail(
      "The active-cherry-pick fixture unexpectedly applied without conflict",
    );
  }

  return {
    operation: "cherry-pick",
    topicCommit,
    unmergedPath: "shared.txt",
  };
}

const SCENARIOS = new Map([
  ["active-cherry-pick", createActiveCherryPick],
  ["bulk-49", (repository) => createBulk(repository, 49)],
  ["bulk-50", (repository) => createBulk(repository, 50)],
  ["literal-path", createLiteralPath],
  ["staged-rename", createStagedRename],
  ["stale-head", createStaleHead],
]);

function main() {
  const options = parseArguments(process.argv.slice(2));
  const createScenario = SCENARIOS.get(options.scenario);

  if (!createScenario) {
    fail(
      `Unknown scenario ${JSON.stringify(options.scenario)}; choose one of ${[
        ...SCENARIOS.keys(),
      ].join(", ")}`,
    );
  }

  const repository = validateDestination(options.destination);

  initializeRepository(repository);
  const expected = createScenario(repository);

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        scenario: options.scenario,
        repository,
        expected,
      },
      null,
      2,
    )}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
