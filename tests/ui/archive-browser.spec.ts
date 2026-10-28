import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    const status = {
      busy: false,
      action: "",
      logs: [],
      history: [],
      unlocked: ["r1"],
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "probe") return "borg 1.4.5";
        if (command === "get_config")
          return {
            onboardingComplete: true,
            repositories: [
              { id: "r1", name: "documents", location: "/repo/documents" },
            ],
            profiles: [],
          };
        if (command === "get_status") return structuredClone(status);
        if (command === "run_operation") {
          (window as any).__archiveRequest = args.request;
          if (args.request.action === "archives")
            return {
              exitCode: 0,
              text: "",
              data: {
                archives: [{ name: "docs-1", time: "2026-10-27T12:00:00Z" }],
              },
            };
          if (args.request.action === "restore")
            return { exitCode: 0, data: {}, text: "" };
          if (args.request.action === "files") {
            if ((window as any).__failArchive)
              throw new Error("Repository unavailable");
            return {
              exitCode: 0,
              text: "",
              data: [
                { path: "Documents", type: "d" },
                { path: "Documents/Projects", type: "d" },
                { path: "Documents/Empty", type: "d" },
                {
                  path: "Documents/Projects/notes.txt",
                  type: "-",
                  size: 1234,
                  mtime: "2026-10-27T12:00:00Z",
                },
                {
                  path: "Documents/link",
                  type: "l",
                  linktarget: "/outside/archive",
                },
                { path: "Documents/<img src=x onerror=alert(1)>", type: "-" },
                ...Array.from({ length: 650 }, (_, i) => ({
                  path: `Documents/Many/file-${String(i).padStart(3, "0")}.txt`,
                  type: "-",
                  size: i,
                })),
              ],
            };
          }
        }
        throw new Error(`Unexpected IPC ${command}`);
      },
    };
  });
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Archives", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByRole("button", { name: "Browse", exact: true }).click();
}

test("archive opens inline with independently scrolling folders and contents, breadcrumbs and safe restore context", async ({
  page,
}) => {
  await setup(page);
  await expect(
    page.getByRole("heading", { name: "Archive contents", exact: true }),
  ).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const contents = page.getByRole("region", {
    name: "Folder contents",
    exact: true,
  });
  await contents
    .getByRole("button", { name: "Documents", exact: true })
    .click();
  const tree = page.getByRole("tree", { name: "Archive folder tree" });
  await expect(
    tree.getByRole("button", { name: "Projects", exact: true }),
  ).toBeVisible();
  await tree.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(
    contents.getByRole("button", { name: "notes.txt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Archive folder path" }),
  ).toContainText("Projects");
  await expect(page.locator("#toast")).not.toHaveClass(/bad/);
  await page.screenshot({ path: "test-results/archive-file-manager.png" });
  await page
    .getByRole("navigation", { name: "Archive folder path" })
    .getByRole("button", { name: "Documents", exact: true })
    .click();
  await contents.getByRole("button", { name: "Empty", exact: true }).click();
  await expect(contents).toContainText("No items");
  await page
    .getByRole("button", { name: "Restore whole archive", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("docs-1");
  expect(
    await page.evaluate(() => (window as any).__archiveRequest),
  ).toMatchObject({ action: "files", repositoryId: "r1", archive: "docs-1" });
});

test("full workspace and right-click restore preserve multi-selection and require destination confirmation", async ({
  page,
}) => {
  await setup(page);
  const root = (await page.locator(".archive-explorer").boundingBox())!;
  const main = (await page.locator("main").boundingBox())!;
  const top = (await page.locator(".toolbar").boundingBox())!;
  expect(Math.abs(root.x - main.x - 6)).toBeLessThan(2);
  expect(Math.abs(root.y - (top.y + top.height) - 6)).toBeLessThan(2);
  expect(Math.abs(root.width - main.width + 12)).toBeLessThan(2);
  const contents = page.getByRole("region", {
    name: "Folder contents",
    exact: true,
  });
  await contents
    .getByRole("button", { name: "Documents", exact: true })
    .click();
  await contents
    .getByRole("checkbox", { name: "Select Documents/Projects", exact: true })
    .check();
  await contents
    .getByRole("checkbox", { name: "Select Documents/link", exact: true })
    .check();
  await contents
    .getByRole("button", { name: "Projects", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", {
      name: "Restore selected items (2)...",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Documents/Projects");
  await expect(dialog).toContainText("Documents/link");
  expect(
    await page.evaluate(() => (window as any).__archiveRequest.action),
  ).toBe("files");
  await dialog.locator('[name="destination"]').fill("/safe/empty");
  await dialog
    .getByRole("button", { name: "Restore 2 selected items", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__archiveRequest))
    .toMatchObject({
      action: "restore",
      repositoryId: "r1",
      archive: "docs-1",
      destination: "/safe/empty",
      selectedPaths: ["Documents/Projects", "Documents/link"],
    });
});

test("keyboard context menu cancels without restoration", async ({ page }) => {
  await setup(page);
  const contents = page.getByRole("region", {
    name: "Folder contents",
    exact: true,
  });
  const folder = contents.getByRole("button", {
    name: "Documents",
    exact: true,
  });
  await folder.focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__archiveRequest.action),
  ).toBe("files");
});

test("all entries remain reachable beyond 500, archive-wide search escapes names, and tree can collapse", async ({
  page,
}) => {
  await setup(page);
  const tree = page.getByRole("tree");
  await tree.getByRole("button", { name: "Documents", exact: true }).click();
  await tree.getByRole("button", { name: "Many", exact: true }).click();
  const contents = page.getByRole("region", {
    name: "Folder contents",
    exact: true,
  });
  await contents.getByRole("button", { name: /Show more/ }).click();
  await contents.getByRole("button", { name: /Show more/ }).click();
  await contents.getByRole("button", { name: /Show more/ }).click();
  await expect(
    contents.getByRole("button", { name: "file-649.txt", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search archive" })
    .fill("notes.txt");
  await expect(contents).toContainText("Documents/Projects/notes.txt");
  await page.getByRole("searchbox", { name: "Search archive" }).fill("<img");
  await expect(contents).toContainText("<img src=x onerror=alert(1)>");
  await expect(contents.locator("img")).toHaveCount(0);
  await tree
    .getByRole("button", { name: "Collapse Documents", exact: true })
    .click();
  await expect(
    tree.getByRole("button", { name: "Projects", exact: true }),
  ).toHaveCount(0);
});

test("load errors stay inline with retry and smaller windows retain both panes", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "Back to archives", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).__failArchive = true;
  });
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Repository unavailable");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__failArchive = false;
  });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("tree")).toBeVisible();
  await page.setViewportSize({ width: 680, height: 700 });
  const left = (await page
    .getByRole("complementary", { name: "Archive folders" })
    .boundingBox())!;
  const right = (await page
    .getByRole("region", { name: "Folder contents", exact: true })
    .boundingBox())!;
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + 2);
  expect(right.width).toBeGreaterThan(90);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/archive-file-manager-narrow.png",
  });
});
