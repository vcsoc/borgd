import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, relocation = true) {
  await page.addInitScript(
    ({ relocation }) => {
      (window as any).isTauri = true;
      (window as any).__relocationCalls = [];
      const status: any = {
        busy: false,
        action: "",
        logs: [],
        history: [],
        unlocked: ["r1"],
        relocation: null,
      };
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === "probe") return "borg 1.4.5";
          if (command === "get_config")
            return {
              onboardingComplete: true,
              repositories: [
                { id: "r1", name: "documents", location: "/mnt/My Drive/docs" },
              ],
              profiles: [],
            };
          if (command === "get_status") return structuredClone(status);
          (window as any).__relocationCalls.push({ command, args });
          if (command === "run_operation") {
            if (relocation)
              status.relocation = {
                token: "one-shot-token",
                repositoryId: "r1",
                action: "info",
                paths: {
                  oldPath: "/run/media/old <drive>/docs",
                  newPath: "/mnt/My Drive/docs",
                },
              };
            throw new Error(
              relocation
                ? "Repository relocation requires confirmation."
                : "Repository does not exist.",
            );
          }
          if (command === "confirm_relocation") {
            if ((window as any).__rejectConfirmation)
              throw new Error("Confirmation expired. Run the operation again.");
            if (args.token !== status.relocation.token)
              throw new Error("Invalid token");
            status.relocation = null;
            return {
              exitCode: 0,
              data: { encryption: { mode: "repokey-blake2" }, archives: [] },
              text: "",
            };
          }
          if (command === "dismiss_relocation") {
            status.relocation = null;
            return;
          }
          throw new Error(`Unexpected IPC: ${command}`);
        },
      };
    },
    { relocation },
  );
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await page.getByRole("button", { name: "Inspect", exact: true }).click();
}

test("relocation shows escaped paths and never retries before explicit approval", async ({
  page,
}) => {
  await setup(page);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Confirm repository relocation" }),
  ).toBeVisible();
  await expect(dialog).toContainText("/run/media/old <drive>/docs");
  await expect(dialog).toContainText("/mnt/My Drive/docs");
  await expect(dialog.locator("drive")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(() =>
      (window as any).__relocationCalls.filter(
        (c: any) => c.command === "confirm_relocation",
      ),
    ),
  ).toHaveLength(0);
  await page.screenshot({ path: "test-results/relocation-confirmation.png" });
  await dialog.getByRole("button", { name: "Confirm and retry info" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("repokey-blake2", { exact: true })).toBeVisible();
  const calls = await page.evaluate(() => (window as any).__relocationCalls);
  expect(calls.map((c: any) => c.command)).toEqual([
    "run_operation",
    "confirm_relocation",
  ]);
  expect(calls[1].args).toEqual({ token: "one-shot-token" });
});

for (const cancel of ["button", "escape", "close"]) {
  test(`cancel relocation using ${cancel} makes no retry`, async ({ page }) => {
    await setup(page);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (cancel === "escape") await page.keyboard.press("Escape");
    else
      await dialog
        .getByRole("button", {
          name: cancel === "close" ? "Close relocation dialog" : "Cancel",
          exact: true,
        })
        .click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__relocationCalls.map((c: any) => c.command),
        ),
      )
      .toEqual(["run_operation", "dismiss_relocation"]);
    await expect(
      page.getByRole("button", { name: "Inspect", exact: true }),
    ).toBeEnabled();
  });
}

test("a rejected confirmation reports its error instead of reopening the same prompt forever", async ({
  page,
}) => {
  await setup(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    (window as any).__rejectConfirmation = true;
  });
  await dialog.getByRole("button", { name: "Confirm and retry info" }).click();
  await expect(
    page.getByText("Error: Confirmation expired. Run the operation again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).__relocationCalls.map((c: any) => c.command),
    ),
  ).toEqual(["run_operation", "confirm_relocation"]);
});

test("ordinary Borg errors do not trigger a relocation approval", async ({
  page,
}) => {
  await setup(page, false);
  await expect(
    page.getByText("Error: Repository does not exist.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).__relocationCalls.map((c: any) => c.command),
    ),
  ).toEqual(["run_operation"]);
});
