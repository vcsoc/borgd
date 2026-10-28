import { test, expect, type Page } from "@playwright/test";
async function desktop(page: Page, supported = true, single = false) {
  await page.addInitScript(
    ({ supported, single }) => {
      (window as any).isTauri = true;
      (window as any).__operations = [];
      (window as any).__diffFailure = false;
      (window as any).__diffRows = [
        {
          path: "folder/<img src=x onerror=alert(1)>.txt",
          changes: [{ type: "modified", added: 20, removed: 10 }],
        },
        { path: "new.txt", changes: [{ type: "added", size: 42 }] },
      ];
      const profiles = Array.from({ length: 12 }, (_, index) => ({
        id: `p${index}`,
        name: `Profile ${index}`,
        repositoryId: "a",
        sources: [`/source-${index}`],
        excludes: [],
        intervalHours: 0,
        keepDaily: 7,
        keepWeekly: 4,
        keepMonthly: 6,
      }));
      profiles.push({
        ...profiles[0],
        id: "beta",
        name: "Beta only",
        repositoryId: "b",
      });
      const config = {
        onboardingComplete: true,
        repositories: [
          { id: "a", name: "Alpha", location: "/alpha" },
          { id: "b", name: "Beta", location: "/beta" },
        ],
        profiles,
      };
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === "probe") return "borg 1.4.5";
          if (command === "get_config") return structuredClone(config);
          if (command === "get_status")
            return {
              busy: false,
              workerRunning: true,
              archiveDiffSupported: supported,
              history: [],
              logs: [],
              unlocked: ["a", "b"],
            };
          if (command === "run_operation") {
            const request = args.request;
            (window as any).__operations.push(request);
            if (request.action === "archives")
              return {
                exitCode: 0,
                text: "",
                data: {
                  archives: (single
                    ? ["latest"]
                    : ["latest", "older", "oldest"]
                  ).map((name, index) => ({
                    name,
                    time: `2026-01-0${3 - index}T00:00:00Z`,
                    stats: { nfiles: 3, original_size: 100 },
                  })),
                },
              };
            if (request.action === "info")
              return {
                exitCode: 0,
                text: "",
                data: {
                  encryption: { mode: "repokey" },
                  cache: { stats: { unique_csize: 100, total_size: 200 } },
                },
              };
            if (request.action === "files")
              return {
                exitCode: 0,
                text: "",
                data: [
                  {
                    path: "folder/<img src=x onerror=alert(1)>.txt",
                    type: "-",
                    size: 20,
                  },
                  { path: "new.txt", type: "-", size: 42 },
                  ...(request.archive !== "latest"
                    ? [{ path: "gone/deep/removed.txt", type: "-", size: 10 }]
                    : []),
                ],
              };
            if (request.action === "diff") {
              if ((window as any).__diffFailure)
                throw new Error("Comparison storage unavailable");
              return {
                exitCode: 0,
                text: "",
                data: structuredClone((window as any).__diffRows),
              };
            }
            throw new Error(request.action);
          }
          throw new Error(command);
        },
      };
    },
    { supported, single },
  );
  await page.goto("/");
  await expect(
    page.getByRole("article", { name: "Alpha", exact: true }),
  ).toBeVisible();
}
const alpha = (page: Page) =>
  page.getByRole("article", { name: "Alpha", exact: true });
