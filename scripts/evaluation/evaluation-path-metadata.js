import { lstat, statfs } from "node:fs/promises";
import { dirname, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { openWindowsPathMetadataProbe } from "./windows-path-metadata.js";

// Linux UAPI include/uapi/linux/magic.h: ext2/3/4, XFS, Btrfs, F2FS,
// tmpfs and ramfs. Unknown, network, FUSE and layered filesystems fail closed.
const LOCAL_LINUX_FILESYSTEMS = new Set([
  0xef53, 0x58465342, 0x9123683e, 0xf2f52010, 0x01021994, 0x858458f6,
]);

async function optionalMetadata(path) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readLinuxPath(path, statFilesystem) {
  const fullPath = resolve(path);
  const metadata = await optionalMetadata(fullPath);
  // Never follow a redirected leaf to classify its destination filesystem.
  let storagePath = metadata?.isSymbolicLink() ? dirname(fullPath) : fullPath;
  let storageMetadata = await optionalMetadata(storagePath);
  while (storageMetadata === null) {
    const parent = dirname(storagePath);
    if (parent === storagePath)
      throw new Error("Filesystem root is unavailable");
    storagePath = parent;
    storageMetadata = await optionalMetadata(storagePath);
  }
  if (storageMetadata.isSymbolicLink()) {
    const error = new Error("Redirected storage ancestors are not supported");
    error.code = "reparse-point";
    throw error;
  }
  const filesystem = await statFilesystem(storagePath);
  return {
    schemaVersion: 1,
    exists: metadata !== null,
    fullPath,
    isDirectory: metadata?.isDirectory() ?? false,
    redirected: metadata?.isSymbolicLink() ?? false,
    volume: {
      identity: `device:${storageMetadata.dev}`,
      kind: LOCAL_LINUX_FILESYSTEMS.has(Number(filesystem.type))
        ? "local"
        : "unsupported",
    },
  };
}

export function openEvaluationPathMetadata({
  platform = process.platform,
  statFilesystem = statfs,
  openWindowsProbe = openWindowsPathMetadataProbe,
} = {}) {
  if (platform === "linux") {
    return {
      read: (path) => readLinuxPath(path, statFilesystem),
      close: async () => {},
    };
  }
  if (platform !== "win32") {
    const error = new Error(
      `Unsupported evaluation-home platform: ${platform}`,
    );
    error.code = "unsupported-platform";
    throw error;
  }
  const probe = openWindowsProbe({
    executable: "powershell.exe",
    scriptPath: fileURLToPath(
      new URL("./windows-path-probe.ps1", import.meta.url),
    ),
  });
  return {
    read: async (path) => {
      const metadata = await probe.read(path);
      return {
        schemaVersion: metadata.schemaVersion,
        exists: metadata.exists,
        fullPath: metadata.fullPath,
        isDirectory: metadata.isContainer,
        redirected: metadata.attributes.includes("ReparsePoint"),
        volume: {
          identity: win32.normalize(metadata.drive.root).toLowerCase(),
          kind: metadata.drive.driveType === "Fixed" ? "local" : "unsupported",
        },
      };
    },
    close: () => probe.close(),
  };
}
