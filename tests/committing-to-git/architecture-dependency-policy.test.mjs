import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cruise } from "dependency-cruiser";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SKILL_SOURCE = "src/committing-to-git";
const FIXTURES = "tests/committing-to-git/fixtures/architecture";

// Subsystem edges that still close a directory-level cycle. This is a migration
// baseline, not an allow-list: later slices remove edges, and the migration is
// complete only when it is empty (docs/plans/2026-11-03-committing-to-git-ephemeral-state.md).
const SUBSYSTEM_CYCLE_BASELINE = [
  "checks -> snapshot",
  "message -> transaction",
  "report -> checks",
  "snapshot -> message",
  "snapshot -> transaction",
  "transaction -> checks",
  "transaction -> message",
  "transaction -> report",
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function architectureRules(root) {
  const prefix = `^${escapeRegExp(root)}/`;

  return {
    forbidden: [
      {
        name: "no-module-cycle",
        severity: "error",
        from: { path: prefix },
        to: { circular: true },
      },
      {
        name: "workflow-does-not-depend-on-cli",
        severity: "error",
        from: { path: `${prefix}workflow/` },
        to: { path: `${prefix}cli/` },
      },
      {
        name: "only-delivery-depends-on-workflows",
        severity: "error",
        from: { path: prefix, pathNot: `${prefix}(cli|workflow)/` },
        to: { path: `${prefix}(cli|workflow)/` },
      },
      {
        name: "diagnostics-depends-on-no-subsystem",
        severity: "error",
        from: { path: `${prefix}diagnostics/` },
        to: { path: prefix, pathNot: `${prefix}diagnostics/` },
      },
    ],
  };
}

async function cruiseArchitecture(root) {
  const { output } = await cruise([root], {
    baseDir: REPOSITORY_ROOT,
    validate: true,
    ruleSet: architectureRules(root),
    exclude: { path: `^${escapeRegExp(root)}/evals/` },
    doNotFollow: { path: "node_modules" },
  });

  return output;
}

function violations(output) {
  return output.summary.violations.map(
    ({ rule, from, to }) => `${rule.name}: ${from} -> ${to}`,
  );
}

function subsystemOf(root, path) {
  const prefix = `${root}/`;

  if (!path.startsWith(prefix)) {
    return null;
  }

  const remainder = path.slice(prefix.length);
  const separator = remainder.indexOf("/");

  return separator < 0 ? null : remainder.slice(0, separator);
}

/** Fold the cruised module graph into subsystems and return edges inside cycles. */
function subsystemCycleEdges(output, root) {
  const edges = new Map();

  for (const module of output.modules) {
    const from = subsystemOf(root, module.source);

    for (const dependency of module.dependencies) {
      const to = subsystemOf(root, dependency.resolved);

      if (from !== null && to !== null && from !== to) {
        edges.set(from, (edges.get(from) ?? new Set()).add(to));
      }
    }
  }

  const reaches = (start, goal) => {
    const pending = [start];
    const seen = new Set();

    while (pending.length > 0) {
      const current = pending.pop();

      if (current === goal) {
        return true;
      }

      if (!seen.has(current)) {
        seen.add(current);
        pending.push(...(edges.get(current) ?? []));
      }
    }

    return false;
  };

  return [...edges]
    .flatMap(([from, targets]) =>
      [...targets]
        .filter((to) => reaches(to, from))
        .map((to) => `${from} -> ${to}`),
    )
    .sort();
}

test("committing-to-git source satisfies the architecture dependency policy", async () => {
  const output = await cruiseArchitecture(SKILL_SOURCE);

  assert.ok(output.summary.totalCruised > 50);
  assert.deepEqual(violations(output), []);
});

test("subsystem cycles match the shrinking migration baseline", async () => {
  const output = await cruiseArchitecture(SKILL_SOURCE);

  assert.deepEqual(
    subsystemCycleEdges(output, SKILL_SOURCE),
    SUBSYSTEM_CYCLE_BASELINE,
  );
});

test("the policy rejects a module cycle", async () => {
  const root = `${FIXTURES}/module-cycle`;

  // dependency-cruiser reports each cycle once, at its first module.
  assert.deepEqual(violations(await cruiseArchitecture(root)), [
    `no-module-cycle: ${root}/message/first.js -> ${root}/message/second.js`,
  ]);
});

test("the policy rejects a workflow import of the CLI", async () => {
  const root = `${FIXTURES}/workflow-imports-cli`;

  assert.deepEqual(violations(await cruiseArchitecture(root)), [
    `workflow-does-not-depend-on-cli: ${root}/workflow/prepareWorkflow.js -> ${root}/cli/commandArguments.js`,
  ]);
});

test("subsystem folding reports a directory cycle without a module cycle", async () => {
  const root = `${FIXTURES}/subsystem-cycle`;
  const output = await cruiseArchitecture(root);

  assert.deepEqual(subsystemCycleEdges(output, root), [
    "message -> transaction",
    "transaction -> message",
  ]);
});
