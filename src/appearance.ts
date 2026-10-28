const families: Record<string, string> = {
  sans: '"Noto Sans", "DejaVu Sans", sans-serif',
  system: "ui-sans-serif, system-ui, sans-serif",
  serif: '"Noto Serif", "DejaVu Serif", serif',
  mono: '"JetBrains Mono", "DejaVu Sans Mono", monospace',
};
const labels: Record<string, string> = {
  sans: "Noto Sans / DejaVu Sans",
  system: "System sans-serif",
  serif: "Noto Serif / DejaVu Serif",
  mono: "JetBrains Mono / DejaVu Sans Mono",
};
export function appearance() {
  try {
    const saved = JSON.parse(localStorage.getItem("borgd-appearance") ?? "{}");
    return {
      family: Object.hasOwn(families, saved.family)
        ? (saved.family as string)
        : "mono",
      size: Number.isFinite(saved.size)
        ? Math.max(12, Math.min(20, saved.size))
        : 14,
    };
  } catch {
    return { family: "mono", size: 14 };
  }
}
export function applyAppearance() {
  const value = appearance();
  document.documentElement.style.fontFamily = families[value.family];
  document.documentElement.style.fontSize = `${value.size}px`;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("borgd-appearance"));
}
export function saveAppearance(family: string, size: number) {
  if (
    !Object.hasOwn(families, family) ||
    !Number.isFinite(size) ||
    size < 12 ||
    size > 20
  )
    return;
  localStorage.setItem("borgd-appearance", JSON.stringify({ family, size }));
  applyAppearance();
}
export function appearanceView() {
  const current = appearance();
  return `<section class="settings-card" aria-label="Appearance"><h2>Appearance</h2><p>Choose the interface font and text size. Saved on this device and applied immediately.</p><label class="field">Font family<select id="appearance-family">${Object.keys(
    families,
  )
    .map(
      (key) =>
        `<option value="${key}" ${current.family === key ? "selected" : ""}>${labels[key]}</option>`,
    )
    .join(
      "",
    )}</select></label><label class="field">Font size<select id="appearance-size">${Array.from(
    { length: 9 },
    (_, i) => i + 12,
  )
    .map(
      (size) =>
        `<option value="${size}" ${current.size === size ? "selected" : ""}>${size} px${size === 14 ? " (default)" : ""}</option>`,
    )
    .join(
      "",
    )}</select></label><button class="button" data-action="appearance-reset">Reset appearance</button></section>`;
}
