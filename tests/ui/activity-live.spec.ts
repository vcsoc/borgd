import { test, expect } from "@playwright/test";

test("log copy enables as a running operation emits output", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).__liveStatus = {
      busy: true,
      action: "backup",
      logs: [],
      history: [],
      unlocked: [],
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "get_config")
          return { onboardingComplete: true, repositories: [], profiles: [] };
        if (command === "probe") return "borg 1.4.5";
        if (command === "get_status")
          return structuredClone((window as any).__liveStatus);
        if (command === "plugin:clipboard-manager|write_text") {
          (window as any).__copied = args.text;
          return;
        }
        throw new Error(`Unexpected IPC: ${command}`);
      },
    };
  });
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  const copy = page.getByRole("button", {
    name: "Copy operation log",
    exact: true,
  });
  await expect(copy).toBeDisabled();
  await page.evaluate(() =>
    (window as any).__liveStatus.logs.push("Backup progress: 42 files"),
  );
  await expect(copy).toBeEnabled();
  await copy.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__copied))
    .toBe("Backup progress: 42 files");
});
