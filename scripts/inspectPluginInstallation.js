import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { inspectPluginInstallation } from "./pluginIdentity.js";

export function installationArguments(args) {
  const { values } = parseArgs({
    args,
    options: {
      repository: { type: "string" },
      "plugin-root": { type: "string" },
      revision: { type: "string" },
      marketplace: { type: "string" },
      skill: { type: "string", default: "committing-to-git" },
      layout: { type: "string", default: "package" },
    },
  });
  if (
    !values.repository ||
    !values["plugin-root"] ||
    Boolean(values.revision) === Boolean(values.marketplace)
  ) {
    throw new Error(
      "Supply --repository, --plugin-root and exactly one of --revision or --marketplace.",
    );
  }
  let revision = values.revision;
  if (values.marketplace) {
    const catalog = JSON.parse(readFileSync(values.marketplace, "utf8"));
    const entries = catalog.plugins?.filter(
      (plugin) => plugin.name === values.skill,
    );
    if (
      entries?.length !== 1 ||
      entries[0].source?.source !== "git-subdir" ||
      entries[0].source.path !== `plugins/${values.skill}`
    ) {
      throw new Error("Expected one matching git-subdir marketplace plugin.");
    }
    revision = entries[0].source.sha;
  }
  return {
    repositoryRoot: resolve(values.repository),
    pluginRoot: resolve(values["plugin-root"]),
    skillName: values.skill,
    revision,
    layout: values.layout,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const report = inspectPluginInstallation(
      installationArguments(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode =
      report.comparison.status === "verified-byte-match" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
