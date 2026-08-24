#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { gitText, repositoryRoot } from "../git/gitRepository.js";
import {
  collectCommitReport,
  renderCommitReport,
} from "../report/commitReport.js";
import {
  applyVerificationPolicy,
  verifyCommitSignature,
} from "../signature/commitSignature.js";

function usageError(message) {
  console.error(message);
  console.error(
    "Usage: node commitWorkflow.mjs signature verify --commit <oid> " +
      "--initial-policy <policy> --policy <policy> --output <verification.json> | " +
      "report create --commit <oid> --manifest <snapshot.json> --approved-message " +
      "<message.txt> --verification <verification.json> --checks <checks.json> " +
      "[--publication <publication.json>] " +
      "--output-json <report.json> --output-text <report.txt>",
  );
  process.exit(2);
}

function parseFlags(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      usageError(`Invalid argument near ${JSON.stringify(argv[index])}.`);
    }

    values.set(argv[index].slice(2), argv[index + 1]);
  }

  return values;
}

function required(flags, name) {
  const value = flags.get(name);

  if (!value) {
    usageError(`--${name} is required.`);
  }

  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function write(path, contents) {
  const resolved = resolve(path);

  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, contents);
  return resolved;
}

const [command, ...flagArguments] = process.argv.slice(2);
const flags = parseFlags(flagArguments);

try {
  const root = repositoryRoot();

  if (command === "verify") {
    const requestedCommitOid = required(flags, "commit");

    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(requestedCommitOid)) {
      throw new Error("--commit must be a full 40- or 64-hex object ID.");
    }

    const commitOid = gitText(
      ["rev-parse", "--verify", `${requestedCommitOid}^{commit}`],
      { cwd: root },
    ).trim();

    if (commitOid.toLowerCase() !== requestedCommitOid.toLowerCase()) {
      throw new Error(
        "--commit did not resolve to the exact supplied object ID.",
      );
    }

    const initialPolicy = required(flags, "initial-policy");
    const finalPolicy = required(flags, "policy");
    const verificationAttempt =
      finalPolicy === "skipped" ? null : verifyCommitSignature(root, commitOid);
    const verification = applyVerificationPolicy({
      commitOid,
      initialPolicy,
      finalPolicy,
      verificationAttempt,
    });

    write(
      required(flags, "output"),
      `${JSON.stringify(verification, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    process.exit(verification.blocksPush ? 1 : 0);
  } else if (command === "report") {
    const report = collectCommitReport({
      root,
      commitOid: required(flags, "commit"),
      manifest: readJson(required(flags, "manifest")),
      approvedMessage: readFileSync(
        resolve(required(flags, "approved-message")),
        "utf8",
      ),
      verification: readJson(required(flags, "verification")),
      checks: readJson(required(flags, "checks")),
      publication: flags.get("publication")
        ? readJson(flags.get("publication"))
        : { status: "not-requested" },
    });
    const outputJson = write(
      required(flags, "output-json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const outputText = write(
      required(flags, "output-text"),
      renderCommitReport(report),
    );

    process.stdout.write(
      `${JSON.stringify({ outputJson, outputText }, null, 2)}\n`,
    );
    process.exit(
      report.commit.treeMatches &&
        report.commit.messageMatches &&
        report.commit.parentMatches
        ? 0
        : 1,
    );
  } else {
    usageError("Expected verify or report command.");
  }
} catch (error) {
  console.error(`Commit-result reporting failed: ${error.message}`);
  process.exit(2);
}
