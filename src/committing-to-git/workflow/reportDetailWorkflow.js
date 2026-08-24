import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { TextDecoder } from "node:util";

import {
  MAXIMUM_REPORT_RESULT_BYTES,
  observeWorkspaceEntries,
} from "../report/commitReport.js";
import {
  acquireTransactionStateLock,
  releaseTransactionStateLock,
} from "../transaction/transactionRecovery.js";
import { readTransaction } from "../transaction/transactionWorkspace.js";

const ACTIVE_NAME = "report-detail.active.json";
const COMPLETED_NAME = "report-detail.completed.json";
const MAXIMUM_CURSOR_BYTES = 512;
const MAXIMUM_PAGE_MODEL_BYTES = 40 * 1024;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const STRICT_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const SAFE_TERMINAL_TEXT = /^[^\p{Cc}\p{Cf}]*$/u;

export class ReportDetailError extends Error {
  constructor(code, message, exitCode = 2) {
    super(message);
    this.name = "ReportDetailError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(code, message, exitCode = 2) {
  throw new ReportDetailError(code, message, exitCode);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeDisplay(bytes) {
  try {
    const decoded = STRICT_UTF8_DECODER.decode(bytes);

    if (SAFE_TERMINAL_TEXT.test(decoded)) {
      return decoded;
    }
  } catch {
    // Fall through to a reversible byte display.
  }

  return [...bytes]
    .map((byte) =>
      byte >= 0x20 && byte <= 0x7e && byte !== 0x5c
        ? String.fromCharCode(byte)
        : `\\x${byte.toString(16).padStart(2, "0")}`,
    )
    .join("");
}

function detailEntry(entry, ordinal) {
  return {
    ordinal,
    category: entry.category,
    status: entry.status,
    path: {
      display: safeDisplay(entry.pathBytes),
      bytesBase64: entry.pathBytes.toString("base64"),
      byteCount: entry.pathBytes.length,
      sha256: sha256(entry.pathBytes),
    },
  };
}

function directoryIdentity(path) {
  const stat = lstatSync(path, { bigint: true });

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(
      "DETAIL_STATE_REPLACED",
      "Workspace observation directory was replaced.",
    );
  }

  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    birthtimeNanoseconds: String(stat.birthtimeNs),
  };
}

function validDirectoryIdentity(identity) {
  return (
    identity !== null &&
    typeof identity === "object" &&
    !Array.isArray(identity) &&
    JSON.stringify(Object.keys(identity).sort()) ===
      JSON.stringify(["birthtimeNanoseconds", "device", "inode"].sort()) &&
    Object.values(identity).every(
      (value) => typeof value === "string" && /^\d+$/u.test(value),
    )
  );
}

function assertRegularFile(path, label) {
  const stat = lstatSync(path);

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("DETAIL_STATE_REPLACED", `${label} was replaced or is not regular.`);
  }
}

function readJson(path, label) {
  assertRegularFile(path, label);

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail("DETAIL_STATE_INVALID", `${label} is invalid: ${error.message}`);
  }
}

