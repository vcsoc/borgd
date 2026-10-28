import { appearance, applyAppearance, saveAppearance } from "./appearance";
import { escape as e } from "./model";

export const colorTokens = {
  bg: "Workspace background",
  sidebar: "Navigation background",
  panel: "Panel background",
  header: "Repository header",
  toolbar: "Toolbar background",
  input: "Input background",
  button: "Button background",
  buttonHover: "Button hover",
  line: "Borders and dividers",
  text: "Main text",
  muted: "Secondary text",
  faint: "Subtle text",
  accent: "Accent and links",
  accentText: "Accent button text",
  selection: "Selected controls",
  highlight: "Selected text background",
  highlightText: "Selected text foreground",
  green: "Success and unlocked",
  danger: "Errors and locked",
  warning: "Warnings",
  chartOk: "Chart success",
  chartFail: "Chart failure",
  chartWarn: "Chart warning",
  terminal: "Terminal background",
  terminalText: "Terminal text",
  footer: "Footer background",
  code: "Code background",
  overlay: "Dialog backdrop",
} as const;
export type Colors = Record<keyof typeof colorTokens, string>;
type Mode = "dark" | "light";
export const themeNames = {
  midnight: "Midnight",
  ocean: "Ocean",
  forest: "Forest",
  ember: "Ember",
  sandstone: "Sandstone",
  rose: "Rose",
  slate: "Slate",
  custom: "Custom",
} as const;
type ThemeId = keyof typeof themeNames;
interface State {
  version: 1;
  theme: ThemeId;
  mode: Mode;
  custom: Record<Mode, Colors>;
  radius: number;
  density: "compact" | "comfortable";
}
export interface ThemeDocument {
  format: "borgd-theme";
  version: 1;
  name: string;
  mode: Mode;
  colors: Record<Mode, Colors>;
  font: { family: string; size: number };
  radius: number;
  density: "compact" | "comfortable";
}
const key = "borgd-theme-studio";
const baseDark: Colors = {
  bg: "#18191b",
  sidebar: "#202123",
  panel: "#202225",
  header: "#242a35",
  toolbar: "#1b1c1e",
  input: "#1b1e24",
  button: "#292c31",
  buttonHover: "#363d49",
  line: "#30343d",
  text: "#e8eaf0",
  muted: "#a0a8b7",
  faint: "#8792a5",
  accent: "#91b0ff",
  accentText: "#17233b",
  selection: "#303e58",
  highlight: "#416eb6",
  highlightText: "#ffffff",
  green: "#8ec8aa",
  danger: "#ee939b",
  warning: "#e7bd7d",
  chartOk: "#94cabc",
  chartFail: "#e4979c",
  chartWarn: "#e7bd7d",
  terminal: "#14171c",
  terminalText: "#d3dbe8",
  footer: "#191b1f",
  code: "#1d222b",
  overlay: "#080b12",
};
const baseLight: Colors = {
  bg: "#f3f5f8",
  sidebar: "#e6eaf0",
  panel: "#ffffff",
  header: "#dce5f3",
  toolbar: "#e8edf4",
  input: "#ffffff",
  button: "#e3e9f1",
  buttonHover: "#d2dced",
  line: "#c4ccd8",
  text: "#202b3a",
  muted: "#505e71",
  faint: "#5e6c80",
  accent: "#345fa7",
  accentText: "#ffffff",
  selection: "#d5e1f5",
  highlight: "#345fa7",
  highlightText: "#ffffff",
  green: "#286744",
  danger: "#a33343",
  warning: "#825717",
  chartOk: "#28745e",
  chartFail: "#b13f4a",
  chartWarn: "#946021",
  terminal: "#f7f9fc",
  terminalText: "#25334a",
  footer: "#e8edf3",
  code: "#e8edf4",
  overlay: "#1a263a",
};
const tones: Record<string, { dark: Partial<Colors>; light: Partial<Colors> }> =
  {
    ocean: {
      dark: {
        bg: "#111d27",
        sidebar: "#162934",
        panel: "#192e3b",
        header: "#203d50",
        toolbar: "#142630",
        input: "#13232e",
        button: "#243e4e",
        buttonHover: "#315568",
        line: "#34515e",
        accent: "#80d7e7",
        accentText: "#102e39",
        selection: "#254b60",
        highlight: "#286b94",
        footer: "#142630",
        code: "#172d3b",
      },
      light: {
        bg: "#eef7f9",
        sidebar: "#dbeaf0",
        header: "#c9e5ee",
        toolbar: "#e0eff4",
        button: "#d8eaf0",
        buttonHover: "#c1dde7",
        line: "#adcbd6",
        accent: "#12647c",
        selection: "#c8e7f0",
        highlight: "#12647c",
        footer: "#e0eff4",
        code: "#e0eff4",
      },
    },
    forest: {
      dark: {
        bg: "#14201b",
        sidebar: "#1b2c23",
        panel: "#203329",
        header: "#2a4536",
        toolbar: "#18291f",
        input: "#19291f",
        button: "#2c4333",
        buttonHover: "#3b5741",
        line: "#3b5042",
        accent: "#b0d69b",
        accentText: "#193222",
        selection: "#354e34",
        highlight: "#477449",
        footer: "#18291f",
        code: "#1b2e22",
      },
      light: {
        bg: "#f1f6ee",
        sidebar: "#e0ebda",
        header: "#d3e5c9",
        toolbar: "#e5efdf",
        button: "#dfebd8",
        buttonHover: "#cce0c2",
        line: "#bacdb0",
        accent: "#386532",
        selection: "#d4e7c9",
        highlight: "#386532",
        footer: "#e5efdf",
        code: "#e5efdf",
      },
    },
    ember: {
      dark: {
        bg: "#251a17",
        sidebar: "#30211c",
        panel: "#362720",
        header: "#4c3026",
        toolbar: "#2c1f1a",
        input: "#2a1e1a",
        button: "#49332b",
        buttonHover: "#614337",
        line: "#574035",
        accent: "#f2b58b",
        accentText: "#3b2115",
        selection: "#5b3c2c",
        highlight: "#9c4d2d",
        footer: "#2c1f1a",
        code: "#32231c",
      },
      light: {
        bg: "#fcf3ed",
        sidebar: "#f0e0d4",
        header: "#f0d3bd",
        toolbar: "#f5e6dc",
        button: "#efddcf",
        buttonHover: "#e8cbb7",
        line: "#d7bda9",
        accent: "#96451f",
        selection: "#f0d6c1",
        highlight: "#96451f",
        footer: "#f5e6dc",
        code: "#f5e6dc",
      },
    },
    sandstone: {
      dark: {
        bg: "#24221c",
        sidebar: "#302d24",
        panel: "#363227",
        header: "#474130",
        toolbar: "#2b281f",
        input: "#2b281f",
        button: "#45402f",
        buttonHover: "#5a523a",
        line: "#514b3a",
        accent: "#e2ca8b",
        accentText: "#342a13",
        selection: "#51472e",
        highlight: "#82703c",
        footer: "#2b281f",
        code: "#302c21",
      },
      light: {
        bg: "#f8f5eb",
        sidebar: "#eae4d2",
        header: "#e8dbb9",
        toolbar: "#f0eadb",
        button: "#e9e0c9",
        buttonHover: "#ded0af",
        line: "#cfc3a5",
        accent: "#78601c",
        selection: "#e9dcba",
        highlight: "#78601c",
        footer: "#f0eadb",
        code: "#f0eadb",
      },
    },
    rose: {
      dark: {
        bg: "#251a1e",
        sidebar: "#322229",
        panel: "#39272f",
        header: "#4d303e",
        toolbar: "#2d1f26",
        input: "#2c1f25",
        button: "#48303c",
        buttonHover: "#5c3d4d",
        line: "#553e49",
        accent: "#efb0bc",
        accentText: "#3d1d29",
        selection: "#583446",
        highlight: "#97475f",
        footer: "#2d1f26",
        code: "#33232b",
      },
      light: {
        bg: "#fcf1f3",
        sidebar: "#f0dfe4",
        header: "#efd0da",
        toolbar: "#f5e5e9",
        button: "#efdae1",
        buttonHover: "#e5c1cd",
        line: "#d6b8c2",
        accent: "#94435c",
        selection: "#efd2dc",
        highlight: "#94435c",
        footer: "#f5e5e9",
        code: "#f5e5e9",
      },
    },
    slate: {
      dark: {
        bg: "#1d2228",
        sidebar: "#252d35",
        panel: "#2b343e",
        header: "#364454",
        toolbar: "#222a32",
        input: "#242c35",
        button: "#35414e",
        buttonHover: "#465668",
        line: "#44515f",
        accent: "#bbcedf",
        accentText: "#213044",
        selection: "#3c4d62",
        highlight: "#496b91",
        footer: "#222a32",
        code: "#27323e",
      },
      light: {
        bg: "#f0f4f7",
        sidebar: "#e0e7ed",
        header: "#d1dfe9",
        toolbar: "#e5ecf2",
        button: "#dce5ed",
        buttonHover: "#c8d8e5",
        line: "#b8c7d3",
        accent: "#415f7a",
        selection: "#d1e1ee",
        highlight: "#415f7a",
        footer: "#e5ecf2",
        code: "#e5ecf2",
      },
    },
  };
