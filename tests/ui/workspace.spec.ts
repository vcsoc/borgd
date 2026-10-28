import { test, expect } from "@playwright/test";

test("browser preview is honest, navigable, and responsive", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Repositories", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Run the Tauri desktop app", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add a repository", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Settings & help", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Borg engine" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Somewhere safe for your files" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 480, height: 850 });
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Repositories", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/overview-narrow.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("desktop UI contract: create, back up, browse, and preview retention", async ({
  page,
}) => {
  // This is an IPC contract mock. Actual Borg execution is tested separately in Rust.
  await page.addInitScript(() => {
    let config = { repositories: [] as any[], profiles: [] as any[] };
    const status = {
      busy: false,
      action: "",
      logs: [] as string[],
      history: [] as any[],
      unlocked: [] as string[],
    };
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "get_config") return structuredClone(config);
        if (command === "save_config") {
          config = args.config;
          return;
        }
        if (command === "get_status") return structuredClone(status);
        if (command === "probe") return "borg 1.4.5";
        if (command === "unlock") {
          status.unlocked.push(args.id);
          return;
        }
        if (command === "run_operation") {
          const request = args.request;
          (window as any).__lastRequest = request;
          status.history.unshift({
            ...request,
            time: new Date().toISOString(),
            exitCode: 0,
            message: "Completed",
          });
          status.logs = [`${request.action}: test repository`, "Completed"];
          let data: any = null;
          if (request.action === "info")
            data = {
              encryption: { mode: "repokey-blake2" },
              cache: { stats: { unique_csize: 1024, total_size: 4096 } },
            };
          if (request.action === "archives")
            data = {
              archives: [
                {
                  name: "borgd-test-2026-01-01",
                  time: "2026-01-01T00:00:00Z",
                  id: "abc",
                },
              ],
            };
          if (request.action === "files")
            data = [{ type: "-", path: "home/test/file.txt", size: 42 }];
          return { exitCode: 0, data, text: "" };
        }
        throw new Error(`Unexpected IPC command: ${command}`);
      },
    };
  });
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5")).toBeVisible();
  await page
    .getByRole("button", { name: "Add a repository", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Work <safe>");
  await page.getByLabel("Repository location").fill("/backups/work");
  await page.getByRole("button", { name: "Connect repository" }).click();
  await expect(
    page.getByRole("heading", { name: "Work <safe>", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  await page.getByLabel("Profile name").fill("Documents");
  await page
    .getByLabel("Source folders", { exact: false })
    .fill("/home/test/Documents");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("button", { name: "Back up", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Recent activity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "backup", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await page.getByRole("button", { name: "Archives", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    page.getByText("borgd-test-2026-01-01", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  const contents = page.getByRole("region", {
    name: "Folder contents",
    exact: true,
  });
  await contents.getByRole("button", { name: "home", exact: true }).click();
  await contents.getByRole("button", { name: "test", exact: true }).click();
  await expect(
    contents.getByRole("button", { name: "file.txt", exact: true }),
  ).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Back to archives", exact: true })
    .click();
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "Edit Documents" }).click();
  await page
    .getByRole("button", { name: "Preview prune", exact: true })
    .click();
  await page.getByRole("button", { name: "Run preview", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__lastRequest))
    .toMatchObject({ action: "prune", dryRun: true });
});
