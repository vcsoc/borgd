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

test("preview context menu copies both template variants into editable Custom and supports keyboard dismissal", async ({
  page,
}) => {
  await studio(page);
  const forest = page.getByRole("radio", { name: "Forest", exact: true });
  await forest.click({ button: "right" });
  await expect(page.getByRole("menu", { name: "Theme actions" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(forest).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "midnight");
  await forest.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Update Custom", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Custom", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByLabel("Repository header", { exact: true }),
  ).toHaveValue("#2a4536");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(
    page.getByLabel("Repository header", { exact: true }),
  ).toHaveValue("#d3e5c9");
  await page.getByLabel("Repository header", { exact: true }).fill("#abcdef");
  await forest.click();
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--header")
        .trim(),
    ),
  ).toBe("#d3e5c9");
});

test("color editor starts at the exact swatch color and cancels or applies explicitly", async ({ page }) => {
  await studio(page);
  await page.getByRole("radio", { name: "Custom", exact: true }).click();
  const swatch = page.getByLabel("Repository header", { exact: true });
  await swatch.fill("#234567"); await swatch.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: "Hex color", exact: true })).toHaveValue("#234567");
  await expect(dialog.getByRole("slider", { name: "Red", exact: true })).toHaveValue("35");
  await expect(dialog.getByRole("slider", { name: "Green", exact: true })).toHaveValue("69");
  await expect(dialog.getByRole("slider", { name: "Blue", exact: true })).toHaveValue("103");
  await dialog.getByRole("textbox", { name: "Hex color", exact: true }).fill("#aabbcc");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(swatch).toHaveValue("#234567");
  await swatch.click();
  await expect(dialog.getByRole("textbox", { name: "Hex color", exact: true })).toHaveValue("#234567");
  await dialog.getByRole("textbox", { name: "Hex color", exact: true }).fill("#123456");
  await dialog.getByRole("button", { name: "Apply color", exact: true }).click();
  await expect(swatch).toHaveValue("#123456");
  await swatch.press("Enter");
  await expect(dialog.getByRole("textbox", { name: "Hex color", exact: true })).toHaveValue("#123456");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
test("studio has two preview columns on the left and Custom on the right, stacking on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await studio(page);
  const geometry = await page.evaluate(() => {
    const previews = [...document.querySelectorAll('.theme-preview')].map(node => node.getBoundingClientRect());
    const grid = document.querySelector('.theme-previews')!.getBoundingClientRect();
    const custom = document.querySelector('.custom-theme-editor')!.getBoundingClientRect();
    return { columns: new Set(previews.map(box => Math.round(box.left))).size, customRight: custom.left >= grid.right, aligned: Math.abs(custom.top - grid.top) < 2 };
  });
  expect(geometry).toEqual({ columns: 2, customRight: true, aligned: true });
  await page.screenshot({ path: "test-results/theme-studio-split.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.querySelector('.custom-theme-editor')!.getBoundingClientRect().top >= document.querySelector('.theme-previews')!.getBoundingClientRect().bottom)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