function defaults(): State {
  return {
    version: 1,
    theme: "midnight",
    mode: "dark",
    custom: { dark: { ...baseDark }, light: { ...baseLight } },
    radius: 4,
    density: "compact",
  };
}
function colors(value: unknown): Colors {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== Object.keys(colorTokens).length
  )
    throw new Error("Theme must contain every supported color token.");
  const result = {} as Colors;
  for (const token of Object.keys(colorTokens) as (keyof Colors)[]) {
    const color = (value as Record<string, unknown>)[token];
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))
      throw new Error(`Invalid theme color: ${token}. Use #RRGGBB.`);
    result[token] = color.toLowerCase();
  }
  return result;
}
export function parseTheme(source: string): ThemeDocument {
  if (source.length > 131072) throw new Error("Theme JSON exceeds 128 KiB.");
  const value = JSON.parse(source);
  const allowed = [
    "format",
    "version",
    "name",
    "mode",
    "colors",
    "font",
    "radius",
    "density",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    value.format !== "borgd-theme" ||
    value.version !== 1 ||
    !["dark", "light"].includes(value.mode)
  )
    throw new Error(
      "Unsupported theme document. Expected borgd-theme version 1.",
    );
  if (
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 60 ||
    /[\x00-\x1f]/.test(value.name)
  )
    throw new Error("Invalid theme name.");
  if (
    !value.font ||
    !["mono", "sans", "serif", "system"].includes(value.font.family) ||
    !Number.isInteger(value.font.size) ||
    value.font.size < 12 ||
    value.font.size > 20
  )
    throw new Error(
      "Theme font must use a supported family and a size from 12 to 20.",
    );
  if (
    !Number.isInteger(value.radius) ||
    value.radius < 0 ||
    value.radius > 16 ||
    !["compact", "comfortable"].includes(value.density)
  )
    throw new Error("Invalid theme radius or density.");
  return {
    format: "borgd-theme",
    version: 1,
    name: value.name,
    mode: value.mode,
    colors: {
      dark: colors(value.colors?.dark),
      light: colors(value.colors?.light),
    },
    font: { family: value.font.family, size: value.font.size },
    radius: value.radius,
    density: value.density,
  };
}
export function themeState(): State {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      !value ||
      value.version !== 1 ||
      !Object.hasOwn(themeNames, value.theme) ||
      !["dark", "light"].includes(value.mode)
    )
      return defaults();
    return {
      ...defaults(),
      theme: value.theme,
      mode: value.mode,
      custom: {
        dark: colors(value.custom.dark),
        light: colors(value.custom.light),
      },
      radius:
        Number.isInteger(value.radius) &&
        value.radius >= 0 &&
        value.radius <= 16
          ? value.radius
          : 4,
      density: value.density === "comfortable" ? "comfortable" : "compact",
    };
  } catch {
    return defaults();
  }
}
export function palette(id: ThemeId, mode: Mode, state = themeState()): Colors {
  return id === "custom"
    ? { ...state.custom[mode] }
    : { ...(mode === "dark" ? baseDark : baseLight), ...tones[id]?.[mode] };
}
const variable = (token: string) =>
  `--${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
export function applyTheme() {
  const state = themeState(),
    root = document.documentElement;
  root.dataset.theme = state.theme;
  root.dataset.themeMode = state.mode;
  root.dataset.themeDensity =
    state.theme === "custom" ? state.density : "compact";
  root.style.colorScheme = state.mode;
  for (const [token, color] of Object.entries(
    palette(state.theme, state.mode, state),
  ))
    root.style.setProperty(variable(token), color);
  root.style.setProperty(
    "--theme-radius",
    `${state.theme === "custom" ? state.radius : 4}px`,
  );
  window.dispatchEvent(new Event("borgd-theme"));
}
function commit(state: State) {
  localStorage.setItem(key, JSON.stringify(state));
  applyTheme();
}
export function selectTheme(id: string) {
  if (!Object.hasOwn(themeNames, id)) return;
  commit({ ...themeState(), theme: id as ThemeId });
}
export function setThemeMode(mode: string) {
  if (mode === "dark" || mode === "light") commit({ ...themeState(), mode });
}
export function setCustomColor(token: string, color: string) {
  if (!Object.hasOwn(colorTokens, token) || !/^#[0-9a-f]{6}$/i.test(color))
    throw new Error("Invalid custom color.");
  const state = themeState();
  state.theme = "custom";
  state.custom[state.mode][token as keyof Colors] = color.toLowerCase();
  commit(state);
}
export function setCustomLayout(radius: number, density: string) {
  if (
    !Number.isInteger(radius) ||
    radius < 0 ||
    radius > 16 ||
    !["compact", "comfortable"].includes(density)
  )
    throw new Error("Invalid custom layout.");
  commit({
    ...themeState(),
    theme: "custom",
    radius,
    density: density as State["density"],
  });
}
export function exportTheme(): string {
  const state = themeState();
  return JSON.stringify(
    {
      format: "borgd-theme",
      version: 1,
      name: themeNames[state.theme],
      mode: state.mode,
      colors: {
        dark: palette(state.theme, "dark", state),
        light: palette(state.theme, "light", state),
      },
      font: appearance(),
      radius: state.theme === "custom" ? state.radius : 4,
      density: state.theme === "custom" ? state.density : "compact",
    },
    null,
    2,
  );
}
export function importTheme(source: string) {
  const document = parseTheme(source); // Validate the entire document before touching preferences.
  const previous = localStorage.getItem(key),
    previousFont = localStorage.getItem("borgd-appearance");
  try {
    saveAppearance(document.font.family, document.font.size);
    commit({
      version: 1,
      theme: "custom",
      mode: document.mode,
      custom: document.colors,
      radius: document.radius,
      density: document.density,
    });
  } catch (error) {
    if (previous === null) localStorage.removeItem(key);
    else localStorage.setItem(key, previous);
    if (previousFont === null) localStorage.removeItem("borgd-appearance");
    else localStorage.setItem("borgd-appearance", previousFont);
    applyAppearance();
    applyTheme();
    throw error;
  }
}
export function terminalColors() {
  const style = getComputedStyle(document.documentElement),
    color = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
  return {
    background: color("--terminal", "#14171c"),
    foreground: color("--terminal-text", "#d3dbe8"),
    cursor: color("--accent", "#a9c3ff"),
    selectionBackground: color("--highlight", "#416eb6"),
    selectionForeground: color("--highlight-text", "#ffffff"),
  };
}
export function themeStudioView() {
  const state = themeState(),
    font = appearance();
  return `<section class="settings-card theme-studio" id="theme-studio" aria-label="Theme Studio"><div class="theme-studio-heading"><div><h2>Theme Studio</h2><p>Choose a layout, then a theme. Saved on this device; Midnight is the original charcoal workspace.</p></div><div class="theme-file-actions"><button class="theme-file-button" data-action="theme-export" aria-label="Export theme JSON" title="Export theme to JSON"><i data-lucide="download"></i></button><button class="theme-file-button" data-action="theme-import" aria-label="Import theme JSON" title="Import JSON as the Custom theme"><i data-lucide="upload"></i></button><input type="file" id="theme-import-file" accept="application/json,.json" hidden></div></div><div class="theme-layout" role="group" aria-label="Theme layout"><button class="theme-mode" data-action="theme-mode" data-mode="dark" aria-pressed="${state.mode === "dark"}" title="Use dark layout"><i data-lucide="moon"></i>Dark</button><button class="theme-mode" data-action="theme-mode" data-mode="light" aria-pressed="${state.mode === "light"}" title="Use light layout"><i data-lucide="sun"></i>Light</button></div><div class="theme-previews" role="radiogroup" aria-label="Themes">${(
    Object.keys(themeNames) as ThemeId[]
  )
    .map((id) => {
      const p = palette(id, state.mode, state);
      return `<button class="theme-preview" role="radio" tabindex="${state.theme === id ? 0 : -1}" aria-checked="${state.theme === id}" aria-label="${themeNames[id]}" data-action="theme-select" data-theme="${id}" title="Apply ${themeNames[id]} ${state.mode} theme" style="--preview-bg:${p.bg};--preview-panel:${p.panel};--preview-header:${p.header};--preview-accent:${p.accent};--preview-text:${p.text}"><span class="theme-preview-scene" aria-hidden="true"><span class="theme-preview-rail"></span><span class="theme-preview-content"><span class="theme-preview-bar"></span><span class="theme-preview-line"></span><span class="theme-preview-block"></span></span></span><span class="theme-preview-name">${themeNames[id]}${state.theme === id ? '<span aria-hidden="true">✓</span>' : ""}</span></button>`;
    })
    .join("")}</div>${
    state.theme === "custom"
      ? `<div class="custom-theme-editor"><h3>Custom · ${state.mode} palette</h3><p>Colors are independent for dark and light layouts. Fonts are shared with Appearance. Only validated local colors and supported fonts are imported; no CSS, scripts or URLs.</p><div class="theme-typography"><label class="field">Custom font family<select id="custom-theme-family">${[
          ["mono", "JetBrains Mono"],
          ["sans", "Noto Sans"],
          ["serif", "Noto Serif"],
          ["system", "System sans-serif"],
        ]
          .map(
            ([id, label]) =>
              `<option value="${id}" ${font.family === id ? "selected" : ""}>${label}</option>`,
          )
          .join(
            "",
          )}</select></label><label class="field">Custom font size<select id="custom-theme-size">${Array.from(
          { length: 9 },
          (_, i) => i + 12,
        )
          .map(
            (size) =>
              `<option value="${size}" ${font.size === size ? "selected" : ""}>${size}px</option>`,
          )
          .join(
            "",
          )}</select></label><label class="field">Corner radius<select id="custom-theme-radius">${Array.from(
          { length: 17 },
          (_, i) => i,
        )
          .map(
            (size) =>
              `<option value="${size}" ${state.radius === size ? "selected" : ""}>${size}px</option>`,
          )
          .join(
            "",
          )}</select></label><label class="field">Spacing<select id="custom-theme-density"><option value="compact" ${state.density === "compact" ? "selected" : ""}>Compact</option><option value="comfortable" ${state.density === "comfortable" ? "selected" : ""}>Comfortable</option></select></label></div><div class="theme-colors">${(Object.keys(colorTokens) as (keyof Colors)[]).map((token) => `<label class="theme-color"><span>${colorTokens[token]}</span><input type="color" data-theme-color="${token}" value="${e(state.custom[state.mode][token])}" aria-label="${colorTokens[token]}"><code>${e(state.custom[state.mode][token])}</code></label>`).join("")}</div></div>`
      : ""
  }<p class="theme-file-status" role="status" aria-live="polite"></p></section>`;
}
