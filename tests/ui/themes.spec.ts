import { test, expect, type Page } from "@playwright/test";
async function studio(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Theme Studio", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Theme Studio", exact: true }),
  ).toBeVisible();
}
test("eight preview themes apply in both layouts, color headers and persist", async ({
  page,
}) => {
  await studio(page);
  const previews = page
    .getByRole("radiogroup", { name: "Themes" })
    .getByRole("radio");
  await expect(previews).toHaveCount(8);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  for (const mode of ["light", "dark"]) {
    await page
      .getByRole("button", {
        name: mode === "dark" ? "Dark" : "Light",
        exact: true,
      })
      .click();
    for (const name of [
      "Midnight",
      "Ocean",
      "Forest",
      "Ember",
      "Sandstone",
      "Rose",
      "Slate",
      "Custom",
    ]) {
      await page.getByRole("radio", { name, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        name.toLowerCase(),
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme-mode",
        mode,
      );
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue("--header")
            .trim(),
        ),
      ).toMatch(/^#[a-f0-9]{6}$/);
    }
  }
  await page.getByRole("radio", { name: "Ocean", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.screenshot({
    path: "test-results/theme-studio-light.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme-mode",
    "light",
  );
});
test("custom controls and JSON round trip retain both palettes, fonts and layout", async ({
  page,
}) => {
  await studio(page);
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  await page.getByLabel("Repository header", { exact: true }).fill("#234567");
  await page
    .getByRole("combobox", { name: "Custom font family", exact: true })
    .selectOption("sans");
  await page
    .getByRole("combobox", { name: "Custom font size", exact: true })
    .selectOption("16");
  await page
    .getByRole("combobox", { name: "Corner radius", exact: true })
    .selectOption("8");
  await page
    .getByRole("combobox", { name: "Spacing", exact: true })
    .selectOption("comfortable");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByLabel("Repository header", { exact: true }).fill("#abcdef");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export theme JSON", exact: true })
    .click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const document = JSON.parse(Buffer.concat(chunks).toString());
  expect(document).toMatchObject({
    format: "borgd-theme",
    mode: "light",
    colors: { dark: { header: "#234567" }, light: { header: "#abcdef" } },
    font: { family: "sans", size: 16 },
    radius: 8,
    density: "comfortable",
  });
  await page.getByRole("radio", { name: "Midnight", exact: true }).click();
  await page.locator("#theme-import-file").setInputFiles({
    name: "theme.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(
    page.getByRole("radio", { name: "Custom", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByLabel("Repository header", { exact: true }),
  ).toHaveValue("#abcdef");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(
    page.getByLabel("Repository header", { exact: true }),
  ).toHaveValue("#234567");
  await expect(
    page.getByRole("combobox", { name: "Custom font size", exact: true }),
  ).toHaveValue("16");
  await page.screenshot({
    path: "test-results/theme-studio-custom.png",
    fullPage: true,
  });
});
test("invalid imports leave the active theme untouched and mobile studio stays within the viewport", async ({
  page,
}) => {
  await studio(page);
  await page.locator("#theme-import-file").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"format":"evil","css":"url(https://evil.test)"}'),
  });
  await expect(page.locator(".theme-file-status")).toHaveAttribute(
    "role",
    "alert",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/theme-studio-mobile.png",
    fullPage: true,
  });
});
