import { expect, it } from "vitest";
import { checkProgress } from "./check-progress";
import type { Status } from "./model";
const status: Status = {
  action: "check",
  busy: true,
  logs: [],
  history: [],
  unlocked: [],
};
it("waits without inventing percentages and ignores other operation progress", () => {
  expect(checkProgress(status)?.value).toBeNull();
  expect(checkProgress({ ...status, action: "backup" })).toBeNull();
});
it("reports the latest phase rather than treating segment progress as overall progress", () => {
  const logs = ["Checking segments 75.0%", "Checking archives 0.0%"];
  expect(checkProgress({ ...status, logs })).toMatchObject({
    label: "Checking archives",
    value: 0,
  });
  expect(
    checkProgress({ ...status, logs: ["Checking segments 25.5%"] })?.value,
  ).toBe(25.5);
});
it("never reports a failed check as complete", () => {
  const entry = {
    time: "now",
    action: "check",
    repositoryId: "r1",
    profileId: null,
    exitCode: 2,
    message:
      "Repository passphrase is missing or incorrect. Unlock then retry.",
  };
  expect(
    checkProgress({
      ...status,
      busy: false,
      logs: ["Checking segments 75.0%"],
      history: [entry],
    }),
  ).toMatchObject({
    value: null,
    label: "Integrity check failed",
    needsPassphrase: true,
  });
  expect(
    checkProgress({
      ...status,
      busy: false,
      history: [{ ...entry, exitCode: 0, message: "Completed" }],
    }),
  ).toMatchObject({ value: 100, label: "Integrity check completed" });
  expect(
    checkProgress({
      ...status,
      busy: false,
      history: [{ ...entry, exitCode: 1 }],
    })?.value,
  ).toBeNull();
});
