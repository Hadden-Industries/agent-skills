const FULL_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** Require the exact own enumerable members of an admitted record; throws on mismatch. */
export function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();

  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} contains missing or unknown members.`);
  }
}

/** Validate a native HEAD destination and parent anchor, or null for an absent anchor. */
export function validateHeadAnchor(headAnchor) {
  if (headAnchor === null) {
    return;
  }

  assertExactKeys(
    headAnchor,
    ["headKind", "targetRef", "expectedParentOids"],
    "Head anchor",
  );

  if (!new Set(["unborn", "attached", "detached"]).has(headAnchor.headKind)) {
    throw new Error(
      `Unknown head anchor kind ${JSON.stringify(headAnchor.headKind)}.`,
    );
  }

  if (
    !Array.isArray(headAnchor.expectedParentOids) ||
    headAnchor.expectedParentOids.some(
      (oid) => typeof oid !== "string" || !FULL_OID_PATTERN.test(oid),
    )
  ) {
    throw new Error("Head anchor parent IDs must be full opaque object IDs.");
  }

  if (headAnchor.headKind === "unborn") {
    if (
      typeof headAnchor.targetRef !== "string" ||
      !headAnchor.targetRef.startsWith("refs/heads/") ||
      headAnchor.expectedParentOids.length !== 0
    ) {
      throw new Error(
        "An unborn head anchor requires a full branch ref and no parents.",
      );
    }

    return;
  }

  if (headAnchor.expectedParentOids.length !== 1) {
    throw new Error(`${headAnchor.headKind} head anchor requires one parent.`);
  }

  if (headAnchor.headKind === "attached") {
    if (
      typeof headAnchor.targetRef !== "string" ||
      !headAnchor.targetRef.startsWith("refs/heads/")
    ) {
      throw new Error("An attached head anchor requires a full branch ref.");
    }

    return;
  }

  if (headAnchor.targetRef !== null) {
    throw new Error("A detached head anchor requires a null target ref.");
  }
}
