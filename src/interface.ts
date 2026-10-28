import { invoke, isTauri } from "@tauri-apps/api/core";
export function iconButtons() {
  return localStorage.getItem("borgd-button-labels") !== "text";
}
export function applyButtonPreference() {
  document.documentElement.dataset.buttonMode = iconButtons()
    ? "icons"
    : "text";
}
export function setIconButtons(enabled: boolean) {
  localStorage.setItem("borgd-button-labels", enabled ? "icons" : "text");
  applyButtonPreference();
}
export function decorateButtons() {
  applyButtonPreference();
  document
    .querySelectorAll<HTMLButtonElement>(
      "button.button, .repo-actions button.text-button",
    )
    .forEach((button) => {
      const label =
        button.getAttribute("aria-label") ||
        button.textContent?.trim() ||
        "Action";
      button.setAttribute("aria-label", label);
      if (!button.title) button.title = label;
      if (!button.querySelector("svg, [data-lucide]")) {
        const icon = document.createElement("i");
        icon.dataset.lucide = /cancel|close/i.test(label)
          ? "x"
          : /source/i.test(label)
            ? "folder-plus"
            : /reset/i.test(label)
              ? "refresh-cw"
              : button.type === "submit"
                ? "check"
                : "settings-2";
        button.prepend(icon);
      }
      for (const child of [...button.childNodes]) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          const span = document.createElement("span");
          span.className = "button-label";
          span.textContent = child.textContent;
          child.replaceWith(span);
        }
      }
      button.classList.add("action-button");
    });
}
let zoom = 1;
let desiredZoom = 1;
let zoomWork = Promise.resolve();
export function zoomLevel() {
  return zoom;
}
export function setZoom(next: number) {
  next = Math.max(0.5, Math.min(2, Math.round(next * 10) / 10));
  desiredZoom = next;
  // Serialize native calls so rapid shortcuts and reset cannot apply out of order.
  zoomWork = zoomWork
    .catch(() => {})
    .then(async () => {
      try {
        if (isTauri())
          await invoke("plugin:webview|set_webview_zoom", {
            label: "main",
            value: next,
          });
        else {
          document.documentElement.style.zoom = String(next);
          document.documentElement.style.setProperty(
            "--app-zoom",
            String(next),
          );
        }
        zoom = next;
        document.documentElement.dataset.zoom = String(next);
      } catch (error) {
        if (desiredZoom === next) desiredZoom = zoom;
        throw error;
      }
    });
  return zoomWork;
}
export function installZoom(onError: (message: string) => void) {
  document.addEventListener(
    "keydown",
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const plus =
        ["+", "=", "Add"].includes(event.key) || event.code === "NumpadAdd";
      const minus =
        ["-", "Subtract"].includes(event.key) ||
        event.code === "NumpadSubtract";
      if (!plus && !minus && event.key !== "0") return;
      event.preventDefault();
      event.stopPropagation();
      void setZoom(
        event.key === "0" ? 1 : desiredZoom + (plus ? 0.1 : -0.1),
      ).catch((error) => onError(String(error)));
    },
    { capture: true },
  );
}