function validateReadyActive(transactionPath, active) {
  const expectedKeys = [
    "schemaVersion",
    "state",
    "transactionDigest",
    "startingReportDigest",
    "observationId",
    "observationDirectoryIdentity",
    "cursorKey",
    "observedAt",
    "observationDigest",
    "observedEntryCount",
    "pages",
  ].sort();
  const pagesValid =
    Array.isArray(active?.pages) &&
    active.pages.length > 0 &&
    active.pages.every(
      (page, index) =>
        JSON.stringify(Object.keys(page).sort()) ===
          JSON.stringify(
            ["index", "startOrdinal", "endOrdinal", "sha256"].sort(),
          ) &&
        page.index === index &&
        Number.isSafeInteger(page.startOrdinal) &&
        page.startOrdinal >= 0 &&
        Number.isSafeInteger(page.endOrdinal) &&
        page.endOrdinal >= -1 &&
        SHA256_PATTERN.test(page.sha256),
    );
  const pagesContiguous =
    pagesValid &&
    active.pages.every(
      (page, index) =>
        page.startOrdinal ===
        (index === 0 ? 0 : active.pages[index - 1].endOrdinal + 1),
    ) &&
    (active.observedEntryCount === 0
      ? active.pages.length === 1 &&
        active.pages[0].startOrdinal === 0 &&
        active.pages[0].endOrdinal === -1
      : active.pages.every((page) => page.endOrdinal >= page.startOrdinal) &&
        active.pages.at(-1).endOrdinal + 1 === active.observedEntryCount);
  let cursorKeyValid = false;

  if (typeof active?.cursorKey === "string") {
    const cursorKeyBytes = Buffer.from(active.cursorKey, "base64url");

    cursorKeyValid =
      cursorKeyBytes.length === 32 &&
      cursorKeyBytes.toString("base64url") === active.cursorKey;
  }

  if (
    JSON.stringify(Object.keys(active ?? {}).sort()) !==
      JSON.stringify(expectedKeys) ||
    active.schemaVersion !== 1 ||
    active.state !== "ready" ||
    active.transactionDigest !==
      sha256(Buffer.from(resolve(transactionPath))) ||
    !SHA256_PATTERN.test(active.startingReportDigest) ||
    !UUID_V4_PATTERN.test(active.observationId) ||
    !validDirectoryIdentity(active.observationDirectoryIdentity) ||
    !cursorKeyValid ||
    typeof active.observedAt !== "string" ||
    !Number.isFinite(Date.parse(active.observedAt)) ||
    !SHA256_PATTERN.test(active.observationDigest) ||
    !Number.isSafeInteger(active.observedEntryCount) ||
    active.observedEntryCount < 0 ||
    !pagesContiguous
  ) {
    fail("DETAIL_STATE_INVALID", "Active workspace detail journal is invalid.");
  }

  return active;
}

