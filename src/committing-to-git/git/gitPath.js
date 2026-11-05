// Byte-preserving Git path parsing and ordering.
export function splitNul(buffer) {
  const fields = [];
  let start = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0) {
      continue;
    }

    fields.push(buffer.subarray(start, index));
    start = index + 1;
  }

  if (start < buffer.length) {
    fields.push(buffer.subarray(start));
  }

  return fields.filter((field) => field.length > 0);
}

export function comparePathBytes(left, right) {
  return Buffer.compare(left, right);
}

/** Git's line-oriented --stdin-paths accepts C-quoted raw path bytes. */
export function quotePathForGitInput(bytes) {
  return `"${[...bytes]
    .map((byte) =>
      byte >= 0x20 && byte <= 0x7e && byte !== 0x22 && byte !== 0x5c
        ? String.fromCharCode(byte)
        : `\\${byte.toString(8).padStart(3, "0")}`,
    )
    .join("")}"`;
}

export function pathRecord(raw) {
  const decoded = raw.toString("utf8");

  return {
    bytesBase64: raw.toString("base64"),
    text: decoded,
    display: decoded,
  };
}
