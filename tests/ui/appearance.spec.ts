import { test, expect } from "@playwright/test";
test("larger default text and appearance controls apply and persist font preferences", async ({
  page,
}) => {
  await page.goto("/");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
  ).toBe("15px");
  await page
    .getByRole("button", { name: "Settings & help", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true }),
  ).toBeVisible();
  await page.locator("#appearance-family").selectOption("mono");
  await page.locator("#appearance-size").selectOption("18");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
  ).toBe("18px");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontFamily,
    ),
  ).toContain("JetBrains Mono");
  await page.reload();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
  ).toBe("18px");
  await page
    .getByRole("button", { name: "Settings & help", exact: true })
    .click();
  await expect(page.locator("#appearance-size")).toHaveValue("18");
  await expect(page.locator("#appearance-family")).toHaveValue("mono");
  await page.screenshot({ path: "test-results/appearance-settings.png" });
  await page
    .getByRole("button", { name: "Reset appearance", exact: true })
    .click();
  await expect(page.locator("#appearance-size")).toHaveValue("15");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).fontSize,
    ),
  ).toBe("15px");
});
