"""Run the installed script afresh for each example in one test-owned process."""

import contextlib
import io
import json
import runpy
import sys

checker = sys.argv[1]
examples = json.load(sys.stdin)
results = []
for example in examples:
    sys.argv = [
        checker,
        "--kind",
        example["kind"],
        "--name=" + example["name"],
        "--json",
    ]
    output = io.StringIO()
    status = None
    with contextlib.redirect_stdout(output):
        try:
            runpy.run_path(checker, run_name="__main__")
        except SystemExit as exc:
            status = exc.code
    results.append({"status": status, "stdout": output.getvalue()})
json.dump(results, sys.stdout)
