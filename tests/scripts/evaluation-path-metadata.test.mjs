import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { openEvaluationPathMetadata } from "../../scripts/evaluation/evaluation-path-metadata.js";

test("Linux path observations use native device identity and classify missing children", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "evaluation-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const probe = openEvaluationPathMetadata({
    platform: "linux",
    statFilesystem: async () => ({ type: 0xef53 }),
  });
  const observed = await probe.read(root);
  assert.equal(observed.exists, true);
  assert.equal(observed.isDirectory, true);
  assert.equal(observed.redirected, false);
  assert.equal(observed.volume.kind, "local");
  assert.match(observed.volume.identity, /^device:\d+$/u);
  const missing = await probe.read(join(root, "missing", "child"));
  assert.equal(missing.exists, false);
  assert.equal(missing.isDirectory, false);
  assert.equal(missing.redirected, false);
  assert.deepEqual(missing.volume, observed.volume);
  await probe.close();
});

test("Linux storage classification fails closed for network and unknown filesystems", async (t) => {
  for (const type of [0x6969, 0xff534d42, 0x65735546, 0x12345678]) {
    await t.test(type.toString(16), async () => {
      const probe = openEvaluationPathMetadata({
        platform: "linux",
        statFilesystem: async () => ({ type }),
      });
      assert.equal((await probe.read(tmpdir())).volume.kind, "unsupported");
      await probe.close();
    });
  }
});

test("Linux path observations detect redirects before querying their destination filesystem", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "evaluation-path-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "target");
  const link = join(root, "link");
  await mkdir(target);
  await symlink(
    target,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  const calls = [];
  const probe = openEvaluationPathMetadata({
    platform: "linux",
    statFilesystem: async (path) => {
      calls.push(path);
      return { type: 0xef53 };
    },
  });
  const observation = await probe.read(link);
  assert.equal(observation.redirected, true);
  assert.equal(observation.isDirectory, false);
  assert.deepEqual(calls, [dirname(resolve(link))]);
  await probe.close();
});

test("the native Windows probe is normalized once and closed by its owner", async () => {
  let closed = false;
  const probe = openEvaluationPathMetadata({
    platform: "win32",
    openWindowsProbe: () => ({
      read: async (path) => ({
        schemaVersion: 1,
        exists: true,
        fullPath: path,
        isContainer: true,
        attributes: ["Directory", "ReparsePoint"],
        drive: { root: "C:\\", driveType: "Fixed" },
      }),
      close: async () => {
        closed = true;
      },
    }),
  });
  const observation = await probe.read("C:\\fixture");
  assert.deepEqual(observation, {
    schemaVersion: 1,
    exists: true,
    fullPath: "C:\\fixture",
    isDirectory: true,
    redirected: true,
    volume: { identity: "c:\\", kind: "local" },
  });
  await probe.close();
  assert.equal(closed, true);
});
