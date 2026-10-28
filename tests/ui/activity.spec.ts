import { test, expect, type Page } from "@playwright/test";

const log =
  'info: documents\nFailed to create/acquire the lock /media/backup/documents/lock.exclusive ([Errno 30] Read-only file system).\nTraceback (most recent call last):\n  File "borg/repository.py", line 465\nSSH_ORIGINAL_COMMAND: None';
async function activityDesktop(page: Page, legacy = false) {
  await page.addInitScript(
    ({ log, legacy }) => {
      (window as any).isTauri = true;
      (window as any).__copied = [];
      (window as any).__detailReads = [];
      const history = Array.from({ length: 200 }, (_, i) => ({
        id: legacy
          ? null
          : `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        detailsAvailable: !legacy,
        repositoryName: legacy ? null : "Original documents",
        repositoryLocation: legacy ? null : "/media/backup/documents",
        time: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        action: "info",
        repositoryId: "repo",
        profileId: null,
        exitCode: 2,
        message:
          "Repository storage is read-only. Borg needs a writable lock file even for inspection. Check the drive/filesystem before safely mounting it read-write; do not force-remount or delete locks to bypass this error. (Borg exit code 2.)",
      }));
      const status = {
        busy: false,
        action: "info",
        logs: log.split("\n"),
        history,
        unlocked: [],
      };
      (window as any).__activityStatus = status;
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === "get_config")
            return {
              onboardingComplete: true,
              repositories: [
                {
                  id: "repo",
                  name: "Renamed repository",
                  location: "/new/location",
                },
              ],
              profiles: [],
            };
          if (command === "get_status") return structuredClone(status);
          if (command === "probe") return "borg 1.4.5";
          if (command === "get_history_details") {
            (window as any).__detailReads.push(args.id);
            if ((window as any).__failDetails)
              throw new Error("Saved diagnostic file could not be read");
            return {
              entry: history.find((h) => h.id === args.id),
              request: {
                action: "info",
                repositoryId: "repo",
                profileId: null,
              },
              repository: {
                id: "repo",
                name: "Original documents",
                location: "/media/backup/documents",
              },
              profile: null,
              log,
              output: "",
              truncated: false,
            };
          }
          if (command === "plugin:clipboard-manager|write_text") {
            if ((window as any).__failClipboard)
              throw new Error("Clipboard is unavailable");
            (window as any).__copied.push(args.text);
            return;
          }
          if (command === "terminal_create")
            return { id: 1, shell: "/bin/bash" };
          if (command === "terminal_read")
            return { data: [], exited: false, exitCode: null, dropped: false };
          if (command === "terminal_resize") return;
          throw new Error(`Unexpected command ${command}`);
        },
      };
    },
    { log, legacy },
  );
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
}

test("copy operation output and full saved entry details through the native clipboard API", async ({
  page,
}) => {
  await activityDesktop(page);
  await expect(
    page.getByRole("button", { name: /Copy details for/ }),
  ).toHaveCount(200);
  expect(await page.evaluate(() => (window as any).__detailReads)).toEqual([]);
  await page
    .getByRole("button", { name: "Copy operation log", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copied[0]))
    .toBe(log);
  await page
    .getByRole("button", { name: /Copy details for/ })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copied[1]))
    .toContain("Operation log:");
  const copied = await page.evaluate(() => (window as any).__copied[1]);
  expect(copied).toContain("Repository: Original documents");
  expect(copied).toContain("Repository location: /media/backup/documents");
  expect(copied).toContain("Borg exit code: 2");
  expect(copied).toContain(log);
  expect(copied).toContain('"action": "info"');
  expect(copied).not.toContain("Renamed repository");
  expect(await page.evaluate(() => (window as any).__detailReads)).toHaveLength(
    1,
  );
});

test("history scrolls independently and keeps the log and table header in view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await activityDesktop(page);
  const history = page.getByRole("region", { name: "Recent activity history" });
  const before = (await page.locator("#terminal").boundingBox())!;
  await history.hover();
  await page.mouse.wheel(0, 900);
  await expect
    .poll(() => history.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(
    await page.locator(".activity-content").evaluate((el) => el.scrollTop),
  ).toBe(0);
  expect((await page.locator("#terminal").boundingBox())!.y).toBe(before.y);
  await expect(
    page.getByRole("heading", { name: "Operation log", exact: true }),
  ).toBeVisible();
  const region = (await history.boundingBox())!;
  const header = (await history.locator("thead th").first().boundingBox())!;
  expect(Math.abs(region.y - header.y)).toBeLessThan(3);
  await page.screenshot({
    path: "test-results/activity-scroll-and-copy.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(page.locator("#terminal")).toBeVisible();
  expect(
    await page.locator(".activity-content").evaluate((el) => el.scrollTop),
  ).toBe(0);
  await page.setViewportSize({ width: 480, height: 850 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(480);
});

test("legacy entries copy all recorded metadata without inventing a missing traceback", async ({
  page,
}) => {
  await activityDesktop(page, true);
  await page
    .getByRole("button", { name: /Copy details for/ })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copied[0]))
    .toContain("Detailed output was not saved");
  expect(await page.evaluate(() => (window as any).__detailReads)).toEqual([]);
});

test("clipboard and detail-loading failures report errors without claiming a successful copy", async ({
  page,
}) => {
  await activityDesktop(page);
  await page.evaluate(() => ((window as any).__failDetails = true));
  const copy = page.getByRole("button", { name: /Copy details for/ }).first();
  await copy.click();
  await expect(page.locator("#toast")).toContainText(
    "Saved diagnostic file could not be read",
  );
  await expect(copy).toBeEnabled();
  await page.evaluate(() => ((window as any).__failClipboard = true));
  await page
    .getByRole("button", { name: "Copy operation log", exact: true })
    .click();
  await expect(page.locator("#toast")).toContainText(
    "Clipboard is unavailable",
  );
  expect(await page.evaluate(() => (window as any).__copied)).toEqual([]);
});

test("read-only root cause stays visible on the repository card", async ({
  page,
}) => {
  await activityDesktop(page);
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await expect(page.locator(".repository-error")).toContainText(
    "Repository storage is read-only",
  );
  await expect(page.locator(".repository-error")).toContainText(
    "do not force-remount or delete locks",
  );
});
