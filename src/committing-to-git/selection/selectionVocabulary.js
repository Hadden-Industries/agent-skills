/** Shared selector grammar; canonical ordering remains the consuming domain's decision. */
export const ARRAY_SELECTOR_FIELDS = Object.freeze([
  "ids",
  "destinationPaths",
  "destinationPathPrefixes",
  "sourcePaths",
  "sourcePathPrefixes",
  "kinds",
]);
export const SELECTOR_FIELDS = Object.freeze([
  "all",
  "remaining",
  ...ARRAY_SELECTOR_FIELDS,
]);
