import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  colorTokens,
  themeNames,
  themeState,
  palette,
  parseTheme,
  exportTheme,
  importTheme,
  selectTheme,
  updateCustomFromTheme,
  setThemeMode,
  setCustomColor,
  setCustomLayout,
} from "./themes";
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  vi.stubGlobal("document", {
    documentElement: { dataset: {}, style: { setProperty: vi.fn() } },
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
it("provides eight complete themes with distinct dark and light headers", () => {
  expect(Object.keys(themeNames)).toHaveLength(8);
  expect(themeState().theme).toBe("midnight");
  for (const id of Object.keys(themeNames) as (keyof typeof themeNames)[]) {
    const dark = palette(id, "dark"),
      light = palette(id, "light");
    expect(dark.header).not.toBe(light.header);
    for (const mode of [dark, light]) {
      expect(Object.keys(mode).sort()).toEqual(Object.keys(colorTokens).sort());
      for (const color of Object.values(mode))
        expect(color).toMatch(/^#[a-f0-9]{6}$/);
      expect(mode.highlight).not.toBe(mode.highlightText);
    }
  }
});
it("persists custom colors independently in each mode and preserves them across presets", () => {
  selectTheme("custom");
  setCustomColor("header", "#123456");
  setThemeMode("light");
  setCustomColor("header", "#abcdef");
  selectTheme("forest");
  selectTheme("custom");
  expect(palette("custom", "dark").header).toBe("#123456");
  expect(palette("custom", "light").header).toBe("#abcdef");
  setCustomLayout(8, "comfortable");
  expect(themeState()).toMatchObject({ radius: 8, density: "comfortable" });
});
it("exports only appearance data and imports a complete theme as Custom", () => {
  storage.set("repository-passphrase", "must-not-export");
  selectTheme("ocean");
  setThemeMode("light");
  const text = exportTheme();
  expect(text).not.toContain("must-not-export");
  const document = parseTheme(text);
  expect(document).toMatchObject({
    name: "Ocean",
    mode: "light",
    font: { family: "mono", size: 14 },
  });
  importTheme(text);
  expect(themeState()).toMatchObject({
    theme: "custom",
    mode: "light",
    custom: document.colors,
  });
});
it("rejects malformed, oversized, executable and unsupported themes without changing preferences", () => {
  const good = JSON.parse(exportTheme());
  for (const bad of [
    "not json",
    "x".repeat(131073),
    JSON.stringify({ ...good, version: 2 }),
    JSON.stringify({ ...good, css: "url(https://evil.test)" }),
    JSON.stringify({ ...good, font: { family: "url(evil)", size: 14 } }),
    JSON.stringify({
      ...good,
      colors: {
        ...good.colors,
        dark: { ...good.colors.dark, header: "red; background:url(evil)" },
      },
    }),
    JSON.stringify({ ...good, radius: -1 }),
  ]) {
    const before = [...storage];
    expect(() => importTheme(bad)).toThrow();
    expect([...storage]).toEqual(before);
  }
  expect(() => setCustomColor("__proto__", "#123456")).toThrow();
});
it("recovers from broken local preferences and ignores unknown presets", () => {
  storage.set("borgd-theme-studio", "{");
  expect(themeState().theme).toBe("midnight");
  selectTheme("__proto__");
  expect(themeState().theme).toBe("midnight");
});

it("copies both template palettes and layout into Custom without mutating the preset", () => {
  selectTheme("custom");
  setCustomColor("header", "#123456");
  setCustomLayout(12, "comfortable");
  setThemeMode("light");
  const dark = palette("forest", "dark"),
    light = palette("forest", "light");
  updateCustomFromTheme("forest");
  expect(themeState()).toMatchObject({
    theme: "custom",
    mode: "light",
    radius: 4,
    density: "compact",
    custom: { dark, light },
  });
  setCustomColor("header", "#654321");
  expect(palette("forest", "light")).toEqual(light);
  expect(palette("custom", "dark")).toEqual(dark);
});
