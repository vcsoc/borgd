import { test, expect, type Page } from "@playwright/test";
async function desktop(page: Page, history = true) {
  await page.addInitScript(
    ({ history }) => {
      (window as any).isTauri = true;
      const entries = history
        ? Array.from({ length: 32 }, (_, index) => ({
            time: new Date(
              Date.now() - Math.floor(index / 2) * 86400000 - 10000,
            ).toISOString(),
            action: "backup",
            repositoryId: "a",
            profileId: null,
            exitCode: index % 9 === 0 ? 2 : index % 7 === 0 ? 1 : 0,
            message: "Recorded result",
          }))
        : [];
      const status = {
        busy: false,
        action: "",
        logs: [],
        history: entries,
        unlocked: [] as string[],
        workerRunning: true,
      };
      (window as any).__flatStatus = status;
      (window as any).__unlockCalls = [];
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === "probe") return "borg 1.4.5";
          if (command === "get_config")
            return {
              onboardingComplete: true,
              repositories: [
                { id: "a", name: "Documents", location: "/backups/documents" },
                { id: "b", name: "Photos", location: "/backups/photos" },
              ],
              profiles: [],
            };
          if (command === "get_status") return structuredClone(status);
          if (command === "unlock") {
            (window as any).__unlockCalls.push(args);
            if ((window as any).__unlockFailure)
              throw new Error("Worker unavailable. Please retry.");
            if ((window as any).__delayUnlock)
              await new Promise((resolve) => {
                (window as any).__finishUnlock = resolve;
              });
            status.unlocked.push(args.id);
            return;
          }
          if (command === "lock_repository") {
            status.unlocked = status.unlocked.filter((id) => id !== args.id);
            return;
          }
          if (command === "run_operation")
            return {
              exitCode: 0,
              text: "",
              data: {
                encryption: { mode: "repokey" },
                cache: {
                  stats: {
                    unique_csize:
                      args.request.repositoryId === "a"
                        ? 1024 * 1024
                        : 3 * 1024 * 1024,
                    total_size: 8 * 1024 * 1024,
                  },
                },
                archives: [],
              },
            };
          throw new Error(`Unexpected IPC ${command}`);
        },
      };
    },
    { history },
  );
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
}
const documents = (page: Page) =>
  page.locator(".repo-card").filter({
    has: page.getByRole("heading", { name: "Documents", exact: true }),
  });
test("Unlock reveals an inline password form, preserves typing through redraws, and never persists its draft", async ({
  page,
}) => {
  await desktop(page);
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await documents(page)
    .getByRole("button", { name: "Unlock", exact: true })
    .click();
  const form = page.getByRole("form", {
    name: "Unlock Documents",
    exact: true,
  });
  const input = form.getByLabel("Repository passphrase");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("type", "password");
  await input.fill("draft-not-for-storage");
  await page.evaluate(() => {
    (window as any).__flatStatus.busy = true;
  });
  await expect(
    documents(page).getByRole("button", { name: "Inspect", exact: true }),
  ).toBeDisabled();
  await expect(input).toHaveValue("draft-not-for-storage");
  await expect(input).toBeFocused();
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("draft-not-for-storage");
  await page.evaluate(() => {
    (window as any).__flatStatus.busy = false;
  });
  await expect(
    documents(page).getByRole("button", { name: "Inspect", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: "test-results/inline-unlock.png" });
  await input.press("Escape");
  await expect(form).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__unlockCalls.length)).toBe(
    0,
  );
  await documents(page)
    .getByRole("button", { name: "Unlock", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await input.fill("discard-on-navigation");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await expect(form).toHaveCount(0);
  await documents(page)
    .getByRole("button", { name: "Unlock", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(form).toHaveCount(0);
});
test("inline unlock submits once, clears failed secrets, and supports an empty unencrypted passphrase", async ({
  page,
}) => {
  await desktop(page);
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await documents(page)
    .getByRole("button", { name: "Unlock", exact: true })
    .click();
  const form = page.getByRole("form", {
    name: "Unlock Documents",
    exact: true,
  });
  const input = form.getByLabel("Repository passphrase");
  await page.evaluate(() => {
    (window as any).__unlockFailure = true;
  });
  await input.fill("failed-test-passphrase");
  await input.press("Enter");
  await expect(form.getByRole("alert")).toContainText("Worker unavailable");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await page.evaluate(() => {
    (window as any).__unlockFailure = false;
    (window as any).__delayUnlock = true;
  });
  await input.press("Enter");
  await expect(form).toHaveAttribute("aria-busy", "true");
  await expect(
    form.getByRole("button", { name: "Set session passphrase", exact: true }),
  ).toBeDisabled();
  await form.evaluate((el: HTMLFormElement) => el.requestSubmit());
  expect(await page.evaluate(() => (window as any).__unlockCalls.length)).toBe(
    2,
  );
  await page.evaluate(() => (window as any).__finishUnlock());
  await expect(form).toHaveCount(0);
  await expect(
    documents(page).getByRole("button", { name: "Lock", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__unlockCalls[1])).toEqual({
    id: "a",
    passphrase: "",
  });
});
test("overview renders real-history graph, accessible heatmap, outcomes and inspected-storage pies without cards", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1910, height: 1200 });
  await desktop(page);
  await documents(page)
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Backup rhythm", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trend-chart")).toHaveCount(1);
  await expect(page.locator(".heatmap > .heat-cell")).toHaveCount(84);
  await expect(page.locator(".donut-chart")).toHaveCount(1);
  await expect(
    page.getByText("No usage is estimated.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  for (const name of ["Documents", "Photos"]) {
    const row = page
      .locator(".repo-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await row.getByRole("button", { name: "Inspect", exact: true }).click();
    await expect(row.getByText("repokey", { exact: true })).toBeVisible();
    expect(
      await row.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
  }
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await expect(page.locator(".donut-chart")).toHaveCount(2);
  await expect(page.getByText("1 of 1 inspected this window")).toHaveCount(1);
  await page.screenshot({
    path: "test-results/flat-overview-desktop.png",
    fullPage: true,
  });
  await page.getByText("View daily counts", { exact: true }).click();
  await expect(page.locator(".chart-data tbody tr")).toHaveCount(84);
  await page.getByText("View daily counts", { exact: true }).click();
  await page.setViewportSize({ width: 700, height: 1000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/flat-overview-narrow.png",
    fullPage: true,
  });
});
test("empty charts are honest and graph refreshes when worker history changes", async ({
  page,
}) => {
  await desktop(page, false);
  await documents(page)
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(page.locator(".trend-chart")).toHaveCount(0);
  await expect(page.locator(".donut-chart")).toHaveCount(0);
  await expect(
    page.getByText("No backup runs recorded in this period.", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => {
    (window as any).__flatStatus.history.push({
      time: new Date(Date.now() - 1000).toISOString(),
      action: "backup",
      repositoryId: "a",
      profileId: null,
      exitCode: 0,
      message: "Completed",
    });
  });
  await expect(page.locator(".trend-chart")).toHaveCount(1);
  await expect(page.locator(".donut-chart")).toHaveCount(1);
});

test("calendar rolls over at local midnight even when retained history is unchanged", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 9, 27, 12) });
  await desktop(page, false);
  await documents(page)
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await expect(page.locator(".heatmap > .heat-cell").last()).toHaveAttribute(
    "title",
    /^2026-10-27:/,
  );
  await page.clock.setSystemTime(new Date(2026, 9, 28, 12));
  await page.clock.runFor(1000);
  await expect(page.locator(".heatmap > .heat-cell").last()).toHaveAttribute(
    "title",
    /^2026-10-28:/,
  );
});
