import { test, expect, type Page } from "@playwright/test";
async function desktop(page: Page) {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    const config = {
      onboardingComplete: true,
      repositories: [
        { id: "a", name: "Alpha", location: "/alpha" },
        { id: "b", name: "Beta", location: "/beta" },
      ],
      profiles: ["a", "b"].map((id) => ({
        id: "profile-" + id,
        name: "Sources " + id,
        repositoryId: id,
        sources: ["/source/" + id],
        excludes: [],
        keepDaily: 7,
        keepWeekly: 4,
        keepMonthly: 6,
        intervalHours: 0,
      })),
    };
    const status = {
      busy: false,
      action: "",
      logs: [],
      unlocked: ["a", "b"],
      workerRunning: true,
      history: ["a", "b"].map((id, index) => ({
        id: "entry-" + id,
        repositoryId: id,
        profileId: null,
        time: new Date(Date.now() - 10000).toISOString(),
        action: "backup",
        exitCode: index ? 2 : 0,
        message: "Recorded result",
      })),
    };
    (window as any).__panelConfig = config;
    (window as any).__panelRequests = [];
    (window as any).__panelStatus = status;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "probe") return "borg 1.4.5";
        if (command === "get_config") return structuredClone(config);
        if (command === "get_status") return structuredClone(status);
        if (command === "save_config") {
          Object.assign(config, args.config);
          return;
        }
        if (command === "run_operation") {
          const request = args.request;
          (window as any).__panelRequests.push(request);
          let data: any = {};
          if (request.action === "archives")
            data = {
              archives: [
                {
                  name: "shared-name",
                  time: "2026-01-01T00:00:00Z",
                  stats: {
                    nfiles: request.repositoryId === "a" ? 11 : 22,
                    original_size: 1024,
                  },
                },
                {
                  name: "z-" + request.repositoryId,
                  time: "2026-02-01T00:00:00Z",
                  stats: { nfiles: 1, original_size: 5 },
                },
              ],
            };
          if (request.action === "files")
            data = [
              { path: "file-" + request.repositoryId, type: "-", size: 10 },
            ];
          return { exitCode: 0, text: "", data };
        }
        throw new Error(`Unexpected IPC ${command}`);
      },
    };
  });
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.getByRole("article", { name, exact: true });
test("repository panels scope profiles and new drafts, and preserve explicit unsaved editing across collapse and navigation", async ({
  page,
}) => {
  await desktop(page);
  const alpha = row(page, "Alpha"),
    beta = row(page, "Beta");
  await alpha.getByRole("button", { name: "Profiles", exact: true }).click();
  await expect(
    alpha.getByRole("heading", { name: "Sources a", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sources b", exact: true }),
  ).toHaveCount(0);
  await beta.getByRole("button", { name: "Profiles", exact: true }).click();
  await beta.getByRole("button", { name: "New profile", exact: true }).click();
  const form = beta.getByRole("form", {
    name: "New backup profile",
    exact: true,
  });
  await expect(
    form.getByRole("combobox", { name: "Repository", exact: true }),
  ).toHaveValue("b");
  await form.getByLabel("Profile name", { exact: true }).fill("Beta draft");
  await form.locator('[name="sources"]').fill("/new-beta-source");
  await beta.getByRole("button", { name: "Profiles", exact: true }).click();
  await expect(form).toHaveCount(0);
  await beta.getByRole("button", { name: "Profiles", exact: true }).click();
  await expect(form.getByLabel("Profile name", { exact: true })).toHaveValue(
    "Beta draft",
  );
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await expect(form.getByLabel("Profile name", { exact: true })).toHaveValue(
    "Beta draft",
  );
  expect(
    await page.evaluate(() => (window as any).__panelConfig.profiles.length),
  ).toBe(2);
  await form.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    beta.getByRole("heading", { name: "Beta draft", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).__panelConfig.profiles.at(-1).repositoryId,
    ),
  ).toBe("b");
  await expect(
    alpha.getByRole("heading", { name: "Beta draft", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/repository-inline-profiles.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("multiple inline archive panels have independent filters and sorting; browsing returns to the correct repository", async ({
  page,
}) => {
  await desktop(page);
  const alpha = row(page, "Alpha"),
    beta = row(page, "Beta");
  for (const current of [alpha, beta]) {
    await current
      .getByRole("button", { name: "Archives", exact: true })
      .click();
    await current.getByRole("button", { name: "Refresh", exact: true }).click();
  }
  await expect(
    alpha.getByRole("cell", { name: "11", exact: true }),
  ).toBeVisible();
  await expect(
    beta.getByRole("cell", { name: "22", exact: true }),
  ).toBeVisible();
  await alpha.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(alpha.locator('th[aria-sort="ascending"]')).toContainText(
    "Archive",
  );
  await expect(beta.locator('th[aria-sort="descending"]')).toContainText(
    "Created",
  );
  await alpha.getByLabel("Filter archives").fill("shared-name");
  await expect(alpha.locator("tbody tr")).toHaveCount(1);
  await expect(beta.locator("tbody tr")).toHaveCount(2);
  await expect(beta.getByLabel("Filter archives")).toHaveValue("");
  await alpha.getByRole("button", { name: "Browse", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "file-a", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__panelRequests.at(-1)),
  ).toMatchObject({
    action: "files",
    repositoryId: "a",
    archive: "shared-name",
  });
  await page
    .getByRole("button", { name: "Back to archives", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Repositories", exact: true }),
  ).toBeVisible();
  await expect(
    alpha.getByRole("button", { name: "Archives", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(alpha.getByLabel("Filter archives")).toHaveValue("shared-name");
  await page.screenshot({
    path: "test-results/repository-inline-archives.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("repository overview uses only that repository's history, and removed pages have no navigation entries", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await desktop(page);
  const alpha = row(page, "Alpha"),
    beta = row(page, "Beta");
  for (const current of [alpha, beta])
    await current
      .getByRole("button", { name: "Overview", exact: true })
      .click();
  await expect(
    alpha
      .locator(".chart-legend li")
      .filter({ hasText: "Completed" })
      .locator("strong"),
  ).toHaveText("1");
  await expect(
    alpha
      .locator(".chart-legend li")
      .filter({ hasText: "Failed" })
      .locator("strong"),
  ).toHaveText("0");
  await expect(
    beta
      .locator(".chart-legend li")
      .filter({ hasText: "Completed" })
      .locator("strong"),
  ).toHaveText("0");
  await expect(
    beta
      .locator(".chart-legend li")
      .filter({ hasText: "Failed" })
      .locator("strong"),
  ).toHaveText("1");
  await expect(
    page.locator(
      'nav [data-route="overview"], nav [data-route="backups"], nav [data-route="archives"]',
    ),
  ).toHaveCount(0);
  await expect(page.locator("nav button")).toHaveCount(2);
  await page.screenshot({
    path: "test-results/repository-inline-overview.png",
    fullPage: true,
    animations: "disabled",
  });
});
