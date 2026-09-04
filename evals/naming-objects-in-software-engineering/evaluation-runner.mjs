import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
const REPO_ROOT = resolve(import.meta.dirname, "../..");
const SUITE_DIR = resolve(import.meta.dirname);
const RESULTS_DIR = join(SUITE_DIR, "results");

const EVALS_PATH = join(SUITE_DIR, "evals.json");

const AGY_EXECUTABLE =
  "C:/Users/maksy/AppData/Local/Microsoft/WinGet/Packages/Google.AntigravityCLI_Microsoft.Winget.Source_8wekyb3d8bbwe/agy.exe";

import {
  captureWorkingTreeSkillBundle,
  renderSkillBundle,
} from "../../scripts/evaluation/skill-bundle.js";

// Load evals and skill bundle
const evalsData = JSON.parse(readFileSync(EVALS_PATH, "utf8"));
const skillBundle = captureWorkingTreeSkillBundle({
  repositoryRoot: REPO_ROOT,
  skillName: "naming-objects-in-software-engineering",
});
const renderedSkillBundle = renderSkillBundle(skillBundle);

const MODEL_BRANCHES = {
  judge: {
    id: "gemini-3.1-pro-high",
    displayName: "Gemini 3.1 Pro (High)",
    role: "High-Powered (The Judge)",
  },
  high: {
    id: "gemini-3.1-pro-high",
    displayName: "Gemini 3.1 Pro (High)",
    role: "High-Powered (The Judge)",
  },
  default: {
    id: "gemini-3.8-flash-medium",
    displayName: "Gemini 3.8 Flash (Medium)",
    role: "Default (The Worker)",
  },
  worker: {
    id: "gemini-3.8-flash-medium",
    displayName: "Gemini 3.8 Flash (Medium)",
    role: "Default (The Worker)",
  },
  standard: {
    id: "gemini-3.8-flash-medium",
    displayName: "Gemini 3.8 Flash (Medium)",
    role: "Default (The Worker)",
  },
  low: {
    id: "gemini-3.6-flash-low",
    displayName: "Gemini 3.6 Flash (Low)",
    role: "Low-Powered (The Stress Tester)",
  },
  stress: {
    id: "gemini-3.6-flash-low",
    displayName: "Gemini 3.6 Flash (Low)",
    role: "Low-Powered (The Stress Tester)",
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  let campaign = "calibration";
  let branch = "default";
  let model = MODEL_BRANCHES.default.id;
  let caseId = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--campaign" && args[i + 1]) {
      campaign = args[++i];
    } else if (args[i] === "--branch" && args[i + 1]) {
      branch = args[++i].toLowerCase();
      if (MODEL_BRANCHES[branch]) {
        model = MODEL_BRANCHES[branch].id;
      }
    } else if (args[i] === "--model" && args[i + 1]) {
      model = args[++i];
      if (model === "gemini-3.1-pro-high") branch = "judge";
      else if (model === "gemini-3.8-flash-medium") branch = "default";
      else if (model === "gemini-3.6-flash-low") branch = "stress";
      else branch = "custom";
    } else if (args[i] === "--case" && args[i + 1]) {
      caseId = parseInt(args[++i], 10);
    }
  }
  return { campaign, model, caseId, branch };
}

function buildPrompt(arm, evalCase) {
  if (arm === "no-skill") {
    return `You are an expert software engineer. Answer the following naming question directly, precisely, and concisely.\n\n${evalCase.prompt}`;
  }
  return `You are an expert software engineer following the "naming-objects-in-software-engineering" skill.\n\n${renderedSkillBundle}\n\n[Task]\n${evalCase.prompt}`;
}

