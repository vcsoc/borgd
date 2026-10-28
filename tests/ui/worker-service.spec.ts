import { test, expect, type Page } from "@playwright/test";
async function desktop(page: Page, manager = "systemd user service") {
  await page.addInitScript(
    ({ manager }) => {
      (window as any).isTauri = true;
      const status = {
        workerRunning: true,
        workerOffline: false,
        busy: false,
        action: "",
        history: [],
        logs: [],
        unlocked: ["temporary-repo"],
      };
      const service = {
        manager,
        registered: false,
        conflict: false,
        running: true,
        stopping: false,
        paused: false,
        definition: "borgd-worker",
      };
      (window as any).__serviceActions = [];
      (window as any).__serviceFail = false;
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === "probe") return "borg 1.4.5";
          if (command === "get_config")
            return { onboardingComplete: true, repositories: [], profiles: [] };
          if (command === "get_status") return structuredClone(status);
          if (command === "worker_service_info")
            return structuredClone(service);
          if (command === "worker_service_action") {
            (window as any).__serviceActions.push(args.action);
            if ((window as any).__serviceFail)
              throw new Error("Service manager denied the request");
            if (args.action === "register") service.registered = true;
            if (["stop", "uninstall"].includes(args.action)) {
              status.workerRunning = service.running = false;
              status.workerOffline = service.paused = true;
              status.unlocked = [];
            }
            if (args.action === "uninstall") service.registered = false;
            if (args.action === "start") {
              status.workerRunning = service.running = true;
              status.workerOffline = service.paused = false;
            }
            return structuredClone(service);
          }
          throw new Error(command);
        },
      };
    },
    { manager },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Settings & help", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Register worker startup", exact: true }),
  ).toBeEnabled();
}
test("worker controls register, confirm graceful stop, start and uninstall without deleting application data", async ({
  page,
}) => {
  await desktop(page);
  const section = page.getByRole("region", {
    name: "Background backups",
    exact: true,
  });
  await expect(section).toContainText("systemd user service");
  await expect(
    section.getByRole("button", { name: "Start worker", exact: true }),
  ).toBeDisabled();
  await section
    .getByRole("button", { name: "Register worker startup", exact: true })
    .click();
  await expect(section).toContainText("Startup registered.");
  await section
    .getByRole("button", { name: "Stop worker", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Memory-only repository passphrases will be cleared",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).__serviceActions)).toEqual([
    "register",
  ]);
  await section
    .getByRole("button", { name: "Stop worker", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Stop worker", exact: true })
    .click();
  await expect(section).toContainText("Worker stopped");
  await section
    .getByRole("button", { name: "Start worker", exact: true })
    .click();
  await expect(section).toContainText("Worker connected");
  await section
    .getByRole("button", { name: "Uninstall worker startup", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "repositories, archives and profiles remain unchanged",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Uninstall worker startup", exact: true })
    .click();
  await expect(section).toContainText("Startup not registered.");
  expect(await page.evaluate(() => (window as any).__serviceActions)).toEqual([
    "register",
    "stop",
    "start",
    "uninstall",
  ]);
  await expect(
    page.getByText(
      "Version 0.1.0 · Rust + Tauri · Developed by Chris Visser.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/worker-service-controls.png",
    animations: "disabled",
  });
});
for (const manager of [
  "XDG desktop autostart",
  "macOS per-user launchd LaunchAgent",
  "Windows Task Scheduler, current user only",
]) {
  test(`worker controls describe ${manager} and failures do not pretend to register startup`, async ({
    page,
  }) => {
    await desktop(page, manager);
    const section = page.getByRole("region", {
      name: "Background backups",
      exact: true,
    });
    await expect(section).toContainText(manager);
    await page.evaluate(() => {
      (window as any).__serviceFail = true;
    });
    await section
      .getByRole("button", { name: "Register worker startup", exact: true })
      .click();
    await expect(section).toContainText("Service manager denied the request");
    await expect(section).toContainText("Startup not registered.");
    await expect(
      section.getByRole("button", {
        name: "Register worker startup",
        exact: true,
      }),
    ).toBeEnabled();
  });
}
