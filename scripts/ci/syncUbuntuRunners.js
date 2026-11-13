import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import {
  ubuntuLabel,
  ubuntuRunner,
  windowsLabel,
  windowsRunner,
} from "./runnerPolicy.js";

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
/** Project both pins into literal YAML selectors without reserializing the workflow. */
export function projectWorkflowRunners(
  name,
  source,
  { ubuntu = ubuntuRunner, windows = windowsRunner } = {},
) {
  const workflow = parseDocument(source, { uniqueKeys: true });
  if (
    workflow.errors.length ||
    !ubuntuLabel.test(ubuntu) ||
    !windowsLabel.test(windows)
  ) {
    throw new Error("Invalid workflow YAML or runner selection for " + name);
  }

  const selectors = Object.entries(workflows[name]);
  const jobs = workflow.get("jobs", true);
  if (!isMap(jobs) || jobs.items.length !== selectors.length) {
    throw new Error(
      name + " job inventory differs from its managed selectors.",
    );
  }
  const replacements = [];
  function replaceLabel(node, pattern, target, job) {
    if (
      !isScalar(node) ||
      !pattern.test(node.value) ||
      source.slice(node.range[0], node.range[1]) !== node.value
    ) {
      throw new Error(
        name + "/" + job + " has an unsupported runner selector.",
      );
    }
    if (node.value !== target)
      replacements.push([node.range[0], node.range[1], target]);
  }
  for (const [job, selector] of selectors) {
    const path = ["jobs", job];
    const label = workflow.getIn([...path, "runs-on"], true);
    if (selector === "matrix") {
      const matrix = workflow.getIn([...path, "strategy", "matrix"], true);
      const os =
        isMap(matrix) && matrix.items.length === 1 && matrix.get("os", true);
      if (
        label?.value !== "${{ matrix.os }}" ||
        !isSeq(os) ||
        os.items.length !== 2
      ) {
        throw new Error(
          name + "/" + job + " must select exactly Ubuntu and Windows.",
        );
      }
      replaceLabel(
        os.items.find((entry) => ubuntuLabel.test(entry?.value)),
        ubuntuLabel,
        ubuntu,
        job,
      );
      replaceLabel(
        os.items.find((entry) => windowsLabel.test(entry?.value)),
        windowsLabel,
        windows,
        job,
      );
    } else {
      replaceLabel(label, ubuntuLabel, ubuntu, job);
    }
  }
  let result = source;
  for (const [start, end, target] of replacements.sort((a, b) => b[0] - a[0])) {
    result = result.slice(0, start) + target + result.slice(end);
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
    const updated = projectWorkflowRunners(name, original);
    return original === updated ? [] : [{ file, name, updated }];
  });
  if (!write && updates.length > 0) {
    throw new Error(
      "Regenerate runner selectors for " +
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
