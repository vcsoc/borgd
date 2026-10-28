import "./sidebar.css";
interface Preferences {
  collapsed: boolean;
  width?: number;
}
function preferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem("borgd-sidebar") ?? "{}");
    return {
      collapsed:
        typeof saved.collapsed === "boolean"
          ? saved.collapsed
          : innerWidth < 760,
      width: Number.isFinite(saved.width) ? saved.width : undefined,
    };
  } catch {
    return { collapsed: innerWidth < 760 };
  }
}
let state = preferences();
let minimum = 228;
function persist() {
  localStorage.setItem("borgd-sidebar", JSON.stringify(state));
}
function textWidth(element: Element) {
  const style = getComputedStyle(element);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText(element.firstChild?.textContent ?? "").width;
}
function maximum() {
  return Math.max(64, Math.min(640, innerWidth - 220));
}
function fit() {
  const shell = document.querySelector<HTMLElement>(".shell"),
    sidebar = shell?.querySelector<HTMLElement>(".sidebar");
  if (!shell || !sidebar) return;
  // Measure text independently of its current clipping or collapsed display state.
  const labels = [...sidebar.querySelectorAll(".nav")].map(
    (nav) =>
      [...nav.children].reduce(
        (sum, child) =>
          sum +
          (child.tagName.toLowerCase() === "svg"
            ? 20
            : child.classList.contains("dot")
              ? 8
              : textWidth(child) + (child.tagName === "SMALL" ? 12 : 0)),
        0,
      ) +
      (nav.children.length - 1) * 11 +
      48,
  );
  const brand = sidebar.querySelector(".brand strong")!;
  minimum = Math.min(
    maximum(),
    Math.ceil(Math.max(228, textWidth(brand) + 140, ...labels)),
  );
  const width = state.collapsed
    ? 64
    : Math.max(minimum, Math.min(maximum(), state.width ?? minimum));
  shell.style.setProperty("--sidebar-width", `${width}px`);
  sidebar.dataset.collapsed = String(state.collapsed);
  const toggle = sidebar.querySelector(".brand")!;
  toggle.setAttribute("aria-expanded", String(!state.collapsed));
  toggle.setAttribute(
    "aria-label",
    state.collapsed ? "Expand sidebar" : "Collapse sidebar",
  );
  toggle.setAttribute(
    "title",
    state.collapsed ? "Expand sidebar" : "Collapse sidebar",
  );
  const handle = sidebar.querySelector(".sidebar-resize")!;
  handle.setAttribute("aria-valuenow", String(Math.round(width)));
  handle.setAttribute("aria-valuemin", "64");
  handle.setAttribute("aria-valuemax", String(maximum()));
}
export function mountSidebar() {
  const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
  sidebar.querySelector<HTMLButtonElement>(".brand")!.onclick = () => {
    state.collapsed = !state.collapsed;
    persist();
    fit();
  };
  const handle = document.createElement("div");
  handle.className = "sidebar-resize";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize sidebar");
  sidebar.append(handle);
  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    sidebar.dataset.resizing = "true";
    const left = sidebar.getBoundingClientRect().left;
    handle.onpointermove = (move) => {
      const wanted = move.clientX - left;
      state.collapsed = wanted < minimum * 0.55;
      state.width = Math.max(minimum, Math.min(maximum(), wanted));
      fit();
    };
    const finish = () => {
      delete sidebar.dataset.resizing;
      handle.onpointermove = null;
      persist();
    };
    handle.onpointerup = finish;
    handle.onlostpointercapture = finish;
  };
  handle.ondblclick = () => {
    state.width = undefined;
    state.collapsed = false;
    persist();
    fit();
  };
  handle.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") {
      state.width = undefined;
      state.collapsed = false;
    } else if (event.key === "End") {
      state.width = maximum();
      state.collapsed = false;
    } else if (event.key === "ArrowRight" && state.collapsed) {
      state.collapsed = false;
      state.width = minimum;
    } else {
      const width =
        sidebar.getBoundingClientRect().width +
        (event.key === "ArrowRight" ? 20 : -20);
      state.collapsed = width < minimum;
      state.width = state.collapsed ? minimum : width;
    }
    persist();
    fit();
  };
  fit();
  void document.fonts?.ready.then(fit);
}
window.addEventListener("resize", fit);
window.addEventListener("borgd-appearance", () => requestAnimationFrame(fit));
