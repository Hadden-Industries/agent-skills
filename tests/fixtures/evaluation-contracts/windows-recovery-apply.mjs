// A real recovery owner that can be killed at an observed filesystem transition.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { applyEvaluationHomeRecovery } from "../../../scripts/evaluation/evaluation-homes.js";
import { openEvaluationPathMetadata } from "../../../scripts/evaluation/evaluation-path-metadata.js";
const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
const probe = openEvaluationPathMetadata();
try {
  await applyEvaluationHomeRecovery({
    proposal: request.proposal,
    confirmRoot: request.proposal.root,
    confirmRole: "execution",
    stateDigest: request.proposal.stateDigest,
    resume: request.proposal.mode === "resume",
    testDependencies: {
      clock: () => new Date().toISOString(),
      randomBytes,
      pathMetadata: (path) => probe.read(path),
      async failAfterPhase(phase) {
        if (phase === request.phase) {
          writeFileSync(
            request.barrierPath,
            JSON.stringify({ pid: process.pid, phase }),
          );
          // Keep the async owner alive until its real parent deliberately kills it.
          setInterval(() => {}, 1000);
          await new Promise(() => {});
        }
      },
    },
  });
} finally {
  await probe.close();
}
