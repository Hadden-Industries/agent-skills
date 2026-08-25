#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));

export function resolveSourceWorktree() {
  return realpathSync(resolve(SCRIPT_DIRECTORY, "..", ".."));
}

const SOURCE_WORKTREE = resolveSourceWorktree();

export const COST_PROFILES = Object.freeze({
  "commit-and-publish": {
    route: "concise",
    highLevelHelperCalls: 3,
    opaqueTransactionHandlePassThroughs: 2,
    agentManagedArtifactReads: 0,
    agentManagedArtifactWrites: 0,
    approvalTurns: 1,
  },
  "commit-recovery": {
    route: "recovery",
    maximumAutomaticMutationRetries: 0,
  },
  "concise-checked": {
    route: "concise",
    highLevelHelperCalls: 3,
    opaqueTransactionHandlePassThroughs: 2,
    agentManagedArtifactReads: 0,
    agentManagedArtifactWrites: 1,
    approvalTurns: 1,
  },
  "concise-direct": {
    route: "concise",
    highLevelHelperCalls: 2,
    opaqueTransactionHandlePassThroughs: 1,
    agentManagedArtifactReads: 0,
    agentManagedArtifactWrites: 0,
    approvalTurns: 1,
  },
  "draft-concise": {
    route: "concise",
    highLevelHelperCalls: 1,
    agentManagedArtifactReads: 0,
    agentManagedArtifactWrites: 0,
    approvalTurns: 0,
  },
  "draft-promotion": {
    route: "concise",
    highLevelHelperCalls: 3,
    maximumRepeatedEvidenceReads: 0,
    approvalTurns: 1,
  },
  "draft-retention": {
    route: "concise",
    maximumCleanupCallsBeforeTerminalState: 0,
  },
  "evidence-delta": {
    route: "extended",
    maximumUnchangedPacketReads: 0,
  },
  "extended-review": {
    route: "extended",
    maximumPacketBytes: 16384,
    maximumConcurrentPacketReads: 1,
  },
  "fresh-preparation": {
    route: "fresh-preparation",
    maximumStaleTransactionMutations: 0,
  },
  "high-level-exits": {
    route: "mixed",
    maximumStdoutDocumentsPerCall: 1,
    maximumAutomaticMutationRetries: 0,
  },
  "history-exception": {
    route: "concise",
    maximumHistoryQueries: 1,
  },
  "invalid-input": {
    route: "invalid",
    highLevelHelperCalls: 1,
    maximumRepositoryMutations: 0,
  },
  "known-context-direct": {
    route: "concise",
    highLevelHelperCalls: 2,
    opaqueTransactionHandlePassThroughs: 1,
    agentManagedArtifactReads: 0,
    agentManagedArtifactWrites: 0,
    approvalTurns: 1,
    minimumOldSkillTokenReductionPercent: 80,
    maximumNoSkillTokenMultiple: 2,
  },
  "mixed-evidence": {
    route: "extended",
    maximumWholeScopeReviewEscalations: 0,
  },
  "permission-preflight": {
    route: "concise",
    maximumKnownDoomedCommands: 0,
    permissionRequests: 1,
  },
  "preparation-recovery": {
    route: "recovery",
    maximumReconstructedPreparationInputs: 0,
  },
  "publication-recovery": {
    route: "recovery",
    maximumRemoteObservations: 1,
    maximumAutomaticPushRetries: 0,
  },
  "safe-stop": {
    route: "stopped",
    maximumRepositoryMutations: 0,
  },
  "scope-clarification": {
    route: "clarification",
    maximumRepositoryMutationsBeforeClarification: 0,
  },
  "structured-bulk": {
    route: "extended",
    maximumAuthoredUnitIds: 0,
    maximumCanonicalMessageBytes: 32768,
  },
  "verification-recovery": {
    route: "recovery",
    maximumCommitCreations: 0,
  },
  "wording-revision": {
    route: "concise",
    maximumEvidenceReads: 0,
    retainedCanonicalMessageBodies: 1,
  },
  "witnessed-check": {
    route: "concise-with-check",
    highLevelHelperCalls: 3,
    opaqueTransactionHandlePassThroughs: 2,
    agentManagedArtifactReads: 0,
    agentManagedArtifactWrites: 0,
    approvalTurns: 1,
    maximumSuccessfulOutputDisplayBytes: 0,
    maximumAutomaticCheckRetries: 0,
  },
});

const EVALUATION_FIELDS = new Set([
  "case_key",
  "cost_profile",
  "critical_safety",
  "execution_mode",
  "expectations",
  "expected_output",
  "files",
  "fixture",
  "id",
  "prompt",
]);
const CONFIGURATION_FIELDS = new Set([
  "evals",
  "metrics",
  "notes",
  "schemaVersion",
  "skill_name",
]);
const RETIRED_EVALUATION_IDS = new Set([20, 22, 25, 26, 27]);
const REMOVED_COMMAND =
  /\b(?:snapshot create|snapshot verify|inspection (?:prepare|acknowledge|expand-deletion)|message (?:scaffold|render|validate)|signature verify|report create|publication push)\b/iu;

function fail(message) {
  throw new Error(message);
}

export function fixtureScenarioNames() {
  // Module initialization completes the SCENARIOS map before callers can invoke this export.
  // eslint-disable-next-line no-use-before-define
  return [...SCENARIOS.keys()].sort();
}

