import { parseArgs } from "node:util";
import { WorkflowDiagnosticError } from "../diagnostics/workflowDiagnosticError.js";
import {
  EVIDENCE_POLICIES,
  BASIS_KINDS,
  REUSE_BASIS_KINDS,
} from "../evidence/evidenceVocabulary.js";

const stringOption = { type: "string" };
const repeatedOption = { type: "string", multiple: true };
const booleanOption = { type: "boolean" };

/** Public helper options. Child arguments are deliberately outside this schema. */
export const COMMAND_ARGUMENTS = {
  "workflow preflight": {
    remote: {
      ...stringOption,
      description: "<name>  Required configured publication remote.",
    },
    destination: {
      ...stringOption,
      description:
        "<refs/heads/name>  Target; default: provider default branch.",
    },
    "source-branch": {
      ...stringOption,
      description: "<name>  Proposed PR branch; default: not selected.",
    },
    "require-personal-signature": {
      ...booleanOption,
      description:
        "Require original signed commits in target ancestry; default: false.",
    },
  },
  "workflow prepare": {
    "message-format": {
      ...stringOption,
      description:
        "<detailed>  Prepare structured detailed authoring immediately; evidence requirements remain independent.",
    },
    mode: {
      ...stringOption,
      description:
        "<actual|draft>  Required. Actual may install the index; draft does not.",
    },
    scope: {
      ...stringOption,
      description:
        "<staged|full|paths>  Required. Select staged, all, or literal path changes.",
    },
    evidence: {
      ...stringOption,
      description: `<${EVIDENCE_POLICIES.join("|")}>  Uniform evidence policy; pair with --basis.`,
    },
    basis: {
      ...stringOption,
      description: `<kind>  Uniform provenance: ${BASIS_KINDS.join(", ")}.\n    Reuse accepts ${REUSE_BASIS_KINDS.join(", ")}.`,
    },
    "evidence-plan": {
      ...stringOption,
      description:
        "<file>  JSON schemaVersion 1 groups; alternative to evidence/basis.",
    },
    "scope-file": {
      ...stringOption,
      description:
        "<file>  JSON schemaVersion 2 selectors instead of inline selectors.\n    Selectors require scope paths, at least one inclusion, and / separators.\n    Include both sides of renames. Full and staged accept no selectors.",
    },
    path: {
      ...repeatedOption,
      description:
        "<path>  Repeatable exact repository-relative path; no globs.",
    },
    "path-prefix": {
      ...repeatedOption,
      description:
        "<prefix/>  Repeatable literal directory prefix ending in /.",
    },
    "exclude-path": {
      ...repeatedOption,
      description: "<path>  Repeatable exact exclusion within included scope.",
    },
    "exclude-path-prefix": {
      ...repeatedOption,
      description: "<prefix/>  Repeatable directory exclusion within scope.",
    },
    "allowed-type": {
      ...repeatedOption,
      description:
        "<type>  Repeatable unique lowercase commit type (maximum 64).\n    Tokens match [a-z][a-z0-9-]{0,31}; default: no supplied type restriction.",
    },
    verification: {
      ...stringOption,
      description:
        "<required|advisory|skipped>  Signature policy; default: required.",
    },
  },
  "workflow resume": {},
  "workflow extend": {
    reason: {
      ...stringOption,
      description:
        "<evidence-uncertainty|semantic-structure-required>  Required.\n    Evidence uncertainty reads the fixed evidence-plan-input.json; semantic\n    structure retains evidence and supplies content.json for message finalize.",
    },
  },
  "workflow review-next": {
    cursor: {
      ...stringOption,
      description:
        "<opaque-cursor>  Returned nextCursor; default: cursorless delivery.\n    Start cursorless, then use reviewProgress.nextCursor while reviewRequired.",
    },
  },
  "workflow promote": {},
  "message check": {},
  "message finalize": {},
  "workflow check": {
    label: {
      ...stringOption,
      description: "<description>  Check label; default: Repository check.",
    },
    "working-directory": {
      ...stringOption,
      description: "<directory>  Repository-relative directory; default: .",
    },
    "timeout-ms": {
      ...stringOption,
      description:
        "<milliseconds>  Integer 1..86400000; default: no helper timeout.",
    },
    "retry-after-attempt": {
      ...stringOption,
      description: "<receipt-id>  Bind a recovered check retry; default: none.",
    },
  },
  "workflow check-detail": {
    receipt: {
      ...stringOption,
      description: "<receipt-id>  Required helper-owned check receipt.",
    },
    stream: {
      ...stringOption,
      description: "<stdout|stderr>  Required retained output stream.",
    },
    segment: {
      ...stringOption,
      description: "<head|tail>  Required retained output segment.",
    },
    offset: {
      ...stringOption,
      description: "<bytes>  Nonnegative integer byte offset; default: 0.",
    },
  },
  "workflow commit": {
    message: {
      ...stringOption,
      description:
        "<subject>  Exact transport-safe subject without LF; the helper\n    appends LF. Default: checked/finalized revision. Not a body or message file.",
    },
    verification: {
      ...stringOption,
      description: "<required|advisory|skipped>  Default: recorded policy.",
    },
    "acknowledge-failed-check": {
      ...repeatedOption,
      description:
        "<receipt-id>  Repeatable explicit acknowledgement\n    of each non-passing receipt; default: none. Requires user authorization.",
    },
    "retain-review-artifacts": {
      ...booleanOption,
      description: "Boolean switch; default: false.",
    },
    "retain-process-logs": {
      ...booleanOption,
      description:
        "Boolean switch; default: false.\n    Retain process logs in text mode; JSON mode always retains them during automatic compaction.",
    },
  },
  "workflow verify": {
    verification: {
      ...stringOption,
      description:
        "<required|advisory|skipped>  Default: recorded policy.\n    Required blocks publication on failure; advisory reports without blocking;\n    skipped records that signature verification was not performed.",
    },
  },
  "workflow report-detail": {
    section: {
      ...stringOption,
      description:
        "<workspace|report|diagnostics>  Default: workspace. Report and diagnostics read retained evidence without a new observation.",
    },
    cursor: {
      ...stringOption,
      description:
        "<cursor>  Opaque returned page cursor; default: cursorless replay.",
    },
    refresh: {
      ...booleanOption,
      description:
        "Boolean switch; default: false. Start a new workspace observation.\n    Cursor and refresh are mutually exclusive.",
    },
  },
  "workflow publish": {
    remote: {
      ...stringOption,
      description: "<name>  Required configured Git remote name, not a URL.",
    },
    destination: {
      ...stringOption,
      description: "<refs/heads/name>  Required full destination branch ref.",
    },
    "retry-after-attempt": {
      ...stringOption,
      description:
        "<attempt-id>  Exact UUID of a resolved uncertain attempt;\n    default: none. Required only on the recovery retry route, never for a\n    reported known rejection. Retargeting requires separate push authorization.",
    },
  },
  "workflow recover": {
    resolution: {
      ...stringOption,
      description:
        "<confirmed-no-live-child>  Default: no liveness assertion.\n    Supply only after explicit confirmation that the child ended or host restarted.",
    },
  },
  "workflow cleanup": {
    purge: {
      ...booleanOption,
      description:
        "Boolean switch; default: false (compact safe artifacts).\n    Purge removes the eligible terminal transaction workspace completely.",
    },
  },
};

