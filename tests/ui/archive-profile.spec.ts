import { test, expect, type Page } from "@playwright/test";
async function desktop(page: Page) {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).__status = {
      busy: false,
      action: "",
      logs: [],
      history: [],
      unlocked: ["repo"],
      workerRunning: true,
    };
    (window as any).__config = {
      onboardingComplete: true,
      repositories: [
        { id: "repo", name: "Documents", location: "/tmp/disposable-repo" },
      ],
      profiles: [
        {
          id: "profile",
          name: "documents",
          repositoryId: "repo",
          sources: ["/home/example/Documents"],
          excludes: [],
          keepDaily: 7,
          keepWeekly: 4,
          keepMonthly: 6,
          intervalHours: 0,
        },
      ],
    };
    (window as any).__saves = [];
    (window as any).__operations = [];
    (window as any).__pickPath = "/home/example/Pictures";
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "get_config")
          return structuredClone((window as any).__config);
        if (command === "get_status")
          return structuredClone((window as any).__status);
        if (command === "probe") return "borg 1.4.5";
        if (command === "plugin:dialog|open") return (window as any).__pickPath;
        if (command === "save_config") {
          (window as any).__saves.push(args.config);
          if ((window as any).__rejectSave)
            throw new Error(
              "Wait for the active operation before changing settings.",
            );
          (window as any).__config = structuredClone(args.config);
          return;
        }
        if (command === "run_operation") {
          (window as any).__operations.push(args.request);
          return {
            exitCode: 0,
            text: "",
            data: {
              archives: [
                {
                  name: (window as any).__longArchiveName ?? "older",
                  id: "a",
                  time: "2026-01-01T00:00:00Z",
                  stats: { nfiles: 10, original_size: 2000 },
                },
                {
                  name: "newest",
                  id: "b",
                  time: "2026-03-01T00:00:00Z",
                  stats: { nfiles: 0, original_size: 0 },
                },
                {
                  name: "middle",
                  id: "c",
                  time: "2026-02-01T00:00:00Z",
                  stats: { nfiles: 2, original_size: 100 },
                },
                { name: "unknown", id: "d", time: "invalid" },
              ],
            },
          };
        }
        throw new Error(`Unexpected IPC ${command}`);
      },
    };
  });
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
}
test("archive headers toggle sorting with newest first and honest per-archive counts/sizes", async ({
  page,
}) => {
  await desktop(page);
  await page.getByRole("button", { name: "Archives", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const names = page.locator(".archive-name code");
  await expect(names).toHaveText(["newest", "middle", "older", "unknown"]);
  await expect(
    page.getByRole("columnheader", { name: "Created", exact: true }),
  ).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("button", { name: "Created", exact: true }).click();
  await expect(names).toHaveText(["older", "middle", "newest", "unknown"]);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(names).toHaveText(["middle", "newest", "older", "unknown"]);
  await page
    .getByRole("button", { name: "Files backed up", exact: true })
    .click();
  await expect(names).toHaveText(["newest", "middle", "older", "unknown"]);
  await page
    .getByRole("button", { name: "Files backed up", exact: true })
    .click();
  await expect(names).toHaveText(["older", "middle", "newest", "unknown"]);
  await page.getByRole("button", { name: "Total size", exact: true }).click();
  await expect(names).toHaveText(["newest", "middle", "older", "unknown"]);
  await expect(page.locator("tbody tr").first()).toContainText("0 B");
  await expect(page.locator("tbody tr").last()).toContainText("Unavailable");
  await page.screenshot({ path: "test-results/archive-sorting-stats.png" });
});
test("long archive names stay on one line and narrow tables scroll instead of squeezing the name column", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__longArchiveName = "borgd-" + "0123456789abcdef".repeat(8);
  });
  await page.setViewportSize({ width: 953, height: 900 });
  await desktop(page);
  await page.getByRole("button", { name: "Archives", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const name = page.locator('.archive-name code[title^="borgd-"]');
  await expect(name).toHaveCount(1);
  expect((await name.boundingBox())!.height).toBeLessThan(30);
  expect(
    await page
      .locator(".archive-list")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBeTruthy();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "test-results/archive-long-name-narrow.png" });
});
test("profile editing is inline, Source picker appends uniquely, and background renders/failures preserve draft", async ({
  page,
}) => {
  await desktop(page);
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit documents", exact: true })
    .click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Edit backup profile", exact: true }),
  ).toBeVisible();
  const form = page.getByRole("form", { name: "Edit backup profile" });
  await form.getByLabel("Profile name", { exact: true }).fill("Unsaved name");
  const pick = form.getByRole("button", { name: "+ Source", exact: true });
  await pick.click();
  await pick.click();
  await expect(form.locator('[name="sources"]')).toHaveValue(
    "/home/example/Documents\n/home/example/Pictures",
  );
  const label = (await form.locator(".source-heading label").boundingBox())!,
    button = (await pick.boundingBox())!;
  expect(button.x).toBeGreaterThan(label.x + label.width);
  expect(Math.abs(button.y - label.y)).toBeLessThan(30);
  await page.evaluate(() => {
    (window as any).__status.busy = true;
  });
  await expect(page.locator("#running-label")).toHaveText("Working");
  await expect(form.getByLabel("Profile name", { exact: true })).toHaveValue(
    "Unsaved name",
  );
  await page.evaluate(() => {
    (window as any).__status.busy = false;
    (window as any).__rejectSave = true;
  });
  await form.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText(
    "Wait for the active operation",
  );
  await expect(form.locator('[name="sources"]')).toHaveValue(
    "/home/example/Documents\n/home/example/Pictures",
  );
  await page.screenshot({ path: "test-results/inline-profile-editor.png" });
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(() => (window as any).__config.profiles[0].name),
  ).toBe("documents");
});
test("inline profile saves explicitly and deletion still needs its own confirmation", async ({
  page,
}) => {
  await desktop(page);
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit documents", exact: true })
    .click();
  await page
    .getByLabel("Profile name", { exact: true })
    .fill("Updated profile");
  await page.locator('[name="intervalHours"]').fill("2");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Backup profiles", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).__config.profiles[0].intervalHours,
    ),
  ).toBe(2);
  await page
    .getByRole("button", { name: "Edit Updated profile", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete profile", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByRole("form", { name: "Edit backup profile" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 640, height: 900 });
  await page.screenshot({ path: "test-results/inline-profile-narrow.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  expect(await page.evaluate(() => (window as any).__operations)).toHaveLength(
    0,
  );
});
