import type { Status } from "./model";

export function checkProgress(status: Status): {
  label: string;
  value: number | null;
  detail: string;
  needsPassphrase: boolean;
} | null {
  if (status.action !== "check") return null;
  if (!status.busy) {
    const entry = status.history[0];
    if (!entry || entry.action !== "check") return null;
    return {
      label:
        entry.exitCode === 0
          ? "Integrity check completed"
          : entry.exitCode === 1
            ? "Check completed with warnings"
            : "Integrity check failed",
      value: entry.exitCode === 0 ? 100 : null,
      detail:
        entry.exitCode === 0
          ? "Repository and archive consistency checked. This is not full backup-data verification."
          : entry.message,
      needsPassphrase: entry.message.includes(
        "Repository passphrase is missing or incorrect",
      ),
    };
  }
  for (const line of [...status.logs].reverse()) {
    const match =
      /^(Checking segments|Checking archives|Verifying data)\s+(\d+(?:\.\d+)?)%/.exec(
        line,
      );
    if (match)
      return {
        label:
          match[1] === "Checking segments"
            ? "Checking repository segments"
            : match[1],
        value: Math.min(100, Math.max(0, Number(match[2]))),
        detail:
          "Progress is for this phase, not the entire check. Keep borgd open until it finishes.",
        needsPassphrase: false,
      };
  }
  return {
    label: "Running integrity check",
    value: null,
    detail:
      "Waiting for Borg to report phase progress. Keep borgd open until it finishes.",
    needsPassphrase: false,
  };
}
