import { test, expect } from "@playwright/test";
test("fixed icon rail contains only logo, Repositories and Activity; branding and tools live in the top bar", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Repositories", exact: true }),
  ).toBeVisible();
  expect((await page.locator(".sidebar").boundingBox())!.width).toBe(64);
  await expect(page.locator(".sidebar nav button")).toHaveCount(2);
  await expect(page.locator(".sidebar button")).toHaveCount(3);
  await expect(page.locator(".sidebar .rail-logo")).toHaveAttribute(
    "title",
    "borgd home",
  );
  await expect(page.locator(".toolbar .top-brand")).toContainText("borgd");
  await expect(page.locator(".toolbar .version")).toHaveText("0.1");
  for (const label of ["Terminal", "Settings & help"]) {
    const button = page
      .locator(".toolbar")
      .getByRole("button", { name: label, exact: true });
    await expect(button).toHaveAttribute("title", label);
    await expect(button.locator("svg")).toHaveCount(1);
    await expect(button).toHaveText("");
  }
  await expect(page.locator(".toolbar .engine-status")).toBeVisible();
  await expect(
    page.getByText("Ready when you are", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".repository-nav, .sidebar-bottom, .sidebar-resize"),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/repository-rail-desktop.png" });
});
test("narrow rail stays compact with larger saved typography and small screens", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Settings & help", exact: true })
    .click();
  await page.locator("#appearance-size").selectOption("20");
  expect((await page.locator(".sidebar").boundingBox())!.width).toBe(64);
  await page.reload();
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await page.setViewportSize({ width: 480, height: 900 });
  expect((await page.locator(".sidebar").boundingBox())!.width).toBe(54);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Activity", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/repository-rail-narrow.png" });
});
