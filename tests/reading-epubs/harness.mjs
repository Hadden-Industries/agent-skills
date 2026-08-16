/**
 * Shared plumbing for the `reading-epubs` contract tests.
 *
 * The skill's scripts are Python, so these tests drive them the way the skill
 * does — as subprocesses — rather than importing them. That keeps one test
 * command (`node --test`) for the whole repository and needs no Python test
 * framework.
 *
 * Scripts are run from an unrelated working directory by default. The agent
 * that invokes this skill has its own project as the current directory, never
 * the skill directory, so any behaviour that depends on the process starting
 * inside the skill is a defect these tests should expose rather than hide.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SKILL_DIR = join(REPO_ROOT, "skills", "reading-epubs");
export const SCRIPT_DIR = join(SKILL_DIR, "scripts");

const EXPLICIT_PYTHON = process.env.PYTHON ? process.env.PYTHON.split(/\s+/u) : null;

// `py -3` is the launcher the repository's own bootstrap documentation uses on
// Windows; `python3` is the usual command elsewhere. Bare `python` is the last
// resort because on some systems it is still Python 2.
const PYTHON_CANDIDATES = EXPLICIT_PYTHON
  ? [EXPLICIT_PYTHON]
  : process.platform === "win32"
    ? [["py", "-3"], ["python3"], ["python"]]
    : [["python3"], ["python"]];

let cachedPython;

export function resolvePython() {
  if (cachedPython) {
    return cachedPython;
  }

  for (const candidate of PYTHON_CANDIDATES) {
    const [command, ...prefix] = candidate;
    const probe = spawnSync(command, [...prefix, "--version"], { encoding: "utf8" });

    if (probe.status === 0) {
      cachedPython = candidate;

      return cachedPython;
    }
  }

  throw new Error(
    `No Python 3 interpreter found. Tried: ${PYTHON_CANDIDATES.map((c) => c.join(" ")).join(", ")}. ` +
      "Set the PYTHON environment variable to override.",
  );
}

/**
 * Runs one of the skill's scripts and parses its single line of JSON stdout.
 */
export function runScript(script, args = [], options = {}) {
  const [command, ...prefix] = resolvePython();

  const result = spawnSync(command, [...prefix, join(SCRIPT_DIR, script), ...args], {
    cwd: options.cwd ?? tmpdir(),
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout ?? "";

  return {
    status: result.status,
    stdout,
    stderr: result.stderr ?? "",
    json: stdout.trim() ? JSON.parse(stdout) : null,
  };
}

export function readSchema(name) {
  return JSON.parse(readFileSync(join(SCRIPT_DIR, name), "utf8"));
}

export function readScriptSource(name) {
  return readFileSync(join(SCRIPT_DIR, name), "utf8");
}

/**
 * Extracts the `EXIT_* = <n>` constants a script declares, so the tests can
 * assert the exit-code contract without provoking every failure mode.
 */
export function exitCodes(script) {
  const source = readScriptSource(script);

  return Object.fromEntries(
    [...source.matchAll(/^EXIT_([A-Z_]+)\s*=\s*(\d+)$/gmu)].map(([, name, value]) => [
      name,
      Number(value),
    ]),
  );
}

/**
 * Pandoc is an external dependency the skill installs on demand, so it is not
 * guaranteed on a machine running the test suite. Conversion tests that need a
 * real Pandoc skip rather than fail when it is absent.
 */
export const pandocAvailable = runScript("check_pandoc.py").json?.status === "ok";