function writeNew(path, value) {
  const noFollow = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
  const descriptor = openSync(
    path,
    fsConstants.O_WRONLY + fsConstants.O_CREAT + fsConstants.O_EXCL + noFollow,
    0o600,
  );

  try {
    writeFileSync(descriptor, canonicalBytes(value));
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function replaceJson(path, value) {
  const candidate = `${path}.${randomUUID()}.tmp`;

  writeNew(candidate, value);
  renameSync(candidate, path);
}

function cursorRequestDigest(cursor) {
  return sha256(Buffer.from(cursor === null ? "<cursorless>" : cursor));
}

function cursorBody(active, nextOrdinal) {
  return {
    schemaVersion: 1,
    transactionDigest: active.transactionDigest,
    startingReportDigest: active.startingReportDigest,
    observationDigest: active.observationDigest,
    nextOrdinal,
  };
}

function encodeCursor(active, nextOrdinal) {
  const body = cursorBody(active, nextOrdinal);
  const signature = sha256(
    Buffer.concat([
      Buffer.from(active.cursorKey, "base64url"),
      Buffer.from(JSON.stringify(body), "utf8"),
    ]),
  );
  const cursor = Buffer.from(
    JSON.stringify({ ...body, signature }),
    "utf8",
  ).toString("base64url");

  if (Buffer.byteLength(cursor) > MAXIMUM_CURSOR_BYTES) {
    fail("DETAIL_CURSOR_BUDGET_EXCEEDED", "Generated cursor is too large.");
  }

  return cursor;
}

function decodeCursor(cursor, active) {
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    Buffer.byteLength(cursor) > MAXIMUM_CURSOR_BYTES
  ) {
    fail("DETAIL_CURSOR_INVALID", "Report-detail cursor is malformed.");
  }

  let decoded;

  try {
    const bytes = Buffer.from(cursor, "base64url");

    if (bytes.toString("base64url") !== cursor) {
      fail("DETAIL_CURSOR_INVALID", "Report-detail cursor is malformed.");
    }

    decoded = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("DETAIL_CURSOR_INVALID", "Report-detail cursor is malformed.");
  }

  const keys = Object.keys(decoded).sort();
  const expectedKeys = [
    "nextOrdinal",
    "observationDigest",
    "schemaVersion",
    "signature",
    "startingReportDigest",
    "transactionDigest",
  ].sort();
  const body = cursorBody(active, decoded.nextOrdinal);
  const expectedSignature = sha256(
    Buffer.concat([
      Buffer.from(active.cursorKey, "base64url"),
      Buffer.from(JSON.stringify(body), "utf8"),
    ]),
  );

  if (
    JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
    decoded.schemaVersion !== 1 ||
    decoded.transactionDigest !== active.transactionDigest ||
    decoded.startingReportDigest !== active.startingReportDigest ||
    decoded.observationDigest !== active.observationDigest ||
    !Number.isSafeInteger(decoded.nextOrdinal) ||
    decoded.nextOrdinal < 1 ||
    decoded.signature !== expectedSignature
  ) {
    fail(
      "DETAIL_CURSOR_INVALID",
      "Report-detail cursor is stale, tampered, or belongs to another transaction.",
    );
  }

  return decoded.nextOrdinal;
}

function observationDirectory(transaction, active) {
  if (!UUID_V4_PATTERN.test(active.observationId)) {
    fail("DETAIL_STATE_INVALID", "Workspace observation ID is invalid.");
  }

  return join(
    transaction.attemptDirectory,
    `report-detail-${active.observationId}`,
  );
}

function pagePath(transaction, active, index) {
  return join(
    observationDirectory(transaction, active),
    `page-${String(index).padStart(6, "0")}.json`,
  );
}

function assertObservationDirectory(transaction, active) {
  const path = observationDirectory(transaction, active);
  const observedIdentity = directoryIdentity(path);

  if (
    !validDirectoryIdentity(active.observationDirectoryIdentity) ||
    JSON.stringify(observedIdentity) !==
      JSON.stringify(active.observationDirectoryIdentity)
  ) {
    fail(
      "DETAIL_STATE_REPLACED",
      "Workspace observation directory was replaced.",
    );
  }

  return path;
}

async function materializeObservation(transaction, active) {
  mkdirSync(observationDirectory(transaction, active), { mode: 0o700 });
  const observationDirectoryIdentity = directoryIdentity(
    observationDirectory(transaction, active),
  );
  let entries = [];
  let pageIndex = 0;
  let nextOrdinal = 0;
  const pages = [];

  const flushPage = () => {
    if (entries.length === 0) {
      return;
    }

    const page = {
      schemaVersion: 1,
      startOrdinal: entries[0].ordinal,
      endOrdinal: entries.at(-1).ordinal,
      entries,
    };

    writeNew(pagePath(transaction, active, pageIndex), page);
    pages.push({
      index: pageIndex,
      startOrdinal: page.startOrdinal,
      endOrdinal: page.endOrdinal,
      sha256: sha256(canonicalBytes(page)),
    });
    pageIndex += 1;
    entries = [];
  };

  const observation = await observeWorkspaceEntries(
    transaction.repositoryRoot,
    {
      scope: transaction.scope,
      enumerateAllUntracked: true,
      onEntry(entry) {
        const candidate = detailEntry(entry, nextOrdinal);

        if (
          entries.length > 0 &&
          Buffer.byteLength(JSON.stringify([...entries, candidate])) >
            MAXIMUM_PAGE_MODEL_BYTES
        ) {
          flushPage();
        }

        entries.push(candidate);
        nextOrdinal += 1;
      },
    },
  );

  flushPage();

  if (pages.length === 0) {
    const page = {
      schemaVersion: 1,
      startOrdinal: 0,
      endOrdinal: -1,
      entries: [],
    };

    writeNew(pagePath(transaction, active, 0), page);
    pages.push({
      index: 0,
      startOrdinal: 0,
      endOrdinal: -1,
      sha256: sha256(canonicalBytes(page)),
    });
  }

  const completedActive = {
    ...active,
    state: "ready",
    observationDirectoryIdentity,
    observationDigest: observation.digest,
    observedEntryCount: observation.observedEntries,
    pages,
  };

  replaceJson(join(transaction.attemptDirectory, ACTIVE_NAME), completedActive);
  return completedActive;
}

function renderDetailPage(result) {
  const lines = [
    `Workspace detail observed ${result.observation.observedAt}`,
    `Digest: ${result.observation.digest}`,
    "",
  ];

  if (result.page.entries.length === 0) {
    lines.push("Workspace is clean.");
  } else {
    for (const entry of result.page.entries) {
      lines.push(
        `${entry.ordinal + 1}. ${entry.category}: ${entry.path.display} (${entry.status})`,
      );
    }
  }

  if (result.nextCursor !== null) {
    lines.push("", "More entries remain; continue with the returned cursor.");
  }

  return `${lines.join("\n")}\n`;
}

function boundedPageResult(transactionPath, active, page, requestCursor) {
  const nextPage = active.pages[page.index + 1] ?? null;
  const result = {
    schemaVersion: 1,
    status: nextPage === null ? "detail-complete" : "detail-page",
    transaction: resolve(transactionPath),
    startingReportDigest: active.startingReportDigest,
    observation: {
      observedAt: active.observedAt,
      digest: active.observationDigest,
      observedEntryCount: active.observedEntryCount,
      exactAtReportTime: false,
    },
    page: {
      startOrdinal: page.startOrdinal,
      endOrdinal: page.endOrdinal,
      entries: page.entries,
    },
    nextCursor:
      nextPage === null ? null : encodeCursor(active, nextPage.startOrdinal),
    displayText: "",
    exitCode: 0,
  };

  result.displayText = renderDetailPage(result);

  if (Buffer.byteLength(JSON.stringify(result)) > MAXIMUM_REPORT_RESULT_BYTES) {
    fail(
      "DETAIL_RESULT_BUDGET_EXCEEDED",
      "Workspace detail page exceeds the serialized result budget.",
    );
  }

  return {
    result,
    requestCursorDigest: cursorRequestDigest(requestCursor),
    final: nextPage === null,
  };
}

function readPageForRequest(transaction, active, cursor) {
  assertObservationDirectory(transaction, active);
  const ordinal = cursor === null ? 0 : decodeCursor(cursor, active);
  const descriptor = active.pages.find((page) => page.startOrdinal === ordinal);

  if (!descriptor) {
    fail("DETAIL_CURSOR_INVALID", "Report-detail cursor does not name a page.");
  }

  const page = readJson(
    pagePath(transaction, active, descriptor.index),
    "Workspace detail page",
  );

  if (sha256(canonicalBytes(page)) !== descriptor.sha256) {
    fail("DETAIL_STATE_INVALID", "Workspace detail page digest changed.");
  }

  return { ...page, index: descriptor.index };
}

function hasExactKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...expectedKeys].sort())
  );
}

