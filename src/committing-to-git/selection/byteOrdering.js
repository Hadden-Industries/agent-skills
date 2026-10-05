// Prepare UTF-8 keys once per operation; preserve native stable byte ordering.
export function sortByUtf8Bytes(values, key = (value) => value) {
  if (values.length < 2) {
    return [...values];
  }

  return values
    .map((value) => ({ value, bytes: Buffer.from(key(value), "utf8") }))
    .sort((left, right) => Buffer.compare(left.bytes, right.bytes))
    .map(({ value }) => value);
}