export function validateEvaluationConfiguration(configuration) {
  if (!configuration || configuration.schemaVersion !== 2) {
    fail("Evaluation configuration must use schemaVersion 2");
  }

  for (const field of Object.keys(configuration)) {
    if (!CONFIGURATION_FIELDS.has(field)) {
      fail(`Unknown configuration field ${JSON.stringify(field)}`);
    }
  }

  for (const field of CONFIGURATION_FIELDS) {
    if (!(field in configuration)) {
      fail(`Missing configuration field ${JSON.stringify(field)}`);
    }
  }

  if (!Array.isArray(configuration.evals)) {
    fail("Evaluation configuration must contain an evals array");
  }

  const ids = new Set();
  const caseKeys = new Set();

  for (const evaluation of configuration.evals) {
    for (const field of Object.keys(evaluation)) {
      if (!EVALUATION_FIELDS.has(field)) {
        fail(`Unknown evaluation field ${JSON.stringify(field)}`);
      }
    }

    for (const field of EVALUATION_FIELDS) {
      if (!(field in evaluation)) {
        fail(`Missing evaluation field ${JSON.stringify(field)}`);
      }
    }

    if (RETIRED_EVALUATION_IDS.has(evaluation.id)) {
      fail(`Retired evaluation ID ${evaluation.id} cannot be loaded`);
    }

    if (ids.has(evaluation.id)) {
      fail(`Duplicate evaluation ID ${evaluation.id}`);
    }

    if (caseKeys.has(evaluation.case_key)) {
      fail(`Duplicate case key ${JSON.stringify(evaluation.case_key)}`);
    }

    ids.add(evaluation.id);
    caseKeys.add(evaluation.case_key);

    if (!["policy", "executable"].includes(evaluation.execution_mode)) {
      fail(`Invalid execution mode for ${evaluation.case_key}`);
    }

    if (evaluation.execution_mode === "executable") {
      if (
        typeof evaluation.fixture !== "string" ||
        // Module initialization completes the SCENARIOS map before validation can run.
        // eslint-disable-next-line no-use-before-define
        !SCENARIOS.has(evaluation.fixture)
      ) {
        fail(`Unknown fixture ${JSON.stringify(evaluation.fixture)}`);
      }
    } else if (evaluation.fixture !== null) {
      fail(`Policy evaluation ${evaluation.case_key} cannot name a fixture`);
    }

    if (
      evaluation.cost_profile !== null &&
      !Object.hasOwn(COST_PROFILES, evaluation.cost_profile)
    ) {
      fail(`Unknown cost profile ${JSON.stringify(evaluation.cost_profile)}`);
    }

    if (!Array.isArray(evaluation.expectations)) {
      fail(`Evaluation ${evaluation.case_key} must have expectations`);
    }

    for (const expectation of evaluation.expectations) {
      if (typeof expectation !== "string" || expectation.length === 0) {
        fail(`Evaluation ${evaluation.case_key} has an invalid expectation`);
      }

      if (REMOVED_COMMAND.test(expectation)) {
        fail(`Evaluation ${evaluation.case_key} names a removed command`);
      }
    }
  }

  return configuration;
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

function createAddedFiles(
  repository,
  {
    count = 1,
    directory = "src",
    prefix = "change",
    staged = false,
    contents = (index) => `change ${index + 1}\n`,
  } = {},
) {
  writeRepositoryFile(repository, "README.md", "# Evaluation fixture\n");
  commitAll(repository, "seed evaluation fixture");

  const paths = [];

  for (let index = 0; index < count; index += 1) {
    const path = join(
      directory,
      `${prefix}-${String(index + 1).padStart(4, "0")}.txt`,
    );

    writeRepositoryFile(repository, path, contents(index));
    paths.push(path.replaceAll("\\", "/"));
  }

  if (staged) {
    git(repository, ["add", "-A"]);
  }

  return { changeUnitCount: count, paths, staged };
}

function createKnownContextInventory(repository) {
  writeRepositoryFile(repository, "skills-lock.json", '{"skills": []}\n');
  writeRepositoryFile(repository, "README.md", "# Fixture\n");
  writeRepositoryFile(
    repository,
    "package-lock.json",
    '{"lockfileVersion": 3}\n',
  );
  commitAll(repository, "seed known-context fixture");

  writeRepositoryFile(
    repository,
    "skills-lock.json",
    '{"skills": ["new-agent-skill"], "updated": ["existing-skill"]}\n',
  );
  writeRepositoryFile(repository, "README.md", "# Unrelated local notes\n");
  writeRepositoryFile(
    repository,
    "package-lock.json",
    '{"lockfileVersion": 3, "unrelated": true}\n',
  );

  return {
    hint: "Add new agent skills, update existing skill",
    selectedPaths: ["skills-lock.json"],
    excludedPaths: ["README.md", "package-lock.json"],
  };
}

function createThreeFileFix(repository) {
  writeRepositoryFile(
    repository,
    "src/parser.js",
    "export const parse = (value) => value;\n",
  );
  writeRepositoryFile(repository, "tests/parser.test.js", "// baseline\n");
  writeRepositoryFile(repository, "fixtures/malformed.txt", "accepted\n");
  commitAll(repository, "seed misleading feature fixture");

  writeRepositoryFile(
    repository,
    "src/parser.js",
    "export const parse = (value) => { if (!value.includes(':')) throw new Error('malformed'); return value; };\n",
  );
  writeRepositoryFile(
    repository,
    "tests/parser.test.js",
    "// rejects malformed\n",
  );
  writeRepositoryFile(repository, "fixtures/malformed.txt", "rejected\n");

  return {
    misleadingHintType: "feat",
    expectedType: "fix",
    changeUnitCount: 3,
  };
}

function createSecurityChange(repository, grounded) {
  writeRepositoryFile(
    repository,
    "src/security/policy.js",
    "export const allow = () => true;\n",
  );
  commitAll(repository, "seed security fixture");
  writeRepositoryFile(
    repository,
    "src/security/policy.js",
    "export const allow = (request) => request.authenticated === true;\n",
  );

  return {
    path: "src/security/policy.js",
    evidenceBasis: grounded ? "authored-and-tested-current-task" : "unknown",
    expectedRoute: grounded ? "concise" : "extended",
  };
}

function createImplementationMechanicsHint(repository) {
  const expected = createStagedRename(repository);

  return {
    ...expected,
    hint: "Rename the Vite config and convert path handling to ESM",
    outcome: "Prevent the native config-loader warning",
  };
}

function createUnambiguousScope(repository) {
  writeRepositoryFile(repository, "README.md", "# Baseline\n");
  writeRepositoryFile(
    repository,
    "package-lock.json",
    '{"lockfileVersion": 3}\n',
  );
  commitAll(repository, "seed unambiguous scope fixture");

  const selectedPaths = [];

  for (let index = 0; index < 6; index += 1) {
    const path = `src/task-${index + 1}.js`;
    writeRepositoryFile(
      repository,
      path,
      `export const task${index + 1} = true;\n`,
    );
    selectedPaths.push(path);
  }

  writeRepositoryFile(repository, "README.md", "# Unrelated notes\n");
  writeRepositoryFile(
    repository,
    "package-lock.json",
    '{"lockfileVersion": 3, "local": true}\n',
  );

  return {
    selectedPaths,
    excludedPaths: ["README.md", "package-lock.json"],
  };
}

function createAmbiguousScopes(repository) {
  writeRepositoryFile(repository, "README.md", "# Baseline\n");
  commitAll(repository, "seed ambiguous scope fixture");

  const scopes = { importer: [], exporter: [] };

  for (const [scope, directory] of [
    ["importer", "src/import"],
    ["exporter", "src/export"],
  ]) {
    for (let index = 0; index < 3; index += 1) {
      const path = `${directory}/shared-${index + 1}.js`;
      writeRepositoryFile(repository, path, `${scope} ${index + 1}\n`);
      scopes[scope].push(path);
    }
  }

  return { materiallyPlausibleScopes: scopes, stagedPathCount: 0 };
}

function createSimpleEvidenceScenario(repository, evidenceBasis) {
  const state = createAddedFiles(repository, {
    count: 4,
    directory: "generated",
  });

  return { ...state, evidenceBasis };
}

function createMessageTransportScenario(repository, message, transport) {
  const state = createAddedFiles(repository, { count: 1, staged: true });

  return {
    ...state,
    canonicalMessage: message.endsWith("\n") ? message : `${message}\n`,
    expectedTransport: transport,
    fixedInputName: "message-input.txt",
  };
}

function createRevisionScenario(repository, revisionKind) {
  writeRepositoryFile(repository, "feature.txt", "baseline\n");
  commitAll(repository, "seed revision fixture");
  writeRepositoryFile(repository, "feature.txt", "approved change\n");
  git(repository, ["add", "--", "feature.txt"]);
  const approvedTree = git(repository, ["write-tree"]).stdout.trim();

  if (revisionKind === "changed-tree") {
    writeRepositoryFile(repository, "feature.txt", "changed after approval\n");
  }

  return {
    revisionKind,
    approvedTree,
    retainedCanonicalBodies: 1,
  };
}

function createMixedProvenance(repository) {
  writeRepositoryFile(repository, "README.md", "# Baseline\n");
  commitAll(repository, "seed mixed provenance fixture");

  for (const [directory, count] of [
    ["src/authored", 4],
    ["docs/user-grounded", 3],
    ["fixtures/unknown", 2],
  ]) {
    for (let index = 0; index < count; index += 1) {
      writeRepositoryFile(
        repository,
        join(directory, `unit-${index + 1}.txt`),
        `${directory} ${index + 1}\n`,
      );
    }
  }

  return {
    groups: [
      { selector: "src/authored", policy: "reuse", count: 4 },
      { selector: "docs/user-grounded", policy: "message", count: 3 },
      { selector: "fixtures/unknown", policy: "review", count: 2 },
    ],
    newlyRequiredPacketCount: 3,
  };
}

function createInvalidUtf8Evidence(repository) {
  writeRepositoryFile(repository, "README.md", "# Baseline\n");
  commitAll(repository, "seed invalid UTF-8 fixture");
  writeRepositoryFile(
    repository,
    "fixtures/invalid.bin",
    Buffer.from([0x66, 0x6f, 0x80, 0x6f, 0x0a]),
  );

  return {
    path: "fixtures/invalid.bin",
    expectedRoute: "extended",
    expectedReason: "invalid-evidence-encoding",
    replacementDecodingAllowed: false,
  };
}

function createSynopsisOverBudget(repository) {
  const state = createAddedFiles(repository, {
    count: 330,
    directory: "scope",
    prefix: `long-${"x".repeat(80)}`,
    staged: true,
  });

  return {
    ...state,
    expectedRoute: "extended",
    expectedReason: "scope-synopsis-over-budget",
    boundary: "one-byte-over",
  };
}

function createPartialCloneMissingObject(repository) {
  writeRepositoryFile(
    repository,
    "historical.txt",
    "required historical body\n",
  );
  commitAll(repository, "seed partial clone fixture");
  const missingObjectOid = git(repository, [
    "rev-parse",
    "HEAD:historical.txt",
  ]).stdout.trim();

  rmSync(join(repository, "historical.txt"));
  git(repository, ["add", "-A"]);
  git(repository, ["config", "extensions.partialClone", "origin"]);
  git(repository, ["config", "remote.origin.promisor", "true"]);
  git(repository, ["config", "remote.origin.partialclonefilter", "blob:none"]);

  const looseObject = join(
    repository,
    ".git",
    "objects",
    missingObjectOid.slice(0, 2),
    missingObjectOid.slice(2),
  );

  if (existsSync(looseObject)) {
    rmSync(looseObject);
  }

  return {
    missingObjectOid,
    hiddenFetchAllowed: false,
    expectedReason: "required-object-unavailable",
  };
}

function createConfiguredExternalDrivers(repository) {
  const sentinelPaths = [
    "external-diff-ran",
    "textconv-ran",
    "pager-ran",
    "fsmonitor-ran",
  ];
  const script = join(repository, "tools", "write-sentinel.mjs");

  writeRepositoryFile(
    repository,
    "tools/write-sentinel.mjs",
    "import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], 'ran\\n');\n",
  );
  writeRepositoryFile(repository, ".gitattributes", "*.custom diff=eval\n");
  writeRepositoryFile(repository, "sample.custom", "baseline\n");
  commitAll(repository, "seed configured driver fixture");
  writeRepositoryFile(repository, "sample.custom", "changed\n");

  git(repository, [
    "config",
    "diff.external",
    `node ${JSON.stringify(script)} ${JSON.stringify(join(repository, sentinelPaths[0]))}`,
  ]);
  git(repository, [
    "config",
    "diff.eval.textconv",
    `node ${JSON.stringify(script)} ${JSON.stringify(join(repository, sentinelPaths[1]))}`,
  ]);
  git(repository, [
    "config",
    "core.pager",
    `node ${JSON.stringify(script)} ${JSON.stringify(join(repository, sentinelPaths[2]))}`,
  ]);
  git(repository, [
    "config",
    "core.fsmonitor",
    `node ${JSON.stringify(script)} ${JSON.stringify(join(repository, sentinelPaths[3]))}`,
  ]);

  return { sentinelPaths, expectedInvocations: 0 };
}

function createBinaryFiles(repository, count) {
  writeRepositoryFile(repository, "README.md", "# Binary fixture\n");
  commitAll(repository, "seed binary fixture");

  for (let index = 0; index < count; index += 1) {
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32BE(index, 0);
    writeRepositoryFile(
      repository,
      join("assets", `blob-${String(index + 1).padStart(4, "0")}.bin`),
      bytes,
    );
  }

  git(repository, ["add", "-A"]);

  return {
    changeUnitCount: count,
    binaryMetadataArtifactCount: 0,
    expectedRoute: "concise",
  };
}

function createLargeFile(repository, relativePath, byteCount, byte = "x") {
  writeRepositoryFile(repository, "README.md", "# Large file fixture\n");
  commitAll(repository, "seed large file fixture");
  writeRepositoryFile(repository, relativePath, Buffer.alloc(byteCount, byte));
  git(repository, ["add", "-A"]);

  return { path: relativePath, byteCount };
}

function createHeadAnchor(repository, kind) {
  if (kind === "unborn") {
    writeRepositoryFile(repository, "feature.txt", "unborn change\n");
    return { headKind: "unborn", expectedParentOids: [] };
  }

  writeRepositoryFile(repository, "feature.txt", "baseline\n");
  commitAll(repository, `seed ${kind} head fixture`);

  if (kind === "detached") {
    git(repository, ["switch", "--quiet", "--detach"]);
  }

  writeRepositoryFile(repository, "feature.txt", `${kind} change\n`);

  return {
    headKind: kind,
    expectedParentOids: [git(repository, ["rev-parse", "HEAD"]).stdout.trim()],
  };
}

function createDraftPathsState(repository, state) {
  writeRepositoryFile(repository, "selected.txt", "baseline\n");
  writeRepositoryFile(repository, "blocker.txt", "baseline\n");
  commitAll(repository, "seed draft paths fixture");
  writeRepositoryFile(repository, "selected.txt", "selected change\n");

  if (state === "disjoint") {
    writeRepositoryFile(repository, "blocker.txt", "staged blocker\n");
    git(repository, ["add", "--", "blocker.txt"]);
  } else if (state === "overlap") {
    git(repository, ["add", "--", "selected.txt"]);
    writeRepositoryFile(
      repository,
      "selected.txt",
      "overlapping unstaged change\n",
    );
  } else {
    writeRepositoryFile(repository, "blocker.txt", "pre-staged blocker\n");
    git(repository, ["add", "--", "blocker.txt"]);
  }

  return { selectedPath: "selected.txt", stagedState: state };
}

function createSignatureTrustFixture(repository) {
  const state = createAddedFiles(repository, { count: 1, staged: true });
  const trustPath = join(repository, ".git", "missing-allowed-signers");
  git(repository, ["config", "gpg.format", "ssh"]);
  git(repository, ["config", "gpg.ssh.allowedSignersFile", trustPath]);

  return {
    ...state,
    trustPath,
    trustSourceReadable: false,
    expectedClassification: "unavailable",
  };
}

function createSshTrustStateFixture(repository, expectedTrustState) {
  const state = createAddedFiles(repository, { count: 1 });
  const trustPath = join(
    repository,
    ".git",
    expectedTrustState === "not-found"
      ? "missing-allowed-signers"
      : "declared-denied-allowed-signers",
  );

  if (expectedTrustState === "permission-denied") {
    writeFileSync(
      trustPath,
      "evals@example.invalid ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEvaluationOnly\n",
    );
  }

  git(repository, ["config", "gpg.format", "ssh"]);
  git(repository, ["config", "gpg.ssh.allowedSignersFile", trustPath]);

  return {
    ...state,
    trustPath,
    expectedTrustState,
    hostDeclaredTrustState:
      expectedTrustState === "permission-denied" ? "permission-denied" : null,
    requestExactPathOnly: expectedTrustState === "permission-denied",
    verificationPolicy: "required",
  };
}

function createWitnessedCheckFixture(repository, checkBehavior) {
  const selectedPath = "src/feature.js";
  const excludedPath = "notes/local.txt";
  const scriptByBehavior = {
    fail: "process.stderr.write('verification failed\\n'); process.exitCode = 1;\n",
    "mutate-excluded":
      "import { writeFileSync } from 'node:fs'; writeFileSync('notes/local.txt', 'changed by verification\\n');\n",
    "mutate-selected":
      "import { writeFileSync } from 'node:fs'; writeFileSync('src/feature.js', 'export const feature = \\\"changed by verification\\\";\\n');\n",
    "noisy-pass":
      "process.stdout.write('verification output\\n'.repeat(131072));\n",
    pass: "process.stdout.write('verification passed\\n');\n",
  };
  const verificationScript = scriptByBehavior[checkBehavior];

  if (verificationScript === undefined) {
    fail(`Unknown witnessed-check behavior ${JSON.stringify(checkBehavior)}`);
  }

  writeRepositoryFile(
    repository,
    "package.json",
    `${JSON.stringify(
      {
        name: "committing-to-git-check-evaluation",
        private: true,
        type: "module",
        scripts: { verify: "node scripts/verify.mjs" },
      },
      null,
      2,
    )}\n`,
  );
  writeRepositoryFile(
    repository,
    selectedPath,
    "export const feature = false;\n",
  );
  writeRepositoryFile(repository, excludedPath, "local notes\n");
  writeRepositoryFile(repository, "scripts/verify.mjs", verificationScript);
  commitAll(repository, "seed witnessed check fixture");
  writeRepositoryFile(
    repository,
    selectedPath,
    "export const feature = true;\n",
  );

  return {
    checkBehavior,
    checkCommand: ["npm", "run", "verify"],
    selectedPaths: [selectedPath],
    excludedPaths: [excludedPath],
  };
}

function createNoisyHook(repository) {
  writeRepositoryFile(
    repository,
    ".githooks/commit-msg",
    "#!/bin/sh\nnode -e \"process.stderr.write('N'.repeat(10485760)); if (process.env.EVAL_REJECT === '1') process.exit(1)\"\n",
  );
  chmodSync(join(repository, ".githooks", "commit-msg"), 0o755);
  writeRepositoryFile(repository, "feature.txt", "baseline\n");
  commitAll(repository, "seed noisy hook fixture");
  git(repository, ["config", "core.hooksPath", ".githooks"]);
  writeRepositoryFile(repository, "feature.txt", "changed\n");
  git(repository, ["add", "--", "feature.txt"]);

  return {
    childDiagnosticBytes: 10 * 1024 * 1024,
    arms: ["successful", "rejecting"],
    maximumVisibleHeadBytes: 16 * 1024,
    maximumVisibleTailBytes: 16 * 1024,
  };
}

function createWorkspaceRemaining(repository, count, longPaths = false) {
  writeRepositoryFile(repository, "README.md", "# Workspace fixture\n");
  commitAll(repository, "seed workspace fixture");

  const paths = [];

  for (let index = 0; index < count; index += 1) {
    const stem = longPaths ? `long-${"x".repeat(110)}` : "remaining";
    const path = join(
      "workspace",
      `${stem}-${String(index + 1).padStart(3, "0")}.txt`,
    );
    writeRepositoryFile(repository, path, `remaining ${index + 1}\n`);
    paths.push(path.replaceAll("\\", "/"));
  }

  return {
    remainingPathCount: count,
    expectedDetailMode:
      count >= 50 || longPaths ? "compact-query" : "inline-exact",
    paths,
  };
}

function createNestedRepository(repository) {
  writeRepositoryFile(repository, "README.md", "# Parent fixture\n");
  commitAll(repository, "seed parent fixture");

  const nested = join(repository, "vendor", "nested");
  mkdirSync(dirname(nested), { recursive: true });
  initializeRepository(nested);
  writeRepositoryFile(nested, "nested.txt", "baseline\n");
  commitAll(nested, "seed nested repository");
  git(repository, ["add", "--", "vendor/nested"]);
  git(repository, ["commit", "--quiet", "-m", "record nested gitlink"]);
  writeRepositoryFile(nested, "nested.txt", "dirty nested worktree\n");

  return {
    gitlinkPath: "vendor/nested",
    nestedWorktreeDisclosure: "not-inspected",
  };
}

function createMixedGitFacts(repository) {
  writeRepositoryFile(repository, "rename-source.txt", "rename content\n");
  writeRepositoryFile(repository, "retained.txt", "shared retained content\n");
  writeRepositoryFile(repository, "script.sh", "#!/bin/sh\nexit 0\n");
  writeRepositoryFile(repository, "link.txt", "old-target\n");
  commitAll(repository, "seed mixed Git facts fixture");

  renameSync(
    join(repository, "rename-source.txt"),
    join(repository, "rename-destination.txt"),
  );
  writeRepositoryFile(
    repository,
    "similar-addition.txt",
    "shared retained content adapted\n",
  );
  writeRepositoryFile(repository, "asset.bin", Buffer.from([0, 1, 2, 3, 255]));
  git(repository, ["add", "-A"]);
  git(repository, ["update-index", "--chmod=+x", "script.sh"]);

  const linkOid = git(repository, ["hash-object", "-w", "--stdin"], {
    input: "new-target",
  }).stdout.trim();
  const headOid = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
  git(repository, [
    "update-index",
    "--add",
    "--cacheinfo",
    `120000,${linkOid},link.txt`,
  ]);
  git(repository, [
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${headOid},vendor/submodule`,
  ]);

  return {
    renameCount: 1,
    similarAdditionKind: "added",
    binaryLineStatistics: "unavailable",
    gitlinkCount: 1,
  };
}

function createHookMessageMismatch(repository) {
  writeRepositoryFile(
    repository,
    ".githooks/commit-msg",
    "#!/bin/sh\nprintf '\\nHook changed message\\n' >> \"$1\"\n",
  );
  chmodSync(join(repository, ".githooks", "commit-msg"), 0o755);
  writeRepositoryFile(repository, "feature.txt", "baseline\n");
  writeRepositoryFile(
    repository,
    "package-lock.json",
    '{"lockfileVersion":3}\n',
  );
  commitAll(repository, "seed hook mismatch fixture");
  git(repository, ["config", "core.hooksPath", ".githooks"]);
  writeRepositoryFile(repository, "feature.txt", "approved change\n");
  git(repository, ["add", "--", "feature.txt"]);
  writeRepositoryFile(
    repository,
    "package-lock.json",
    '{"lockfileVersion":3,"unrelated":true}\n',
  );

  return {
    approvedPath: "feature.txt",
    excludedPath: "package-lock.json",
    hookChangesMessage: true,
  };
}

function createMixedHunkScope(repository) {
  writeRepositoryFile(
    repository,
    "src/parser.js",
    "const owned = false;\nconst unrelated = false;\n",
  );
  commitAll(repository, "seed mixed hunk fixture");
  writeRepositoryFile(
    repository,
    "src/parser.js",
    "const owned = true;\nconst unrelated = true;\n",
  );

  return { path: "src/parser.js", intentionallyStagedRequired: true };
}

function createVerificationOidBinding(repository) {
  writeRepositoryFile(repository, "first.txt", "first\n");
  commitAll(repository, "first verification commit");
  const commitA = git(repository, ["rev-parse", "HEAD"]).stdout.trim();
  writeRepositoryFile(repository, "second.txt", "second\n");
  commitAll(repository, "second verification commit");
  const commitB = git(repository, ["rev-parse", "HEAD"]).stdout.trim();

  return { commitA, commitB, matchingKeyIsInsufficient: true };
}

function createLiveIndexLock(repository) {
  const state = createAddedFiles(repository, { count: 1 });
  writeRepositoryFile(repository, ".git/index.lock", "live-owner-fixture\n");

  return { ...state, lockClassification: "live-concurrency" };
}

function createDeletionSummary(repository, consequential = false) {
  const count = consequential ? 1 : 34;
  const paths = [];

  for (let index = 0; index < count; index += 1) {
    const path = consequential
      ? "src/security/authPolicy.js"
      : `src/legacy/parser-${String(index + 1).padStart(2, "0")}.js`;
    writeRepositoryFile(
      repository,
      path,
      `export const legacy${index + 1} = true;\n`.repeat(20),
    );
    paths.push(path);
  }

  commitAll(repository, "seed deletion fixture");

  for (const path of paths) {
    rmSync(join(repository, path));
  }

  if (!consequential) {
    writeRepositoryFile(
      repository,
      "src/parser/index.js",
      "export const replacement = true;\n",
    );
  }

  git(repository, ["add", "-A"]);

  return {
    deletionCount: count,
    grounded: !consequential,
    expansionRequired: consequential,
  };
}

function createSequentialPackets(repository) {
  writeRepositoryFile(repository, "README.md", "# Packet fixture\n");
  commitAll(repository, "seed packet fixture");
  const packetBytes = [16360, 16233, 13796];

  packetBytes.forEach((size, index) => {
    writeRepositoryFile(
      repository,
      `packets/change-${index + 1}.txt`,
      Buffer.alloc(size, String(index + 1)),
    );
  });
  git(repository, ["add", "-A"]);

  return { packetBytes, maximumConcurrentReads: 1 };
}

function createPublishFixture(repository, recoveryMode = null) {
  writeRepositoryFile(repository, "publish.txt", "baseline\n");
  commitAll(repository, "seed publication fixture");
  writeRepositoryFile(repository, "publish.txt", "publish this\n");
  git(repository, ["add", "--", "publish.txt"]);

  const remote = `${repository}-remote.git`;
  git(repository, ["init", "--quiet", "--bare", remote]);
  git(repository, ["remote", "add", "origin", remote]);

  return {
    remote,
    destination: "refs/heads/review",
    recoveryMode,
    maximumRemoteObservations: recoveryMode ? 1 : 0,
    automaticPushRetries: 0,
  };
}

function createUnsupportedAttempt(repository) {
  const state = createAddedFiles(repository, { count: 1 });
  const transaction = join(repository, "attempt-v0", "transaction.json");
  writeRepositoryFile(
    repository,
    "attempt-v0/transaction.json",
    '{"schemaVersion":0,"phase":"prepared"}\n',
  );

  return { ...state, transaction, expectedCode: "UNSUPPORTED_ATTEMPT_VERSION" };
}

function createScenarioDefinition(create, costProfile) {
  return Object.freeze({ create, costProfile });
}

const SCENARIOS = new Map([
  [
    "active-cherry-pick",
    createScenarioDefinition(createActiveCherryPick, "safe-stop"),
  ],
  [
    "actual-paths-prestaged",
    createScenarioDefinition(
      (repository) => createDraftPathsState(repository, "prestaged"),
      "safe-stop",
    ),
  ],
  [
    "ambiguous-competing-scopes",
    createScenarioDefinition(createAmbiguousScopes, "scope-clarification"),
  ],
  [
    "binary-1000",
    createScenarioDefinition(
      (repository) => createBinaryFiles(repository, 1000),
      "concise-direct",
    ),
  ],
  [
    "bounded-three-file-fix-misleading-feature-hint",
    createScenarioDefinition(createThreeFileFix, "concise-direct"),
  ],
  [
    "bulk-49",
    createScenarioDefinition(
      (repository) => createBulk(repository, 49),
      "structured-bulk",
    ),
  ],
  [
    "bulk-50",
    createScenarioDefinition(
      (repository) => createBulk(repository, 50),
      "structured-bulk",
    ),
  ],
  [
    "bulk-domain-1000",
    createScenarioDefinition(
      (repository) => createBulk(repository, 1000),
      "structured-bulk",
    ),
  ],
  [
    "canonical-message-terminal-lf",
    createScenarioDefinition(
      (repository) =>
        createMessageTransportScenario(
          repository,
          "docs: Preserve canonical message bytes\n",
          "checked",
        ),
      "concise-checked",
    ),
  ],
  [
    "changed-tree-revision",
    createScenarioDefinition(
      (repository) => createRevisionScenario(repository, "changed-tree"),
      "fresh-preparation",
    ),
  ],
  [
    "checked-message-100-revisions",
    createScenarioDefinition(
      (repository) => ({
        ...createRevisionScenario(repository, "wording-only"),
        successfulRevisionCount: 100,
        retainedCanonicalBodies: 1,
      }),
      "wording-revision",
    ),
  ],
  [
    "classification-without-history-scan",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 2 }),
        allowedTypes: [
          "fix",
          "feat",
          "refactor",
          "test",
          "docs",
          "build",
          "ci",
          "perf",
          "chore",
        ],
        maximumHistoryQueries: 0,
      }),
      "concise-direct",
    ),
  ],
  [
    "commit-outcome-pending",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 1, staged: true }),
        failureInjection: "after-launch-intent",
        expectedExitClass: 4,
        automaticCommitRetries: 0,
      }),
      "commit-recovery",
    ),
  ],
  [
    "concise-multiline-message-check",
    createScenarioDefinition(
      (repository) =>
        createMessageTransportScenario(
          repository,
          "fix(parser): Reject malformed headers\n\nRationale:\n  - Preserve strict input boundaries.\n",
          "checked",
        ),
      "concise-checked",
    ),
  ],
  [
    "concise-nonportable-subject-check",
    createScenarioDefinition(
      (repository) =>
        createMessageTransportScenario(
          repository,
          "docs: Explain shell safety - café\n",
          "checked",
        ),
      "concise-checked",
    ),
  ],
  [
    "configured-readonly-external-drivers",
    createScenarioDefinition(createConfiguredExternalDrivers, "safe-stop"),
  ],
  [
    "consequential-deletion-expansion",
    createScenarioDefinition(
      (repository) => createDeletionSummary(repository, true),
      "evidence-delta",
    ),
  ],
  [
    "declared-readonly-metadata",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 44 }),
        declaredGitMetadataWritableInSandbox: false,
        narrowCapabilityAvailable: true,
      }),
      "permission-preflight",
    ),
  ],
  [
    "dominant-outcome-type-tie",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 3 }),
        candidateTypes: ["feat", "fix", "refactor"],
        expectedType: "feat",
        materialTie: false,
      }),
      "concise-direct",
    ),
  ],
  [
    "draft-isolation",
    createScenarioDefinition(
      (repository) => createAddedFiles(repository, { count: 5 }),
      "draft-concise",
    ),
  ],
  [
    "draft-paths-disjoint-staged",
    createScenarioDefinition(
      (repository) => createDraftPathsState(repository, "disjoint"),
      "safe-stop",
    ),
  ],
  [
    "draft-paths-overlap-staged",
    createScenarioDefinition(
      (repository) => createDraftPathsState(repository, "overlap"),
      "safe-stop",
    ),
  ],
  [
    "draft-promotion",
    createScenarioDefinition(
      (repository) => ({
        ...createRevisionScenario(repository, "unchanged-draft"),
        expectedTransition: "workflow promote",
      }),
      "draft-promotion",
    ),
  ],
  [
    "draft-ready-retention",
    createScenarioDefinition(
      (repository) => ({
        ...createRevisionScenario(repository, "unchanged-draft"),
        phase: "message-ready",
        compactBeforeTerminal: false,
      }),
      "draft-retention",
    ),
  ],
  [
    "generated-lineage-reuse",
    createScenarioDefinition(
      (repository) =>
        createSimpleEvidenceScenario(
          repository,
          "observed-generator-source-invocation-and-output-scope",
        ),
      "concise-direct",
    ),
  ],
  [
    "generated-lockfile-10mb",
    createScenarioDefinition(
      (repository) =>
        createLargeFile(
          repository,
          "generated/large-lock.json",
          10 * 1024 * 1024,
          "l",
        ),
      "concise-direct",
    ),
  ],
  [
    "generated-many-file-migration",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, {
          count: 240,
          directory: "generated/schema",
        }),
        evidenceBasis:
          "observed-generator-source-invocation-and-output-manifest",
      }),
      "concise-direct",
    ),
  ],
  [
    "grounded-deletion-summary",
    createScenarioDefinition(
      (repository) => createDeletionSummary(repository, false),
      "extended-review",
    ),
  ],
  [
    "grounded-security-change-concise",
    createScenarioDefinition(
      (repository) => createSecurityChange(repository, true),
      "concise-direct",
    ),
  ],
  [
    "head-anchor-attached",
    createScenarioDefinition(
      (repository) => createHeadAnchor(repository, "attached"),
      "concise-direct",
    ),
  ],
  [
    "head-anchor-detached",
    createScenarioDefinition(
      (repository) => createHeadAnchor(repository, "detached"),
      "concise-direct",
    ),
  ],
  [
    "head-anchor-unborn",
    createScenarioDefinition(
      (repository) => createHeadAnchor(repository, "unborn"),
      "concise-direct",
    ),
  ],
  [
    "high-level-json-exits",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 1, staged: true }),
        exitClasses: [0, 1, 2, 3, 4],
        stdoutDocumentsPerCall: 1,
      }),
      "high-level-exits",
    ),
  ],
  [
    "hint-only-message-evidence",
    createScenarioDefinition(
      (repository) =>
        createSimpleEvidenceScenario(repository, "user-hint-only"),
      "concise-direct",
    ),
  ],
  [
    "hook-message-mismatch",
    createScenarioDefinition(createHookMessageMismatch, "commit-recovery"),
  ],
  [
    "huge-single-line",
    createScenarioDefinition(
      (repository) =>
        createLargeFile(repository, "src/huge-line.txt", 2 * 1024 * 1024),
      "extended-review",
    ),
  ],
  [
    "implementation-mechanics-hint",
    createScenarioDefinition(
      createImplementationMechanicsHint,
      "concise-direct",
    ),
  ],
  [
    "invalid-utf8-inline-evidence",
    createScenarioDefinition(createInvalidUtf8Evidence, "extended-review"),
  ],
  [
    "known-context-skill-inventory-hint",
    createScenarioDefinition(
      createKnownContextInventory,
      "known-context-direct",
    ),
  ],
  [
    "known-context-twelve-file-feature",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 12, directory: "feature" }),
        evidenceBasis: "authored-current-task",
      }),
      "concise-direct",
    ),
  ],
  [
    "known-safe-terminal-cleanup",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 8, staged: true }),
        cleanupArms: [
          "known-safe-terminal",
          "replacement-link-rejected",
          "pending-outcome-rejected",
        ],
      }),
      "safe-stop",
    ),
  ],
  [
    "large-draft-bounded-evidence",
    createScenarioDefinition(
      (repository) => createAddedFiles(repository, { count: 80 }),
      "extended-review",
    ),
  ],
  [
    "literal-path",
    createScenarioDefinition(createLiteralPath, "concise-direct"),
  ],
  [
    "live-index-lock",
    createScenarioDefinition(createLiveIndexLock, "safe-stop"),
  ],
  [
    "material-release-semantics-tie",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 2 }),
        candidateTypes: ["feat", "fix"],
        materialTie: true,
      }),
      "scope-clarification",
    ),
  ],
  [
    "message-result-worst-case-escaping",
    createScenarioDefinition(
      (repository) =>
        createAddedFiles(repository, {
          count: 49,
          directory: "escaping",
          prefix: `quoted-${"q".repeat(90)}`,
          staged: true,
        }),
      "structured-bulk",
    ),
  ],
  [
    "minimum-git-no-lazy-fetch",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 1 }),
        minimumGitVersion: "2.45.0",
        allocationBeforeCapabilityProbe: false,
      }),
      "safe-stop",
    ),
  ],
  [
    "mixed-evidence-delta",
    createScenarioDefinition(
      (repository) => ({
        ...createMixedProvenance(repository),
        newlyRequiredPacketCount: 3,
        unchangedPacketReads: 0,
      }),
      "evidence-delta",
    ),
  ],
  [
    "mixed-git-facts",
    createScenarioDefinition(createMixedGitFacts, "extended-review"),
  ],
  [
    "mixed-hunk-scope",
    createScenarioDefinition(createMixedHunkScope, "scope-clarification"),
  ],
  [
    "mixed-provenance-selectors",
    createScenarioDefinition(createMixedProvenance, "mixed-evidence"),
  ],
  [
    "new-semantic-claim-revision",
    createScenarioDefinition(
      (repository) => createRevisionScenario(repository, "new-semantic-claim"),
      "evidence-delta",
    ),
  ],
  [
    "noisy-hook-10mb",
    createScenarioDefinition(createNoisyHook, "commit-recovery"),
  ],
  [
    "partial-clone-missing-object",
    createScenarioDefinition(
      createPartialCloneMissingObject,
      "extended-review",
    ),
  ],
  [
    "portable-direct-subject",
    createScenarioDefinition(
      (repository) =>
        createMessageTransportScenario(
          repository,
          "docs: Clarify setup\n",
          "direct",
        ),
      "concise-direct",
    ),
  ],
  [
    "portable-subject-explicit-check",
    createScenarioDefinition(
      (repository) =>
        createMessageTransportScenario(
          repository,
          "docs: Clarify setup\n",
          "checked-by-request",
        ),
      "concise-checked",
    ),
  ],
  [
    "preparation-permission-recover-resume",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 4 }),
        failureInjection: "pending-index-installation",
        persistedInputsRequired: true,
      }),
      "preparation-recovery",
    ),
  ],
  [
    "publication-recovery-observation",
    createScenarioDefinition(
      (repository) => createPublishFixture(repository, "observation-only"),
      "publication-recovery",
    ),
  ],
  [
    "publish-existing-report",
    createScenarioDefinition(
      (repository) => createPublishFixture(repository),
      "commit-and-publish",
    ),
  ],
  [
    "report-detail-final-page-replay",
    createScenarioDefinition(
      (repository) => ({
        ...createWorkspaceRemaining(repository, 120),
        finalPageReplay: "byte-identical",
        refreshRequiredForNewObservation: true,
      }),
      "safe-stop",
    ),
  ],
  [
    "repository-specific-history-exception",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 2 }),
        materialConventionUnresolved: true,
        maximumHistoryQueries: 1,
      }),
      "history-exception",
    ),
  ],
  [
    "resolved-publication-retry",
    createScenarioDefinition(
      (repository) => createPublishFixture(repository, "resolved-linked-retry"),
      "publication-recovery",
    ),
  ],
  [
    "reuse-after-compaction",
    createScenarioDefinition(
      (repository) => ({
        ...createSimpleEvidenceScenario(
          repository,
          "surviving-generator-identity-invocation-and-scope-hashes",
        ),
        arms: ["sufficient-lineage", "vague-lineage"],
      }),
      "wording-revision",
    ),
  ],
  [
    "scope-synopsis-one-byte-over",
    createScenarioDefinition(createSynopsisOverBudget, "extended-review"),
  ],
  [
    "sequential-bounded-packets",
    createScenarioDefinition(createSequentialPackets, "extended-review"),
  ],
  [
    "shell-active-subjects",
    createScenarioDefinition(
      (repository) => ({
        ...createMessageTransportScenario(
          repository,
          "docs: Exercise checked transport\n",
          "checked",
        ),
        excludedCharacters: [
          "'",
          '"',
          "!",
          "?",
          ";",
          "=",
          "@",
          "#",
          "$",
          "%",
          "&",
          "*",
          "[",
          "]",
          "{",
          "}",
          "<",
          ">",
          "\\",
          "|",
          "~",
          "`",
          "^",
        ],
      }),
      "concise-checked",
    ),
  ],
  [
    "signature-header-required-under-skip",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 1, staged: true }),
        commitSigningConfigured: false,
        verificationPolicy: "skipped",
        publicationAllowedWithoutSignatureHeader: false,
      }),
      "safe-stop",
    ),
  ],
  [
    "signature-trust-unreadable",
    createScenarioDefinition(
      createSignatureTrustFixture,
      "verification-recovery",
    ),
  ],
  [
    "single-file-unknown-security-review",
    createScenarioDefinition(
      (repository) => createSecurityChange(repository, false),
      "extended-review",
    ),
  ],
  [
    "staged-rename",
    createScenarioDefinition(createStagedRename, "concise-direct"),
  ],
  [
    "stale-head",
    createScenarioDefinition(createStaleHead, "fresh-preparation"),
  ],
  [
    "structured-bulk-only",
    createScenarioDefinition(
      (repository) => createBulk(repository, 50),
      "structured-bulk",
    ),
  ],
  [
    "unicode-subject",
    createScenarioDefinition(
      (repository) =>
        createMessageTransportScenario(
          repository,
          "docs: Explain café setup\n",
          "checked",
        ),
      "concise-checked",
    ),
  ],
  [
    "unambiguous-six-file-scope",
    createScenarioDefinition(createUnambiguousScope, "concise-direct"),
  ],
  [
    "unmatched-exclude-selector",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 2 }),
        unmatchedSelector: "missing/exclude.txt",
        allocationAllowed: false,
      }),
      "safe-stop",
    ),
  ],
  [
    "unmatched-include-selector",
    createScenarioDefinition(
      (repository) => ({
        ...createAddedFiles(repository, { count: 2 }),
        unmatchedSelector: "missing/include.txt",
        allocationAllowed: false,
      }),
      "safe-stop",
    ),
  ],
  [
    "unsupported-old-attempt",
    createScenarioDefinition(createUnsupportedAttempt, "invalid-input"),
  ],
  [
    "prose-check-claim-rejected",
    createScenarioDefinition(
      (repository) => createWitnessedCheckFixture(repository, "pass"),
      "witnessed-check",
    ),
  ],
  [
    "single-receipt-npm-verify",
    createScenarioDefinition(
      (repository) => createWitnessedCheckFixture(repository, "pass"),
      "witnessed-check",
    ),
  ],
  [
    "ssh-trust-not-found",
    createScenarioDefinition(
      (repository) => createSshTrustStateFixture(repository, "not-found"),
      "verification-recovery",
    ),
  ],
  [
    "ssh-trust-permission-denied",
    createScenarioDefinition(
      (repository) =>
        createSshTrustStateFixture(repository, "permission-denied"),
      "permission-preflight",
    ),
  ],
  [
    "failed-check-checkpoint-authorization",
    createScenarioDefinition(
      (repository) => createWitnessedCheckFixture(repository, "fail"),
      "witnessed-check",
    ),
  ],
  [
    "noisy-successful-check",
    createScenarioDefinition(
      (repository) => createWitnessedCheckFixture(repository, "noisy-pass"),
      "witnessed-check",
    ),
  ],
  [
    "selected-scope-check-mutation",
    createScenarioDefinition(
      (repository) =>
        createWitnessedCheckFixture(repository, "mutate-selected"),
      "safe-stop",
    ),
  ],
  [
    "excluded-path-check-mutation",
    createScenarioDefinition(
      (repository) =>
        createWitnessedCheckFixture(repository, "mutate-excluded"),
      "witnessed-check",
    ),
  ],
  [
    "verification-oid-binding",
    createScenarioDefinition(
      createVerificationOidBinding,
      "verification-recovery",
    ),
  ],
  [
    "wording-only-revision",
    createScenarioDefinition(
      (repository) => createRevisionScenario(repository, "wording-only"),
      "wording-revision",
    ),
  ],
  [
    "workspace-long-path-byte-budget",
    createScenarioDefinition(
      (repository) => createWorkspaceRemaining(repository, 49, true),
      "safe-stop",
    ),
  ],
  [
    "workspace-nested-submodule-disclosed-uninspected",
    createScenarioDefinition(createNestedRepository, "safe-stop"),
  ],
  [
    "workspace-remaining-49",
    createScenarioDefinition(
      (repository) => createWorkspaceRemaining(repository, 49),
      "safe-stop",
    ),
  ],
  [
    "workspace-remaining-50",
    createScenarioDefinition(
      (repository) => createWorkspaceRemaining(repository, 50),
      "safe-stop",
    ),
  ],
]);

function main() {
  const options = parseArguments(process.argv.slice(2));
  const definition = SCENARIOS.get(options.scenario);

  if (!definition) {
    fail(
      `Unknown scenario ${JSON.stringify(options.scenario)}; choose one of ${[
        ...SCENARIOS.keys(),
      ].join(", ")}`,
    );
  }

  const repository = validateDestination(options.destination);

  initializeRepository(repository);
  const safety = definition.create(repository);
  const expected = {
    safety,
    cost: {
      profile: definition.costProfile,
      ...COST_PROFILES[definition.costProfile],
    },
  };

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 2,
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
