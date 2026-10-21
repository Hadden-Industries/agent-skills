import { SELECTOR_FIELDS } from "../selection/selectionVocabulary.js";
import {
  BULK_CHANGE_UNIT_THRESHOLD,
  MAXIMUM_CANONICAL_MESSAGE_BYTES,
} from "./changeSelection.js";

const SUPPORTED_SECTIONS = Object.freeze([
  "Rationale",
  "User Experience Changes",
  "File Changes",
]);

function selectionExample(field, value) {
  return { [field]: [value] };
}

/** Describe semantic input and fixed presentation limits without granting phase eligibility. */
export function semanticContentContract(mode) {
  if (!new Set(["detailed", "bulk"]).has(mode)) {
    throw new Error("Semantic content contract mode must be detailed or bulk.");
  }

  const common = {
    schemaVersion: 1,
    contentSchemaVersion: 3,
    completion: {
      field: "authoringState",
      value: "complete",
    },
    helperOwnedFields: ["schemaVersion", "evidenceGroups", "mode"],
    subject: {
      requiredFields: ["type", "scope", "description"],
      example: {
        type: "fix",
        scope: "parser",
        description: "Preserve parser behavior",
      },
    },
    sharedRationale: {
      requiredFields: ["selection", "reasons"],
      example: {
        selection: { all: true },
        reasons: ["Keep established callers stable"],
      },
    },
    userExperienceChanges: {
      itemType: "string",
      example: ["Existing callers retain the same observable behavior"],
    },
    selection: {
      allowedFields: [...SELECTOR_FIELDS],
      exclusiveFields: ["all", "remaining"],
      exactDestinationExample: selectionExample(
        "destinationPaths",
        "src/parser.js",
      ),
      destinationPrefixExample: selectionExample(
        "destinationPathPrefixes",
        "src/parser/",
      ),
      scopeFileContrast: {
        scopeFileField: "includePaths",
        semanticField: "destinationPaths",
      },
    },
    supportedSections: [...SUPPORTED_SECTIONS],
    presentation: {
      bulkChangeUnitThreshold: BULK_CHANGE_UNIT_THRESHOLD,
      maximumCanonicalBytes: MAXIMUM_CANONICAL_MESSAGE_BYTES,
      detailedProjection:
        "Minimal subject and inventory titles in UTF-8, excluding authored narrative and notes; final rendered bytes are checked separately.",
      modeIsHelperOwned: true,
    },
  };

  if (mode === "detailed") {
    return {
      ...common,
      mode: "detailed",
      detailed: {
        fileNote: {
          requiredFields: ["selection", "reasons"],
          example: {
            selection: { destinationPaths: ["src/parser.js"] },
            reasons: ["Keep parser-specific error handling explicit"],
          },
        },
      },
      bulk: null,
    };
  }

  return {
    ...common,
    mode: "bulk",
    detailed: null,
    bulk: {
      domain: {
        requiredFields: ["title", "selection", "reasons"],
        example: {
          title: "Parser and ingestion",
          selection: { destinationPathPrefixes: ["src/parser/"] },
          reasons: ["Keep parser inputs aligned with ingestion behavior"],
        },
      },
    },
  };
}