/** Supply the same option definitions to native parsing and public help. */
export function commandOptions(command) {
  return {
    ...COMMAND_ARGUMENTS[command],
    ...(["workflow prepare", "workflow preflight"].includes(command)
      ? {}
      : {
          transaction: {
            ...stringOption,
            description:
              "<transaction.json>  Required opaque helper-returned path.",
          },
        }),
    format: {
      ...stringOption,
      description: "<json|text>  Output contract; default: json.",
    },
    "result-detail": {
      ...stringOption,
      description:
        "<full|summary>  Default: full. Summary omits duplicate successful report detail; exact display and recovery stay intact.",
    },
  };
}

/** Parse helper arguments once; operands after -- belong exclusively to the child. */
export function parseCommandArguments(command, argv) {
  const options = commandOptions(command);
  const recovery = {
    kind: "correct-input",
    automatic: false,
    requiredInputs: ["valid helper arguments"],
    commands: [{ arguments: [...command.split(" "), "--help"] }],
  };
  const separator = argv.indexOf("--");
  const acceptsChild = command === "workflow check";
  if (!acceptsChild && separator >= 0) {
    throw new WorkflowDiagnosticError(
      "INVALID_ARGUMENT",
      `${command} does not accept a child-command separator.`,
      { recovery },
    );
  }
  const args = acceptsChild && separator >= 0 ? argv.slice(0, separator) : argv;
  let parsed;
  try {
    parsed = parseArgs({
      args,
      options,
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
  } catch (cause) {
    throw new WorkflowDiagnosticError(
      cause.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION"
        ? "UNKNOWN_ARGUMENT"
        : "INVALID_ARGUMENT",
      `Invalid arguments for ${command}. Follow the command's option definitions and supply every required value.`,
      { cause, recovery, details: { parserCode: cause.code } },
    );
  }
  const seen = new Set();
  if (
    parsed.values["result-detail"] !== undefined &&
    !["full", "summary"].includes(parsed.values["result-detail"])
  ) {
    throw new WorkflowDiagnosticError(
      "INVALID_RESULT_DETAIL",
      "--result-detail must be full or summary.",
      { recovery },
    );
  }
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name) && !options[token.name].multiple) {
      throw new WorkflowDiagnosticError(
        "DUPLICATE_ARGUMENT",
        `--${token.name} may be supplied only once.`,
        { recovery },
      );
    }
    if (token.value === "") {
      throw new WorkflowDiagnosticError(
        "INVALID_ARGUMENT",
        `--${token.name} requires a non-empty value.`,
        { recovery },
      );
    }
    seen.add(token.name);
  }
  return {
    values: new Map(Object.entries(parsed.values)),
    childArguments:
      acceptsChild && separator >= 0 ? argv.slice(separator + 1) : [],
  };
}
