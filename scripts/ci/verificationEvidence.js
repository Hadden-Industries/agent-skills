/** Capture native verification text and publish diagnostic navigation for CI.
 * This boundary does not validate native reports or sandbox candidate code.
 * GitHub workflow commands are suspended while untrusted text is emitted.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";

const LOG_BUDGET_BYTES = 32 * 1024 * 1024;
const SUMMARY_BUDGET_BYTES = 64 * 1024;
const DIRECTORY_ENTRY_LIMIT = 256;
const RECORD_LIMIT = 2048;
const STAGES_BY_VERIFICATION_KIND = {
  "committing-to-git": ["environment", "install", "build-check", "tests"],
  "defining-concepts": ["environment", "install", "acquisition", "tests"],
  "evaluation-conformance": [
    "environment",
    "install",
    "acquisition",
    "build-check",
    "conformance",
    "tests",
  ],
};
const STAGE_RECORDS = {
  environment: "environment.txt",
  install: "install.txt",
  acquisition: "acquisition.txt",
  "build-check": "build-check.txt",
  conformance: "conformance.txt",
  tests: "tests.tap",
};
const SKILLS = [
  "committing-to-git",
  "defining-concepts",
  "naming-objects-in-software-engineering",
  "reading-epubs",
];
const PROCESS_SCENARIOS = [
  "normal",
  "delayed-startup",
  "timeout",
  "cancellation",
  "abrupt-consumer-death",
  "abrupt-engine-death",
  "inherited-pipe",
  "cleanup-overrun",
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function assertUnredirectedAncestors(candidate) {
  let ancestor = resolve(candidate);
  while (ancestor !== parse(ancestor).root) {
    try {
      if (lstatSync(ancestor).isSymbolicLink()) {
        throw new Error(`Redirected evidence path: ${ancestor}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    ancestor = dirname(ancestor);
  }
}

/** Reject redirected ancestors, nonordinary objects and resolved root escapes. */
export function assertEvidencePath(root, candidate, kind = "file") {
  root = resolve(root);
  candidate = resolve(candidate);
  const displacement = relative(root, candidate);
  if (
    isAbsolute(displacement) ||
    displacement === ".." ||
    displacement.startsWith(`..${sep}`)
  ) {
    throw new Error(`Evidence path outside root: ${candidate}`);
  }
  assertUnredirectedAncestors(candidate);
  const metadata = lstatSync(candidate);
  if (!(kind === "directory" ? metadata.isDirectory() : metadata.isFile())) {
    throw new Error(`Expected ordinary evidence ${kind}: ${candidate}`);
  }
  if (kind === "file" && metadata.nlink !== 1) {
    throw new Error(`Hardlinked evidence file: ${candidate}`);
  }
  const resolvedDisplacement = relative(
    realpathSync.native(root),
    realpathSync.native(candidate),
  );
  if (
    isAbsolute(resolvedDisplacement) ||
    resolvedDisplacement === ".." ||
    resolvedDisplacement.startsWith(`..${sep}`)
  ) {
    throw new Error(`Resolved evidence path outside root: ${candidate}`);
  }
  return metadata;
}

