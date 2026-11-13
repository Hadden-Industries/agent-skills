import { readFileSync } from "node:fs";

const { ubuntuRelease, windowsRelease } = JSON.parse(
  readFileSync(
    new URL("../../.github/runner-policy.json", import.meta.url),
    "utf8",
  ),
);
export const ubuntuLabel = /^ubuntu-\d[02468]\.04$/u;
export const windowsLabel = /^windows-20\d{2}(?:-vs20\d{2})?$/u;

export const ubuntuRunner = "ubuntu-" + ubuntuRelease;
export const windowsRunner = "windows-" + windowsRelease;
if (typeof ubuntuRelease !== "string" || !ubuntuLabel.test(ubuntuRunner)) {
  throw new Error(
    "ubuntuRelease must be an even-year Ubuntu LTS release in YY.04 format.",
  );
}
if (typeof windowsRelease !== "string" || !windowsLabel.test(windowsRunner)) {
  throw new Error("windowsRelease must name a versioned Windows Server image.");
}
// GitHub's ImageOS drops the century from the server year and retains the VS suffix.
const windowsImageOS = "win" + windowsRelease.slice(2);

export function observeConformanceRunner({
  expected,
  platform,
  arch,
  runnerArch,
  imageOS,
  imageVersion,
  osRelease,
}) {
  if (arch !== "x64" || runnerArch !== "X64" || !imageOS || !imageVersion) {
    throw new Error("Expected a hosted x64 runner with image metadata.");
  }
  if (
    expected === ubuntuRunner &&
    platform === "linux" &&
    imageOS === "ubuntu" + ubuntuRelease.slice(0, 2)
  ) {
    const release = /^VERSION_ID="?(\d{2}\.\d{2})"?\r?$/mu.exec(osRelease)?.[1];
    if (/^ID="?ubuntu"?\r?$/mu.test(osRelease) && release === ubuntuRelease) {
      return { runner: expected, imageOS, imageVersion, arch, release };
    }
  } else if (
    expected === windowsRunner &&
    platform === "win32" &&
    imageOS === windowsImageOS
  ) {
    return { runner: expected, imageOS, imageVersion, arch };
  }
  throw new Error("The observed runner OS does not match the selected lane.");
}
