#!/usr/bin/env node

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { gitText, repositoryRoot, runGit } from "../git/gitRepository.js";

function usageError(message) {
  console.error(message);
  console.error(
    "Usage: node commitWorkflow.mjs publication push --commit <oid> " +
      "--remote <name> --destination <refs/heads/name> " +
      "--output <publication.json>",
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

  for (const name of ["commit", "remote", "destination", "output"]) {
    if (!values.get(name)) {
      usageError(`--${name} is required.`);
    }
  }

  return {
    commit: values.get("commit"),
    remote: values.get("remote"),
    destination: values.get("destination"),
    output: resolve(values.get("output")),
  };
}

function validateInputs(root, options) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(options.commit)) {
    throw new Error("--commit must be a full 40- or 64-hex object ID.");
  }

  if (!/^[a-z0-9][a-z0-9._/-]*$/iu.test(options.remote)) {
    throw new Error("--remote must name a configured Git remote.");
  }

  if (!options.destination.startsWith("refs/heads/")) {
    throw new Error("--destination must be a full refs/heads/... branch ref.");
  }

  const refCheck = runGit(["check-ref-format", options.destination], {
    cwd: root,
    allowFailure: true,
  });

  if (refCheck.status !== 0) {
    throw new Error("--destination is not a valid Git branch ref.");
  }

  const resolvedCommit = gitText(
    ["rev-parse", "--verify", `${options.commit}^{commit}`],
    { cwd: root },
  ).trim();

  if (resolvedCommit.toLowerCase() !== options.commit.toLowerCase()) {
    throw new Error(
      "--commit did not resolve to the exact supplied object ID.",
    );
  }

  return resolvedCommit;
}

let pendingPath = null;

try {
  const options = parseFlags(process.argv.slice(2));
  const root = repositoryRoot();
  const commitOid = validateInputs(root, options);
  const refspec = `${commitOid}:${options.destination}`;
  pendingPath = `${options.output}.pending`;

  if (existsSync(options.output) || existsSync(pendingPath)) {
    throw new Error(
      "--output and its .pending journal path must not already exist.",
    );
  }

  mkdirSync(dirname(options.output), { recursive: true });
  writeFileSync(
    pendingPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        status: "unknown",
        commitOid,
        remote: options.remote,
        destination: options.destination,
        refspec,
        exitCode: null,
        stdout: "",
        stderr:
          "Publication may have started, but no final Git result was durably recorded.",
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );

  const push = runGit(["push", "--porcelain", options.remote, refspec], {
    cwd: root,
    allowFailure: true,
  });
  const publication = {
    schemaVersion: 1,
    status: push.status === 0 ? "pushed" : "failed",
    commitOid,
    remote: options.remote,
    destination: options.destination,
    refspec,
    exitCode: push.status,
    stdout: push.stdout.toString("utf8"),
    stderr: push.stderr.toString("utf8"),
  };

  writeFileSync(options.output, `${JSON.stringify(publication, null, 2)}\n`, {
    flag: "wx",
  });

  try {
    unlinkSync(pendingPath);
  } catch {
    // The completed result is authoritative even if journal cleanup fails.
  }

  process.stdout.write(`${JSON.stringify(publication, null, 2)}\n`);
  process.exit(push.status === 0 ? 0 : 1);
} catch (error) {
  console.error(`Commit publication failed: ${error.message}`);

  if (pendingPath && existsSync(pendingPath)) {
    console.error(
      `Remote outcome is unknown; preserve and inspect ${pendingPath}. ` +
        "Do not infer failure or retry automatically.",
    );
  }

  process.exit(2);
}
