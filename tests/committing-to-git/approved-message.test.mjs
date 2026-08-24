import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECT_SUBJECT_TRANSPORT_PATTERN,
  MAXIMUM_CANONICAL_MESSAGE_BYTES,
  canUseDirectSubjectTransport,
  validateApprovedMessage,
} from "../../src/committing-to-git/message/approvedMessage.js";
import { formatMessagePath } from "../../src/committing-to-git/message/changeSelection.js";

function changeUnit(index, path = `src/file-${index}.js`, overrides = {}) {
  return {
    id: `F${String(index).padStart(6, "0")}`,
    kind: "modified",
    sourcePath: null,
    destinationPath: path,
    sourcePathBytesBase64: null,
    destinationPathBytesBase64: Buffer.from(path).toString("base64"),
    ...overrides,
  };
}

function manifestFixture(changeUnitCount) {
  const changeUnits = Array.from({ length: changeUnitCount }, (_, index) =>
    changeUnit(index + 1),
  );

  return {
    schemaVersion: 2,
    indexTreeOid: "a".repeat(40),
    changeUnitCount,
    changeUnits,
  };
}

function validate(manifest, text, overrides = {}) {
  return validateApprovedMessage({
    manifest,
    route: "concise",
    bytes: Buffer.from(text, "utf8"),
    repositoryTypePolicy: { allowedTypes: [] },
    messageSource: "checked-file",
    ...overrides,
  });
}

function errorCode(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

test("subject-only concise messages are valid for one, twelve, and one thousand units", () => {
  for (const count of [1, 12, 1_000]) {
    const result = validate(
      manifestFixture(count),
      "feat(parser): Preserve parser compatibility\n",
    );

    assert.equal(result.valid, true);
    assert.equal(result.sections.fileChanges.present, false);
    assert.equal(result.byteCount, 44);
    assert.deepEqual(result.presentationWarnings, {
      count: 0,
      samples: [],
      sha256: null,
    });
  }
});

test("optional rationale and user-experience sections add context without ceremony", () => {
  const result = validate(
    manifestFixture(12),
    [
      "fix(parser): Prevent invalid token acceptance",
      "",
      "Rationale:",
      "  - Reject malformed tokens before structural parsing",
      "",
      "User Experience Changes:",
      "  - Return the existing validation diagnostic earlier",
      "",
    ].join("\n"),
  );

  assert.equal(result.valid, true);
  assert.equal(result.sections.rationale.present, true);
  assert.equal(result.sections.userExperience.present, true);
  assert.equal(result.sections.fileChanges.present, false);
});

test("a checked detailed inventory maps every reversible path exactly once", () => {
  const manifest = manifestFixture(3);
  const sorted = [...manifest.changeUnits].sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.destinationPathBytesBase64, "base64"),
      Buffer.from(right.destinationPathBytesBase64, "base64"),
    ),
  );
  const text = [
    "refactor(parser): Simplify parser dispatch",
    "",
    "File Changes:",
    ...sorted.map(
      (unit, index) =>
        `${" ".repeat(2)}${index + 1}. ${formatMessagePath(
          Buffer.from(unit.destinationPathBytesBase64, "base64"),
        )}`,
    ),
    "",
  ].join("\n");
  const result = validate(manifest, text);

  assert.equal(result.valid, true);
  assert.equal(result.files.setMatches, true);
  assert.equal(result.files.listedCount, 3);
});

test("free-form counted bulk domains require structured finalization", () => {
  errorCode(
    () =>
      validate(
        manifestFixture(50),
        [
          "refactor(parser): Retire the legacy parser",
          "",
          "File Changes:",
          "  1. Legacy parser retirement (50 files)",
          "",
        ].join("\n"),
      ),
    "STRUCTURED_BULK_FINALIZATION_REQUIRED",
  );
});

test("section order and empty ceremonial sections are rejected", () => {
  errorCode(
    () =>
      validate(
        manifestFixture(1),
        [
          "fix(parser): Prevent invalid input",
          "",
          "User Experience Changes:",
          "  - Keep diagnostics stable",
          "",
          "Rationale:",
          "  - Reject invalid input early",
          "",
        ].join("\n"),
      ),
    "SECTION_ORDER_INVALID",
  );
  errorCode(
    () =>
      validate(
        manifestFixture(1),
        "fix(parser): Prevent invalid input\n\nRationale:\n",
      ),
    "EMPTY_SECTION",
  );
});

