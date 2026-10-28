import { test, expect, type Page } from "@playwright/test";

async function desktop(
  page: Page,
  options: {
    used?: boolean;
    repository?: boolean;
    history?: boolean;
    unavailable?: boolean;
  } = {},
) {
  await page.addInitScript((options) => {
    (window as any).isTauri = true;
    let config = {
      onboardingComplete: !!options.used,
      repositories: options.repository
        ? [{ id: "repo", name: "Existing", location: "/backups/existing" }]
        : [],
      profiles: [],
    };
    const status = {
      busy: false,
      action: "",
      logs: [],
      unlocked: [],
      history: options.history
        ? [
            {
              action: "info",
              time: "2026-01-01T00:00:00Z",
              repositoryId: "repo",
              profileId: null,
              exitCode: 0,
              message: "Completed",
            },
          ]
        : [],
    };
    let counter = 0;
    const sessions = new Map<number, number[]>();
    (window as any).__terminalWrites = [];
    (window as any).__terminalResizes = [];
    (window as any).__terminalClosed = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "get_config") return structuredClone(config);
        if (command === "save_config") {
          config = args.config;
          return;
        }
        if (command === "get_status") return structuredClone(status);
        if (command === "probe") {
          if (options.unavailable)
            throw new Error("Diagnostic: system Borg could not start");
          return "borg 1.4.5";
        }
        if (command === "terminal_create") {
          const id = ++counter;
          sessions.set(
            id,
            Array.from(new TextEncoder().encode(`System shell ${id}\r\n$ `)),
          );
          return { id, shell: "/bin/bash" };
        }
        if (command === "terminal_read") {
          const data = sessions.get(args.id) || [];
          sessions.set(args.id, []);
          return { data, exited: false, exitCode: null, dropped: false };
        }
        if (command === "terminal_write") {
          (window as any).__terminalWrites.push(args);
          sessions.get(args.id)!.push(...new TextEncoder().encode(args.data));
          return;
        }
        if (command === "terminal_resize") {
          (window as any).__terminalResizes.push(args);
          return;
        }
        if (command === "terminal_close") {
          (window as any).__terminalClosed.push(args.id);
          sessions.delete(args.id);
          return;
        }
        throw new Error(`Unexpected IPC: ${command}`);
      },
    };
  }, options);
  await page.goto("/");
}

for (const [name, options] of [
  ["fresh installation", {}],
  ["configured repository", { repository: true }],
  ["previously completed setup with no repositories left", { used: true }],
  ["legacy installation with operation history", { history: true }],
] as const) {
  test(`onboarding: ${name}`, async ({ page }) => {
    await desktop(page, options);
    await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
    await expect(page.locator(".welcome, .getting-started")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Somewhere safe for your files" }),
    ).toHaveCount("repository" in options ? 0 : 1);
    await expect(page.locator(".notice")).toHaveCount(0);
  });
}

test("returning installs show engine failures in settings, not onboarding", async ({
  page,
}) => {
  await desktop(page, { used: true, unavailable: true });
  await expect(
    page.getByText("Borg unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".notice")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Somewhere safe for your files" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Settings & help", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Diagnostic: system Borg could not start",
  );
});

test("docked terminal supports input, tabs, navigation, hide, close, and saved resizing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await desktop(page, { used: true });
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const dock = page.getByRole("region", { name: "Integrated system terminal" });
  await expect(dock).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Terminal 1", exact: true }),
  ).toBeVisible();
  await expect.poll(() => dock.textContent()).toContain("System shell 1");
  await page
    .locator(".terminal-screen:not([hidden]) .xterm-helper-textarea")
    .focus();
  await page.keyboard.type("printf hello");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__terminalWrites.map((w: any) => w.data).join(""),
      ),
    )
    .toContain("printf hello\r");
  const grip = page.getByRole("separator", { name: "Resize terminal panel" });
  const before = await dock.boundingBox();
  await grip.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect
    .poll(async () => (await dock.boundingBox())!.height)
    .toBe(before!.height + 32);
  const gripBox = (await grip.boundingBox())!;
  await page.mouse.move(gripBox.x + 30, gripBox.y + 3);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + 30, gripBox.y - 21, { steps: 3 });
  await page.mouse.up();
  await expect
    .poll(async () => (await dock.boundingBox())!.height)
    .toBe(before!.height + 56);
  const saved = await page.evaluate(() =>
    localStorage.getItem("borgd.terminal.height"),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).__terminalResizes.length))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "New terminal tab" }).click();
  await expect(
    page.getByRole("tab", { name: "Terminal 2", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Terminal 1", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Terminal 1", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Settings & help", exact: true })
    .click();
  await expect(dock).toBeVisible();
  await expect.poll(() => dock.textContent()).toContain("System shell 1");
  await page
    .getByRole("button", {
      name: "Hide terminal panel (keep sessions running)",
    })
    .click();
  await expect(dock).toBeHidden();
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Terminal 2", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/integrated-terminal.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Close Terminal 2 and stop its shell" })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__terminalClosed))
    .toEqual([2]);
  await expect(
    page.getByRole("tab", { name: "Terminal 1", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  await expect
    .poll(async () => (await dock.boundingBox())!.height)
    .toBe(Number(saved));
  await grip.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await dock.boundingBox())!.height).toBe(120);
  const screen = (await page
    .locator(".terminal-screen:not([hidden])")
    .boundingBox())!;
  const xterm = (await page
    .locator(".terminal-screen:not([hidden]) .xterm")
    .boundingBox())!;
  expect(xterm.height).toBeLessThanOrEqual(screen.height);
  expect(errors).toEqual([]);
});
