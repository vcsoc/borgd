import { describe, expect, it } from "vitest";
import {
  activityDetailsText,
  type ActivityDetails,
  type History,
} from "./model";
const entry: History = {
  id: "operation-1",
  detailsAvailable: true,
  time: "2026-01-01T00:00:00Z",
  action: "info",
  repositoryId: "r",
  profileId: null,
  exitCode: 2,
  message: "Repository is read-only",
};
const details: ActivityDetails = {
  entry,
  request: { action: "info", repositoryId: "r" },
  repository: { id: "r", name: "Original", location: "/old/repository" },
  profile: null,
  log: "Root error\nTraceback\nSSH_ORIGINAL_COMMAND: None",
  output: "Borg output",
  truncated: false,
  processExitCode: 2,
};
const config = {
  repositories: [{ id: "r", name: "Renamed", location: "/new/repository" }],
  profiles: [],
};
describe("copying activity details", () => {
  it("records explicit relocation approval without persisting its authorization token", () => {
    const text = activityDetailsText(entry, config, {
      ...details,
      relocationConfirmation: { oldPath: "/old", newPath: "/new" },
    });
    expect(text).toContain("Relocation explicitly approved for this retry:");
    expect(text).toContain('"oldPath": "/old"');
    expect(text).toContain('"newPath": "/new"');
    expect(text).not.toContain("token");
  });
  it("copies the original snapshot, complete retained log, request and stdout", () => {
    const text = activityDetailsText(entry, config, details);
    for (const content of [
      "Original",
      "/old/repository",
      details.log,
      details.output,
      '"action": "info"',
      entry.time,
      "Borg exit code: 2",
      "Result: Failed",
    ])
      expect(text).toContain(content);
    expect(text).not.toContain("Renamed");
  });
  it("states when older entries do not have detailed logs", () =>
    expect(
      activityDetailsText(
        { ...entry, id: undefined, detailsAvailable: false },
        config,
      ),
    ).toContain("Detailed output was not saved"));
  it("labels truncated output rather than claiming a complete transcript", () =>
    expect(
      activityDetailsText(entry, config, { ...details, truncated: true }),
    ).toContain("truncated"));
  it("distinguishes an application-level failure from a successful Borg exit", () => {
    const text = activityDetailsText(entry, config, {
      ...details,
      processExitCode: 0,
    });
    expect(text).toContain("Operation exit code: 2");
    expect(text).toContain("Borg exit code: 0");
    expect(text).toContain("Result: Failed");
  });
});