function validReplayPath(path) {
  if (
    !hasExactKeys(path, ["display", "bytesBase64", "byteCount", "sha256"]) ||
    typeof path.display !== "string" ||
    typeof path.bytesBase64 !== "string" ||
    !Number.isSafeInteger(path.byteCount) ||
    path.byteCount < 0 ||
    !SHA256_PATTERN.test(path.sha256)
  ) {
    return false;
  }

  const bytes = Buffer.from(path.bytesBase64, "base64");

  return (
    bytes.toString("base64") === path.bytesBase64 &&
    bytes.length === path.byteCount &&
    sha256(bytes) === path.sha256 &&
    safeDisplay(bytes) === path.display
  );
}

function validateCompletedResult(result, transactionPath) {
  const resultKeys = [
    "schemaVersion",
    "status",
    "transaction",
    "startingReportDigest",
    "observation",
    "page",
    "nextCursor",
    "displayText",
    "exitCode",
  ];
  const observationValid =
    hasExactKeys(result?.observation, [
      "observedAt",
      "digest",
      "observedEntryCount",
      "exactAtReportTime",
    ]) &&
    typeof result.observation.observedAt === "string" &&
    Number.isFinite(Date.parse(result.observation.observedAt)) &&
    SHA256_PATTERN.test(result.observation.digest) &&
    Number.isSafeInteger(result.observation.observedEntryCount) &&
    result.observation.observedEntryCount >= 0 &&
    result.observation.exactAtReportTime === false;
  const pageValid =
    hasExactKeys(result?.page, ["startOrdinal", "endOrdinal", "entries"]) &&
    Number.isSafeInteger(result.page.startOrdinal) &&
    result.page.startOrdinal >= 0 &&
    Number.isSafeInteger(result.page.endOrdinal) &&
    result.page.endOrdinal >= -1 &&
    Array.isArray(result.page.entries) &&
    result.page.entries.every(
      (entry, index) =>
        hasExactKeys(entry, ["ordinal", "category", "status", "path"]) &&
        entry.ordinal === result.page.startOrdinal + index &&
        new Set(["staged", "unstaged", "untracked", "conflicted"]).has(
          entry.category,
        ) &&
        typeof entry.status === "string" &&
        entry.status.length > 0 &&
        SAFE_TERMINAL_TEXT.test(entry.status) &&
        validReplayPath(entry.path),
    );
  const pageBoundsValid =
    pageValid &&
    observationValid &&
    (result.observation.observedEntryCount === 0
      ? result.page.startOrdinal === 0 &&
        result.page.endOrdinal === -1 &&
        result.page.entries.length === 0
      : result.page.entries.length > 0 &&
        result.page.endOrdinal === result.page.entries.at(-1).ordinal &&
        result.page.endOrdinal + 1 === result.observation.observedEntryCount);

  if (
    !hasExactKeys(result, resultKeys) ||
    result.schemaVersion !== 1 ||
    result.status !== "detail-complete" ||
    result.transaction !== resolve(transactionPath) ||
    !SHA256_PATTERN.test(result.startingReportDigest) ||
    !observationValid ||
    !pageBoundsValid ||
    result.nextCursor !== null ||
    typeof result.displayText !== "string" ||
    result.exitCode !== 0 ||
    result.displayText !== renderDetailPage(result)
  ) {
    fail("DETAIL_STATE_INVALID", "Completed detail replay is invalid.");
  }
}

