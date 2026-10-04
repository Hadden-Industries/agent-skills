// Synthetic adapter: real authority consumption/home acquisition, no model call.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  executeAuthorizedModelSession,
  consumeExternalModelLaunch,
} from "../../../scripts/evaluation/runtime.js";
import { preparedProcessContainment } from "../../../scripts/evaluation/process-host.js";
import { withEvaluationHome } from "../../../scripts/evaluation/evaluation-homes.js";

const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
const control = JSON.parse(readFileSync(request.controlPath, "utf8"));
const containment = preparedProcessContainment(request.controlPath, control);
await executeAuthorizedModelSession({
  preparedSession: control.preparedSession,
  authorization: request.authorization,
  allowExternalModelCall: true,
  assertCurrent: async () => {}, // No changing provider/toolchain in this fixture.
  request: {},
  adapter: {
    provider: "openai",
    async execute({ launchCapability, transmission }) {
      return withEvaluationHome(
        {
          root: request.homes,
          role: "execution",
          operationId: transmission.session.preparedSessionId,
          containment,
        },
        async (context) => {
          await consumeExternalModelLaunch(launchCapability, {
            provider: transmission.provider,
            model: transmission.model,
            effort: transmission.effort,
            transmissionSha256: control.transmissionSha256,
          });
          writeFileSync(
            join(context.path, "runtime-residue"),
            "preserve in retained used generation",
          );
          if (request.complete) {
            const closure = {
              status: "safe",
              exitStatus: "not-started",
              exitCode: null,
              exitSignal: null,
              stdioStatus: "not-opened",
              protocolStatus: "not-opened",
              terminationActions: [],
              descendantStatus: "none-observed",
            };
            return {
              value: {
                status: "completed",
                failureClass: null,
                error: null,
                nativeUsage: null,
                normalizedUsage: {
                  inputTokens: null,
                  cachedInputTokens: null,
                  outputTokens: null,
                  totalTokens: null,
                  costUsd: null,
                },
                closure,
                suiteResult: null,
              },
              release: closure,
            };
          }
          writeFileSync(
            join(request.root, "barrier.json"),
            JSON.stringify({ pid: process.pid, hostPid: process.ppid }),
          );
          // Real abrupt death: the recorder must close this still-live workload.
          process.kill(process.ppid, "SIGKILL");
          await new Promise(() => {});
        },
      );
    },
  },
});
