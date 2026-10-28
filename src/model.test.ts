import { describe, expect, it } from "vitest";
import { bytes, due, escape, lines, type Profile, type History } from "./model";
const profile: Profile = {
  id: "p",
  name: "Home",
  repositoryId: "r",
  sources: ["/home"],
  excludes: [],
  keepDaily: 7,
  keepWeekly: 4,
  keepMonthly: 6,
  intervalHours: 24,
};
const entry = (time: string, exitCode = 0): History => ({
  time,
  exitCode,
  action: "backup",
  repositoryId: "r",
  profileId: "p",
  message: "",
});
describe("display helpers", () => {
  it("escapes untrusted repository and archive names", () =>
    expect(escape('<img src=x onerror="alert(1)">&\'')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;",
    ));
  it("formats storage without inventing measurements", () => {
    expect(bytes(undefined)).toBe("--");
    expect(bytes(0)).toBe("0 B");
    expect(bytes(1024)).toBe("1 KB");
  });
  it("cleans multiline paths and excludes", () =>
    expect(lines(" /home/me \n\n /media/photos\n")).toEqual([
      "/home/me",
      "/media/photos",
    ]));
});
describe("open-app scheduling", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  it("never runs manual profiles", () =>
    expect(due({ ...profile, intervalHours: 0 }, [], now)).toBe(false));
  it("runs first and overdue backups", () => {
    expect(due(profile, [], now)).toBe(true);
    expect(due(profile, [entry("2026-01-01T00:00:00Z")], now)).toBe(true);
  });
  it("waits a full interval after success or failure", () => {
    expect(due(profile, [entry("2026-01-01T23:00:00Z")], now)).toBe(false);
    expect(due(profile, [entry("2026-01-01T23:00:00Z", 2)], now)).toBe(false);
  });
  it("ignores other profiles and non-backup operations", () =>
    expect(
      due(
        profile,
        [
          { ...entry("2026-01-01T23:00:00Z"), profileId: "other" },
          { ...entry("2026-01-01T23:00:00Z"), action: "prune" },
        ],
        now,
      ),
    ).toBe(true));
});