async function runModel(prompt, model) {
  const commandArgs = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--model",
    model,
    "--disable-slash-commands",
  ];

  const startTime = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(AGY_EXECUTABLE, commandArgs, {
      cwd: REPO_ROOT,
      windowsHide: true,
    });

    let stdoutData = "";
    let stderrData = "";
    let finalResult = null;

    child.stdout.on("data", (chunk) => {
      stdoutData += chunk.toString("utf8");
      const lines = stdoutData.split("\n");
      stdoutData = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.event === "result" && parsed.result) {
            finalResult = parsed.result;
          }
        } catch {
          // ignore partial parse
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrData += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      if (finalResult && finalResult.status === "SUCCESS") {
        resolvePromise({
          success: true,
          response: finalResult.response ?? "",
          usage: finalResult.usage ?? {},
          durationMs,
          error: null,
        });
      } else {
        const err = finalResult?.error || stderrData || `Exit code ${code}`;
        resolvePromise({
          success: false,
          response: "",
          usage: {},
          durationMs,
          error: err,
        });
      }
    });

    child.on("error", (err) => {
      const durationMs = Date.now() - startTime;
      resolvePromise({
        success: false,
        response: "",
        usage: {},
        durationMs,
        error: err.message,
      });
    });

    const frame =
      JSON.stringify({
        event: "user",
        message: {
          content: [{ type: "text", text: prompt }],
        },
      }) + "\n";
    child.stdin.write(frame, () => {
      child.stdin.end();
    });
  });
}

