import { test, expect } from "@playwright/test";
for (const [zone, summer, winter] of [
  ["America/New_York", "Oct 27, 2026, 10:38 PM", "Jan 27, 2026, 9:38 PM"],
  ["Asia/Tokyo", "Oct 28, 2026, 11:38 AM", "Jan 28, 2026, 11:38 AM"],
]) {
  test.describe(zone, () => {
    test.use({ timezoneId: zone, locale: "en-US" });
    test("Created uses local time and seasonal offset, not the archive-name timestamp", async ({
      page,
    }) => {
      await page.addInitScript(() => {
        (window as any).isTauri = true;
        (window as any).__TAURI_INTERNALS__ = {
          invoke: async (command: string) => {
            if (command === "probe") return "borg 1.4.5";
            if (command === "get_config")
              return {
                onboardingComplete: true,
                repositories: [
                  { id: "r", name: "Local dates", location: "/temporary" },
                ],
                profiles: [],
              };
            if (command === "get_status")
              return {
                busy: false,
                workerRunning: true,
                logs: [],
                history: [],
                unlocked: [],
              };
            if (command === "run_operation")
              return {
                exitCode: 0,
                text: "",
                data: {
                  archives: [
                    {
                      name: "borgd-a1y25k-summer",
                      time: "2026-10-28T02:38:43.732Z",
                    },
                    {
                      name: "borgd-a1y25k-winter",
                      time: "2026-01-28T02:38:43.732Z",
                    },
                  ],
                },
              };
            throw new Error(command);
          },
        };
      });
      await page.goto("/");
      await page.getByRole("button", { name: "Archives", exact: true }).click();
      await expect(
        page
          .locator(".archive-table tbody tr")
          .filter({ hasText: "borgd-a1y25k-summer" })
          .locator("td")
          .nth(1),
      ).toHaveText(summer);
      await expect(
        page
          .locator(".archive-table tbody tr")
          .filter({ hasText: "borgd-a1y25k-winter" })
          .locator("td")
          .nth(1),
      ).toHaveText(winter);
      await expect(
        page.getByRole("button", { name: /Created/ }),
      ).toHaveAttribute("title", new RegExp(zone));
    });
  });
}