function readEvidenceFile(root, candidate, maximumBytes = LOG_BUDGET_BYTES) {
  const metadata = assertEvidencePath(root, candidate);
  if (metadata.size > maximumBytes) {
    throw new Error(
      `Evidence limit: ${candidate}; omitted ${metadata.size} bytes`,
    );
  }
  const descriptor = openSync(
    candidate,
    // Native open flags are a bitmask; path and handle identities remain checked.
    // eslint-disable-next-line no-bitwise
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== metadata.dev ||
      opened.ino !== metadata.ino ||
      opened.size !== metadata.size
    ) {
      throw new Error(`Evidence changed before read: ${candidate}`);
    }
    const bytes = Buffer.alloc(metadata.size);
    let observedBytes = 0;
    while (observedBytes < bytes.length) {
      const bytesRead = readSync(
        descriptor,
        bytes,
        observedBytes,
        bytes.length - observedBytes,
        observedBytes,
      );
      if (bytesRead === 0) {
        break;
      }
      observedBytes += bytesRead;
    }
    if (
      observedBytes !== metadata.size ||
      fstatSync(descriptor).size !== metadata.size
    ) {
      throw new Error(
        `Evidence changed during read: ${candidate}; observed ${observedBytes} bytes`,
      );
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

/** Suspend runner commands with a secret token; detect collisions across chunks.
 * Call finish in finally. The token is never supplied to child processes.
 */
export function createProtectedLog(output = process.stdout) {
  const token = randomBytes(32).toString("hex");
  const decoder = new StringDecoder("utf8");
  let pendingText = "";
  let hasCollision = false;
  output.write(`::stop-commands::${token}\n`);
  function emitText(text, final) {
    pendingText += text;
    let collisionIndex;
    while ((collisionIndex = pendingText.indexOf(token)) !== -1) {
      hasCollision = true;
      pendingText = `${pendingText.slice(0, collisionIndex)}[suspension token collision]${pendingText.slice(collisionIndex + token.length)}`;
    }
    let emittedLength = final
      ? pendingText.length
      : Math.max(0, pendingText.length - token.length + 1);
    if (
      emittedLength > 0 &&
      emittedLength < pendingText.length &&
      pendingText.charCodeAt(emittedLength - 1) >= 0xd800 &&
      pendingText.charCodeAt(emittedLength - 1) <= 0xdbff &&
      pendingText.charCodeAt(emittedLength) >= 0xdc00 &&
      pendingText.charCodeAt(emittedLength) <= 0xdfff
    ) {
      emittedLength--;
    }
    output.write(pendingText.slice(0, emittedLength));
    pendingText = pendingText.slice(emittedLength);
  }
  return {
    write(bytes) {
      emitText(decoder.write(Buffer.from(bytes)), false);
    },
    finish() {
      try {
        emitText(decoder.end(), true);
      } finally {
        output.write(`\n::${token}::\n`);
      }
      return { hasCollision };
    },
  };
}

function initializeOutputRoot(outputRoot) {
  if (!existsSync(outputRoot)) {
    assertEvidencePath(dirname(outputRoot), dirname(outputRoot), "directory");
    mkdirSync(outputRoot);
  }
  assertEvidencePath(outputRoot, outputRoot, "directory");
}

function stageResultPath(outputRoot, stage) {
  return join(outputRoot, `${stage}.result.json`);
}

function loadStageResults(outputRoot, verificationKind) {
  return STAGES_BY_VERIFICATION_KIND[verificationKind].map((stage) => {
    const path = stageResultPath(outputRoot, stage);
    try {
      if (!pathExists(path)) {
        return { stage, status: "not-started" };
      }
      const result = JSON.parse(
        readEvidenceFile(outputRoot, path, SUMMARY_BUDGET_BYTES),
      );
      if (
        result.stage !== stage ||
        !Number.isSafeInteger(result.emittedBytes) ||
        result.emittedBytes < 0 ||
        result.emittedBytes > LOG_BUDGET_BYTES ||
        !Array.isArray(result.failures)
      ) {
        throw new Error(`Invalid capture result: ${path}`);
      }
      return result;
    } catch (error) {
      return {
        stage,
        status: "unreadable",
        exitCode: null,
        failures: [error.message],
      };
    }
  });
}

/** Use npm's native JavaScript entry point on Windows, where .cmd cannot exec.
 * PATH selects the installed npm; no shell or compatibility fallback is used.
 */
function commandInvocation(command, arguments_) {
  if (command === "node") {
    return [process.execPath, arguments_];
  }
  if (command === "npm" && process.platform === "win32") {
    const searchDirectories = (process.env.PATH ?? "").split(";");
    const npmDirectory = searchDirectories.find((directory) =>
      existsSync(join(directory, "npm.cmd")),
    );
    if (!npmDirectory) {
      throw new Error("Installed npm.cmd not found on PATH");
    }
    const npmEntryPoint = join(
      npmDirectory,
      basename(npmDirectory).toLowerCase() === ".bin"
        ? "../npm/bin/npm-cli.js"
        : "node_modules/npm/bin/npm-cli.js",
    );
    if (!existsSync(npmEntryPoint)) {
      throw new Error(`Native npm entry point missing: ${npmEntryPoint}`);
    }
    return [process.execPath, [npmEntryPoint, ...arguments_]];
  }
  return [command, arguments_];
}

/** Stream one native command, retaining its status/signal and recorder failures.
 * Output limits fail visibly, drain remaining text and never mask native failure.
 */
export async function captureCommand({
  outputRoot,
  verificationKind,
  stage,
  command,
  arguments_ = [],
  temporaryRoot,
  acquisitionRoot,
  output = process.stdout,
}) {
  if (
    !STAGES_BY_VERIFICATION_KIND[verificationKind]?.includes(stage) ||
    !command
  ) {
    throw new Error(
      "Unknown verification kind/stage or missing native command",
    );
  }
  initializeOutputRoot(outputRoot);
  if (existsSync(stageResultPath(outputRoot, stage))) {
    throw new Error(`Stage already captured: ${stage}`);
  }
  const priorResults = loadStageResults(outputRoot, verificationKind);
  const failures = [];
  let nativeRootsBefore = [];
  let acquisitionRecordsBefore = [];
  try {
    if (
      verificationKind === "evaluation-conformance" &&
      temporaryRoot &&
      pathExists(temporaryRoot)
    ) {
      nativeRootsBefore = childDirectories(temporaryRoot);
    }
  } catch (error) {
    nativeRootsBefore = null;
    failures.push(error.message);
  }
  try {
    if (acquisitionRoot && pathExists(acquisitionRoot)) {
      acquisitionRecordsBefore = acquisitionRecordNames(acquisitionRoot);
    }
  } catch (error) {
    acquisitionRecordsBefore = null;
    failures.push(error.message);
  }
  const remainingBytes = priorResults.some(
    (result) => result.status === "unreadable",
  )
    ? 0
    : Math.max(
        0,
        LOG_BUDGET_BYTES -
          priorResults.reduce(
            (sum, result) => sum + (result.emittedBytes ?? 0),
            0,
          ),
      );
  const recordPath = join(outputRoot, STAGE_RECORDS[stage]);
  let descriptor;
  try {
    descriptor = openSync(recordPath, "wx");
  } catch (error) {
    failures.push(`Capture file unavailable: ${error.message}`);
  }
  const protectedLog = createProtectedLog(output);
  failures.push(...priorResults.flatMap((result) => result.failures ?? []));
  let emittedBytes = 0;
  let omittedBytes = 0;
  let exitCode = null;
  let signal = null;
  let child;
  let launchFailed = false;
  const forwardSignal = (receivedSignal) => {
    child?.kill(receivedSignal);
  };
  const interrupt = () => forwardSignal("SIGINT");
  const terminate = () => forwardSignal("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const [executable, argv] = commandInvocation(command, arguments_);
    child = spawn(executable, argv, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    function captureChunk(bytes) {
      let acceptedBytes = Math.min(bytes.length, remainingBytes - emittedBytes);
      // Avoid ending the accepted text inside a UTF-8 character.
      if (acceptedBytes < bytes.length) {
        while (
          acceptedBytes > 0 &&
          bytes[acceptedBytes] >= 0x80 &&
          bytes[acceptedBytes] < 0xc0
        ) {
          acceptedBytes--;
        }
      }
      omittedBytes += bytes.length - acceptedBytes;
      if (acceptedBytes === 0) {
        return;
      }
      emittedBytes += acceptedBytes;
      try {
        const accepted = bytes.subarray(0, acceptedBytes);
        // Synchronous writes keep log and retained byte accounting in one order.
        if (descriptor !== undefined) {
          writeFileSync(descriptor, accepted);
        }
        protectedLog.write(accepted);
      } catch (error) {
        if (failures.length === 0) {
          failures.push(`Capture failed: ${error.message}`);
        }
      }
    }
    // Each pipe owns its UTF-8 boundary. Count rendered text bytes, including
    // replacement characters, before applying the shared job output budget.
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder("utf8");
      stream.on("data", (bytes) =>
        captureChunk(Buffer.from(decoder.write(bytes))),
      );
      stream.on("end", () => captureChunk(Buffer.from(decoder.end())));
    }
    await new Promise((done) => {
      child.once("error", (error) => {
        launchFailed = true;
        failures.push(`Native launch failed: ${error.message}`);
      });
      child.once("close", (code, receivedSignal) => {
        exitCode = launchFailed ? null : code;
        signal = receivedSignal;
        done();
      });
    });
  } catch (error) {
    failures.push(error.message);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    try {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
    } catch (error) {
      failures.push(error.message);
    }
    if (protectedLog.finish().hasCollision) {
      failures.push("Live evidence contains a suspension token collision");
    }
  }
  if (omittedBytes > 0) {
    failures.push(
      `Evidence limit: omitted ${omittedBytes} bytes from ${stage}`,
    );
  }
  let nativeRoots = [];
  let acquisitionRecords = [];
  if (
    verificationKind === "evaluation-conformance" &&
    nativeRootsBefore !== null &&
    temporaryRoot
  ) {
    try {
      if (pathExists(temporaryRoot)) {
        nativeRoots = childDirectories(temporaryRoot).filter(
          (name) => !nativeRootsBefore.includes(name),
        );
      }
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (acquisitionRecordsBefore !== null && acquisitionRoot) {
    try {
      if (pathExists(acquisitionRoot)) {
        acquisitionRecords = acquisitionRecordNames(acquisitionRoot).filter(
          (name) => !acquisitionRecordsBefore.includes(name),
        );
      }
    } catch (error) {
      failures.push(error.message);
    }
  }
  const result = {
    stage,
    command,
    arguments: arguments_,
    exitCode,
    signal,
    emittedBytes,
    omittedBytes,
    nativeRoots,
    acquisitionRecords,
    failures,
  };
  writeFileSync(
    stageResultPath(outputRoot, stage),
    `${JSON.stringify(result)}\n`,
    { flag: "wx" },
  );
  return result;
}

function childDirectories(root) {
  assertEvidencePath(root, root, "directory");
  const directory = opendirSync(root);
  const children = [];
  try {
    let entry;
    let observedEntries = 0;
    while ((entry = directory.readSync())) {
      if (++observedEntries > DIRECTORY_ENTRY_LIMIT) {
        throw new Error(
          `Evidence discovery limit: more than ${DIRECTORY_ENTRY_LIMIT} entries in ${root}`,
        );
      }
      // Include redirected entries for visible rejection at the read boundary.
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        children.push(entry.name);
      }
    }
  } finally {
    directory.closeSync();
  }
  return children.sort();
}

/** Enumerate producer-owned paths only, never recursive extension searches.
 * Optional partial records are navigation, never a native success oracle.
 */
function acquisitionRecordNames(root) {
  assertEvidencePath(root, root, "directory");
  const directory = opendirSync(root);
  const names = [];
  try {
    let entry;
    let observedEntries = 0;
    while ((entry = directory.readSync())) {
      if (++observedEntries > DIRECTORY_ENTRY_LIMIT) {
        throw new Error("Acquisition evidence discovery limit");
      }
      if (/^failure-[A-Za-z0-9_-]+\.json$/u.test(entry.name)) {
        names.push(entry.name);
      }
    }
  } finally {
    directory.closeSync();
  }
  return names.sort();
}

function discoverNativeRecords(temporaryRoot, failures, stages) {
  const records = [];
  const add = (root, name, required = false) =>
    records.push({ root, path: join(root, name), required });
  const invocationRoots = new Set(
    stages.flatMap((stage) => stage.nativeRoots ?? []),
  );
  for (const name of invocationRoots) {
    if (
      typeof name !== "string" ||
      name === "." ||
      name === ".." ||
      name !== parse(name).base ||
      /[\\/]/u.test(name)
    ) {
      failures.push("Invalid native evidence basename");
      continue;
    }
    const root = join(temporaryRoot, name);
    try {
      assertEvidencePath(temporaryRoot, root, "directory");
      const producerStage = stages.find((stage) =>
        stage.nativeRoots?.includes(name),
      );
      const isMainConformance = producerStage?.stage === "conformance";
      const hasSuccessfulProducer =
        isMainConformance && producerStage.exitCode === 0;
      if (name.startsWith("evaluation-conformance-")) {
        add(root, "commands.json", isMainConformance);
        add(root, "receipt.json", hasSuccessfulProducer);
        add(root, "bridge-transport-fixture.json", hasSuccessfulProducer);
        add(
          root,
          "skill-up-results/iteration-1/report.json",
          hasSuccessfulProducer,
        );
      } else if (name.startsWith("evaluation-workspace-")) {
        add(root, "projection-receipt.json", true);
        const carrierReceipt = join(root, "carrier-receipt.json");
        assertUnredirectedAncestors(carrierReceipt);
        const isCarrier = pathExists(carrierReceipt);
        if (!isCarrier) {
          add(root, "commands.json", isMainConformance);
          add(root, "receipt.json", hasSuccessfulProducer);
          add(
            root,
            "consumer-results/iteration-1/report.json",
            hasSuccessfulProducer,
          );
        }
        for (const file of [
          "reports/iteration-1/report.json",
          "reports/iteration-1/benchmark.json",
          "invocation.json",
          "completed-invocation.json",
          "process-host-observation.json",
          "process-host-observation.json.ready.json",
          "process-host-observation.json.closure.json",
        ]) {
          add(root, file);
        }
      } else if (name.startsWith("evaluation-installation-")) {
        add(root, "receipt.json", hasSuccessfulProducer);
        for (const skill of SKILLS) {
          for (const mode of ["explicit", "default", "full-depth"]) {
            add(
              root,
              `${skill}-${mode}/process.json`,
              hasSuccessfulProducer ||
                pathExists(join(root, `${skill}-${mode}`)),
            );
          }
        }
      } else if (name.startsWith("evaluation-process-matrix-")) {
        add(root, "receipt.json", hasSuccessfulProducer);
        for (const scenario of PROCESS_SCENARIOS) {
          for (const file of [
            "observation.json",
            "consumer.stdout.log",
            "consumer.stderr.log",
            "reports/iteration-1/report.json",
          ]) {
            add(
              root,
              `${scenario}/${file}`,
              file !== "reports/iteration-1/report.json" &&
                pathExists(join(root, scenario)),
            );
          }
        }
      } else if (name.startsWith("bridge-transport-fixture-")) {
        for (const file of [
          "receipt.json",
          "dispatch-equivalence.json",
          "git-controller-equivalence.json",
        ]) {
          add(root, file);
        }
      } else if (
        /^windows-job-(?:contract|startup|api|invalid|nested)-/u.test(name)
      ) {
        for (const file of [
          "host-result.json",
          "host-result.json.ready.json",
          "host-result.json.closure.json",
          "wrapper-result.json",
          "outer-result.json",
          "outer-result.json.ready.json",
          "outer-result.json.closure.json",
          "ready.json",
        ]) {
          add(root, file);
        }
      }
    } catch (error) {
      failures.push(error.message);
    }
  }
  return records;
}

function escapeSummary(text) {
  // HTML text nodes avoid Markdown/link/backtick interpretation entirely.
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Emit available raw records before any optional parse, and accumulate gaps.
 * Summary and raw log have independent bounds; neither authenticates evidence.
 */
export function reportEvidence({
  outputRoot,
  verificationKind,
  temporaryRoot,
  acquisitionRoot,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
  output = process.stdout,
}) {
  initializeOutputRoot(outputRoot);
  const failures = [];
  let stages = [];
  try {
    stages = loadStageResults(outputRoot, verificationKind);
  } catch (error) {
    failures.push(error.message);
  }
  const records = [];
  for (const stage of STAGES_BY_VERIFICATION_KIND[verificationKind] ?? []) {
    const result = stages.find((result) => result.stage === stage);
    if (result?.status === "not-started") {
      // A preceding failure legitimately skips later stages; a missing first
      // stage, or a gap before another started stage, is incomplete evidence.
      const precedingFailure = stages
        .slice(0, STAGES_BY_VERIFICATION_KIND[verificationKind].indexOf(stage))
        .some(
          (result) =>
            result.status !== "not-started" &&
            (result.exitCode !== 0 || result.failures.length > 0),
        );
      if (!precedingFailure) {
        failures.push(`Missing stage evidence: ${stage}`);
      }
      continue;
    }
    if (result) {
      failures.push(...result.failures);
      records.push({
        root: outputRoot,
        path: join(outputRoot, STAGE_RECORDS[stage]),
        required: true,
        alreadyStreamed: true,
      });
    }
  }
  if (verificationKind === "evaluation-conformance" && temporaryRoot) {
    try {
      records.push(...discoverNativeRecords(temporaryRoot, failures, stages));
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (
    verificationKind === "evaluation-conformance" &&
    acquisitionRoot &&
    stages.some((stage) => stage.acquisitionRecords?.length)
  ) {
    try {
      assertEvidencePath(acquisitionRoot, acquisitionRoot, "directory");
      for (const name of stages.find((stage) => stage.stage === "acquisition")
        ?.acquisitionRecords ?? []) {
        if (!/^failure-[A-Za-z0-9_-]+\.json$/u.test(name)) {
          throw new Error("Invalid acquisition evidence basename");
        }
        records.push({
          root: acquisitionRoot,
          path: join(acquisitionRoot, name),
          required: true,
        });
      }
    } catch (error) {
      failures.push(error.message);
    }
  }
  const protectedLog = createProtectedLog(output);
  let emittedBytes = stages.reduce(
    (sum, stage) => sum + (stage.emittedBytes ?? 0),
    0,
  );
  const identities = [];
  try {
    for (const record of records.slice(0, RECORD_LIMIT)) {
      try {
        assertUnredirectedAncestors(record.path);
        if (!pathExists(record.path)) {
          if (record.required) {
            failures.push(`Missing required evidence: ${record.path}`);
          }
          continue;
        }
        const remainingBytes = record.alreadyStreamed
          ? LOG_BUDGET_BYTES
          : stages.some((stage) => stage.status === "unreadable")
            ? 0
            : Math.max(0, LOG_BUDGET_BYTES - emittedBytes);
        const bytes = readEvidenceFile(
          record.root,
          record.path,
          remainingBytes,
        );
        const identity = {
          path: record.path,
          byteLength: bytes.length,
          sha256: sha256(bytes),
        };
        identities.push(identity);
        if (!record.alreadyStreamed) {
          const heading = Buffer.from(
            `\nEvidence ${JSON.stringify(identity)}\n`,
          );
          const renderedBytes = Buffer.from(bytes.toString("utf8"));
          if (
            emittedBytes + heading.length + renderedBytes.length >
            LOG_BUDGET_BYTES
          ) {
            throw new Error(
              `Evidence limit: ${record.path}; omitted ${bytes.length} bytes`,
            );
          }
          protectedLog.write(heading);
          protectedLog.write(renderedBytes);
          emittedBytes += heading.length + renderedBytes.length;
        }
        // Native report validation remains exclusively with its producer.
      } catch (error) {
        failures.push(error.message);
      }
    }
    if (records.length > RECORD_LIMIT) {
      failures.push(
        `Evidence record limit: omitted ${records.length - RECORD_LIMIT} records`,
      );
    }
  } finally {
    if (protectedLog.finish().hasCollision) {
      failures.push("Stored evidence contains a suspension token collision");
    }
  }
  const source = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const metadata = {
    testedSource: source.status === 0 ? source.stdout.trim() : "unavailable",
    workflow: process.env.GITHUB_WORKFLOW_REF ?? "local",
    workflowSource: process.env.GITHUB_WORKFLOW_SHA ?? "unavailable",
    event: process.env.GITHUB_EVENT_NAME ?? "local",
    revisionInput: process.env.VERIFICATION_REVISION ?? "none",
    run: process.env.GITHUB_RUN_ID ?? "local",
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? "local",
    job: process.env.GITHUB_JOB ?? "local",
    verificationKind,
    os: process.env.RUNNER_OS ?? process.platform,
    node: process.version,
    emittedBytes,
    emittedByteCountComplete: stages.every(
      (stage) => stage.status !== "unreadable",
    ),
    roots: {
      capture: outputRoot,
      temporary: temporaryRoot,
      acquisition: acquisitionRoot,
    },
  };
  for (const tool of verificationKind !== "committing-to-git"
    ? ["npm", "python"]
    : ["npm"]) {
    const [executable, arguments_] = commandInvocation(tool, ["--version"]);
    const observedVersion = spawnSync(executable, arguments_, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 4096,
    });
    metadata[tool] =
      observedVersion.status === 0
        ? observedVersion.stdout.trim()
        : "unavailable";
  }
  const stageSummaries = stages.map(
    ({
      nativeRoots: _nativeRoots,
      acquisitionRecords: _acquisitionRecords,
      ...outcome
    }) => outcome,
  );
  const recordSummaries = identities.map((identity) => {
    for (const [rootName, rootPath] of Object.entries(metadata.roots)) {
      if (!rootPath) {
        continue;
      }
      const path = relative(resolve(rootPath), identity.path);
      if (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`)) {
        return { ...identity, root: rootName, path };
      }
    }
    return identity;
  });
  const summary = `<h2>Verification evidence</h2>\n<pre>${escapeSummary(JSON.stringify({ metadata, stages: stageSummaries, failures }, null, 2))}</pre>\n<h3>Native record identities</h3>\n<pre>${escapeSummary(recordSummaries.map((identity) => JSON.stringify(identity)).join("\n"))}</pre>\n<p>Paths are relative to the named roots above. Digests are navigation identities, not authentication. Expected negative fixtures remain governed by native assertions. Synthetic consumer/closure evidence does not establish production qualification. Cancellation can prevent final collection; absent records are not completion proof.</p>\n`;
  if (Buffer.byteLength(summary) > SUMMARY_BUDGET_BYTES) {
    failures.push(
      `Summary evidence limit: ${Buffer.byteLength(summary)} bytes exceeds ${SUMMARY_BUDGET_BYTES}`,
    );
    if (summaryPath) {
      writeFileSync(
        summaryPath,
        `<h2>Verification evidence incomplete</h2><p>Summary exceeds 64 KiB. See protected logs; no archive fallback.</p>\n`,
      );
    }
  } else if (summaryPath) {
    writeFileSync(summaryPath, summary);
  }
  if (failures.length) {
    const failureLog = createProtectedLog(output);
    try {
      failureLog.write(Buffer.from(`${failures.join("\n")}\n`));
    } finally {
      failureLog.finish();
    }
  }
  return { failures, stages, identities, emittedBytes };
}

async function main(argv) {
  const operation = argv.shift();
  const options = {};
  while (argv.length && argv[0] !== "--") {
    const option = argv.shift();
    if (
      ![
        "--output-root",
        "--verification-kind",
        "--stage",
        "--temporary-root",
        "--acquisition-root",
      ].includes(option) ||
      !argv.length
    ) {
      throw new Error(`Unknown or incomplete option: ${option}`);
    }
    options[option] = argv.shift();
  }
  const outputRoot = resolve(options["--output-root"] ?? "");
  const verificationKind = options["--verification-kind"];
  if (
    !options["--output-root"] ||
    !STAGES_BY_VERIFICATION_KIND[verificationKind]
  ) {
    throw new Error(
      "Explicit output root and known verification kind required",
    );
  }
  if (operation === "capture") {
    if (argv.shift() !== "--") {
      throw new Error("Native command delimiter required");
    }
    const result = await captureCommand({
      outputRoot,
      verificationKind,
      stage: options["--stage"],
      command: argv.shift(),
      arguments_: argv,
      temporaryRoot: options["--temporary-root"],
      acquisitionRoot: options["--acquisition-root"],
    });
    if (result.signal) {
      process.kill(process.pid, result.signal);
    }
    process.exitCode = result.exitCode || (result.failures.length ? 1 : 0);
    if (result.exitCode === null) {
      process.exitCode = 1;
    }
  } else if (operation === "report") {
    const result = reportEvidence({
      outputRoot,
      verificationKind,
      temporaryRoot: options["--temporary-root"],
      acquisitionRoot: options["--acquisition-root"],
    });
    process.exitCode =
      result.failures.length ||
      result.stages.some(
        (stage) => stage.exitCode !== 0 && stage.status !== "not-started",
      )
        ? 1
        : 0;
  } else {
    throw new Error(`Unknown operation: ${operation}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    const protectedLog = createProtectedLog();
    try {
      protectedLog.write(Buffer.from(`${error.stack}\n`));
    } finally {
      protectedLog.finish();
    }
    process.exitCode = 1;
  }
}