test("detailed inventories reject missing, duplicate, and wrong paths", () => {
  const manifest = manifestFixture(2);
  const prefix = ["fix(parser): Prevent invalid input", "", "File Changes:"];

  for (const [lines, code] of [
    [["  1. `src/file-1.js`"], "FILE_INVENTORY_INCOMPLETE"],
    [
      ["  1. `src/file-1.js`", "  2. `src/file-1.js`"],
      "FILE_INVENTORY_DUPLICATE",
    ],
    [
      ["  1. `src/file-1.js`", "  2. `src/other.js`"],
      "FILE_INVENTORY_UNKNOWN_PATH",
    ],
  ]) {
    errorCode(
      () => validate(manifest, [...prefix, ...lines, ""].join("\n")),
      code,
    );
  }
});

test("checked file notes use the same ordinal-derived alignment and reject placeholders", () => {
  const manifest = manifestFixture(1);
  const base = [
    "fix(parser): Prevent invalid input",
    "",
    "File Changes:",
    "  1. `src/file-1.js`",
  ];

  assert.equal(
    validate(
      manifest,
      [...base, "     - Preserve the caller-visible diagnostic", ""].join("\n"),
    ).valid,
    true,
  );
  errorCode(
    () =>
      validate(
        manifest,
        [...base, "    - Preserve the caller-visible diagnostic", ""].join(
          "\n",
        ),
      ),
    "FILE_INVENTORY_FORMAT_INVALID",
  );
  errorCode(
    () =>
      validate(
        manifest,
        [...base, "     - <explain the consequence>", ""].join("\n"),
      ),
    "EMPTY_SECTION",
  );
});

test("approved bytes are preserved exactly and direct text is concise-only", () => {
  const bytes = Buffer.from(
    "fix(parser): Preserve exact approved bytes\n\nRationale:\n  - Keep two spaces here\n",
  );
  const result = validateApprovedMessage({
    manifest: manifestFixture(1),
    route: "concise",
    bytes,
    repositoryTypePolicy: { allowedTypes: [] },
    messageSource: "checked-file",
  });

  assert.equal(Buffer.from(result.displayText).equals(bytes), true);
  errorCode(
    () =>
      validateApprovedMessage({
        manifest: manifestFixture(1),
        route: "extended",
        bytes,
        repositoryTypePolicy: { allowedTypes: [] },
        messageSource: "checked-file",
      }),
    "DIRECT_TEXT_REQUIRES_CONCISE_TRANSACTION",
  );
});

test("canonical messages require exactly one LF and reject invalid encoding", () => {
  const manifest = manifestFixture(1);

  for (const [bytes, code] of [
    [Buffer.from("fix: Prevent invalid input"), "TERMINAL_LF_REQUIRED"],
    [Buffer.from("fix: Prevent invalid input\n\n"), "MULTIPLE_TERMINAL_LF"],
    [
      Buffer.from("fix: Prevent invalid input\r\n"),
      "CARRIAGE_RETURN_FORBIDDEN",
    ],
    [Buffer.from("fix: Prevent\rinvalid input\n"), "CARRIAGE_RETURN_FORBIDDEN"],
    [Buffer.from("fix: Prevent\0invalid input\n"), "NUL_FORBIDDEN"],
    [Buffer.from([0x66, 0x69, 0x78, 0x3a, 0x20, 0xff, 0x0a]), "INVALID_UTF8"],
  ]) {
    errorCode(
      () =>
        validateApprovedMessage({
          manifest,
          route: "concise",
          bytes,
          repositoryTypePolicy: { allowedTypes: [] },
          messageSource: "checked-file",
        }),
      code,
    );
  }
});

test("Unicode controls and format characters are rejected before approval", () => {
  const forbidden = [
    "\u0001",
    "\u001f",
    "\u007f",
    "\u0085",
    "\ufeff",
    "\u202e",
    "\u200b",
  ];

  for (const character of forbidden) {
    errorCode(
      () =>
        validate(manifestFixture(1), `fix: Prevent${character}invalid input\n`),
      "PROHIBITED_UNICODE_CHARACTER",
    );
  }
});

