import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    const status: any = {
      busy: false,
      action: "",
      logs: [],
      history: [],
      unlocked: [],
    };
    (window as any).__checkStatus = status;
    (window as any).__checkCalls = 0;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "probe") return "borg 1.4.5";
        if (command === "get_config")
          return {
            onboardingComplete: true,
            repositories: [
              {
                id: "r1",
                name: "documents",
                location: "/mnt/Visser1TB/backups/borg/documents",
              },
            ],
            profiles: [],
          };
        if (command === "get_status") return structuredClone(status);
        if (command === "unlock") {
          status.unlocked = [args.id];
          return;
        }
        if (command === "run_operation") {
          (window as any).__checkCalls++;
          status.busy = true;
          status.action = "check";
          status.logs = ["check: documents"];
          return new Promise((resolve, reject) => {
            (window as any).__finishCheck = (exitCode: number) => {
              status.busy = false;
              const message =
                exitCode === 0
                  ? "Completed"
                  : "Repository passphrase is missing or incorrect. Set the correct session passphrase using Unlock, then retry.";
              status.history.unshift({
                time: new Date().toISOString(),
                action: "check",
                repositoryId: "r1",
                profileId: null,
                exitCode,
                message,
              });
              if (exitCode === 0) resolve({ exitCode, data: {}, text: "" });
              else reject(new Error(message));
            };
          });
        }
        throw new Error(`Unexpected IPC ${command}`);
      },
    };
  });
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await page.getByRole("button", { name: "Check", exact: true }).click();
}

test("check confirmation closes before completion and Activity shows live phase progress", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Run integrity check" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Activity", exact: true }),
  ).toBeVisible();
  const progress = page.getByRole("progressbar");
  await expect(progress).toBeVisible();
  await expect(progress).not.toHaveAttribute("value");
  await page.evaluate(() =>
    (window as any).__checkStatus.logs.push("Checking segments 75.0%"),
  );
  await expect(progress).toHaveAttribute("value", "75");
  await expect(
    page.getByRole("heading", { name: "Checking repository segments" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/check-live-progress.png" });
  await page.evaluate(() =>
    (window as any).__checkStatus.logs.push("Checking archives 0.0%"),
  );
  await expect(progress).toHaveAttribute("value", "0");
  await expect(
    page.getByRole("heading", { name: "Checking archives" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__finishCheck(0));
  await expect(
    page.getByRole("heading", { name: "Integrity check completed" }),
  ).toBeVisible();
  await expect(progress).toHaveAttribute("value", "100");
});

test("failed check stays in Activity with an actionable passphrase error, not a blocked confirmation dialog", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Run integrity check" }).click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__finishCheck))
    .toBe("function");
  await page.evaluate(() => (window as any).__finishCheck(2));
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Integrity check failed" }),
  ).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Set session passphrase", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "Unlock documents" }),
  ).toBeVisible();
  await expect(page.locator('input[name="passphrase"]')).toHaveAttribute(
    "type",
    "password",
  );
});

test("cancelling the integrity confirmation starts no operation", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__checkCalls)).toBe(0);
});
