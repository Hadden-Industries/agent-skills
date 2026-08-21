/**
 * Contract tests for the GitHub MCP server installer in
 * `scripts/set_up_mcp_servers.py`.
 *
 * The installer downloads a release binary and then rewrites configuration that
 * three different agent hosts read. Both halves are easy to get quietly wrong:
 * an asset name that does not exist for a given platform fails only on that
 * platform, and a configuration merge that discards a neighbouring server
 * breaks tools unrelated to this repository. These tests pin the platform
 * mapping, the archive extraction, and the merge behaviour without touching the
 * network.
 *
 * Run them with:
 *
 *     node --test "tests/**\/*.test.mjs"
 *
 * The bootstrap is a single-file script rather than an importable package, so a
 * small Python driver (`github_mcp_driver.py`) loads it by path and exposes one
 * function per call.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";
import test from "node:test";

import { resolvePython } from "../helpers/python.mjs";

const DRIVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "github_mcp_driver.py",
);

// The command every host configuration should name: repository-relative, POSIX
// separators, so one string works on every platform and stays valid when the
// clone moves.
const COMMAND = ".agent-tools/bin/github-mcp-server.exe";

const ENTRY = { command: COMMAND, args: ["stdio"] };

function driver(call, args = {}) {
  const [command, ...prefix] = resolvePython();

  const result = spawnSync(command, [...prefix, DRIVER], {
    input: JSON.stringify({ call, args }),
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  assert.equal(
    result.status,
    0,
    `driver exited ${result.status}: ${result.stderr}`,
  );

  return JSON.parse(result.stdout);
}

/** Calls the installer and asserts it succeeded, returning the value. */
function value(call, args) {
  const response = driver(call, args);

  assert.ok(
    response.ok,
    `expected ${call} to succeed, but it failed: ${response.error}`,
  );

  return response.value;
}

/** Calls the installer and asserts it failed, returning the error message. */
function failure(call, args) {
  const response = driver(call, args);

  assert.equal(
    response.ok,
    false,
    `expected ${call} to fail, but it returned a value`,
  );

  return response.error;
}

function scratchRepo(t) {
  const repo = mkdtempSync(join(tmpdir(), "github-mcp-config-"));

  t.after(() => rmSync(repo, { recursive: true, force: true }));

  return repo;
}

test("release assets are resolved per operating system and architecture", () => {
  // Every expectation here is a real asset name from the upstream release, which
  // is what makes this mapping worth pinning: a plausible-looking guess such as
  // `Windows_amd64` or `Darwin_aarch64` 404s at download time only on the
  // platform nobody ran the bootstrap on.
  const cases = [
    ["Windows", "AMD64", "github-mcp-server_Windows_x86_64.zip"],
    ["Windows", "ARM64", "github-mcp-server_Windows_arm64.zip"],
    ["Windows", "x86", "github-mcp-server_Windows_i386.zip"],
    ["Darwin", "arm64", "github-mcp-server_Darwin_arm64.tar.gz"],
    ["Darwin", "x86_64", "github-mcp-server_Darwin_x86_64.tar.gz"],
    ["Linux", "x86_64", "github-mcp-server_Linux_x86_64.tar.gz"],
    ["Linux", "aarch64", "github-mcp-server_Linux_arm64.tar.gz"],
    ["Linux", "i686", "github-mcp-server_Linux_i386.tar.gz"],
  ];

  for (const [system, machine, expected] of cases) {
    assert.equal(
      value("asset_name", { system, machine }),
      expected,
      `${system}/${machine} should resolve ${expected}`,
    );
  }
});

test("architecture matching ignores case and vendor spelling", () => {
  assert.equal(
    value("asset_name", { system: "Linux", machine: "AMD64" }),
    "github-mcp-server_Linux_x86_64.tar.gz",
  );

  assert.equal(
    value("asset_name", { system: "Darwin", machine: "ARM64" }),
    "github-mcp-server_Darwin_arm64.tar.gz",
  );
});

