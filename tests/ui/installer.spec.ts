import { test, expect, type Page } from "@playwright/test";
async function missingBorg(
  page: Page,
  supported = true,
  alreadyInstalled = false,
) {
  await page.addInitScript(
    ({ supported, alreadyInstalled }) => {
      (window as any).isTauri = true;
      (window as any).__installCalls = [];
      let installed = false,
        plan = 0;
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === "get_config")
            return { onboardingComplete: true, repositories: [], profiles: [] };
          if (command === "get_status")
            return {
              busy: false,
              action: "",
              history: [],
              logs: [],
              unlocked: [],
            };
          if (command === "probe") {
            if (!installed) throw new Error("Borg is not installed");
            return "borg 1.4.5";
          }
          if (command === "get_install_plan") {
            if (alreadyInstalled) installed = true;
            return {
              installedVersion: alreadyInstalled ? "borg 1.4.5" : null,
              id: `plan-${++plan}`,
              available: supported && !alreadyInstalled,
              title: "System package manager",
              message: supported
                ? "Install from trusted configured package repositories. Your OS may request administrator authorization."
                : "A desktop authorization agent or supported package-manager prerequisite is required.",
              commands: supported
                ? ["pkexec /usr/bin/apt-get install --yes borgbackup"]
                : [],
            };
          }
          if (command === "dismiss_install_plan") return;
          if (command === "install_borg") {
            (window as any).__installCalls.push(args);
            if ((window as any).__denyInstall)
              throw new Error("Administrator authorization cancelled");
            installed = true;
            return "borg 1.4.5";
          }
          throw new Error(`Unexpected IPC ${command}`);
        },
      };
    },
    { supported, alreadyInstalled },
  );
  await page.goto("/");
}
test("missing Borg prompts but does not install without explicit approval", async ({
  page,
}) => {
  await missingBorg(page);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Install Borg Backup?", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText("pkexec /usr/bin/apt-get");
  expect(
    await page.evaluate(() => (window as any).__installCalls),
  ).toHaveLength(0);
  await page.screenshot({ path: "test-results/borg-install-consent.png" });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__installCalls),
  ).toHaveLength(0);
});
test("approved setup re-probes Borg and enables the installed engine", async ({
  page,
}) => {
  await missingBorg(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Install Borg Backup", exact: true })
    .click();
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__installCalls)).toEqual([
    { planId: "plan-1" },
  ]);
});
test("authorization failure is actionable and never silently retries", async ({
  page,
}) => {
  await missingBorg(page);
  await page.evaluate(() => {
    (window as any).__denyInstall = true;
  });
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Install Borg Backup", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Administrator authorization cancelled",
  );
  expect(
    await page.evaluate(() => (window as any).__installCalls),
  ).toHaveLength(1);
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    (window as any).__denyInstall = false;
  });
  await dialog
    .getByRole("button", { name: "Install Borg Backup", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__installCalls)).toEqual([
    { planId: "plan-1" },
    { planId: "plan-2" },
  ]);
});
test("Borg installed by another application is re-probed without requesting installation", async ({
  page,
}) => {
  await missingBorg(page, true, true);
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__installCalls),
  ).toHaveLength(0);
});
test("unsupported setup explains prerequisites instead of executing a download script", async ({
  page,
}) => {
  await missingBorg(page, false);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("prerequisite");
  await expect(
    dialog.getByRole("button", { name: "Install Borg Backup", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "View setup guide", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Settings & help", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).__installCalls),
  ).toHaveLength(0);
});
