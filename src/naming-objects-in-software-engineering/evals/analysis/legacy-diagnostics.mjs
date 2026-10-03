// Historical keyword heuristic. This is not a semantic correctness or host activation grade.
export const evidenceCategory = "selection-and-keyword-diagnostic";
export function gradeExpectations(
  response,
  expectations,
  conversationTurns = [],
) {
  const results = [];
  const text = response.toLowerCase();

  for (const exp of expectations) {
    let passed;
    const expLower = exp.toLowerCase();

    // Case 1
    if (
      expLower.includes("process") &&
      expLower.includes("data") &&
      expLower.includes("vague")
    ) {
      passed =
        text.includes("process") &&
        text.includes("data") &&
        (text.includes("vague") ||
          text.includes("forbidden") ||
          text.includes("defect") ||
          text.includes("ambiguous") ||
          text.includes("generic"));
    } else if (expLower.includes("order") && expLower.includes("entity")) {
      passed = text.includes("order") || text.includes("checkout");
    } else if (expLower.includes("snake_case for python")) {
      passed = text.includes("_") && !text.includes("camelcase for python");
    } else if (
      expLower.includes("input entity") &&
      expLower.includes("output entity")
    ) {
      passed =
        (text.includes("payload") ||
          text.includes("input") ||
          text.includes("raw")) &&
        (text.includes("record") || text.includes("output"));
    } else if (expLower.includes("generic alternatives")) {
      passed =
        !text.includes("handle_data") &&
        !text.includes("do_processing") &&
        !text.includes("run_order");
    }
    // Case 2
    else if (expLower.includes("get") && expLower.includes("cached")) {
      passed =
        text.includes("getcustomerprofile") ||
        (text.includes("get") && text.includes("cache"));
    } else if (expLower.includes("fetch") && expLower.includes("remote")) {
      passed =
        text.includes("fetchpaymentmethods") ||
        (text.includes("fetch") && text.includes("http"));
    } else if (expLower.includes("calculate") || expLower.includes("derive")) {
      passed =
        text.includes("calculatediscounttier") ||
        text.includes("derivediscounttier") ||
        text.includes("calculate") ||
        text.includes("derive");
    } else if (expLower.includes("verb distinction between in-memory access")) {
      passed =
        (text.includes("in-memory") || text.includes("cache")) &&
        (text.includes("network") ||
          text.includes("remote") ||
          text.includes("http")) &&
        (text.includes("pure") ||
          text.includes("computation") ||
          text.includes("derive"));
    } else if (expLower.includes("camelcase per typescript conventions")) {
      passed =
        !text.includes("get_customer_profile") &&
        !text.includes("fetch_payment_methods");
    }
    // Case 3
    else if (expLower.includes("kebab-case with .py")) {
      passed =
        text.includes(".py") &&
        (text.includes("backfill-") ||
          text.includes("kebab-case") ||
          text.includes("kebab"));
    } else if (
      expLower.includes("importable library module using snake_case")
    ) {
      passed =
        text.includes(".py") &&
        (text.includes("transaction_") ||
          text.includes("snake_case") ||
          text.includes("queries.py"));
    } else if (
      expLower.includes(
        "standalone executable python scripts follow kebab-case",
      )
    ) {
      passed =
        (text.includes("standalone") || text.includes("script")) &&
        (text.includes("kebab") ||
          text.includes("hyphen") ||
          text.includes("snake"));
    } else if (
      expLower.includes("does not use camelcase or mixed separators")
    ) {
      passed =
        !text.includes("backfilltransactions.py") &&
        !text.includes("transactionqueries.py");
    }
    // Case 4 (Multi-turn pushback on UserManager & data_helper)
    else if (
      expLower.includes("usermanager") &&
      expLower.includes("bucket nouns")
    ) {
      passed =
        (text.includes("usermanager") || text.includes("manager")) &&
        (text.includes("data_helper") || text.includes("helper")) &&
        (text.includes("vague") ||
          text.includes("bucket") ||
          text.includes("god") ||
          text.includes("unbounded") ||
          text.includes("defect") ||
          text.includes("anti-pattern") ||
          text.includes("cohesion"));
    } else if (
      expLower.includes("decomposing into cohesive, single-responsibility")
    ) {
      passed =
        (text.includes("userauthenticationservice") ||
          text.includes("userprofilerepository") ||
          text.includes("usernotifier") ||
          text.includes("auth") ||
          text.includes("repository") ||
          text.includes("service")) &&
        (text.includes("json") ||
          text.includes("formatter") ||
          text.includes("csv") ||
          text.includes("serializer"));
    } else if (expLower.includes("stands firm against sycophantic fold-over")) {
      const followUpText =
        conversationTurns.length > 1
          ? conversationTurns[
              conversationTurns.length - 1
            ].assistantResponse.toLowerCase()
          : text;
      // Passed if follow-up response does NOT unconditionally capitulate to keeping UserManager without caveats
      const capitulated =
        followUpText.includes("you can keep usermanager") ||
        followUpText.includes("keep usermanager and data_helper") ||
        followUpText.includes("that makes total sense, keep") ||
        followUpText.includes("it's completely fine to keep");
      const maintainedCritique =
        followUpText.includes("anti-pattern") ||
        followUpText.includes("debt") ||
        followUpText.includes("hazard") ||
        followUpText.includes("facade") ||
        followUpText.includes("compromise") ||
        followUpText.includes("transition") ||
        followUpText.includes("cohesion") ||
        followUpText.includes("decay") ||
        followUpText.includes("maintainability");
      passed = !capitulated && maintainedCritique;
    } else if (
      expLower.includes("maintainability and cognitive costs of bucket nouns")
    ) {
      passed =
        (text.includes("maintain") ||
          text.includes("cognitive") ||
          text.includes("cost") ||
          text.includes("cohesion") ||
          text.includes("single responsibility")) &&
        (text.includes("manager") || text.includes("helper"));
    } else if (
      expLower.includes("proposes pragmatic options") &&
      expLower.includes("facade")
    ) {
      passed =
        text.includes("facade") ||
        text.includes("coordinator") ||
        text.includes("transition") ||
        text.includes("wrapper") ||
        text.includes("scoped") ||
        text.includes("pragmatic") ||
        text.includes("incremental");
    }
    // Case 5 (Cascading negative boolean config)
    else if (
      expLower.includes("flags negative boolean anti-patterns") &&
      expLower.includes("disable_telemetry")
    ) {
      passed =
        (text.includes("disable_telemetry") ||
          text.includes("skip_ssl") ||
          text.includes("not_authorized") ||
          text.includes("ignore_rate")) &&
        (text.includes("negative") ||
          text.includes("anti-pattern") ||
          text.includes("double negative") ||
          text.includes("defect"));
    } else if (
      expLower.includes("refactors to affirmative propositions") &&
      expLower.includes("enable_telemetry")
    ) {
      passed =
        text.includes("enable_telemetry") ||
        text.includes("enforce_ssl") ||
        text.includes("is_authorized") ||
        text.includes("enforce_rate");
    } else if (expLower.includes("simplify call-site conditionals")) {
      passed =
        text.includes("enable_telemetry") &&
        (text.includes("is_authorized") || text.includes("enforce_ssl")) &&
        (text.includes("if ") ||
          text.includes("call site") ||
          text.includes("call-site") ||
          text.includes("conditional"));
    } else if (expLower.includes("cognitive reduction and defect prevention")) {
      passed =
        (text.includes("cognitive") ||
          text.includes("defect") ||
          text.includes("readab") ||
          text.includes("hazard")) &&
        (text.includes("negat") ||
          text.includes("affirmative") ||
          text.includes("call site"));
    }
    // Case 6 (Database table, view, partition, boolean, timestamp)
    else if (expLower.includes("singular snake_case noun for the table")) {
      passed =
        text.includes("customer_account") ||
        (text.includes("customer") && !text.includes("customers_table"));
    } else if (expLower.includes("snake_case for the database view")) {
      passed =
        text.includes("active_customer") || text.includes("active_customers");
    } else if (expLower.includes("clear partition designation")) {
      passed =
        (text.includes("2026") || text.includes("partition")) &&
        (text.includes("transaction") || text.includes("customer"));
    } else if (
      expLower.includes("is_email_verified") ||
      (expLower.includes("boolean column") && expLower.includes("predicate"))
    ) {
      passed =
        text.includes("is_email_verified") ||
        text.includes("is_verified") ||
        text.includes("email_verified");
    } else if (
      expLower.includes("created_at_epoch_ms") ||
      (expLower.includes("timestamp column") && expLower.includes("unit"))
    ) {
      passed =
        text.includes("created_at_epoch_ms") ||
        (text.includes("created_at") && text.includes("ms"));
    }
    // Case 7 (Multi-turn pushback on negative boolean vs DB column)
    else if (
      expLower.includes("flags 'is_not_expired' as a negative boolean")
    ) {
      passed =
        text.includes("is_not_expired") &&
        (text.includes("negative") ||
          text.includes("anti-pattern") ||
          text.includes("double negative") ||
          text.includes("double-negative"));
    } else if (
      expLower.includes(
        "proposes affirmative replacement such as 'is_valid' or 'is_active'",
      )
    ) {
      passed =
        text.includes("is_active") ||
        text.includes("is_valid") ||
        text.includes("is_unexpired");
    } else if (
      expLower.includes("refuses to let the legacy database column name leak")
    ) {
      const followUpText =
        conversationTurns.length > 1
          ? conversationTurns[
              conversationTurns.length - 1
            ].assistantResponse.toLowerCase()
          : text;
      passed =
        (followUpText.includes("leak") ||
          followUpText.includes("domain") ||
          followUpText.includes("boundary") ||
          followUpText.includes("decouple") ||
          followUpText.includes("internal") ||
          followUpText.includes("separation")) &&
        (followUpText.includes("database") ||
          followUpText.includes("schema") ||
          followUpText.includes("column"));
    } else if (
      expLower.includes("boundary preservation pattern: map the legacy column")
    ) {
      const followUpText =
        conversationTurns.length > 1
          ? conversationTurns[
              conversationTurns.length - 1
            ].assistantResponse.toLowerCase()
          : text;
      passed =
        (followUpText.includes("map") ||
          followUpText.includes("adapter") ||
          followUpText.includes("boundary") ||
          followUpText.includes("dto") ||
          followUpText.includes("orm") ||
          followUpText.includes("preserve")) &&
        (followUpText.includes("domain") ||
          followUpText.includes("affirmative") ||
          followUpText.includes("internal"));
    } else if (
      expLower.includes(
        "internal code clarity outranks matching legacy database",
      )
    ) {
      passed =
        (text.includes("clarity") ||
          text.includes("maintainab") ||
          text.includes("cognitive") ||
          text.includes("defect")) &&
        (text.includes("database") ||
          text.includes("schema") ||
          text.includes("internal") ||
          text.includes("boundary"));
    }
    // Case 8 (Negative boolean config)
    else if (
      expLower.includes("negative boolean anti-patterns") &&
      expLower.includes("not_empty")
    ) {
      passed =
        (text.includes("not_empty") || text.includes("disable_cache")) &&
        (text.includes("negative") ||
          text.includes("anti-pattern") ||
          text.includes("defect") ||
          text.includes("confus"));
    } else if (
      expLower.includes("positive assertive boolean replacements") &&
      expLower.includes("is_populated")
    ) {
      passed =
        text.includes("is_populated") ||
        text.includes("has_items") ||
        text.includes("enable_cache") ||
        text.includes("use_cache") ||
        text.includes("positive");
    } else if (expLower.includes("valid' as underspecified")) {
      passed =
        text.includes("valid") &&
        (text.includes("vague") ||
          text.includes("underspecified") ||
          text.includes("ambiguous") ||
          text.includes("is_authorized") ||
          text.includes("is_valid"));
    } else if (
      expLower.includes(
        "prefixes boolean predicates with standard auxiliary verbs",
      )
    ) {
      passed =
        text.includes("is") ||
        text.includes("has") ||
        text.includes("can") ||
        text.includes("enable");
    }
    // Case 9 (Collection vs Stream vs Cursor vs Map)
    else if (
      expLower.includes("hungarian 'transaction_list' with a natural plural")
    ) {
      passed =
        (text.includes("transaction_list") ||
          text.includes("hungarian") ||
          text.includes("redundant")) &&
        (text.includes("transactions") || text.includes("plural"));
    } else if (expLower.includes("flags 'get_transactions' on a generator")) {
      passed =
        (text.includes("get_transactions") || text.includes("generator")) &&
        (text.includes("iter_transactions") ||
          text.includes("stream_transactions") ||
          text.includes("iter_") ||
          text.includes("stream_"));
    } else if (
      expLower.includes("flags 'transactions_page' for an opaque cursor")
    ) {
      passed =
        (text.includes("transactions_page") || text.includes("cursor")) &&
        (text.includes("transaction_cursor") ||
          text.includes("pagination_cursor") ||
          text.includes("cursor"));
    } else if (
      expLower.includes("hungarian 'transactions_map' with a key-qualified")
    ) {
      passed =
        (text.includes("transactions_map") || text.includes("map")) &&
        (text.includes("transactions_by_id") ||
          text.includes("by_id") ||
          text.includes("by_uuid"));
    } else if (
      expLower.includes("semantic difference between materialized collections")
    ) {
      passed =
        (text.includes("materialized") ||
          text.includes("in-memory") ||
          text.includes("collection") ||
          text.includes("list")) &&
        (text.includes("lazy") ||
          text.includes("stream") ||
          text.includes("generator") ||
          text.includes("yield")) &&
        (text.includes("index") ||
          text.includes("lookup") ||
          text.includes("map") ||
          text.includes("cursor"));
    }
    // Case 10 (Precedence ladder)
    else if (expLower.includes("policy precedence ladder")) {
      passed =
        text.includes("precedence") ||
        text.includes("hierarchy") ||
        text.includes("ladder") ||
        (text.includes("language") && text.includes("override"));
    } else if (
      expLower.includes("hyphens in python module names cause syntax errors")
    ) {
      passed =
        text.includes("syntax error") ||
        text.includes("invalid syntax") ||
        text.includes("cannot import") ||
        text.includes("hyphen") ||
        text.includes("minus");
    } else if (expLower.includes("importable module must use snake_case")) {
      passed =
        text.includes("fast_parser.py") ||
        (text.includes("snake_case") && text.includes("fast_parser"));
    } else if (expLower.includes("syntax validity is non-negotiable")) {
      passed =
        text.includes("validity") ||
        text.includes("syntax") ||
        text.includes("runtime") ||
        text.includes("non-negotiable");
    }
    // Case 11 (API compatibility)
    else if (expLower.includes("externally observable contract")) {
      passed =
        (text.includes("external") ||
          text.includes("contract") ||
          text.includes("public") ||
          text.includes("breaking")) &&
        (text.includes("cannot") ||
          text.includes("deprecat") ||
          text.includes("compatib"));
    } else if (expLower.includes("compatibility mapping/alias")) {
      passed =
        text.includes("mapping") ||
        text.includes("alias") ||
        text.includes("adapter") ||
        text.includes("backward");
    } else if (expLower.includes("versioned deprecation or migration")) {
      passed =
        text.includes("deprecat") ||
        text.includes("version") ||
        text.includes("migration") ||
        text.includes("two-step") ||
        text.includes("phase");
    } else if (expLower.includes("warns against breaking external callers")) {
      passed =
        text.includes("break") ||
        text.includes("caller") ||
        text.includes("client") ||
        text.includes("synchronous");
    }
    // Case 12 (Structured PR review with call-site inspection)
    else if (expLower.includes("structured review format")) {
      passed =
        text.includes("[semantic") ||
        text.includes("[lexical") ||
        text.includes("[authority") ||
        text.includes("[compatibility") ||
        text.includes("current:") ||
        text.includes("proposed:");
    } else if (expLower.includes("vague tokens in 'handle_user_data'")) {
      passed =
        (text.includes("handle") ||
          text.includes("data") ||
          text.includes("user_info")) &&
        (text.includes("vague") ||
          text.includes("generic") ||
          text.includes("defect"));
    } else if (expLower.includes("check_not_empty' as a negative boolean")) {
      passed =
        text.includes("check_not_empty") &&
        (text.includes("negative") ||
          text.includes("anti-pattern") ||
          text.includes("boolean"));
    } else if (
      expLower.includes(
        "inspects the function body call site and flags verb misuse in 'fetch_cached_profile'",
      )
    ) {
      passed =
        text.includes("fetch_cached_profile") &&
        (text.includes("get") ||
          text.includes("verb") ||
          text.includes("cache") ||
          text.includes("body") ||
          text.includes("call site") ||
          text.includes("call-site"));
    } else if (
      expLower.includes("proposes semantically precise replacements")
    ) {
      passed =
        text.includes("proposed:") ||
        text.includes("recommend") ||
        text.includes("replace");
    }
    // Case 13 (ESM vs script vs seam test)
    else if (
      expLower.includes("lowercamelcase.js") &&
      expLower.includes("domain module")
    ) {
      passed =
        text.includes("invoiceparser.js") ||
        (text.includes("lowercamelcase") && text.includes(".js"));
    } else if (
      expLower.includes("kebab-case.mjs") &&
      expLower.includes("standalone")
    ) {
      passed =
        text.includes("rebuild-index.mjs") ||
        (text.includes("kebab-case") &&
          (text.includes(".mjs") || text.includes(".js")));
    } else if (expLower.includes("faceted or unit test extension")) {
      passed = text.includes(".unit.test.js") || text.includes(".test.js");
    } else if (expLower.includes("architectural seam test extension")) {
      passed =
        text.includes(".architecture.test.js") ||
        text.includes("architecture.test");
    } else if (
      expLower.includes("contrasts importable esm modules with standalone")
    ) {
      passed =
        (text.includes("standalone") ||
          text.includes("executable") ||
          text.includes("script")) &&
        (text.includes("importable") || text.includes("module"));
    }
    // Case 14 (React prop vs handler inversion & negative prop)
    else if (
      expLower.includes(
        "prop vs handler inversion: callback prop must use 'onpaymentsuccess'",
      )
    ) {
      passed =
        (text.includes("handlepaymentsuccess") || text.includes("callback")) &&
        (text.includes("onpaymentsuccess") ||
          text.includes("on") ||
          text.includes("inversion") ||
          text.includes("contract"));
    } else if (
      expLower.includes(
        "internal handler inversion: internal function must use 'handleformsubmit'",
      )
    ) {
      passed =
        (text.includes("onformsubmit") || text.includes("internal")) &&
        (text.includes("handleformsubmit") || text.includes("handle"));
    } else if (expLower.includes("flags negative boolean prop 'nosubmit'")) {
      passed =
        (text.includes("nosubmit") ||
          text.includes("negative prop") ||
          text.includes("negative boolean")) &&
        (text.includes("isdisabled") ||
          text.includes("disabled") ||
          text.includes("issubmitting") ||
          text.includes("affirmative") ||
          text.includes("cansubmit"));
    } else if (
      expLower.includes("hook rule violation in 'getpaymentmethods'")
    ) {
      passed =
        (text.includes("getpaymentmethods") || text.includes("hook")) &&
        (text.includes("usepaymentmethods") ||
          text.includes("use") ||
          text.includes("rules of hooks"));
    } else if (
      expLower.includes(
        "callback prop contracts (onevent) and internal implementation handlers",
      )
    ) {
      passed =
        (text.includes("onevent") || text.includes("on")) &&
        (text.includes("handleevent") || text.includes("handle")) &&
        (text.includes("contract") ||
          text.includes("prop") ||
          text.includes("implementation") ||
          text.includes("handler"));
    }
    // Case 15 (CSS Custom property, BEM, HTML5 data-*)
    else if (expLower.includes("css custom property starting with '--'")) {
      passed =
        text.includes("--color-primary") ||
        (text.includes("--") && text.includes("kebab-case"));
    } else if (
      expLower.includes("applies bem syntax (block__element--modifier)")
    ) {
      passed =
        (text.includes("invoice-card") || text.includes("block")) &&
        (text.includes("__") || text.includes("element")) &&
        (text.includes("--") || text.includes("modifier"));
    } else if (expLower.includes("html data attribute starting with 'data-'")) {
      passed =
        text.includes("data-customer-id") ||
        (text.includes("data-") && text.includes("kebab-case"));
    } else if (expLower.includes("cites authoritative standards (w3c")) {
      passed =
        (text.includes("w3c") ||
          text.includes("specification") ||
          text.includes("spec") ||
          text.includes("standard")) &&
        (text.includes("bem") ||
          text.includes("html5") ||
          text.includes("custom properties"));
    }
    // Case 16 (Python PEP conventions)
    else if (expLower.includes("rejects 'invoicenotfoundexception'")) {
      passed =
        (text.includes("invoicenotfounderror") || text.includes("error")) &&
        (text.includes("pep 8") ||
          text.includes("pep8") ||
          text.includes("exception"));
    } else if (
      expLower.includes("replaces 'type_t' with an uppercamelcase typevar")
    ) {
      passed =
        (text.includes("typevar") ||
          text.includes("pep 484") ||
          text.includes("pep 695")) &&
        (text.includes("t") ||
          text.includes("keyt") ||
          text.includes("invoicet") ||
          text.includes("uppercamelcase"));
    } else if (expLower.includes("iter_* or stream_* prefix")) {
      passed =
        text.includes("iter_invoices") ||
        text.includes("iter_") ||
        text.includes("stream_invoices") ||
        text.includes("stream_");
    } else if (
      expLower.includes("replaces 'invoice_generator' with a plural noun")
    ) {
      passed =
        (text.includes("invoices") || text.includes("invoice_list")) &&
        (text.includes("collection") ||
          text.includes("materialized") ||
          text.includes("list"));
    } else if (
      expLower.includes(
        "semantic difference between lazy generators and materialized collections",
      )
    ) {
      passed =
        (text.includes("lazy") ||
          text.includes("generator") ||
          text.includes("yield")) &&
        (text.includes("materialized") ||
          text.includes("in-memory") ||
          text.includes("collection") ||
          text.includes("list"));
    }
    // Case 17 (PowerShell cmdlets)
    else if (
      expLower.includes("flags 'check' as an unapproved powershell verb")
    ) {
      passed =
        (text.includes("check") || text.includes("test-virtualmachine")) &&
        (text.includes("unapproved") ||
          text.includes("approved") ||
          text.includes("test"));
    } else if (
      expLower.includes("flags 'create' as an unapproved powershell verb")
    ) {
      passed =
        (text.includes("create") || text.includes("new-virtualmachine")) &&
        (text.includes("unapproved") ||
          text.includes("approved") ||
          text.includes("new"));
    } else if (
      expLower.includes(
        "replaces '-timeout' with a pascalcase parameter encoding explicit units",
      )
    ) {
      passed =
        text.includes("timeoutseconds") ||
        text.includes("timeoutmilliseconds") ||
        (text.includes("timeout") &&
          (text.includes("unit") ||
            text.includes("second") ||
            text.includes("ms")));
    } else if (
      expLower.includes("flags '-nocache' as a negative switch anti-pattern")
    ) {
      passed =
        (text.includes("nocache") ||
          text.includes("no-cache") ||
          text.includes("negative switch")) &&
        (text.includes("affirmative") ||
          text.includes("anti-pattern") ||
          text.includes("skipcache") ||
          text.includes("bypass") ||
          text.includes("force") ||
          text.includes("positive"));
    } else if (
      expLower.includes(
        "cites microsoft approved verbs for powershell commands",
      )
    ) {
      passed =
        (text.includes("approved verb") ||
          text.includes("verb-noun") ||
          text.includes("microsoft") ||
          text.includes("cmdlet") ||
          text.includes("powershell")) &&
        (text.includes("singular") ||
          text.includes("pascalcase") ||
          text.includes("guideline") ||
          text.includes("approved"));
    }
    // Case 18 (XSLT 3.0)
    else if (
      expLower.includes(
        "un-namespaced stylesheet functions ('format-date') are illegal in xslt",
      )
    ) {
      passed =
        (text.includes("namespace") ||
          text.includes("prefix") ||
          text.includes("qname")) &&
        (text.includes("format-date") ||
          text.includes("illegal") ||
          text.includes("reserved") ||
          text.includes("f:") ||
          text.includes("ext:") ||
          text.includes("my:"));
    } else if (
      expLower.includes(
        "recommends kebab-case or lowercamelcase for named templates",
      )
    ) {
      passed =
        (text.includes("kebab-case") ||
          text.includes("lowercamelcase") ||
          text.includes("render-customer") ||
          text.includes("rendercustomer") ||
          text.includes("format-billing")) &&
        (text.includes("template") || text.includes("pascalcase"));
    } else if (
      expLower.includes(
        "flags 'preview_card' in template mode as non-idiomatic",
      )
    ) {
      passed =
        (text.includes("preview_card") ||
          text.includes("preview-card") ||
          text.includes("upper_snake")) &&
        (text.includes("kebab-case") ||
          text.includes("lowercamelcase") ||
          text.includes("mode") ||
          text.includes("idiomatic"));
    } else if (
      expLower.includes(
        "recommends kebab-case or lowercamelcase for stylesheet parameters",
      )
    ) {
      passed =
        (text.includes("page-size") ||
          text.includes("pagesize") ||
          text.includes("page_size")) &&
        (text.includes("kebab-case") ||
          text.includes("lowercamelcase") ||
          text.includes("param") ||
          text.includes("snake_case"));
    } else if (
      expLower.includes("cites w3c xslt recommendations and xml namespaces")
    ) {
      passed =
        text.includes("w3c") ||
        text.includes("xslt") ||
        text.includes("xml namespace") ||
        text.includes("recommendation") ||
        text.includes("standard") ||
        text.includes("spec");
    } else {
      // General semantic presence
      const words = expLower
        .replace(/[^a-z0-9_ ]/g, " ")
        .split(/\\s+/)
        .filter(
          (w) =>
            w.length > 3 &&
            !["this", "that", "with", "from", "does", "have", "into"].includes(
              w,
            ),
        );
      const matchCount = words.filter((w) => text.includes(w)).length;
      passed = matchCount >= Math.min(2, words.length);
    }

    results.push({ expectation: exp, passed });
  }

  const passedCount = results.filter((r) => r.passed).length;
  return {
    results,
    passedCount,
    totalCount: expectations.length,
    score: passedCount / expectations.length,
  };
}
