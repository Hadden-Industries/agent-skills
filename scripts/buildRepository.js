import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildSkillArtifacts } from "./buildSkillArtifacts.js";
import { validateSkillRepository } from "./validateSkillRepository.js";

const defaultRepositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function buildRepository({
  checkOnly = false,
  repositoryRoot = defaultRepositoryRoot,
  skillNames,
} = {}) {
  const validation = validateSkillRepository({ repositoryRoot, skillNames });
  const artifacts = await buildSkillArtifacts({
    checkOnly,
    repositoryRoot,
    skillNames,
  });

  return { ...validation, ...artifacts };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const arguments_ = process.argv.slice(2);

  if (arguments_.some((argument) => argument !== "--check")) {
    console.error("Usage: buildRepository.js [--check]");
    process.exitCode = 2;
  } else {
    const { staleArtifacts } = await buildRepository({
      checkOnly: arguments_.includes("--check"),
    });

    if (staleArtifacts.length > 0) {
      console.error("Published skill artifacts are stale or missing:");
      for (const artifact of staleArtifacts) {
        console.error(`- ${artifact}`);
      }
      console.error("Run npm run build and commit the generated output.");
      process.exitCode = 1;
    }
  }
}
