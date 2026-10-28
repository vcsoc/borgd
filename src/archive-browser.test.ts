import { expect, it } from "vitest";
import { ArchiveIndex, ArchiveBrowser } from "./archive-browser";
it("builds missing ancestor folders and sorts folders before naturally sorted files", () => {
  const index = new ArchiveIndex([
    { path: "Documents/work/file10.txt", type: "-", size: 10 },
    { path: "Documents/work/file2.txt", type: "-" },
    { path: "Documents/work/nested", type: "d" },
  ]);
  expect(index.list("").map((i) => i.name)).toEqual(["Documents"]);
  expect(index.list("Documents/work").map((i) => i.name)).toEqual([
    "nested",
    "file2.txt",
    "file10.txt",
  ]);
});
it("indexes and searches beyond the old 500-item limit without treating symlinks as folders", () => {
  const index = new ArchiveIndex([
    ...Array.from({ length: 1200 }, (_, i) => ({
      path: `Documents/file${i}.txt`,
      type: "-",
    })),
    { path: "Documents/link", type: "l", linktarget: "/outside" },
  ]);
  expect(index.list("Documents")).toHaveLength(1201);
  expect(index.list("", "file1199")[0].path).toBe("Documents/file1199.txt");
  expect(index.items.get("Documents/link")?.type).toBe("l");
});
it("escapes archive names and resets navigation when another archive is loaded", () => {
  const browser = new ArchiveBrowser();
  browser.load([{ path: '<img src=x onerror="alert(1)">', type: "-" }]);
  expect(browser.html()).not.toContain("<img src=x");
  expect(browser.html()).toContain("&lt;img");
  browser.folder = "old";
  browser.query = "query";
  browser.load([]);
  expect(browser.folder).toBe("");
  expect(browser.query).toBe("");
  expect(browser.html()).toContain("No items");
});

it("reveals and selects nested paths beyond the first page, without inventing missing items", () => {
  const browser = new ArchiveBrowser();
  browser.load(
    Array.from({ length: 451 }, (_, i) => ({
      path: `deep/folder/file-${i}.txt`,
      type: "-",
    })),
  );
  expect(browser.reveal("./deep/folder/file-450.txt")).toBe(true);
  expect(browser.folder).toBe("deep/folder");
  expect(browser.expanded.has("deep")).toBe(true);
  expect(browser.expanded.has("deep/folder")).toBe(true);
  expect(browser.selection.has("deep/folder/file-450.txt")).toBe(true);
  expect(browser.limit).toBeGreaterThanOrEqual(451);
  expect(browser.reveal("missing.txt")).toBe(false);
  expect(browser.selection.size).toBe(1);
});
