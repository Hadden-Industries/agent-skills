/**
 * Locates a Python 3 interpreter for tests that drive the repository's Python
 * code as a subprocess.
 *
 * Several suites need this — the `reading-epubs` scripts and the bootstrap's
 * GitHub MCP server installer — so the probing lives here rather than being
 * repeated per suite.
 */

import { spawnSync } from "node:child_process";

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
