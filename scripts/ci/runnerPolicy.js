import { readFileSync } from "node:fs";

const { ubuntuRelease } = JSON.parse(
  readFileSync(
    new URL("../../.github/runner-policy.json", import.meta.url),
    "utf8",
  ),
);
if (
  typeof ubuntuRelease !== "string" ||
  !/^\d[02468]\.04$/u.test(ubuntuRelease)
) {
  throw new Error(
    "ubuntuRelease must be an even-year Ubuntu LTS release in YY.04 format.",
  );
}

export const ubuntuRunner = "ubuntu-" + ubuntuRelease;
export const windowsRunner = "windows-2025";

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
    imageOS === "win25"
  ) {
    return { runner: expected, imageOS, imageVersion, arch };
  }
  throw new Error("The observed runner OS does not match the selected lane.");
}
