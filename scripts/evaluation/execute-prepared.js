import { preparedExecutionProfile } from "./profile-registry.js";
import { runSkillUp } from "./run-skill-up.js";

/** Explicit mode selection. A consumer failure never retries via direct execution. */
export async function executePrepared({
  mode,
  profile,
  controlPath,
  ...request
}) {
  if (mode === "direct") {
    if (controlPath !== undefined)
      throw new Error(
        "Direct execution does not accept a consumer control path",
      );
    return (await preparedExecutionProfile(profile)).execute(request);
  }
  if (mode === "skill-up") {
    if (
      Object.keys(request).length ||
      profile !== undefined ||
      typeof controlPath !== "string"
    )
      throw new Error("Consumer mode accepts only its frozen control path");
    return runSkillUp({ controlPath });
  }
  throw new Error("Explicit execution mode must be direct or skill-up");
}
