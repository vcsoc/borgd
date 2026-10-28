import { expect, it } from "vitest";
import { sortArchives } from "./archive-sort";
import type { Archive } from "./model";
const entries: Archive[] = [
  {
    name: "archive10",
    id: "a",
    time: "2026-01-01T00:00:00Z",
    stats: { nfiles: 10, original_size: 2000 },
  },
  {
    name: "archive2",
    id: "b",
    time: "2026-02-01T00:00:00Z",
    stats: { nfiles: 2, original_size: 100 },
  },
  {
    name: "empty",
    id: "c",
    time: "2026-03-01T00:00:00Z",
    stats: { nfiles: 0, original_size: 0 },
  },
  { name: "unknown", id: "d", time: "invalid" },
];
it("orders newest first without mutating the returned repository listing", () => {
  expect(sortArchives(entries, "time", "desc").map((a) => a.id)).toEqual([
    "c",
    "b",
    "a",
    "d",
  ]);
  expect(entries[0].id).toBe("a");
});
it("sorts names naturally in both directions", () => {
  expect(sortArchives(entries, "name", "asc")[0].name).toBe("archive2");
  expect(sortArchives(entries, "name", "desc")[0].name).toBe("unknown");
});
it("sorts counts and sizes numerically while keeping unknown values last", () => {
  expect(sortArchives(entries, "files", "asc").map((a) => a.id)).toEqual([
    "c",
    "b",
    "a",
    "d",
  ]);
  expect(sortArchives(entries, "size", "desc").map((a) => a.id)).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
});
it("accepts Borg start timestamps and rejects invalid numeric metadata", () => {
  const values = [
    {
      name: "a",
      id: "a",
      time: "",
      start: "2026-04-01T00:00:00Z",
      stats: { nfiles: -1 },
    },
    entries[1],
  ];
  expect(sortArchives(values, "time", "desc")[0].id).toBe("a");
  expect(sortArchives(values, "files", "asc")[0].id).toBe("b");
});