function gradeExpectations(response, expectations) {
  const results = [];
  const text = response.toLowerCase();

  for (const exp of expectations) {
    let passed = false;
    const expLower = exp.toLowerCase();

    // Heuristic checking of key semantic requirements in expectation
    if (expLower.includes("process") && expLower.includes("data") && expLower.includes("vague")) {
      passed = (text.includes("process") && text.includes("data")) &&
               (text.includes("vague") || text.includes("forbidden") || text.includes("defect") || text.includes("ambiguous") || text.includes("generic"));
    } else if (expLower.includes("order") && expLower.includes("entity")) {
      passed = text.includes("order") || text.includes("checkout");
    } else if (expLower.includes("snake_case")) {
      passed = text.includes("_") && !text.includes("camelcase for python");
    } else if (expLower.includes("input entity") && expLower.includes("output entity")) {
      passed = (text.includes("payload") || text.includes("input") || text.includes("raw")) &&
               (text.includes("record") || text.includes("output"));
    } else if (expLower.includes("generic alternatives")) {
      passed = !text.includes("handle_data") && !text.includes("do_processing") && !text.includes("run_order");
    } else if (expLower.includes("get") && expLower.includes("cached")) {
      passed = text.includes("getcustomerprofile") || (text.includes("get") && text.includes("cache"));
    } else if (expLower.includes("fetch") && expLower.includes("remote")) {
      passed = text.includes("fetchpaymentmethods") || (text.includes("fetch") && text.includes("http"));
    } else if (expLower.includes("calculate") || expLower.includes("derive")) {
      passed = text.includes("calculatediscounttier") || text.includes("derivediscounttier") || text.includes("calculate") || text.includes("derive");
    } else if (expLower.includes("short, lowercase, single-word package name")) {
      passed = text.includes("package account") || text.includes("'account'") || text.includes("`account`");
    } else if (expLower.includes("without the 'get' prefix") || expLower.includes("getter name")) {
      passed = (text.includes("account(") || text.includes("account (") || text.includes("proposed name: account") || text.includes("recommended name: account") || text.includes("proposed name: `account`") || text.includes("recommended name: `account`") || text.includes("findaccount")) &&
               !text.includes("proposed name: getaccount") &&
               !text.includes("recommended name: getaccount");
    } else if (expLower.includes("initialism") || expLower.includes("url") && expLower.includes("id")) {
      passed = (text.includes("id") || text.includes("url")) && (text.includes("customerurl") || text.includes("accountid") || text.includes("http") || text.includes("uppercase"));
    } else if (expLower.includes("stutter")) {
      passed = !text.includes("account.getaccount");
    } else if (expLower.includes("singular snake_case") || expLower.includes("table representing row entities")) {
      passed = text.includes("customer_account") || text.includes("customer") && !text.includes("customers_table");
    } else if (expLower.includes("snake_case for the database view")) {
      passed = text.includes("active_customer") || text.includes("active_customers");
    } else if (expLower.includes("is_email_verified") || (expLower.includes("boolean column") && expLower.includes("predicate"))) {
      passed = text.includes("is_email_verified") || text.includes("is_verified") || text.includes("email_verified");
    } else if (expLower.includes("created_at_epoch_ms") || (expLower.includes("timestamp column") && expLower.includes("unit"))) {
      passed = text.includes("created_at_epoch_ms") || (text.includes("created_at") && text.includes("ms"));
    } else if (expLower.includes("does not recommend customer_id as the table")) {
      passed = !text.includes("table named customer_id");
    } else if (expLower.includes("kebab-case with .py")) {
      passed = text.includes(".py") && (text.includes("backfill-") || text.includes("backfill_transactions.py") || text.includes("kebab"));
    } else if (expLower.includes("importable library module using snake_case")) {
      passed = text.includes(".py") && (text.includes("transaction_") || text.includes("snake_case") || text.includes("queries.py"));
    } else if (expLower.includes("standalone executable python scripts follow kebab-case")) {
      passed = (text.includes("standalone") || text.includes("script")) && (text.includes("kebab") || text.includes("hyphen") || text.includes("snake"));
    } else if (expLower.includes("does not use camelcase")) {
      passed = !text.includes("backfilltransactions.py") && !text.includes("transactionqueries.py");
    } else if (expLower.includes("trait in uppercamelcase")) {
      passed = text.includes("serializejson") || text.includes("tojsonbytes") || text.includes("serialize") || text.includes("camelcase");
    } else if (expLower.includes("struct in uppercamelcase")) {
      passed = text.includes("httpheader") || text.includes("header") || text.includes("requestheader");
    } else if (expLower.includes("conversion function in snake_case")) {
      passed = text.includes("socket_addr_to_connection_string") || text.includes("to_connection_string") || text.includes("snake_case");
    } else if (expLower.includes("rust api guidelines")) {
      passed = text.includes("rust") && (text.includes("guideline") || text.includes("convention") || text.includes("idiom") || text.includes("standard"));
    } else if (expLower.includes("without an 'i' prefix")) {
      passed = text.includes("paymenttransactionpayload") || (text.includes("payload") && !text.includes("ipaymenttransactionpayload"));
    } else if (expLower.includes("snake_case.ts")) {
      passed = text.includes("payment_transaction_payload.ts") || (text.includes(".ts") && text.includes("_"));
    } else if (expLower.includes("issettled or hassettled")) {
      passed = text.includes("issettled") || text.includes("hassettled") || (text.includes("settled") && text.includes("boolean"));
    } else if (expLower.includes("timeoutms")) {
      passed = text.includes("timeoutms") || text.includes("timeout_ms") || (text.includes("timeout") && text.includes("ms"));
    } else if (expLower.includes("negative boolean anti-patterns")) {
      passed = (text.includes("not_empty") || text.includes("disable_cache")) && (text.includes("negative") || text.includes("anti-pattern") || text.includes("defect") || text.includes("confus"));
    } else if (expLower.includes("positive assertive boolean")) {
      passed = text.includes("is_populated") || text.includes("has_items") || text.includes("enable_cache") || text.includes("use_cache") || text.includes("positive");
    } else if (expLower.includes("valid' as underspecified")) {
      passed = text.includes("valid") && (text.includes("vague") || text.includes("underspecified") || text.includes("ambiguous") || text.includes("is_authorized") || text.includes("is_valid"));
    } else if (expLower.includes("auxiliary verbs")) {
      passed = text.includes("is") || text.includes("has") || text.includes("can") || text.includes("enable");
    } else if (expLower.includes("missing unit qualifiers in 'timeout'")) {
      passed = (text.includes("timeout") && text.includes("unit")) || text.includes("seconds") || text.includes("milliseconds");
    } else if (expLower.includes("explicit unit suffixes")) {
      passed = text.includes("timeout_seconds") || text.includes("timeout_ms") || text.includes("max_size_bytes") || text.includes("bytes");
    } else if (expLower.includes("redundant type encoding ('list')")) {
      passed = text.includes("list") && (text.includes("redundant") || text.includes("type") || text.includes("encoding") || text.includes("hungarian"));
    } else if (expLower.includes("plural noun encoding")) {
      passed = text.includes("user_ids") || text.includes("users") || text.includes("plural");
    } else if (expLower.includes("policy precedence ladder")) {
      passed = text.includes("precedence") || text.includes("hierarchy") || text.includes("ladder") || (text.includes("language") && text.includes("override"));
    } else if (expLower.includes("hyphens in python module names cause syntax errors")) {
      passed = (text.includes("syntax error") || text.includes("invalid syntax") || text.includes("cannot import") || text.includes("hyphen") || text.includes("minus"));
    } else if (expLower.includes("importable module must use snake_case")) {
      passed = text.includes("fast_parser.py") || (text.includes("snake_case") && text.includes("fast_parser"));
    } else if (expLower.includes("syntax validity is non-negotiable")) {
      passed = text.includes("validity") || text.includes("syntax") || text.includes("runtime") || text.includes("non-negotiable");
    } else if (expLower.includes("externally observable contract")) {
      passed = (text.includes("external") || text.includes("contract") || text.includes("public") || text.includes("breaking")) && (text.includes("cannot") || text.includes("deprecat") || text.includes("compatib"));
    } else if (expLower.includes("compatibility mapping/alias")) {
      passed = text.includes("mapping") || text.includes("alias") || text.includes("adapter") || text.includes("backward");
    } else if (expLower.includes("versioned deprecation or migration")) {
      passed = text.includes("deprecat") || text.includes("version") || text.includes("migration") || text.includes("two-step") || text.includes("phase");
    } else if (expLower.includes("warns against breaking external callers")) {
      passed = text.includes("break") || text.includes("caller") || text.includes("client") || text.includes("synchronous");
    } else if (expLower.includes("structured review format")) {
      passed = text.includes("[semantic") || text.includes("[lexical") || text.includes("[authority") || text.includes("[compatibility") || text.includes("current:") || text.includes("proposed:");
    } else if (expLower.includes("vague tokens in 'handle_user_data'")) {
      passed = (text.includes("handle") || text.includes("data") || text.includes("user_info")) && (text.includes("vague") || text.includes("generic") || text.includes("defect"));
    } else if (expLower.includes("check_not_empty' as a negative boolean")) {
      passed = text.includes("check_not_empty") && (text.includes("negative") || text.includes("anti-pattern") || text.includes("boolean"));
    } else if (expLower.includes("fetch_cached_profile' for an in-memory")) {
      passed = text.includes("fetch_cached_profile") && (text.includes("get") || text.includes("verb") || text.includes("cache") || text.includes("fetch"));
    } else if (expLower.includes("proposes semantically precise replacements")) {
      passed = text.includes("proposed:") || text.includes("recommend") || text.includes("replace");
    } else if (expLower.includes("lowercamelcase.js") && expLower.includes("domain module")) {
      passed = text.includes("invoiceparser.js") || (text.includes("lowercamelcase") && text.includes(".js"));
    } else if (expLower.includes("kebab-case.mjs") && expLower.includes("standalone")) {
      passed = text.includes("rebuild-index.mjs") || (text.includes("kebab-case") && (text.includes(".mjs") || text.includes(".js")));
    } else if (expLower.includes("faceted or unit test extension")) {
      passed = text.includes(".unit.test.js") || text.includes(".test.js");
    } else if (expLower.includes("architectural seam test extension")) {
      passed = text.includes(".architecture.test.js") || text.includes("architecture.test");
    } else if (expLower.includes("contrasts importable esm modules with standalone")) {
      passed = (text.includes("standalone") || text.includes("executable") || text.includes("script")) && (text.includes("importable") || text.includes("module"));
    } else if (expLower.includes("react component using pascalcase")) {
      passed = (text.includes("customerinvoiceform") || text.includes("invoiceform")) && (text.includes("pascalcase") || text.includes(".jsx") || text.includes(".tsx"));
    } else if (expLower.includes("custom hook starting with 'use'")) {
      passed = text.includes("usecustomeraccount") || (text.includes("use") && text.includes("hook"));
    } else if (expLower.includes("callback prop starting with 'on'")) {
      passed = text.includes("oninvoicesubmit") || (text.includes("on") && text.includes("prop"));
    } else if (expLower.includes("internal handler function starting with 'handle'")) {
      passed = text.includes("handleinvoicesubmit") || (text.includes("handle") && text.includes("handler"));
    } else if (expLower.includes("callback prop contracts (onevent)")) {
      passed = (text.includes("onevent") || text.includes("on")) && (text.includes("handleevent") || text.includes("handle"));
    } else if (expLower.includes("css custom property starting with '--'")) {
      passed = text.includes("--color-primary") || (text.includes("--") && text.includes("kebab-case"));
    } else if (expLower.includes("applies bem syntax (block__element--modifier)")) {
      passed = (text.includes("invoice-card") || text.includes("block")) && (text.includes("__") || text.includes("element")) && (text.includes("--") || text.includes("modifier"));
    } else if (expLower.includes("html data attribute starting with 'data-'")) {
      passed = text.includes("data-customer-id") || (text.includes("data-") && text.includes("kebab-case"));
    } else if (expLower.includes("cites authoritative standards (w3c")) {
      passed = (text.includes("w3c") || text.includes("specification") || text.includes("spec") || text.includes("standard")) && (text.includes("bem") || text.includes("html5") || text.includes("custom properties"));
    } else if (expLower.includes("rejects 'invoicenotfoundexception'")) {
      passed = (text.includes("invoicenotfounderror") || text.includes("error")) && (text.includes("pep 8") || text.includes("pep8") || text.includes("exception"));
    } else if (expLower.includes("replaces 'type_t' with an uppercamelcase typevar")) {
      passed = (text.includes("typevar") || text.includes("pep 484") || text.includes("pep 695")) && (text.includes("t") || text.includes("keyt") || text.includes("invoicet") || text.includes("uppercamelcase"));
    } else if (expLower.includes("iter_* or stream_* prefix")) {
      passed = text.includes("iter_invoices") || text.includes("iter_") || text.includes("stream_invoices") || text.includes("stream_");
    } else if (expLower.includes("replaces 'invoice_generator' with a plural noun")) {
      passed = (text.includes("invoices") || text.includes("invoice_list")) && (text.includes("collection") || text.includes("materialized") || text.includes("list"));
    } else if (expLower.includes("semantic difference between lazy generators and materialized collections")) {
      passed = (text.includes("lazy") || text.includes("generator") || text.includes("yield")) && (text.includes("materialized") || text.includes("in-memory") || text.includes("collection") || text.includes("list"));
    } else if (expLower.includes("flags 'check' as an unapproved powershell verb")) {
      passed = (text.includes("check") || text.includes("test-virtualmachine")) && (text.includes("unapproved") || text.includes("approved") || text.includes("test"));
    } else if (expLower.includes("flags 'create' as an unapproved powershell verb")) {
      passed = (text.includes("create") || text.includes("new-virtualmachine")) && (text.includes("unapproved") || text.includes("approved") || text.includes("new"));
    } else if (expLower.includes("replaces '-timeout' with a pascalcase parameter encoding explicit units")) {
      passed = text.includes("timeoutseconds") || text.includes("timeoutmilliseconds") || (text.includes("timeout") && (text.includes("unit") || text.includes("second") || text.includes("ms")));
    } else if (expLower.includes("flags '-nocache' as a negative switch anti-pattern")) {
      passed = (text.includes("nocache") || text.includes("no-cache") || text.includes("negative switch")) && (text.includes("affirmative") || text.includes("anti-pattern") || text.includes("skipcache") || text.includes("bypass") || text.includes("force") || text.includes("positive"));
    } else if (expLower.includes("cites microsoft approved verbs for powershell commands")) {
      passed = (text.includes("approved verb") || text.includes("verb-noun") || text.includes("microsoft") || text.includes("cmdlet") || text.includes("powershell")) && (text.includes("singular") || text.includes("pascalcase") || text.includes("guideline") || text.includes("approved"));
    } else if (expLower.includes("un-namespaced stylesheet functions ('format-date') are illegal in xslt")) {
      passed = (text.includes("namespace") || text.includes("prefix") || text.includes("qname")) && (text.includes("format-date") || text.includes("illegal") || text.includes("reserved") || text.includes("f:") || text.includes("ext:") || text.includes("my:"));
    } else if (expLower.includes("recommends kebab-case or lowercamelcase for named templates")) {
      passed = (text.includes("kebab-case") || text.includes("lowercamelcase") || text.includes("render-customer") || text.includes("rendercustomer") || text.includes("format-billing")) && (text.includes("template") || text.includes("pascalcase"));
    } else if (expLower.includes("flags 'preview_card' in template mode as non-idiomatic")) {
      passed = (text.includes("preview_card") || text.includes("preview-card") || text.includes("upper_snake")) && (text.includes("kebab-case") || text.includes("lowercamelcase") || text.includes("mode") || text.includes("idiomatic"));
    } else if (expLower.includes("recommends kebab-case or lowercamelcase for stylesheet parameters")) {
      passed = (text.includes("page-size") || text.includes("pagesize") || text.includes("page_size")) && (text.includes("kebab-case") || text.includes("lowercamelcase") || text.includes("param") || text.includes("snake_case"));
    } else if (expLower.includes("cites w3c xslt recommendations and xml namespaces")) {
      passed = (text.includes("w3c") || text.includes("xslt") || text.includes("xml namespace") || text.includes("recommendation") || text.includes("standard") || text.includes("spec"));
    } else {
      // General semantic presence: check if key nouns from expectation are in response
      const words = expLower.replace(/[^a-z0-9_ ]/g, " ").split(/\s+/).filter(w => w.length > 3 && !["this", "that", "with", "from", "does", "have", "into"].includes(w));
      const matchCount = words.filter(w => text.includes(w)).length;
      passed = matchCount >= Math.min(2, words.length);
    }

    results.push({ expectation: exp, passed });
  }

  const passedCount = results.filter(r => r.passed).length;
  return {
    results,
    passedCount,
    totalCount: expectations.length,
    score: passedCount / expectations.length,
  };
}

