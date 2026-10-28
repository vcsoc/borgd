import { escape as e } from "./model";

// Keep edits local until confirmation; GTK's palette-plus flow does not seed its editor reliably.
export function openColorEditor(
  input: HTMLInputElement,
  apply: (color: string) => void,
) {
  if (document.querySelector(".theme-color-dialog")) return;
  const initial = /^#[0-9a-f]{6}$/i.test(input.value)
    ? input.value.toLowerCase()
    : "#000000";
  const dialog = document.createElement("dialog");
  dialog.className = "theme-color-dialog";
  dialog.setAttribute("aria-labelledby", "color-editor-title");
  const label = input.getAttribute("aria-label") ?? "Theme color";
  dialog.innerHTML = `<form><h2 id="color-editor-title">Edit ${e(label)}</h2><p>Start with the current color. Adjust the channels or enter a hex value.</p><div class="color-editor-preview" aria-label="Color preview"></div><label class="field">Hex color<input name="hex" aria-label="Hex color" required pattern="#[0-9a-fA-F]{6}" value="${initial}" spellcheck="false" maxlength="7"></label><div class="color-editor-channels">${["Red", "Green", "Blue"].map((name, index) => `<label>${name}<input type="range" aria-label="${name}" data-channel="${index}" min="0" max="255" step="1"><output></output></label>`).join("")}</div><div class="color-editor-actions"><button type="button" data-color-cancel>Cancel</button><button type="submit">Apply color</button></div></form>`;
  const hex = dialog.querySelector<HTMLInputElement>('[name="hex"]')!;
  const sliders = [
    ...dialog.querySelectorAll<HTMLInputElement>("[data-channel]"),
  ];
  const update = (color: string) => {
    hex.value = color;
    dialog.querySelector<HTMLElement>(
      ".color-editor-preview",
    )!.style.backgroundColor = color;
    sliders.forEach((slider, index) => {
      slider.value = String(
        parseInt(color.slice(1 + index * 2, 3 + index * 2), 16),
      );
      slider.nextElementSibling!.textContent = slider.value;
    });
  };
  update(initial);
  hex.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(hex.value)) update(hex.value.toLowerCase());
  });
  sliders.forEach((slider) =>
    slider.addEventListener("input", () =>
      update(
        `#${sliders.map((channel) => Number(channel.value).toString(16).padStart(2, "0")).join("")}`,
      ),
    ),
  );
  dialog
    .querySelector("[data-color-cancel]")!
    .addEventListener("click", () => dialog.close());
  dialog.querySelector("form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!/^#[0-9a-f]{6}$/i.test(hex.value)) return;
    const color = hex.value.toLowerCase();
    dialog.close();
    apply(color);
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      if (input.isConnected) input.focus({ preventScroll: true });
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  hex.focus();
  hex.select();
}