function replayCompletion(completed, cursor, transactionPath) {
  if (
    JSON.stringify(Object.keys(completed ?? {}).sort()) !==
      JSON.stringify(
        ["schemaVersion", "requestCursorDigest", "result"].sort(),
      ) ||
    completed.schemaVersion !== 1 ||
    !SHA256_PATTERN.test(completed.requestCursorDigest) ||
    canonicalBytes(completed).length > MAXIMUM_REPORT_RESULT_BYTES
  ) {
    fail("DETAIL_STATE_INVALID", "Completed detail replay is invalid.");
  }

  validateCompletedResult(completed.result, transactionPath);

  if (completed.requestCursorDigest !== cursorRequestDigest(cursor)) {
    fail(
      "DETAIL_STATE_CONFLICT",
      "A completed detail observation is retained; use its final cursor or request --refresh.",
      1,
    );
  }

  return completed.result;
}

export async function readWorkspaceDetailPage({
  transactionPath,
  cursor = null,
  refresh = false,
  failureInjector = () => {},
}) {
  if (refresh && cursor !== null) {
    fail(
      "DETAIL_ARGUMENT_CONFLICT",
      "--cursor and --refresh are mutually exclusive.",
    );
  }

  let lock;

  try {
    lock = acquireTransactionStateLock({
      transactionPath,
      operation: "report-detail",
    });
  } catch (error) {
    if (error.code === "TRANSACTION_STATE_CONFLICT") {
      fail("DETAIL_STATE_CONFLICT", error.message, 1);
    }

    throw error;
  }

  try {
    const transaction = readTransaction(transactionPath);

    if (!new Set(["reported", "published"]).has(transaction.phase)) {
      fail(
        "DETAIL_PHASE_INVALID",
        "Workspace detail requires a reported or published transaction.",
        1,
      );
    }

    const activePath = join(transaction.attemptDirectory, ACTIVE_NAME);
    const completedPath = join(transaction.attemptDirectory, COMPLETED_NAME);

    if (existsSync(completedPath) && !refresh) {
      const completed = readJson(
        completedPath,
        "Completed workspace detail replay",
      );

      if (!existsSync(activePath)) {
        return replayCompletion(completed, cursor, transactionPath);
      }

      const replayActive = readJson(
        activePath,
        "Active workspace detail journal",
      );

      if (
        replayActive.state === "ready" &&
        completed.result?.startingReportDigest ===
          replayActive.startingReportDigest &&
        completed.result?.observation?.digest === replayActive.observationDigest
      ) {
        validateReadyActive(transactionPath, replayActive);
        const replay = replayCompletion(completed, cursor, transactionPath);
        const directory = observationDirectory(transaction, replayActive);

        if (existsSync(directory)) {
          rmSync(assertObservationDirectory(transaction, replayActive), {
            recursive: true,
            force: false,
          });
        }

        unlinkSync(activePath);
        return replay;
      }
    }

    let active;

    if (existsSync(activePath)) {
      if (cursor === null || refresh) {
        fail(
          "DETAIL_STATE_CONFLICT",
          "A workspace detail observation is already active.",
          1,
        );
      }

      active = readJson(activePath, "Active workspace detail journal");

      if (active.state !== "ready") {
        fail(
          "DETAIL_STATE_CONFLICT",
          "The workspace detail observation was interrupted before paging.",
          1,
        );
      }

      active = validateReadyActive(transactionPath, active);
    } else {
      if (cursor !== null) {
        fail(
          "DETAIL_CURSOR_INVALID",
          "No active workspace detail observation accepts this cursor.",
        );
      }

      const observationId = randomUUID();

      active = {
        schemaVersion: 1,
        state: "observing",
        transactionDigest: sha256(Buffer.from(resolve(transactionPath))),
        startingReportDigest: transaction.report.jsonSha256,
        observationId,
        observationDirectoryIdentity: null,
        cursorKey: randomBytes(32).toString("base64url"),
        observedAt: new Date().toISOString(),
        observationDigest: null,
        observedEntryCount: null,
        pages: [],
      };

      writeNew(activePath, active);

      if (refresh && existsSync(completedPath)) {
        unlinkSync(completedPath);
      }

      active = await materializeObservation(transaction, active);
      active = validateReadyActive(transactionPath, active);
    }

    const page = readPageForRequest(transaction, active, cursor);
    const bounded = boundedPageResult(transactionPath, active, page, cursor);

    if (bounded.final) {
      const completed = {
        schemaVersion: 1,
        requestCursorDigest: bounded.requestCursorDigest,
        result: bounded.result,
      };

      if (canonicalBytes(completed).length > MAXIMUM_REPORT_RESULT_BYTES) {
        fail(
          "DETAIL_RESULT_BUDGET_EXCEEDED",
          "Completed detail replay exceeds the serialized result budget.",
        );
      }

      if (existsSync(completedPath)) {
        replaceJson(completedPath, completed);
      } else {
        writeNew(completedPath, completed);
      }

      failureInjector("after-detail-completion-before-page-cleanup");
      rmSync(assertObservationDirectory(transaction, active), {
        recursive: true,
        force: false,
      });
      failureInjector("after-detail-page-cleanup-before-journal-cleanup");
      unlinkSync(activePath);
      failureInjector("after-detail-cleanup-before-output");
    }

    return bounded.result;
  } finally {
    releaseTransactionStateLock(lock);
  }
}