async function runTriggerEvaluation(model, branch, branchInfo, timestamp, runOutputDir) {
  const TRIGGERS_PATH = join(SUITE_DIR, "trigger-evals.json");
  const triggers = JSON.parse(readFileSync(TRIGGERS_PATH, "utf8"));
  console.log(`Loaded ${triggers.length} trigger queries from trigger-evals.json.\n`);

  const results = [];
  let passedCount = 0;

  for (let i = 0; i < triggers.length; i++) {
    const item = triggers[i];
    const prompt = `You are an intelligent routing agent. Given a user query, determine which skill (if any) should be activated from the available skills list.

Available Skills:
- committing-to-git: Drafts or revises commit messages for current workspace changes, guides creation of a signed commit from an approved staged snapshot, reports whether the result matches, and optionally pushes that exact commit.
- defining-concepts: Engineers source-grounded concepts and definitions, including definition, revision, audit, comparison, mapping, formalization, multilingual equivalence, and epistemic-governance work.
- naming-objects-in-software-engineering: Create, assess, and refactor semantically precise, ecosystem-conformant names for programming and data artefacts. Use whenever naming or renaming files, directories, packages, modules, types, functions, methods, parameters, arguments, variables, fields, properties, constants, APIs, CLI commands/options, environment variables, or database objects; and during code review when naming quality, consistency, ambiguity, or terminology is relevant. Enforces conceptual discrimination before casing and separators.
- reading-epubs: Inspect and extract text from EPUB ebooks.

User Query:
"${item.query}"

Respond with ONLY the name of the skill that should be activated, or NONE if no available skill applies.`;

    process.stdout.write(`  [Trigger ${String(i + 1).padStart(2)}/${triggers.length}] Expected: ${item.should_trigger ? "TRIGGER" : "PASS   "} ... `);
    const execution = await runModel(prompt, model);
    if (!execution.success) {
      console.log(`FAILED (${execution.error})`);
      results.push({ ...item, success: false, error: execution.error });
      continue;
    }

    const respText = execution.response.trim().toLowerCase();
    const triggered = respText.includes("naming-objects-in-software-engineering");
    const passed = triggered === item.should_trigger;
    if (passed) passedCount++;

    console.log(`${passed ? "PASS" : "FAIL"} (Model: ${execution.response.trim().slice(0, 40)}, ${execution.durationMs}ms)`);
    results.push({
      query: item.query,
      should_trigger: item.should_trigger,
      triggered,
      passed,
      modelSelection: execution.response.trim(),
      durationMs: execution.durationMs,
    });
  }

  const passRate = `${passedCount}/${triggers.length} (${Math.round((passedCount / triggers.length) * 100)}%)`;
  console.log(`\n=== Trigger Evaluation Summary ===`);
  console.log(`Accuracy: ${passRate}`);

  const summaryPath = join(runOutputDir, "trigger-results.json");
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        timestamp,
        branch,
        role: branchInfo?.role ?? "Custom",
        model,
        modelDisplayName: branchInfo?.displayName ?? model,
        accuracy: passRate,
        results,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  console.log(`Trigger evidence saved to: ${summaryPath}\n`);
}