test("an unsupported architecture is named in the error", () => {
  const error = failure("asset_name", { system: "Linux", machine: "riscv64" });

  assert.match(error, /riscv64/u);
});

test("macOS has no 32-bit release, so i386 is rejected rather than guessed", () => {
  // Upstream publishes `Linux_i386` and `Windows_i386` but no Darwin equivalent.
  // Composing the name from parts without checking would produce a URL that 404s.
  const error = failure("asset_name", { system: "Darwin", machine: "i686" });

  assert.match(error, /Darwin/u);
});

test("an unsupported operating system is named in the error", () => {
  const error = failure("asset_name", { system: "FreeBSD", machine: "x86_64" });

  assert.match(error, /FreeBSD/u);
});

test("only Windows gets an .exe suffix", () => {
  assert.equal(
    value("binary_name", { system: "Windows" }),
    "github-mcp-server.exe",
  );
  assert.equal(value("binary_name", { system: "Darwin" }), "github-mcp-server");
  assert.equal(value("binary_name", { system: "Linux" }), "github-mcp-server");
});

test("release checksums are parsed into a name-to-digest map", () => {
  const text = [
    "29e901869c639bb8e7e908496653d37a02d260761c64921fd83a4d9f4fd137f9  github-mcp-server_Windows_x86_64.zip",
    "cbf38bd3364518ccf80b6a25587d5ef11655b15d63cbb48bc066384d0b5b5964  github-mcp-server_Linux_x86_64.tar.gz",
    "",
  ].join("\n");

  assert.deepEqual(value("parse_checksums", { text }), {
    "github-mcp-server_Windows_x86_64.zip":
      "29e901869c639bb8e7e908496653d37a02d260761c64921fd83a4d9f4fd137f9",
    "github-mcp-server_Linux_x86_64.tar.gz":
      "cbf38bd3364518ccf80b6a25587d5ef11655b15d63cbb48bc066384d0b5b5964",
  });
});

test("the server binary is extracted from a Windows zip", () => {
  // Real release archives ship the licence and README beside the binary.
  const extracted = value("extract", {
    kind: "zip",
    binary_name: "github-mcp-server.exe",
    entries: {
      LICENSE: "MIT",
      "README.md": "# github-mcp-server",
      "github-mcp-server.exe": "windows-binary-payload",
    },
  });

  assert.equal(extracted.exists, true);
  assert.equal(extracted.contents, "windows-binary-payload");
});

test("the server binary is extracted from a gzipped tarball", () => {
  const extracted = value("extract", {
    kind: "tar.gz",
    binary_name: "github-mcp-server",
    entries: {
      LICENSE: "MIT",
      "github-mcp-server": "posix-binary-payload",
    },
  });

  assert.equal(extracted.exists, true);
  assert.equal(extracted.contents, "posix-binary-payload");
});

test("an archive without the expected binary fails loudly", () => {
  const error = failure("extract", {
    kind: "zip",
    binary_name: "github-mcp-server.exe",
    entries: { "README.md": "# github-mcp-server" },
  });

  assert.match(error, /github-mcp-server\.exe/u);
});

test("a JSON host config gains the server without disturbing its neighbours", () => {
  const existing = JSON.stringify(
    {
      mcpServers: {
        postgres: { command: "npx", args: ["-y", "@some/postgres-mcp"] },
      },
      someUnrelatedKey: { keep: true },
    },
    null,
    2,
  );

  const merged = JSON.parse(
    value("merge_json", { existing, name: "github", entry: ENTRY }),
  );

  assert.deepEqual(merged.mcpServers.github, ENTRY);
  assert.deepEqual(merged.mcpServers.postgres, {
    command: "npx",
    args: ["-y", "@some/postgres-mcp"],
  });
  assert.deepEqual(merged.someUnrelatedKey, { keep: true });
});