export async function reportDetailWorkflow(options) {
  return readWorkspaceDetailPage(options);
}

function parseFlags(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token?.startsWith("--")) {
      fail("INVALID_ARGUMENT", `Unexpected argument ${JSON.stringify(token)}.`);
    }

    const name = token.slice(2);

    if (values.has(name)) {
      fail("DUPLICATE_ARGUMENT", `--${name} may be supplied only once.`);
    }

    if (name === "refresh") {
      values.set(name, true);
      continue;
    }

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      fail("INVALID_ARGUMENT", `--${name} requires a value.`);
    }

    values.set(name, value);
    index += 1;
  }

  return values;
}

function commandOutput(result, format) {
  return format === "text" ? result.displayText : `${JSON.stringify(result)}\n`;
}

export async function runReportDetailCommand(
  argv,
  { stdout = process.stdout, stderr = process.stderr } = {},
) {
  let format = "json";

  try {
    const flags = parseFlags(argv);
    const allowed = new Set(["transaction", "cursor", "refresh", "format"]);

    for (const name of flags.keys()) {
      if (!allowed.has(name)) {
        fail("UNKNOWN_ARGUMENT", `Unknown report-detail flag --${name}.`);
      }
    }

    format = flags.get("format") ?? "json";

    if (!new Set(["json", "text"]).has(format)) {
      fail("INVALID_FORMAT", "--format must be json or text.");
    }

    const transactionPath = flags.get("transaction");

    if (!transactionPath) {
      fail("TRANSACTION_REQUIRED", "--transaction is required.");
    }

    const result = await reportDetailWorkflow({
      transactionPath,
      cursor: flags.get("cursor") ?? null,
      refresh: flags.get("refresh") === true,
    });

    stdout.write(commandOutput(result, format));
    return result.exitCode;
  } catch (caught) {
    const error =
      caught instanceof ReportDetailError
        ? caught
        : new ReportDetailError("DETAIL_WORKFLOW_FAILED", caught.message);
    const result = {
      schemaVersion: 1,
      status: "invalid",
      code: error.code,
      message: error.message,
      exitCode: error.exitCode,
      displayText: `Status: invalid\nCode: ${error.code}\nMessage: ${error.message}\n`,
    };

    stderr.write(`${error.code}: ${error.message}\n`);
    stdout.write(commandOutput(result, format));
    return error.exitCode;
  }
}
