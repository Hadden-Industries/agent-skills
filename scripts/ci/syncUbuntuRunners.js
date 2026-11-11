import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { ubuntuRunner, windowsRunner } from "./runnerPolicy.js";

const workflows = {
  "committing-to-git-linux": { verify: "direct" },
  "defining-concepts-linux": { verify: "direct" },
  "evaluation-conformance": {
    verification: "direct",
    conformance: "matrix",
    required: "direct",
  },
  "markdown-quality": { markdown: "matrix" },
};
const ubuntuLabel = /^ubuntu-\d[02468]\.04$/u;

export function projectUbuntuRunners(name, source, runner = ubuntuRunner) {
  const workflow = parseDocument(source, { uniqueKeys: true });
  if (workflow.errors.length > 0 || !ubuntuLabel.test(runner)) {
    throw new Error("Invalid workflow YAML or Ubuntu runner for " + name);
  }

  const selectors = Object.entries(workflows[name]);
  const jobs = workflow.get("jobs", true);
  if (!isMap(jobs) || jobs.items.length !== selectors.length) {
    throw new Error(
      name + " job inventory differs from its managed selectors.",
    );
  }
  const ranges = [];
  for (const [job, selector] of selectors) {
    const path = ["jobs", job];
    let label = workflow.getIn([...path, "runs-on"], true);
    if (selector === "matrix") {
      const matrix = workflow.getIn([...path, "strategy", "matrix"], true);
      const os =
        isMap(matrix) && matrix.items.length === 1 && matrix.get("os", true);
      if (
        label?.value !== "${{ matrix.os }}" ||
        !isSeq(os) ||
        os.items.length !== 2 ||
        os.items.filter((entry) => entry?.value === windowsRunner).length !== 1
      ) {
        throw new Error(
          name + "/" + job + " must select exactly Ubuntu and Windows.",
        );
      }
      label = os.items.find((entry) => entry?.value !== windowsRunner);
    }
    if (
      !isScalar(label) ||
      !ubuntuLabel.test(label.value) ||
      source.slice(label.range[0], label.range[1]) !== label.value
    ) {
      throw new Error(name + "/" + job + " has no supported Ubuntu selector.");
    }
    if (label.value !== runner) ranges.push(label.range);
  }
  let result = source;
  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) {
    result = result.slice(0, start) + runner + result.slice(end);
  }
  return result;
}

function sync(args) {
  const write = args.length === 1 && args[0] === "--write";
  if (args.length !== 0 && !write) {
    throw new Error("Usage: node scripts/ci/syncUbuntuRunners.js [--write]");
  }
  const updates = Object.keys(workflows).flatMap((name) => {
    const file = new URL(
      "../../.github/workflows/" + name + ".yml",
      import.meta.url,
    );
    const original = readFileSync(file, "utf8");
    const updated = projectUbuntuRunners(name, original);
    return original === updated ? [] : [{ file, name, updated }];
  });
  if (!write && updates.length > 0) {
    throw new Error(
      "Regenerate Ubuntu selectors for " +
        updates.map(({ name }) => name).join(", "),
    );
  }
  for (const { file, updated } of updates) writeFileSync(file, updated);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    sync(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
