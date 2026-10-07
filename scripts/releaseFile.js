import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { resolve } from "node:path";

function sameSnapshot(left, right) {
  return ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].every(
    (field) => left[field] === right[field],
  );
}

/** Replace an existing singly-linked release file only if its snapshot still matches.
 * Open without truncation; verify identity and bounded bytes before any mutation.
 * All effects use that descriptor, so a later path substitution cannot redirect
 * them. This is a cooperative stale-input guard, not a concurrent transaction.
 */
export function replaceReleaseFile(path, snapshot, bytes) {
  const absolutePath = resolve(path);
  /* eslint-disable no-bitwise -- Native non-truncating flags form a bit mask. */
  const flags =
    constants.O_RDWR |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0);
  /* eslint-enable no-bitwise */
  const descriptor = openSync(absolutePath, flags);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const initialPath = lstatSync(absolutePath, { bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      initialPath.isSymbolicLink() ||
      !sameSnapshot(before, snapshot.stat) ||
      !sameSnapshot(before, initialPath) ||
      realpathSync(absolutePath) !== absolutePath
    )
      throw new Error(`Release file changed or linked before writing: ${path}`);

    // Read at most the accepted length plus one byte, including concurrent
    // growth. Positional reads/writes do not depend on the descriptor offset.
    const actual = Buffer.alloc(snapshot.bytes.length + 1);
    let read = 0;
    while (read < actual.length) {
      const count = readSync(
        descriptor,
        actual,
        read,
        Math.min(64 * 1024, actual.length - read),
        read,
      );
      if (count === 0) break;
      read += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const finalPath = lstatSync(absolutePath, { bigint: true });
    if (
      !sameSnapshot(before, after) ||
      finalPath.isSymbolicLink() ||
      !sameSnapshot(after, finalPath) ||
      realpathSync(absolutePath) !== absolutePath ||
      !actual.subarray(0, read).equals(snapshot.bytes)
    )
      throw new Error(`Release file changed before writing: ${path}`);

    ftruncateSync(descriptor, 0);
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(
        descriptor,
        bytes,
        written,
        bytes.length - written,
        written,
      );
      if (count === 0)
        throw new Error(`Release file write made no progress: ${path}`);
      written += count;
    }
  } finally {
    closeSync(descriptor);
  }
}
