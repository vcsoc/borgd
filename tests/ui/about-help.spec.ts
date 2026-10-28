import { test, expect } from "@playwright/test";
test("About removes the duplicate heading, describes the app and provides a keyboard-toggleable license", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "About borgd", exact: true }).click();
  await expect(page.locator(".page-heading")).toHaveCount(0);
  await expect(page.locator(".about-description")).toContainText(
    "desktop companion for Borg Backup",
  );
  await expect(page.locator(".license-text")).not.toBeVisible();
  const summary = page.locator(".about-license summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".license-text")).toBeVisible();
  await expect(page.locator(".license-text")).toContainText(
    "do not revoke permissions already granted",
  );
  await page.getByRole("button", { name: "About borgd", exact: true }).click();
  await expect(page.locator(".license-text")).toBeVisible();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".license-text")).not.toBeVisible();
  await page.screenshot({
    path: "test-results/about-help-desktop.png",
    fullPage: true,
  });
});
test("Help bookmarks expose instructions, examples and safety notes without performing operations", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "About borgd", exact: true }).click();
  const bookmarks = page.getByRole("navigation", { name: "Help topics" });
  await expect(bookmarks.getByRole("button")).toHaveCount(12);
  for (const button of await bookmarks.getByRole("button").all()) {
    const title = await button.textContent();
    await button.click();
    await expect(page.locator(".help-detail h4")).toHaveText(title!);
    await expect(page.locator(".help-detail ol li")).not.toHaveCount(0);
    await expect(page.locator(".help-example")).not.toBeEmpty();
    await expect(page.locator(".help-note")).toContainText("Keep in mind");
  }
  await bookmarks
    .getByRole("button", { name: "Restore files", exact: true })
    .click();
  await expect(page.locator(".help-detail")).toContainText("empty destination");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/about-help-mobile.png",
    fullPage: true,
  });
});
