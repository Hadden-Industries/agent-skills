import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sameIdentity(left, right) {
  return ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"].every(
    (field) => left[field] === right[field],
  );
}

/** Read bounded stable regular bytes; optionally reject linked ancestor paths. */
export function readStableFile(
  path,
  maximumBytes,
  { rejectLinkedAncestors = false } = {},
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError("A nonnegative safe byte limit is required.");
  }
  const absolutePath = resolve(path);
  // Open first. Nonblocking avoids a FIFO stall before fstat on POSIX;
  // no-follow rejects final-component links. Windows validates path identity.
  /* eslint-disable no-bitwise -- Node flags are combined as a bit mask. */
  const flags =
    constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0);
  /* eslint-enable no-bitwise */
  const descriptor = openSync(absolutePath, flags, 0o600);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const initialPath = lstatSync(absolutePath, { bigint: true });
    if (
      !before.isFile() ||
      initialPath.isSymbolicLink() ||
      !sameIdentity(before, initialPath) ||
      (rejectLinkedAncestors && realpathSync(absolutePath) !== absolutePath)
    ) {
      fail(
        "FILE_NOT_REGULAR",
        `Expected a stable non-symbolic regular file: ${path}`,
      );
    }
    if (before.size > BigInt(maximumBytes)) {
      fail("FILE_TOO_LARGE", `File exceeds ${maximumBytes} bytes: ${path}`);
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        Math.min(64 * 1024, bytes.length - offset),
        null,
      );
      if (count === 0) break;
      offset += count;
    }
    const extra = readSync(descriptor, Buffer.alloc(1), 0, 1, null);
    const after = fstatSync(descriptor, { bigint: true });
    const finalPath = lstatSync(absolutePath, { bigint: true });
    if (
      offset !== bytes.length ||
      extra !== 0 ||
      !after.isFile() ||
      finalPath.isSymbolicLink() ||
      !sameIdentity(before, after) ||
      !sameIdentity(after, finalPath) ||
      (rejectLinkedAncestors && realpathSync(absolutePath) !== absolutePath)
    ) {
      fail("FILE_CHANGED", `File changed while it was read: ${path}`);
    }
    return { bytes, stat: after };
  } finally {
    closeSync(descriptor);
  }
}

/** Atomically create immutable bytes, or verify an existing identical regular file. */
export function createOrVerifyFile(path, bytes) {
  try {
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!readStableFile(path, bytes.length).bytes.equals(bytes)) {
      fail("FILE_COLLISION", `Immutable file has conflicting bytes: ${path}`);
    }
  }
}