test("a stale command path is replaced but hand-set options survive", () => {
  // The previous setup pointed at a `go install` build under the user profile.
  // Repointing it is the whole purpose of the change; silently dropping a
  // hand-tuned `timeout` alongside it would not be.
  const existing = JSON.stringify({
    mcpServers: {
      github: {
        command: "${USERPROFILE}\\go\\bin\\github-mcp-server.exe",
        args: ["stdio"],
        timeout: 600000,
      },
    },
  });

  const merged = JSON.parse(
    value("merge_json", { existing, name: "github", entry: ENTRY }),
  );

  assert.equal(merged.mcpServers.github.command, COMMAND);
  assert.equal(merged.mcpServers.github.timeout, 600000);
});

test("a JSON host config is created from nothing when absent", () => {
  const merged = JSON.parse(
    value("merge_json", { existing: null, name: "github", entry: ENTRY }),
  );

  assert.deepEqual(merged, { mcpServers: { github: ENTRY } });
});

test("merging a JSON host config is idempotent", () => {
  const first = value("merge_json", {
    existing: null,
    name: "github",
    entry: ENTRY,
  });
  const second = value("merge_json", {
    existing: first,
    name: "github",
    entry: ENTRY,
  });

  assert.equal(second, first);
});

test("a Codex config gains a managed block and keeps hand-written settings", () => {
  const existing = [
    'model = "gpt-5-codex"',
    "",
    "[mcp_servers.postgres]",
    'command = "npx"',
    "",
  ].join("\n");

  const merged = value("merge_codex", {
    existing,
    name: "github",
    entry: ENTRY,
  });

  assert.match(merged, /^model = "gpt-5-codex"$/mu);
  assert.match(merged, /^\[mcp_servers\.postgres\]$/mu);
  assert.match(merged, /^\[mcp_servers\.github\]$/mu);
  assert.match(
    merged,
    /^command = "\.agent-tools\/bin\/github-mcp-server\.exe"$/mu,
  );
  assert.match(merged, /^args = \["stdio"\]$/mu);
});

test("a Codex managed block is replaced in place rather than appended twice", () => {
  const first = value("merge_codex", {
    existing: null,
    name: "github",
    entry: ENTRY,
  });
  const second = value("merge_codex", {
    existing: first,
    name: "github",
    entry: ENTRY,
  });

  assert.equal(second, first);
  assert.equal(second.match(/^\[mcp_servers\.github\]$/gmu).length, 1);
});

test("a Codex config with an outdated managed command is repointed", () => {
  const stale = value("merge_codex", {
    existing: null,
    name: "github",
    entry: { command: "/usr/local/bin/github-mcp-server", args: ["stdio"] },
  });

  const merged = value("merge_codex", {
    existing: stale,
    name: "github",
    entry: ENTRY,
  });

  assert.doesNotMatch(merged, /usr\/local\/bin/u);
  assert.equal(merged.match(/^\[mcp_servers\.github\]$/gmu).length, 1);
});

test("a managed block attributed to a renamed script is still recognised", () => {
  // The marker names the script that owns the block, so it changes whenever that
  // script is renamed or moved. Matching the attribution literally would leave
  // the previous block unrecognised, which reads as a hand-written table and
  // makes the merge refuse instead of updating it.
  const legacy = [
    "# BEGIN mcp_servers.github - managed by scripts/some_former_name.py",
    "[mcp_servers.github]",
    'command = "/opt/github-mcp-server"',
    'args = ["stdio"]',
    "# END mcp_servers.github - managed by scripts/some_former_name.py",
    "",
  ].join("\n");

  const merged = value("merge_codex", {
    existing: legacy,
    name: "github",
    entry: ENTRY,
  });

  assert.equal(merged.match(/^\[mcp_servers\.github\]$/gmu).length, 1);
  assert.doesNotMatch(merged, /some_former_name/u);
  assert.doesNotMatch(merged, /opt\/github-mcp-server/u);
  assert.match(
    merged,
    /^command = "\.agent-tools\/bin\/github-mcp-server\.exe"$/mu,
  );
});

