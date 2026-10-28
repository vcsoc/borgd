import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appearance, applyAppearance, saveAppearance } from "./appearance";
let stored: string | null;
let style: { fontFamily?: string; fontSize?: string };
beforeEach(() => {
  stored = null;
  style = {};
  vi.stubGlobal("localStorage", {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
  vi.stubGlobal("document", { documentElement: { style } });
});
afterEach(() => vi.unstubAllGlobals());
it("uses the larger default and recovers from malformed stored preferences", () => {
  expect(appearance()).toEqual({ family: "mono", size: 15 });
  stored = "invalid JSON";
  applyAppearance();
  expect(style.fontSize).toBe("15px");
});
it("persists supported font families and applies the requested base size", () => {
  saveAppearance("mono", 18);
  expect(appearance()).toEqual({ family: "mono", size: 18 });
  expect(style.fontFamily).toContain("JetBrains Mono");
  expect(style.fontSize).toBe("18px");
});
it("rejects unsupported font values and out-of-range sizes", () => {
  saveAppearance("__proto__", 14);
  expect(stored).toBeNull();
  saveAppearance("mono", 100);
  expect(stored).toBeNull();
  stored = JSON.stringify({ family: "untrusted font; color:red", size: 200 });
  expect(appearance()).toEqual({ family: "mono", size: 20 });
});