async function main() {
  const { campaign, model, caseId, branch } = parseArgs();
  const branchInfo = MODEL_BRANCHES[branch];
  console.log(`=== Running NOISE Evaluation Runner ===`);
  console.log(`Campaign: ${campaign}`);
  console.log(`Branch: ${branch} (${branchInfo?.displayName ?? "Custom"})`);
  if (branchInfo?.role) {
    console.log(`Role / Tier: ${branchInfo.role}`);
  }
  console.log(`Model: ${model}`);
  console.log(`Provider: Google Antigravity CLI`);
  console.log(`Repetitions: 1 (no repetitions)\n`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runOutputDir = join(RESULTS_DIR, timestamp);
  mkdirSync(runOutputDir, { recursive: true });

  if (campaign === "triggers") {
    await runTriggerEvaluation(model, branch, branchInfo, timestamp, runOutputDir);
    return;
  }

  let targetCases = evalsData.evals;
  if (caseId !== null) {
    targetCases = targetCases.filter(c => c.id === caseId);
  } else if (campaign === "calibration") {
    targetCases = targetCases.filter(c => evalsData.calibration_case_ids.includes(c.id));
  }

  console.log(`Selected ${targetCases.length} cases for evaluation.`);

  const arms = ["no-skill", "candidate-skill"];
  const allResults = [];

  for (const evalCase of targetCases) {
    console.log(`\n--- Case ${evalCase.id}: ${evalCase.expectations[0].slice(0, 60)}... ---`);
    for (const arm of arms) {
      process.stdout.write(`  Arm [${arm}] running... `);
      const prompt = buildPrompt(arm, evalCase);
      const execution = await runModel(prompt, model);

      if (!execution.success) {
        console.log(`FAILED (${execution.error})`);
        allResults.push({
          caseId: evalCase.id,
          arm,
          success: false,
          error: execution.error,
        });
        continue;
      }

      const grading = gradeExpectations(execution.response, evalCase.expectations);
      console.log(`DONE (${grading.passedCount}/${grading.totalCount} passed, ${execution.durationMs}ms, ${execution.usage.total_tokens ?? 0} tokens)`);

      allResults.push({
        caseId: evalCase.id,
        arm,
        success: true,
        durationMs: execution.durationMs,
        usage: execution.usage,
        response: execution.response,
        grading,
      });
    }
  }

  // Summary and output
  console.log(`\n=== Evaluation Summary (${timestamp}) ===`);
  console.log(`Case | Arm             | Pass Rate | Tokens | Time (ms)`);
  console.log(`-----+-----------------+-----------+--------+----------`);
  for (const r of allResults) {
    if (r.success) {
      const rate = `${r.grading.passedCount}/${r.grading.totalCount} (${Math.round(r.grading.score * 100)}%)`;
      console.log(
        `  ${String(r.caseId).padEnd(2)} | ${r.arm.padEnd(15)} | ${rate.padEnd(9)} | ${String(r.usage.total_tokens ?? 0).padEnd(6)} | ${r.durationMs}`
      );
    } else {
      console.log(`  ${String(r.caseId).padEnd(2)} | ${r.arm.padEnd(15)} | ERROR     | N/A    | N/A`);
    }
  }

  // Save results
  const summaryPath = join(runOutputDir, "results.json");
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        timestamp,
        branch,
        role: branchInfo?.role ?? "Custom",
        model,
        modelDisplayName: branchInfo?.displayName ?? model,
        campaign,
        results: allResults,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  console.log(`\nComplete evidence saved to: ${summaryPath}`);
}

export { gradeExpectations };

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("evaluation-runner.mjs")) {
  main().catch((err) => {
    console.error("Evaluation run failed:", err);
    process.exit(1);
  });
}
