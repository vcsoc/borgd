import { test, expect, type Page } from "@playwright/test";
async function desktop(page: Page) {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).__zoomCalls = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === "probe") return "borg 1.4.5";
        if (command === "get_config")
          return {
            onboardingComplete: true,
            repositories: [
              { id: "a", name: "Documents", location: "/documents" },
              { id: "b", name: "Photos", location: "/photos" },
            ],
            profiles: [],
          };
        if (command === "get_status")
          return {
            busy: false,
            action: "",
            unlocked: [],
            logs: [],
            history: [
              {
                id: "1",
                time: new Date(Date.now() - 10000).toISOString(),
                action: "backup",
                repositoryId: "a",
                profileId: null,
                exitCode: 0,
                message: "Completed",
              },
            ],
          };
        if (command === "plugin:webview|set_webview_zoom") {
          (window as any).__zoomCalls.push(args);
          return;
        }
        if (command === "open_project_url") {
          (window as any).__projectOpened = true;
          return;
        }
        throw new Error(command);
      },
    };
  });
  await page.goto("/");
  await expect(page.getByText("borg 1.4.5", { exact: true })).toBeVisible();
}
test("compact repository actions default to icons with tooltips, real scoped mini graphs, and a persistent text-mode switch", async ({
  page,
}) => {
  await desktop(page);
  const documents = page.getByRole("article", {
    name: "Documents",
    exact: true,
  });
  const photos = page.getByRole("article", { name: "Photos", exact: true });
  const inspect = documents.getByRole("button", {
    name: "Inspect",
    exact: true,
  });
  await expect(inspect).toHaveAttribute(
    "title",
    "Inspect this repository to load encryption and storage details.",
  );
  await expect(inspect.locator(".button-label")).toBeHidden();
  await expect(page.locator(".repo-card > p.muted")).toHaveCount(0);
  await expect(documents.locator(".repo-rhythm svg")).toHaveAttribute(
    "aria-label",
    /^1 recorded/,
  );
  await expect(photos.locator(".repo-rhythm svg")).toHaveAttribute(
    "aria-label",
    /^0 recorded/,
  );
  await expect(
    documents
      .getByRole("button", { name: "Forget repository", exact: true })
      .locator("svg.lucide-trash-2"),
  ).toHaveCount(1);
  await page.screenshot({
    path: "test-results/compact-repository-rows.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Settings & help", exact: true })
    .click();
  const toggle = page.getByRole("switch", {
    name: "Icon-only action buttons",
    exact: true,
  });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await expect(inspect.locator(".button-label")).toBeVisible();
  await page.reload();
  await expect(inspect.locator(".button-label")).toBeVisible();
  await page
    .getByRole("button", { name: "Settings & help", exact: true })
    .click();
  await toggle.check();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await expect(inspect.locator(".button-label")).toBeHidden();
});
test("14px mono defaults, native zoom shortcuts and reset are independent of font preferences", async ({
  page,
}) => {
  await desktop(page);
  await expect(page.locator("html")).toHaveCSS("font-size", "14px");
  await page.evaluate(() => {
    const trap = document.createElement("input");
    trap.addEventListener("keydown", (event) =>
      event.stopImmediatePropagation(),
    );
    document.body.append(trap);
    trap.focus();
  });
  await page.keyboard.press("Control+=");
  await expect(page.locator("html")).toHaveAttribute("data-zoom", "1.1");
  await page.keyboard.press("Control+-");
  await expect(page.locator("html")).toHaveAttribute("data-zoom", "1");
  await page.keyboard.press("Control+=");
  await expect(page.locator("html")).toHaveAttribute("data-zoom", "1.1");
  await page.keyboard.press("Control+0");
  await expect(page.locator("html")).toHaveAttribute("data-zoom", "1");
  expect(await page.evaluate(() => (window as any).__zoomCalls)).toEqual([
    { label: "main", value: 1.1 },
    { label: "main", value: 1 },
    { label: "main", value: 1.1 },
    { label: "main", value: 1 },
  ]);
  await expect(page.locator("html")).toHaveCSS("font-size", "14px");
});
test("top branding opens inline About with developer, GitHub link and exact custom license terms", async ({
  page,
}) => {
  await desktop(page);
  await page.getByRole("button", { name: "About borgd", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "About borgd", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Developed by Chris Visser", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".about-page h2")).toHaveText("borgd 0.1.1");
  const link = page.getByRole("link", {
    name: "https://github.com/vcsoc/borgd",
    exact: true,
  });
  await expect(link).toHaveAttribute("href", "https://github.com/vcsoc/borgd");
  await expect(link.locator("svg.lucide-github")).toHaveCount(1);
  await expect(page.locator(".license-text")).toContainText(
    "prior written approval from Chris Visser",
  );
  await expect(page.locator(".license-text")).toContainText(
    "do not revoke permissions already granted",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await link.click();
  expect(
    await page.evaluate(() => (window as any).__projectOpened),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/about-borgd.png",
    animations: "disabled",
  });
});

test("rapid zoom shortcuts and reset apply in order", async ({ page }) => {
  await desktop(page);
  await page.evaluate(() => {
    for (const key of ["+", "+", "+", "0"])
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__zoomCalls.length))
    .toBe(4);
  await expect(page.locator("html")).toHaveAttribute("data-zoom", "1");
  expect(
    await page.evaluate(() =>
      (window as any).__zoomCalls.map((call: any) => call.value),
    ),
  ).toEqual([1.1, 1.2, 1.3, 1]);
});