test("a hand-written Codex github table is refused rather than duplicated", () => {
  // Two `[mcp_servers.github]` tables are a TOML duplicate-key error, so
  // appending a managed block next to a hand-written one would break the whole
  // Codex configuration rather than just this server.
  const existing = ["[mcp_servers.github]", 'command = "docker"', ""].join(
    "\n",
  );

  const error = failure("merge_codex", {
    existing,
    name: "github",
    entry: ENTRY,
  });

  assert.match(error, /mcp_servers\.github/u);
});

test("every host config points at the same repository-relative command", (t) => {
  const repo = scratchRepo(t);

  const written = value("write_host_configs", { repo, command: COMMAND });

  assert.deepEqual(Object.keys(written).sort(), [
    ".agents/mcp_config.json",
    ".codex/config.toml",
    ".mcp.json",
  ]);

  assert.equal(
    JSON.parse(written[".mcp.json"]).mcpServers.github.command,
    COMMAND,
  );
  assert.equal(
    JSON.parse(written[".agents/mcp_config.json"]).mcpServers.github.command,
    COMMAND,
  );
  assert.match(
    written[".codex/config.toml"],
    /^command = "\.agent-tools\/bin\/github-mcp-server\.exe"$/mu,
  );
});

test("rewriting every host config leaves the files byte-identical", (t) => {
  const repo = scratchRepo(t);

  const first = value("write_host_configs", { repo, command: COMMAND });
  const second = value("write_host_configs", { repo, command: COMMAND });

  assert.deepEqual(second, first);
});

test("host configs are written without disturbing an unrelated server", (t) => {
  const repo = scratchRepo(t);

  writeFileSync(
    join(repo, ".mcp.json"),
    `${JSON.stringify({ mcpServers: { sentry: { type: "http", url: "https://mcp.sentry.dev" } } }, null, 2)}\n`,
    "utf8",
  );

  value("write_host_configs", { repo, command: COMMAND });

  const merged = JSON.parse(readFileSync(join(repo, ".mcp.json"), "utf8"));

  assert.deepEqual(merged.mcpServers.sentry, {
    type: "http",
    url: "https://mcp.sentry.dev",
  });
  assert.equal(merged.mcpServers.github.command, COMMAND);
});

test("every generated host config ends with exactly one trailing newline", (t) => {
  const repo = scratchRepo(t);

  const written = value("write_host_configs", { repo, command: COMMAND });

  for (const [path, contents] of Object.entries(written)) {
    assert.match(
      contents,
      /[^\n]\n$/u,
      `${path} should end with a single newline`,
    );
  }
});

test("no generated host config plumbs a personal access token", (t) => {
  // The local server runs its browser-based OAuth flow only when no token is
  // set, and keeps the resulting token in memory. A configuration that named or
  // forwarded a personal access token would silently pre-empt that flow, which
  // is the authentication this repository relies on.
  const repo = scratchRepo(t);

  const written = value("write_host_configs", { repo, command: COMMAND });

  for (const [path, contents] of Object.entries(written)) {
    assert.doesNotMatch(
      contents,
      /GITHUB_PERSONAL_ACCESS_TOKEN|GITHUB_TOKEN|env_vars/u,
      `${path} should not reference a personal access token`,
    );
  }
});

test("the server entry carries nothing beyond the command and transport", (t) => {
  const repo = scratchRepo(t);

  const written = value("write_host_configs", { repo, command: COMMAND });

  assert.deepEqual(JSON.parse(written[".mcp.json"]).mcpServers.github, {
    command: COMMAND,
    args: ["stdio"],
  });
  assert.deepEqual(
    JSON.parse(written[".agents/mcp_config.json"]).mcpServers.github,
    {
      command: COMMAND,
      args: ["stdio"],
    },
  );
});