test("direct subject transport uses the exact conservative ASCII boundary", () => {
  const safe = [
    "fix: Prevent parser drift",
    "chore(scope-name): Update parser_v2 + docs/guide",
    "build(ci): Keep Node 24, parser-v2.0 (LTS)",
  ];

  for (const subject of safe) {
    assert.match(subject, DIRECT_SUBJECT_TRANSPORT_PATTERN);
    assert.equal(canUseDirectSubjectTransport(subject), true, subject);
  }

  const excluded = [
    "'",
    '"',
    "\\",
    "$",
    "`",
    "%",
    "!",
    "&",
    "|",
    ";",
    "<",
    ">",
    "=",
    "?",
    "*",
    "^",
    "#",
    "[",
    "]",
    "{",
    "}",
    "@",
    "~",
    "\u00e9",
  ];

  for (const character of excluded) {
    assert.equal(
      canUseDirectSubjectTransport(`fix: Prevent parser ${character} drift`),
      false,
      character,
    );
  }
});

test("subject length counts Unicode scalars, including astral code points", () => {
  const prefix = "fix: ";
  const exact = `${prefix}A${"x".repeat(65)}\ud83d\ude80`;
  const over = `${exact}y`;

  assert.equal([...exact].length, 72);
  assert.equal([...over].length, 73);
  assert.doesNotThrow(() => validate(manifestFixture(1), `${exact}\n`));
  errorCode(
    () => validate(manifestFixture(1), `${over}\n`),
    "SUBJECT_TOO_LONG",
  );
  assert.equal(canUseDirectSubjectTransport(exact), false);
});

test("subject grammar keeps capitalization and terminal-period boundaries", () => {
  errorCode(
    () => validate(manifestFixture(1), "fix: prevent invalid input\n"),
    "SUBJECT_DESCRIPTION_NOT_CAPITALIZED",
  );
  errorCode(
    () => validate(manifestFixture(1), "fix: Prevent invalid input.\n"),
    "SUBJECT_TRAILING_PERIOD",
  );
  errorCode(
    () => validate(manifestFixture(1), "Fix: Prevent invalid input\n"),
    "SUBJECT_FORMAT_INVALID",
  );
  assert.equal(
    validate(manifestFixture(1), "chore: Maintain parser fixtures\n").subject
      .type,
    "chore",
  );
});

test("a valid nonportable subject is file-routed while safe text works both ways", () => {
  const unicodeSubject = "fix: Preserve caf\u00e9 paths";
  const safeSubject = "fix: Preserve parser paths";

  assert.equal(canUseDirectSubjectTransport(unicodeSubject), false);
  assert.equal(validate(manifestFixture(1), `${unicodeSubject}\n`).valid, true);
  assert.equal(canUseDirectSubjectTransport(safeSubject), true);
  assert.equal(validate(manifestFixture(1), `${safeSubject}\n`).valid, true);

  const direct = validateApprovedMessage({
    manifest: manifestFixture(1),
    route: "concise",
    bytes: Buffer.from(`${safeSubject}\n`),
    repositoryTypePolicy: { allowedTypes: [] },
    messageSource: "approved-subject",
  });
  assert.equal(direct.valid, true);

  errorCode(
    () =>
      validateApprovedMessage({
        manifest: manifestFixture(1),
        route: "concise",
        bytes: Buffer.from(`${unicodeSubject}\n`),
        repositoryTypePolicy: { allowedTypes: [] },
        messageSource: "approved-subject",
      }),
    "DIRECT_SUBJECT_TRANSPORT_UNSAFE",
  );
});

test("canonical byte limits are inclusive and never imply a scope change", () => {
  const manifest = manifestFixture(1);
  const prefix = "fix: Preserve parser behavior\n\nRationale:\n  - ";
  const suffix = "\n";
  const bytesAt = (size) =>
    Buffer.from(
      `${prefix}${"x".repeat(size - Buffer.byteLength(prefix) - 1)}${suffix}`,
    );

  for (const size of [32_767, MAXIMUM_CANONICAL_MESSAGE_BYTES]) {
    const result = validateApprovedMessage({
      manifest,
      route: "concise",
      bytes: bytesAt(size),
      repositoryTypePolicy: { allowedTypes: [] },
      messageSource: "checked-file",
    });

    assert.equal(result.byteCount, size);
  }

  errorCode(
    () =>
      validateApprovedMessage({
        manifest,
        route: "concise",
        bytes: bytesAt(MAXIMUM_CANONICAL_MESSAGE_BYTES + 1),
        repositoryTypePolicy: { allowedTypes: [] },
        messageSource: "checked-file",
      }),
    "MESSAGE_DISPLAY_BUDGET_EXCEEDED",
  );
});
