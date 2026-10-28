import { escape as e, bytes } from "./model";
export interface ArchiveItem {
  path: string;
  name: string;
  parent: string;
  type: string;
  size?: number;
  mtime?: string;
  linktarget?: string;
}
export class ArchiveIndex {
  items = new Map<string, ArchiveItem>();
  children = new Map<string, ArchiveItem[]>();
  constructor(entries: any[]) {
    this.items.set("", {
      path: "",
      name: "Archive root",
      parent: "",
      type: "d",
    });
    for (const entry of entries) {
      if (typeof entry.path !== "string") continue;
      const parts = entry.path.split("/").filter((s: string) => s && s !== ".");
      let parent = "";
      for (let i = 0; i < parts.length; i++) {
        const path = parent ? `${parent}/${parts[i]}` : parts[i];
        const last = i === parts.length - 1;
        if (!this.items.has(path) || last)
          this.items.set(path, {
            ...(last ? entry : {}),
            path,
            parent,
            name: parts[i],
            type: last ? (entry.type ?? "-") : "d",
            linktarget: last ? (entry.linktarget ?? entry.source) : undefined,
          });
        parent = path;
      }
    }
    for (const item of this.items.values()) {
      if (!item.path) continue;
      const siblings = this.children.get(item.parent) ?? [];
      siblings.push(item);
      this.children.set(item.parent, siblings);
    }
    for (const siblings of this.children.values())
      siblings.sort(
        (a, b) =>
          Number(b.type === "d") - Number(a.type === "d") ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
  }
  list(path: string, query = ""): ArchiveItem[] {
    if (!query.trim()) return this.children.get(path) ?? [];
    const term = query.toLocaleLowerCase();
    return [...this.items.values()]
      .filter((i) => i.path && i.path.toLocaleLowerCase().includes(term))
      .sort((a, b) => a.path.localeCompare(b.path));
  }
}
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
export class ArchiveBrowser {
  index = new ArchiveIndex([]);
  folder = "";
  expanded = new Set([""]);
  query = "";
  limit = 200;
  selected = "";
  selection = new Set<string>();
  load(entries: any[]) {
    this.index = new ArchiveIndex(entries);
    this.folder = "";
    this.expanded = new Set([""]);
    this.query = "";
    this.limit = 200;
    this.selected = "";
    this.selection.clear();
  }
  private tree(path: string, depth: number): string {
    const item = this.index.items.get(path)!;
    const dirs = (this.index.children.get(path) ?? []).filter(
      (i) => i.type === "d",
    );
    const open = this.expanded.has(path);
    return `<div role="treeitem" aria-level="${depth + 1}" aria-selected="${this.folder === path}" ${dirs.length ? `aria-expanded="${open}"` : ""}><div class="archive-tree-row ${this.folder === path ? "selected" : ""}" style="--depth:${depth}">${dirs.length ? `<button class="tree-toggle" data-toggle="${e(path)}" aria-label="${open ? "Collapse" : "Expand"} ${e(item.name)}">${open ? "&#9662;" : "&#9656;"}</button>` : '<span class="tree-spacer"></span>'}<button data-folder="${e(path)}" title="${e(path || "Archive root")}">${icon(open ? "folder-open" : "folder-closed")}<span>${e(item.name)}</span></button></div>${open && dirs.length ? `<div role="group">${dirs.map((i) => this.tree(i.path, depth + 1)).join("")}</div>` : ""}</div>`;
  }
  html(): string {
    const rows = this.index.list(this.folder, this.query);
    const crumbs = [
      "",
      ...this.folder
        .split("/")
        .filter(Boolean)
        .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
    ];
    const selected = this.index.items.get(this.selected);
    return `<section class="archive-explorer" aria-label="Archive file manager"><div class="archive-explorer-toolbar"><nav class="archive-breadcrumbs" aria-label="Archive folder path">${crumbs.map((path, i) => `<button data-folder="${e(path)}" ${i === crumbs.length - 1 ? 'aria-current="location"' : ""}>${e(path ? this.index.items.get(path)?.name : "Archive root")}</button>`).join('<span aria-hidden="true">/</span>')}</nav>${this.selection.size ? `<button class="button" data-restore-selection>Restore selected (${this.selection.size})</button>` : ""}<label class="search">${icon("search")}<input type="search" aria-label="Search archive" placeholder="Search all archive paths" value="${e(this.query)}"></label></div><div class="archive-explorer-panes"><aside class="archive-folder-pane" aria-label="Archive folders"><h2>Folders</h2><div role="tree" aria-label="Archive folder tree">${this.tree("", 0)}</div></aside><div class="archive-content-pane" role="region" aria-label="Folder contents" tabindex="0"><table><thead><tr><th>Name</th><th>Size</th><th>Modified</th><th>Type</th></tr></thead><tbody>${rows
      .slice(0, this.limit)
      .map(
        (i) =>
          `<tr data-entry="${e(i.path)}" aria-selected="${this.selection.has(i.path)}" class="${this.selection.has(i.path) ? "selected" : ""}"><td><input type="checkbox" data-pick="${e(i.path)}" aria-label="Select ${e(i.path)}" ${this.selection.has(i.path) ? "checked" : ""}><button ${i.type === "d" ? "data-folder" : "data-select"}="${e(i.path)}" title="${e(i.path)}">${icon(i.type === "d" ? "folder-closed" : "file")}<span>${e(i.name)}${this.query ? `<small>${e(i.path)}</small>` : ""}</span></button></td><td>${i.type === "d" ? "--" : bytes(i.size)}</td><td>${i.mtime && Number.isFinite(Date.parse(i.mtime)) ? e(new Date(i.mtime).toLocaleString()) : "--"}</td><td>${i.type === "d" ? "Folder" : i.type === "l" ? "Symbolic link" : i.type === "h" ? "Hard link" : "File"}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table>${!rows.length ? '<p class="archive-no-items">No items in this folder or matching this search.</p>' : ""}${rows.length > this.limit ? `<button class="button archive-more" data-more>Show more (${rows.length - this.limit} remaining)</button>` : ""}</div></div><footer class="archive-explorer-status"><span>${this.selection.size} selected &middot; ${Math.min(rows.length, this.limit)} of ${rows.length} ${this.query ? "matches" : "items"} &middot; ${this.index.items.size - 1} indexed entries</span><span>${selected?.path ? e(selected.path) + (selected.linktarget ? ` &rarr; ${e(selected.linktarget)}` : "") : "Read-only archive listing. Right-click a file or folder to restore selected items."}</span></footer></section>`;
  }
  mount(
    root: HTMLElement,
    paint: () => void,
    restore: (paths: string[]) => void = () => {},
  ) {
    let menu: HTMLElement | null = null;
    const outside = (event: PointerEvent) => {
      if (!menu?.contains(event.target as Node)) closeMenu();
    };
    const closeMenu = () => {
      menu?.remove();
      menu = null;
      document.removeEventListener("pointerdown", outside, true);
    };
    const contextMenu = (target: HTMLElement, x: number, y: number) => {
      const entry = target.closest<HTMLElement>(
        "[data-entry], button[data-folder], button[data-select]",
      );
      const path =
        entry?.dataset.entry ?? entry?.dataset.folder ?? entry?.dataset.select;
      if (!path || !this.index.items.has(path)) return;
      closeMenu();
      if (!this.selection.has(path)) {
        this.selection.clear();
        this.selection.add(path);
      }
      this.selected = path;
      update();
      menu = document.createElement("div");
      menu.className = "archive-context-menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Archive item actions");
      menu.innerHTML = `<button type="button" role="menuitem" data-context-restore>Restore selected items (${this.selection.size})...</button>`;
      root.append(menu);
      menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
      menu.querySelector<HTMLButtonElement>("button")!.focus();
      document.addEventListener("pointerdown", outside, true);
    };
    root.oncontextmenu = (event) => {
      event.preventDefault();
      contextMenu(event.target as HTMLElement, event.clientX, event.clientY);
    };
    root.onchange = (event) => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.pick !== undefined) {
        if (input.checked) this.selection.add(input.dataset.pick);
        else this.selection.delete(input.dataset.pick);
        update();
      }
    };
    const update = () => {
      const active = document.activeElement as HTMLElement | null;
      const attribute = [
        "data-folder",
        "data-toggle",
        "data-select",
        "data-more",
      ].find((key) => active?.hasAttribute(key));
      const activeValue = attribute ? active?.getAttribute(attribute) : null;
      const tree = root.querySelector(".archive-folder-pane");
      const list = root.querySelector(".archive-content-pane");
      const scroll = [tree?.scrollTop ?? 0, list?.scrollTop ?? 0];
      root.innerHTML = this.html();
      paint();
      root.querySelector(".archive-folder-pane")!.scrollTop = scroll[0];
      root.querySelector(".archive-content-pane")!.scrollTop = scroll[1];
      if (attribute) {
        const replacement = [
          ...root.querySelectorAll<HTMLButtonElement>(`button[${attribute}]`),
        ].find((button) => button.getAttribute(attribute) === activeValue);
        (
          replacement ??
          root.querySelector<HTMLElement>(".archive-content-pane")
        )?.focus({ preventScroll: true });
      }
    };
    root.onclick = (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button",
      );
      if (!target) return;
      if (
        target.hasAttribute("data-context-restore") ||
        target.hasAttribute("data-restore-selection")
      ) {
        closeMenu();
        restore([...this.selection]);
        return;
      }
      closeMenu();
      if (
        target.hasAttribute("data-folder") &&
        (event.ctrlKey || event.metaKey) &&
        target.dataset.folder
      ) {
        const path = target.dataset.folder;
        if (this.selection.has(path)) this.selection.delete(path);
        else this.selection.add(path);
        update();
        return;
      }
      if (target.hasAttribute("data-folder")) {
        this.folder = target.dataset.folder!;
        this.query = "";
        this.limit = 200;
        this.selected = "";
        this.selection.clear();
        let path = this.folder;
        for (;;) {
          this.expanded.add(path);
          if (!path) break;
          path = this.index.items.get(path)?.parent ?? "";
        }
        update();
        root.querySelector(".archive-content-pane")!.scrollTop = 0;
      } else if (target.hasAttribute("data-toggle")) {
        const path = target.dataset.toggle!;
        if (this.expanded.has(path)) this.expanded.delete(path);
        else this.expanded.add(path);
        update();
      } else if (target.hasAttribute("data-select")) {
        this.selected = target.dataset.select!;
        if (!event.ctrlKey && !event.metaKey) this.selection.clear();
        if (
          (event.ctrlKey || event.metaKey) &&
          this.selection.has(this.selected)
        )
          this.selection.delete(this.selected);
        else this.selection.add(this.selected);
        update();
      } else if (target.hasAttribute("data-more")) {
        this.limit += 200;
        update();
      }
    };
    root.oninput = (event) => {
      const input = event.target as HTMLInputElement;
      if (input.type !== "search") return;
      const position = input.selectionStart;
      this.query = input.value;
      this.limit = 200;
      update();
      const replacement = root.querySelector<HTMLInputElement>(
        'input[type="search"]',
      )!;
      replacement.focus();
      try {
        replacement.setSelectionRange(position, position);
      } catch {
        /* Search inputs may not expose selection APIs. */
      }
    };
    root.onkeydown = (event) => {
      const target = event.target as HTMLElement;
      if (event.key === "Escape" && menu) {
        event.preventDefault();
        closeMenu();
        root.querySelector<HTMLElement>(".archive-content-pane")?.focus();
        return;
      }
      if (
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        event.preventDefault();
        const box = target.getBoundingClientRect();
        contextMenu(target, box.left, box.bottom);
        return;
      }
      if (!target.closest('[role="tree"]')) return;
      const buttons = [
        ...root.querySelectorAll<HTMLButtonElement>(
          '[role="tree"] button[data-folder]',
        ),
      ];
      const index = buttons.indexOf(target as HTMLButtonElement);
      if (index < 0) return;
      let next = index;
      if (event.key === "ArrowDown")
        next = Math.min(buttons.length - 1, index + 1);
      else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = buttons.length - 1;
      else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const path = target.dataset.folder!;
        if (event.key === "ArrowRight") this.expanded.add(path);
        else if (this.expanded.has(path)) this.expanded.delete(path);
        else {
          const parent = this.index.items.get(path)?.parent ?? "";
          buttons.find((button) => button.dataset.folder === parent)?.focus();
          return;
        }
        update();
        return;
      } else return;
      event.preventDefault();
      buttons[next].focus();
    };
  }
}
