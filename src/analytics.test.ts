import { describe, it, expect } from "vitest";
import { backupAnalytics, inspectedStorage, analyticsView } from "./analytics";
import type { History, Repository } from "./model";
const now = new Date(2026, 9, 27, 12);
const entry = (days: number, exitCode = 0, action = "backup"): History => ({
  time: new Date(2026, 9, 27 - days, 10).toISOString(),
  action,
  exitCode,
  repositoryId: "repo",
  profileId: null,
  message: "",
});
describe("honest retained-history analytics", () => {
  it("counts only real, valid, nonfuture backup attempts and separates warnings from failures", () => {
    const data = backupAnalytics(
      [
        entry(0),
        entry(0, 1),
        entry(1, 2),
        entry(0, 0, "check"),
        entry(-1),
        { ...entry(0), time: "invalid" },
      ],
      now,
    );
    expect(data.outcomes).toEqual([1, 1, 1]);
    expect(data.days).toHaveLength(84);
    expect(data.trend).toHaveLength(30);
    expect(data.days[83]).toEqual({ date: "2026-10-27", count: 2, failed: 0 });
    expect(data.days[82]).toEqual({ date: "2026-10-26", count: 1, failed: 1 });
  });
  it("keeps old outcomes but excludes them from calendar and trend windows", () => {
    const data = backupAnalytics(
      [entry(29), entry(30), entry(83), entry(84)],
      now,
    );
    expect(data.outcomes).toEqual([4, 0, 0]);
    expect(data.trend.reduce((sum, day) => sum + day.count, 0)).toBe(1);
    expect(data.days.reduce((sum, day) => sum + day.count, 0)).toBe(3);
  });
  it("does not mutate history, fill absent days with sample runs, or invent storage", () => {
    const history = [entry(0)];
    const before = JSON.stringify(history);
    backupAnalytics(history, now);
    expect(JSON.stringify(history)).toBe(before);
    expect(backupAnalytics([], now).days.every((day) => day.count === 0)).toBe(
      true,
    );
    const html = analyticsView([], [], {}, now);
    expect(html).toContain("No backup runs recorded");
    expect(html).toContain("No backup outcomes recorded");
    expect(html).toContain("No usage is estimated");
    expect(html).not.toContain('class="donut-chart"');
  });
  it("excludes forgotten, uninspected, invalid, and negative repository sizes but preserves real zero", () => {
    const repositories = ["a", "b", "c", "d", "e"].map(
      (id) => ({ id, name: id, location: "/" + id }) as Repository,
    );
    const info = Object.fromEntries(
      Object.entries({
        a: 0,
        b: 4096,
        c: -1,
        d: Number.NaN,
        forgotten: 20000,
      }).map(([id, size]) => [
        id,
        { cache: { stats: { unique_csize: size } } },
      ]),
    );
    expect(inspectedStorage(repositories, info)).toEqual([
      { name: "a", size: 0 },
      { name: "b", size: 4096 },
    ]);
  });
  it("escapes repository labels inside SVG legends", () => {
    const repositories = [
      { id: "a", name: '<img src=x onerror="alert(1)">', location: "/a" },
    ] as Repository[];
    const html = analyticsView(
      [entry(0)],
      repositories,
      { a: { cache: { stats: { unique_csize: 100 } } } },
      now,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("View daily counts");
  });
});