async function archives(page: Page) {
  await alpha(page)
    .getByRole("button", { name: "Archives", exact: true })
    .click();
  await expect(
    alpha(page).locator('[data-archive-row="latest"]'),
  ).toBeVisible();
}
test("repository header owns all controls; graph is 60%, details are right, quick profiles are scoped and independently scrollable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 950 });
  await desktop(page);
  const row = alpha(page);
  await expect(row.locator(".repo-header .repo-actions > button")).toHaveCount(
    8,
  );
  await expect(row.locator(".repo-details > div")).toHaveCount(4);
  const graph = (await row.locator(".repo-graph-column").boundingBox())!,
    side = (await row.locator(".repo-side-column").boundingBox())!;
  expect(graph.width / (graph.width + side.width)).toBeCloseTo(0.6, 2);
  expect(side.x).toBeGreaterThan(graph.x + graph.width);
  const list = row.getByRole("list", {
    name: "Backup profiles for Alpha",
    exact: true,
  });
  await expect(list.getByRole("listitem")).toHaveCount(12);
  await expect(list).not.toContainText("Beta only");
  expect(
    await list.evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBeTruthy();
  await list.evaluate((el) => {
    el.scrollTop = 300;
  });
  await row.getByRole("button", { name: "Inspect", exact: true }).click();
  await expect(row.locator(".repo-details")).toContainText("repokey");
  expect(await list.evaluate((el) => el.scrollTop)).toBe(300);
  await page.screenshot({
    path: "test-results/repository-redesign-desktop.png",
    animations: "disabled",
  });
  await list
    .getByRole("button", { name: "Edit profile: Profile 8", exact: true })
    .click();
  await expect(
    row.getByRole("form", { name: "Edit backup profile" }),
  ).toBeVisible();
  await expect(row.locator('[name="name"]')).toHaveValue("Profile 8");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/repository-redesign-narrow.png",
    animations: "disabled",
  });
});
test("right-click archive diff defaults to nearest older snapshot, escapes paths, supports another base, empty results and scoped back navigation", async ({
  page,
}) => {
  await desktop(page);
  await archives(page);
  await alpha(page)
    .locator('[data-archive-row="latest"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "View diff", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Archive diff", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#diff-base")).toHaveValue("older");
  await expect(page.locator(".archive-diff-table")).toContainText(
    "folder/<img src=x onerror=alert(1)>.txt",
  );
  await expect(page.locator(".archive-diff-table img")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__operations.at(-1)),
  ).toEqual({
    action: "diff",
    repositoryId: "a",
    archive: "older",
    compareArchive: "latest",
  });
  await page.locator("#diff-base").selectOption("oldest");
  await page.evaluate(() => {
    (window as any).__diffRows = [];
  });
  await page
    .getByRole("button", { name: "Compare archives", exact: true })
    .click();
  await expect(
    page.getByText("No differences found between these archives.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to archives", exact: true })
    .click();
  await expect(
    alpha(page).locator('[data-archive-row="latest"]'),
  ).toBeVisible();
  await expect(
    alpha(page).getByRole("button", { name: "Archives", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
});
test("keyboard archive menu cancels and comparison errors retry without showing false empty results", async ({
  page,
}) => {
  await desktop(page);
  await archives(page);
  const row = alpha(page).locator('[data-archive-row="latest"]');
  await row.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await page.evaluate(() => {
    (window as any).__diffFailure = true;
  });
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Comparison storage unavailable",
  );
  await expect(
    page.getByText("No differences found between these archives.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__diffFailure = false;
  });
  await page
    .getByRole("button", { name: "Retry comparison", exact: true })
    .click();
  await expect(page.locator(".archive-diff-table")).toBeVisible();
  await page.screenshot({
    path: "test-results/archive-diff.png",
    animations: "disabled",
  });
});
test("single archives and older workers explain why no comparison can run", async ({
  page,
}) => {
  await desktop(page, false, true);
  await archives(page);
  await alpha(page)
    .locator('[data-archive-row="latest"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "View diff", exact: true }).click();
  await expect(
    page.getByText(
      "At least two archives in this repository are needed for a diff.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).__operations.filter((r: any) => r.action === "diff")
          .length,
    ),
  ).toBe(0);
});

test("older workers show an actionable update notice without issuing an unsupported operation", async ({
  page,
}) => {
  await desktop(page, false);
  await archives(page);
  await alpha(page)
    .locator('[data-archive-row="latest"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "View diff", exact: true }).click();
  await expect(
    page.getByText(/running worker needs an update for archive diffs/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compare archives", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as any).__operations.filter((r: any) => r.action === "diff")
          .length,
    ),
  ).toBe(0);
});

test("large diffs reveal all changes incrementally", async ({ page }) => {
  await desktop(page);
  await archives(page);
  await page.evaluate(() => {
    (window as any).__diffRows = Array.from({ length: 451 }, (_, index) => ({
      path: `file-${index}`,
      changes: [{ type: "added", size: 1 }],
    }));
  });
  await alpha(page)
    .locator('[data-archive-row="latest"]')
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "View diff", exact: true }).click();
  await expect(page.locator(".archive-diff-table tbody tr")).toHaveCount(200);
  await page
    .getByRole("button", { name: "Show more changes", exact: true })
    .click();
  await expect(page.locator(".archive-diff-table tbody tr")).toHaveCount(400);
  await page
    .getByRole("button", { name: "Show more changes", exact: true })
    .click();
  await expect(page.locator(".archive-diff-table tbody tr")).toHaveCount(451);
  await expect(page.getByText("file-450", { exact: true })).toBeVisible();
});

test("archive context actions browse or ask before restoring, in the requested order", async ({
  page,
}) => {
  await desktop(page);
  await page.locator('[data-action="load-archives"][data-id="a"]').count();
  await page.locator('[data-panel="archives"][data-id="a"]').click();
  const row = page.locator(".archive-table tbody tr").first();
  await row.click({ button: "right" });
  await expect(page.getByRole("menuitem")).toHaveText([
    "Browse",
    "Restore",
    "View diff",
  ]);
  await page.getByRole("menuitem", { name: "Browse", exact: true }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search archive" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to archives", exact: true })
    .click();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).__operations.some((r: any) => r.action === "restore"),
    ),
  ).toBe(false);
});
test("diff Go to highlights a nested path and selects the older snapshot for removed items", async ({
  page,
}) => {
  await desktop(page);
  await page.evaluate(() => {
    (window as any).__diffRows.push({
      path: "gone/deep/removed.txt",
      changes: [{ type: "removed", size: 10 }],
    });
  });
  await page.locator('[data-panel="archives"][data-id="a"]').click();
  await page
    .locator(".archive-table tbody tr")
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "View diff", exact: true }).click();
  await page
    .locator(".archive-diff-table tbody tr")
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Go to", exact: true }).click();
  await expect(
    page.locator('.archive-content-pane tr[aria-selected="true"]'),
  ).toHaveAttribute("data-entry", "folder/<img src=x onerror=alert(1)>.txt");
  await expect(
    page.getByRole("button", { name: "Restore selected (1)", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).__operations
        .filter((r: any) => r.action === "files")
        .at(-1),
    ),
  ).toMatchObject({ repositoryId: "a", archive: "latest" });
  await page
    .getByRole("button", { name: "Back to archives", exact: true })
    .click();
  await page
    .locator(".archive-table tbody tr")
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "View diff", exact: true }).click();
  await page.locator(".archive-diff-table tbody tr").last().focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Go to", exact: true }).click();
  await expect(
    page.locator('.archive-content-pane tr[aria-selected="true"]'),
  ).toHaveAttribute("data-entry", "gone/deep/removed.txt");
  expect(
    await page.evaluate(() =>
      (window as any).__operations
        .filter((r: any) => r.action === "files")
        .at(-1),
    ),
  ).toMatchObject({ repositoryId: "a", archive: "older" });
});

test("Go to reports paths absent from both snapshots without selecting or extracting anything", async ({
  page,
}) => {
  await desktop(page);
  await page.evaluate(() => {
    (window as any).__diffRows = [
      { path: "not-available.txt", changes: [{ type: "modified" }] },
    ];
  });
  await page.locator('[data-panel="archives"][data-id="a"]').click();
  await page
    .locator(".archive-table tbody tr")
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "View diff", exact: true }).click();
  await page.locator(".archive-diff-table tbody tr").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Go to", exact: true }).click();
  await expect(page.locator("#toast")).toContainText(
    "not available in either compared archive",
  );
  await expect(
    page.locator('.archive-content-pane tr[aria-selected="true"]'),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).__operations
        .filter((r: any) => r.action === "files")
        .map((r: any) => r.archive),
    ),
  ).toEqual(["latest", "older"]);
  expect(
    await page.evaluate(() =>
      (window as any).__operations.some((r: any) => r.action === "restore"),
    ),
  ).toBe(false);
});
