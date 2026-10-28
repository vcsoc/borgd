import { test, expect, type Page } from "@playwright/test";
async function desktop(page: Page, busy = false) {
  await page.addInitScript(
    ({ busy }) => {
      (window as any).isTauri = true;
      const status = {
        busy,
        action: busy ? "check" : "",
        logs: [],
        history: [],
        unlocked: [] as string[],
        workerRunning: true,
      };
      (window as any).__archiveStatus = status;
      (window as any).__archiveCalls = [];
      (window as any).__archiveResolvers = {};
      (window as any).__archiveRejectors = {};
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === "probe") return "borg 1.4.5";
          if (command === "get_config")
            return {
              onboardingComplete: true,
              repositories: [
                { id: "a", name: "Alpha", location: "/alpha" },
                { id: "b", name: "Beta", location: "/beta" },
              ],
              profiles: [],
            };
          if (command === "get_status") return structuredClone(status);
          if (command === "unlock") {
            status.unlocked.push(args.id);
            return;
          }
          if (command === "lock_repository") {
            status.unlocked = status.unlocked.filter((id) => id !== args.id);
            return;
          }
          if (command === "run_operation") {
            const id = args.request.repositoryId;
            (window as any).__archiveCalls.push(args.request);
            return new Promise((resolve, reject) => {
              (window as any).__archiveResolvers[id] = (names: string[]) =>
                resolve({
                  exitCode: 0,
                  text: "",
                  data: {
                    archives: names.map((name, index) => ({
                      name,
                      time: "2026-01-01T00:00:00Z",
                      stats: { nfiles: index + 1, original_size: 100 },
                    })),
                  },
                });
              (window as any).__archiveRejectors[id] = (message: string) =>
                reject(new Error(message));
            });
          }
          throw new Error(command);
        },
      };
    },
    { busy },
  );
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.getByRole("article", { name, exact: true });
const resolve = (page: Page, id: string, names: string[]) =>
  page.evaluate(
    ({ id, names }) => (window as any).__archiveResolvers[id](names),
    { id, names },
  );
test("opening Archives automatically loads once; pending and failed requests never pretend the repository is empty", async ({
  page,
}) => {
  await desktop(page);
  const alpha = row(page, "Alpha");
  await alpha.getByRole("button", { name: "Archives", exact: true }).click();
  await expect(alpha.locator(".archive-load-status")).toContainText(
    "Loading archives",
  );
  await expect(
    page.getByRole("heading", { name: "No archives yet", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__archiveCalls)).toEqual([
    { action: "archives", repositoryId: "a" },
  ]);
  await alpha
    .getByRole("button", { name: "Refresh", exact: true })
    .dispatchEvent("click");
  expect(await page.evaluate(() => (window as any).__archiveCalls.length)).toBe(
    1,
  );
  await page.evaluate(() =>
    (window as any).__archiveRejectors.a(
      "Repository passphrase is missing or incorrect",
    ),
  );
  await expect(alpha.getByRole("alert")).toContainText(
    "Could not load archives",
  );
  await expect(
    page.getByRole("heading", { name: "No archives yet", exact: true }),
  ).toHaveCount(0);
  await alpha
    .getByRole("button", { name: "Retry loading archives", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__archiveCalls.length))
    .toBe(2);
  await resolve(page, "a", []);
  await expect(
    alpha.getByRole("heading", { name: "No archives yet", exact: true }),
  ).toBeVisible();
  await expect(
    alpha.getByRole("button", { name: "Load archives", exact: true }),
  ).toHaveCount(0);
});
test("reopening reloads, successful lists appear without Refresh, and failed refresh preserves labelled stale data", async ({
  page,
}) => {
  await desktop(page);
  const beta = row(page, "Beta");
  await beta.getByRole("button", { name: "Archives", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__archiveCalls.length))
    .toBe(1);
  await resolve(page, "b", ["existing-archive"]);
  await expect(
    beta.getByText("existing-archive", { exact: true }),
  ).toBeVisible();
  await beta.getByRole("button", { name: "Archives", exact: true }).click();
  await beta.getByRole("button", { name: "Archives", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__archiveCalls.length))
    .toBe(2);
  await page.evaluate(() =>
    (window as any).__archiveRejectors.b("Storage unavailable"),
  );
  await expect(beta.getByRole("alert")).toContainText("previously loaded list");
  await expect(
    beta.getByText("existing-archive", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No archives yet", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/archive-auto-error.png",
    animations: "disabled",
  });
});
test("archive loads wait behind active work and skip panels closed before their turn", async ({
  page,
}) => {
  await desktop(page, true);
  const alpha = row(page, "Alpha"),
    beta = row(page, "Beta");
  await alpha.getByRole("button", { name: "Archives", exact: true }).click();
  await beta.getByRole("button", { name: "Archives", exact: true }).click();
  await expect(beta.locator(".archive-load-status")).toContainText("Waiting");
  expect(await page.evaluate(() => (window as any).__archiveCalls.length)).toBe(
    0,
  );
  await alpha.getByRole("button", { name: "Archives", exact: true }).click();
  await page.evaluate(() => {
    (window as any).__archiveStatus.busy = false;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__archiveCalls))
    .toEqual([{ action: "archives", repositoryId: "b" }]);
  await resolve(page, "b", ["beta-only"]);
  await expect(beta.getByText("beta-only", { exact: true })).toBeVisible();
});
test("first control and heading icon reflect red/closed versus green/open session state, including external changes", async ({
  page,
}) => {
  await desktop(page);
  const alpha = row(page, "Alpha");
  const first = alpha.locator(".repo-actions > button").first();
  await expect(first).toHaveAttribute("aria-label", "Unlock");
  await expect(first).toHaveAttribute("data-lock-state", "locked");
  await expect(first.locator("svg.lucide-lock-keyhole")).toHaveCount(1);
  await expect(alpha.locator(".repository-lock-state")).toHaveAttribute(
    "aria-label",
    "Locked: no session passphrase set",
  );
  expect(await first.evaluate((el) => getComputedStyle(el).color)).toBe(
    "rgb(238, 147, 155)",
  );
  await page.evaluate(() => {
    (window as any).__archiveStatus.unlocked = ["a"];
  });
  await expect(first).toHaveAttribute("aria-label", "Lock");
  await expect(first.locator("svg.lucide-lock-open")).toHaveCount(1);
  expect(await first.evaluate((el) => getComputedStyle(el).color)).toBe(
    "rgb(142, 200, 170)",
  );
  await expect(
    alpha.locator(".repository-lock-state svg.lucide-lock-open"),
  ).toHaveCount(1);
  await first.click();
  await expect(first).toHaveAttribute("data-lock-state", "locked");
  await first.click();
  await alpha
    .getByLabel("Repository passphrase", { exact: true })
    .fill("disposable-test-pass");
  await alpha
    .getByRole("button", { name: "Set session passphrase", exact: true })
    .click();
  await expect(first).toHaveAttribute("data-lock-state", "unlocked");
  await expect(
    row(page, "Beta").locator(".repo-actions > button").first(),
  ).toHaveAttribute("data-lock-state", "locked");
  await page.screenshot({
    path: "test-results/repository-lock-states.png",
    animations: "disabled",
  });
});
