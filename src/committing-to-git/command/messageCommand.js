#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  renderCommitMessage,
  renderScaffoldTemplate,
  scaffoldContent,
} from "../message/commitMessageRenderer.js";

function usageError(message) {
  console.error(message);
  console.error(
    "Usage: node commitWorkflow.mjs message scaffold --manifest <snapshot.json> " +
      "--output <content.json> --template <template.txt> | message render --manifest " +
      "<snapshot.json> --content <content.json> --ledger <ledger.json> " +
      "--output <commit-message.txt>",
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

  return resolve(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function writeNewText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, { flag: "wx" });
}

function containsScaffoldPlaceholder(value) {
  if (typeof value === "string") {
    return /<(?:explain|name|replace)\b[^<>]*>/iu.test(value);
  }

  if (Array.isArray(value)) {
    return value.some(containsScaffoldPlaceholder);
  }

  if (value && typeof value === "object") {
    return Object.values(value).some(containsScaffoldPlaceholder);
  }

  return false;
}

function rejectPlaceholders(value) {
  if (containsScaffoldPlaceholder(value)) {
    throw new Error("Semantic worksheet still contains scaffold placeholders.");
  }
}

const [command, ...flagArguments] = process.argv.slice(2);
const flags = parseFlags(flagArguments);

try {
  const manifest = readJson(required(flags, "manifest"));

  if (command === "scaffold") {
    const output = required(flags, "output");
    const template = required(flags, "template");
    const content = scaffoldContent(manifest);

    if (existsSync(output) || existsSync(template)) {
      throw new Error(
        "A scaffold output already exists; start a new attempt instead of replacing it.",
      );
    }

    writeNewText(output, `${JSON.stringify(content, null, 2)}\n`);
    writeNewText(template, renderScaffoldTemplate(manifest, content));
    process.stdout.write(
      `${JSON.stringify({ output, template, mode: content.mode }, null, 2)}\n`,
    );
  } else if (command === "render") {
    const content = readJson(required(flags, "content"));
    const ledger = readJson(required(flags, "ledger"));
    const output = required(flags, "output");

    if (!ledger.complete || ledger.indexTreeOid !== manifest.indexTreeOid) {
      throw new Error(
        "Inspection ledger is incomplete or belongs to a different index tree.",
      );
    }

    rejectPlaceholders(content);
    writeText(output, renderCommitMessage(manifest, content));
    process.stdout.write(
      `${JSON.stringify({ output, mode: content.mode }, null, 2)}\n`,
    );
  } else {
    usageError("Expected scaffold or render command.");
  }
} catch (error) {
  console.error(`Commit-message preparation failed: ${error.message}`);
  process.exit(2);
}
