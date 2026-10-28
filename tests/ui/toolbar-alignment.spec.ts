import { test, expect } from "@playwright/test";

test("toolbar text, badge, status and icons share one centerline with even group spacing", async ({
  page,
}) => {
  await page.goto("/");
  for (const size of ["14", "20"]) {
    await page
      .getByRole("button", { name: "Settings & help", exact: true })
      .click();
    await page.locator("#appearance-size").selectOption(size);
    for (const width of [1280, 953, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const toolbar = document
          .querySelector(".toolbar")!
          .getBoundingClientRect();
        const center = toolbar.top + toolbar.height / 2;
        const items = [
          ...document.querySelectorAll(
            ".top-brand strong, .top-brand .version, .brand-tagline, .engine-status, .engine-status > span, .top-icon, .top-icon svg",
          ),
        ].filter((el) => el.getBoundingClientRect().width > 0);
        const tools = [...document.querySelector(".top-tools")!.children].map(
          (el) => el.getBoundingClientRect(),
        );
        const brand = [...document.querySelector(".top-brand")!.children]
          .map((el) => el.getBoundingClientRect())
          .filter((rect) => rect.width > 0);
        return {
          offsets: items.map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              name: el.className?.toString(),
              offset: Math.abs(rect.top + rect.height / 2 - center),
            };
          }),
          toolGaps: [
            tools[1].left - tools[0].right,
            tools[2].left - tools[1].right,
          ],
          brandGaps: brand
            .slice(1)
            .map((rect, index) => rect.left - brand[index].right),
          fits:
            toolbar.right <= innerWidth &&
            tools[2].right <= toolbar.right &&
            document.documentElement.scrollWidth <= innerWidth,
        };
      });
      for (const item of layout.offsets)
        expect(
          item.offset,
          `${width}px/${size}px: ${item.name}`,
        ).toBeLessThanOrEqual(0.75);
      expect(
        Math.abs(layout.toolGaps[0] - layout.toolGaps[1]),
      ).toBeLessThanOrEqual(0.75);
      if (layout.brandGaps.length > 1)
        expect(
          Math.abs(layout.brandGaps[0] - layout.brandGaps[1]),
        ).toBeLessThanOrEqual(0.75);
      expect(layout.fits).toBeTruthy();
      if (size === "14" && width === 953)
        await page.screenshot({
          path: "test-results/toolbar-alignment.png",
          animations: "disabled",
        });
    }
  }
});
