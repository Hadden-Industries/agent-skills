import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  createOrVerifyFile,
  readStableFile,
} from "../../lib/filesystem/stableFile.js";

function fixture(t) {
  const directory = fs.mkdtempSync(join(tmpdir(), "stable-file-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return join(directory, "input");
}

test("stable reads accept bounded regular bytes and reject oversized input before reading", (t) => {
  const path = fixture(t);
  fs.writeFileSync(path, "abc", { mode: 0o600 });
  assert.equal(readStableFile(path, 3).bytes.toString(), "abc");
  const originalRead = fs.readSync;
  let reads = 0;
  t.mock.method(fs, "readSync", (...args) => {
    reads += 1;
    return originalRead(...args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => readStableFile(path, 2), { code: "FILE_TOO_LARGE" });
    assert.equal(reads, 0);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("stable reads reject growth after opening without allocating the growing length", (t) => {
  const path = fixture(t);
  fs.writeFileSync(path, "abc", { mode: 0o600 });
  const originalRead = fs.readSync;
  let totalRequested = 0;
  let changed = false;
  t.mock.method(fs, "readSync", (...args) => {
    if (!changed) {
      changed = true;
      fs.appendFileSync(path, "def", { mode: 0o600 });
    }
    totalRequested += args[3];
    return originalRead(...args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => readStableFile(path, 3), { code: "FILE_CHANGED" });
    assert.equal(changed, true);
    assert.equal(totalRequested, 4);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("stable reads reject same-length path replacement while retaining the opened descriptor", (t) => {
  const path = fixture(t);
  fs.writeFileSync(path, "abc", { mode: 0o600 });
  const originalRead = fs.readSync;
  let changed = false;
  t.mock.method(fs, "readSync", (...args) => {
    if (!changed) {
      changed = true;
      fs.renameSync(path, `${path}.old`);
      fs.writeFileSync(path, "xyz", { flag: "wx", mode: 0o600 });
    }
    return originalRead(...args);
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => readStableFile(path, 3), { code: "FILE_CHANGED" });
    assert.equal(fs.readFileSync(path, "utf8"), "xyz");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
});

test("immutable creation accepts exact replay and preserves conflicting or linked files", (t) => {
  const path = fixture(t);
  const bytes = Buffer.from("abc");
  createOrVerifyFile(path, bytes);
  createOrVerifyFile(path, bytes);
  assert.throws(() => createOrVerifyFile(path, Buffer.from("xyz")), {
    code: "FILE_COLLISION",
  });
  assert.equal(fs.readFileSync(path, "utf8"), "abc");
  if (process.platform !== "win32")
    assert.equal(readStableFile(path, 3).stat.mode % 0o1000n, 0o600n);
  const link = `${path}.link`;
  try {
    fs.symlinkSync(path, link, "file");
  } catch (error) {
    if (process.platform === "win32" && error.code === "EPERM") {
      t.diagnostic(
        "File symlink control unavailable without Windows symlink privilege.",
      );
      return;
    }
    throw error;
  }
  assert.throws(() => readStableFile(link, 3));
  assert.throws(() => createOrVerifyFile(link, bytes));
  assert.equal(fs.readFileSync(path, "utf8"), "abc");
});

test("stable reads preserve regular files reached through a stable directory alias", (t) => {
  const path = fixture(t);
  fs.writeFileSync(path, "abc", { mode: 0o600 });
  const alias = join(dirname(path), "alias");
  fs.symlinkSync(
    dirname(path),
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.equal(readStableFile(join(alias, "input"), 3).bytes.toString(), "abc");
  assert.throws(() =>
    readStableFile(join(alias, "input"), 3, { rejectLinkedAncestors: true }),
  );
});
