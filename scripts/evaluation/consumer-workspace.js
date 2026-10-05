import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { canonicalJsonBytes, sha256Hex } from "./runtime.js";
import { assertRegularPath } from "./toolchain.js";
import { projectSkillUp } from "./project-skill-up.js";

/** Materialize a fresh consumer root; its caller owns retention and disposal.
 * A fixture may select its owned temporary parent without changing global env.
 */
export function createConsumerWorkspace({
  repositoryRoot,
  compiled,
  temporaryParent,
}) {
  // Preserve the existing OS-temp behavior, including OS-managed redirects.
  // The stricter ordinary-directory contract belongs only to an explicit parent.
  let parent = tmpdir();
  if (temporaryParent !== undefined) {
    if (!isAbsolute(temporaryParent))
      throw new Error("Consumer temporary parent must be absolute");
    const parentStat = lstatSync(temporaryParent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink())
      throw new Error(
        "Consumer temporary parent must be an ordinary directory",
      );
    parent = realpathSync.native(temporaryParent);
  }
  const payload = new Map();
  for (const file of compiled.distribution) {
    const path = join(
      repositoryRoot,
      "skills",
      compiled.skill_name,
      file.relativePath,
    );
    assertRegularPath(path);
    const bytes = readFileSync(path);
    if (bytes.length !== file.byteLength || sha256Hex(bytes) !== file.sha256)
      throw new Error(
        `Distribution changed before materialization: ${file.relativePath}`,
      );
    payload.set(file.relativePath, bytes);
  }
  for (const evaluationCase of compiled.cases)
    for (const file of evaluationCase.identity.files) {
      const path = join(
        repositoryRoot,
        "src",
        compiled.skill_name,
        file.relativePath,
      );
      assertRegularPath(path);
      const bytes = readFileSync(path);
      if (bytes.length !== file.byteLength || sha256Hex(bytes) !== file.sha256)
        throw new Error(
          `Fixture changed before materialization: ${file.relativePath}`,
        );
      if (
        payload.has(file.relativePath) &&
        !payload.get(file.relativePath).equals(bytes)
      )
        throw new Error(`Conflicting workspace path: ${file.relativePath}`);
      payload.set(file.relativePath, bytes);
    }
  payload.set("evals/evals.json", canonicalJsonBytes(compiled.portable));
  const projection = projectSkillUp(compiled);
  for (const file of projection.cases)
    payload.set(file.path, Buffer.from(file.yaml));
  const root = mkdtempSync(join(parent, "evaluation-workspace-"));
  const skillRoot = join(root, compiled.skill_name);
  for (const [relativePath, bytes] of payload) {
    const path = join(skillRoot, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes, { flag: "wx" });
  }
  // Receipts stay in control space, outside the consumer/model-readable skill.
  writeFileSync(
    join(root, "projection-receipt.json"),
    canonicalJsonBytes(projection.receipt),
    { flag: "wx" },
  );
  return { root, skillRoot, projection };
}
