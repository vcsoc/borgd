import "./style.css";
import "./activity.css";
import { TerminalDock } from "./terminal";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  createIcons,
  Copy,
  Activity,
  Archive as ArchiveIcon,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Cloud,
  Database,
  Download,
  File,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Folders,
  FolderSearch,
  HardDrive,
  History,
  Info,
  KeyRound,
  Layers3,
  LayoutDashboard,
  Leaf,
  Link,
  ListFilter,
  LockKeyhole,
  LockOpen,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  GitCompareArrows,
  Square,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Github,
  X,
} from "lucide";
const icons = {
  Copy,
  Activity,
  Archive: ArchiveIcon,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Cloud,
  Database,
  Download,
  File,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Folders,
  FolderSearch,
  HardDrive,
  History,
  Info,
  KeyRound,
  Layers3,
  LayoutDashboard,
  Leaf,
  Link,
  ListFilter,
  LockKeyhole,
  LockOpen,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  GitCompareArrows,
  Square,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  Github,
  X,
};
import {
  escape as e,
  isFreshInstallation,
  activityDetailsText,
  type ActivityDetails,
  bytes,
  due,
  lines,
  type Config,
  type Profile,
  type Repository,
  type Status,
  type Archive,
  type Result,
} from "./model";
import { runWithRelocation } from "./relocation";
import { checkProgress } from "./check-progress";
import { ArchiveBrowser } from "./archive-browser";
import { applyAppearance, appearanceView, saveAppearance } from "./appearance";
applyAppearance();
import "./archive-browser.css";
import "./workspace-updates.css";

import { sortArchives, type ArchiveColumn } from "./archive-sort";
import "./profile-page.css";
import { analyticsView, inspectedStorage } from "./analytics";
import "./flat.css";
import "./repository-workspace.css";
import "./compact.css";
import "./repository-redesign.css";
import licenseText from "../LICENSE?raw";
import {
  decorateButtons,
  iconButtons,
  setIconButtons,
  installZoom,
} from "./interface";
import { repositoryRhythm } from "./analytics";
installZoom((message) => notify(message, true));

const app = document.querySelector<HTMLDivElement>("#app")!;
const modalRoot = document.querySelector<HTMLDivElement>("#modal-root")!;
let config: Config = { repositories: [], profiles: [] };
let status: Status = {
  busy: false,
  action: "",
  logs: [],
  history: [],
  unlocked: [],
};
let route = "repositories";
let renderedRoute = "";
let profileRepositoryId = "";
type RepositoryPanel = "overview" | "profiles" | "archives";
const repositoryPanels = new Map<string, RepositoryPanel>();
const archiveStates = new Map<
  string,
  { filter: string; sort: ArchiveColumn; direction: "asc" | "desc" }
>();
function archiveState(id: string) {
  if (!archiveStates.has(id))
    archiveStates.set(id, { filter: "", sort: "time", direction: "desc" });
  return archiveStates.get(id)!;
}
let profileForm: HTMLFormElement | null = null;
let profileTitle = "New backup profile";
let unlockForm: HTMLFormElement | null = null;
let unlockRepositoryId = "";
let overviewRenderedDay = "";
function overviewHistoryKey() {
  return JSON.stringify(
    status.history.map((h) => [
      h.id,
      h.time,
      h.action,
      h.exitCode,
      h.repositoryId,
    ]),
  );
}
let repositoryId = "";
let version = "Checking Borg...";
let available = false;
let initialized = !isTauri();
let operationPending = false;
let installPromptShown = false;
let installPlanning = false;
let error = "";
let archives: Record<string, Archive[]> = {};
const archiveLoads = new Map<string, Promise<void>>();
const archiveLoadState = new Map<string, string>();
const archiveLoadErrors = new Map<string, string>();
let archiveLoadQueue: Promise<void> = Promise.resolve();
function loadRepositoryArchives(id: string): Promise<void> {
  const existing = archiveLoads.get(id);
  if (existing) return existing;
  archiveLoadErrors.delete(id);
  archiveLoadState.set(id, "Waiting to load archives…");
  const task = archiveLoadQueue
    .catch(() => {})
    .then(async () => {
      try {
        while (status.busy) {
          if (repositoryPanels.get(id) !== "archives" || !repo(id)) return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (repositoryPanels.get(id) !== "archives" || !repo(id)) return;
        archiveLoadState.set(id, "Loading archives…");
        render();
        await operation("archives", id);
      } catch (error) {
        archiveLoadErrors.set(id, String(error));
      } finally {
        archiveLoadState.delete(id);
        archiveLoads.delete(id);
        render();
      }
    });
  archiveLoads.set(id, task);
  archiveLoadQueue = task;
  render();
  return task;
}
let info: Record<string, any> = {};
const archiveBrowser = new ArchiveBrowser();
let fileArchive = "";
let fileRepositoryId = "";
let archiveLoading = false;
let archiveError = "";
let toastTimer: ReturnType<typeof setTimeout>;
const icon = (name: string, cls = "") =>
  `<i data-lucide="${name}" class="${cls}"></i>`;
const terminalDock = new TerminalDock(notify, () => render());
const repo = (id = repositoryId) =>
  config.repositories.find((r) => r.id === id);
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not yet";
const button = (
  label: string,
  action: string,
  glyph: string,
  attrs = "",
  primary = false,
) =>
  `<button class="button ${primary ? "primary" : ""}" data-action="${action}" ${attrs}>${icon(glyph)}${label}</button>`;
const disabled = () =>
  status.busy || status.workerOffline || !available ? "disabled" : "";
function notify(message: string, bad = false) {
  const toast = document.querySelector<HTMLDivElement>("#toast")!;
  toast.textContent = message;
  toast.className = `visible ${bad ? "bad" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.className = ""), 6500);
}
function paintIcons() {
  decorateButtons();
  createIcons({ icons, attrs: { "stroke-width": 1.6 } });
}
function empty(title: string, description: string, action = "") {
  return `<div class="empty">${icon("archive")}<h2>${title}</h2><p>${description}</p>${action}</div>`;
}
function render() {
  closeArchiveMenu();
  const quickScroll = new Map(
    [...app.querySelectorAll<HTMLElement>("[data-quick-profiles]")].map(
      (node) => [node.dataset.quickProfiles!, node.scrollTop],
    ),
  );
  const archiveScroll = new Map(
    [...app.querySelectorAll<HTMLElement>(".repo-card[data-repository]")].map(
      (row) => [
        row.dataset.repository!,
        row.querySelector(".archive-list")?.scrollLeft ?? 0,
      ],
    ),
  );
  const profileFocus = profileForm?.contains(document.activeElement)
    ? (document.activeElement as HTMLElement)
    : null;
  const scroll =
    renderedRoute === route
      ? (app.querySelector(".content")?.scrollTop ?? 0)
      : 0;
  const unlockFocused = unlockForm?.contains(document.activeElement);
  if (route !== "repositories" && unlockForm) clearUnlock();
  const pages: Record<string, [string, string]> = {
    repositories: ["Repositories", "Your backups, organized by destination."],
    activity: ["Activity", "A clear record of every operation."],
    archiveDiff: [
      "Archive diff",
      "Compare two saved snapshots without extracting or changing them.",
    ],
    archiveFiles: [
      "Archive contents",
      "Browse a saved snapshot without extracting files.",
    ],
    settings: ["Settings & help", "Small details. Reliable backups."],
    about: ["About borgd", "Backup software by Chris Visser."],
  };
  const topIcon = (label: string, glyph: string, attrs: string) =>
    `<button class="top-icon" aria-label="${label}" title="${label}" ${attrs}>${icon(glyph)}</button>`;
  app.innerHTML = `<div class="shell"><aside class="sidebar rail"><button class="rail-logo" data-route="repositories" aria-label="borgd home" title="borgd home">${icon("layers-3")}</button><nav aria-label="Main navigation">${[
    ["repositories", "hard-drive", "Repositories"],
    ["activity", "activity", "Activity"],
  ]
    .map(
      ([id, glyph, label]) =>
        `<button class="nav ${route === id || (["archiveFiles", "archiveDiff"].includes(route) && id === "repositories") ? "active" : ""}" data-route="${id}" aria-label="${label}" title="${label}" ${route === id ? 'aria-current="page"' : ""}>${icon(glyph)}</button>`,
    )
    .join(
      "",
    )}</nav></aside><main><header class="toolbar"><button class="top-brand" data-route="about" aria-label="About borgd" title="About borgd"><strong>borgd</strong><span class="version">0.1</span><span class="brand-tagline">BACKUP COMPANION</span></button><div class="top-tools"><div class="engine-status" role="status" title="${e(status.busy ? `${version} · Operation in progress` : version)}"><span class="dot ${status.busy ? "amber pulse" : available ? "green" : "amber"}"></span><span>${e(version)}</span>${status.busy ? '<span id="running-label">Working</span>' : ""}</div>${topIcon("Terminal", "terminal", `data-action="toggle-terminal" aria-expanded="${terminalDock.visible}"`)}${topIcon("Settings & help", "settings-2", 'data-route="settings"')}</div></header><div class="content ${route === "activity" || route === "archiveFiles" ? "activity-content" : ""}"><div class="page-heading"><div><div class="eyebrow">YOUR BACKUP WORKSPACE</div><h1>${pages[route][0]}</h1><p>${pages[route][1]}</p></div>${route === "archiveDiff" ? button("Back to archives", "diff-back", "arrow-left") : route === "archiveFiles" ? button("Back to archives", "archive-back", "arrow-left") : route === "repositories" ? button("Add repository", "add-repo", "plus", status.busy ? "disabled" : "", true) : ""}</div>${initialized && !available && isFreshInstallation(config, status.history) ? `<div class="notice">${icon("info")}<div><strong>${isTauri() ? "Borg needs a little setup" : "Desktop preview"}</strong><p>${isTauri() ? e(error || "Looking for Borg 1.x on this computer.") : "This is the browser preview. Run the Tauri desktop app to connect repositories and execute real backups."}</p></div>${button("Setup guide", "setup", "arrow-up-right")}</div>` : ""}<div id="view">${view()}</div></div><footer><span>${icon("lock-keyhole")} Passphrases stay in memory, never on disk.</span><span id="footer-status">${status.busy ? (status.workerRunning ? "Backup worker is running. You may close this window." : "Keep borgd open until this operation finishes.") : status.workerRunning ? "Background backup worker connected" : status.workerOffline ? "Background worker stopped — Start it in Settings" : "Powered by Borg Backup"}</span></footer></main></div>`;
  if (route === "archiveFiles" && !archiveLoading && !archiveError) {
    const browserRoot = app.querySelector<HTMLElement>("#archive-browser-root");
    if (browserRoot)
      archiveBrowser.mount(browserRoot, paintIcons, (paths) =>
        restoreDialog(fileRepositoryId, fileArchive, paths),
      );
  }
  if (route === "archiveFiles") {
    app.querySelector(".content")!.classList.add("archive-full-content");
    app.querySelector(".page-heading")?.remove();
    const toolbar = app.querySelector(".toolbar")!;
    toolbar.classList.add("archive-topbar");
    toolbar.innerHTML = `${button("Back to archives", "archive-back", "arrow-left")}<div class="archive-topbar-title"><h1>Archive contents</h1><span title="${e(fileArchive)}">${e(repo(fileRepositoryId)?.name ?? "Repository")} &middot; ${e(fileArchive)}</span></div>${button("Restore whole archive", "restore", "archive", `data-archive="${e(fileArchive)}" data-repository="${e(fileRepositoryId)}" ${status.busy || archiveLoading || archiveError ? "disabled" : ""}`)}`;
  }
  if (route === "repositories" && profileForm) {
    app
      .querySelector(`[data-profile-host="${CSS.escape(profileRepositoryId)}"]`)
      ?.append(profileForm);
  }
  if (route === "repositories" && unlockForm) {
    const host = app.querySelector(
      `[data-unlock-host="${CSS.escape(unlockRepositoryId)}"]`,
    );
    if (host) {
      host.append(unlockForm);
      if (unlockFocused)
        unlockForm
          .querySelector<HTMLInputElement>("input")
          ?.focus({ preventScroll: true });
    } else clearUnlock();
  }
  app.querySelector(".content")!.scrollTop = scroll;
  for (const [id, left] of archiveScroll) {
    const table = app.querySelector(
      `[data-repository="${CSS.escape(id)}"] .archive-list`,
    );
    if (table) table.scrollLeft = left;
  }
  for (const [id, top] of quickScroll) {
    const node = app.querySelector<HTMLElement>(
      `[data-quick-profiles="${CSS.escape(id)}"]`,
    );
    if (node) node.scrollTop = top;
  }
  renderedRoute = route;
  overviewRenderedDay = new Date().toDateString();
  if (profileFocus?.isConnected) profileFocus.focus({ preventScroll: true });
  terminalDock.attach(app.querySelector("main")!);
  paintIcons();
}
function view(): string {
  if (route === "about")
    return `<section class="about-page"><h2>borgd <small>0.1.0</small></h2><p>Developed by Chris Visser</p><a href="https://github.com/vcsoc/borgd" data-action="open-project" class="project-link">${icon("github")}https://github.com/vcsoc/borgd</a><h3>License</h3><pre class="license-text">${e(licenseText)}</pre></section>`;
  if (route === "repositories") return repositories();
  if (route === "activity") return activity();
  if (route === "archiveFiles") return archiveFilesView();
  if (route === "archiveDiff") return archiveDiffView();
  return settings();
}
function repositoryOverview(id: string) {
  overviewRenderedDay = new Date().toDateString();
  const history = status.history.filter((entry) => entry.repositoryId === id);
  const last = history.find(
    (entry) => entry.action === "backup" && entry.exitCode <= 1,
  );
  return `<div class="repository-summary"><div><small>LAST COMPLETED BACKUP</small><strong>${last ? e(date(last.time)) : "No backup recorded"}</strong></div><div><small>BACKUP PROFILES</small><strong>${config.profiles.filter((profile) => profile.repositoryId === id).length}</strong></div><div><small>STORED BY BORG</small><strong>${bytes(inspectedStorage([repo(id)!], info)[0]?.size)}</strong></div></div>${analyticsView(history, [repo(id)!], info)}`;
}
function profileCard(p: Profile) {
  const last = status.history.find(
    (h) => h.profileId === p.id && h.action === "backup",
  );
  return `<article class="profile-card"><div class="profile-icon">${icon("folder-closed")}</div><div class="profile-info"><h3>${e(p.name)}</h3><p>${e(repo(p.repositoryId)?.name)} <span> / </span> ${p.sources.length} source${p.sources.length !== 1 ? "s" : ""}</p></div><div class="profile-meta"><span class="pill ${last?.exitCode === 0 ? "success" : ""}">${last ? (last.exitCode === 0 ? "Backed up" : last.exitCode === 1 ? "Review warnings" : "Needs attention") : "Not backed up yet"}</span><small>${p.intervalHours ? `Every ${p.intervalHours}h ${status.workerRunning ? "in background" : "while open"}` : "Run manually"}</small></div>${button("", "edit-profile", "sliders-horizontal", `data-id="${e(p.id)}" aria-label="Edit ${e(p.name)}" ${status.busy ? "disabled" : ""}`)}${button("Back up", "backup", "play", `data-id="${e(p.id)}" ${disabled()}`)}</article>`;
}
function repositoryProfiles(id: string) {
  const profiles = config.profiles.filter(
    (profile) => profile.repositoryId === id,
  );
  return `<div class="section-heading"><h3>Backup profiles</h3>${button("New profile", "add-profile", "plus", `data-id="${e(id)}" ${disabled()}`)}</div>${profiles.map(profileCard).join("") || '<p class="muted">No profiles for this repository yet.</p>'}<div data-profile-host="${e(id)}">${profileForm && profileRepositoryId === id ? `<h3 class="inline-editor-title">${e(profileTitle)}</h3>` : ""}</div><p class="field-help">${status.workerRunning ? "The background worker runs scheduled profiles with this window closed." : "Keep borgd open for scheduled backups on this platform."} Scheduling is opt-in; 0 means manual. Encrypted repositories need a session passphrase. No automatic pruning is performed.</p>`;
}
function repositoryLockButton(id: string) {
  const unlocked = status.unlocked.includes(id);
  return button(
    unlocked ? "Lock" : "Unlock",
    unlocked ? "lock-repository" : "unlock",
    unlocked ? "lock-open" : "lock-keyhole",
    `data-id="${e(id)}" data-lock-state="${unlocked ? "unlocked" : "locked"}" title="${unlocked ? "Unlocked: session passphrase set (not verified). Click to lock." : "Locked: no session passphrase set. Click to unlock."}" ${disabled()}`,
  );
}
function repositoryLockIndicator(id: string) {
  const unlocked = status.unlocked.includes(id);
  const description = unlocked
    ? "Unlocked: session passphrase set (not verified)"
    : "Locked: no session passphrase set";
  return `<span class="repository-lock-state ${unlocked ? "is-unlocked" : "is-locked"}" role="img" aria-label="${description}" title="${description}">${icon(unlocked ? "lock-open" : "lock-keyhole")}</span>`;
}
function repositoryQuickProfiles(id: string) {
  const profiles = config.profiles.filter((p) => p.repositoryId === id);
  return `<section class="repo-quick-profiles" aria-label="${e(repo(id)?.name)} quick profiles"><div class="quick-profiles-heading"><h3>Quick profiles <span>${profiles.length}</span></h3>${button("New profile", "add-profile", "plus", `data-id="${e(id)}" aria-label="Add profile to ${e(repo(id)?.name)}" ${disabled()}`)}</div><div class="quick-profile-list" data-quick-profiles="${e(id)}" role="list" tabindex="0" aria-label="Backup profiles for ${e(repo(id)?.name)}">${profiles.map((p) => `<div class="quick-profile-row" role="listitem"><div class="quick-profile-info"><strong title="${e(p.name)}">${e(p.name)}</strong><small>${p.intervalHours ? `Every ${p.intervalHours}h` : "Manual backup"} · ${p.sources.length} source${p.sources.length === 1 ? "" : "s"}</small></div><div class="quick-profile-actions">${button("Edit", "edit-profile", "sliders-horizontal", `data-id="${e(p.id)}" aria-label="Edit profile: ${e(p.name)}" ${disabled()}`)}${button("Preview retention", "prune-preview", "list-filter", `data-id="${e(p.id)}" aria-label="Preview retention: ${e(p.name)}" ${disabled()}`)}${button("Back up", "backup", "play", `data-id="${e(p.id)}" aria-label="Back up profile: ${e(p.name)}" ${disabled()}`)}</div></div>`).join("") || '<p class="muted quick-profiles-empty">No profiles for this repository yet.</p>'}</div></section>`;
}
function repositories() {
  if (!config.repositories.length)
    return empty(
      "Somewhere safe for your files",
      "Create a new Borg repository or connect one you already use.",
      button("Add a repository", "add-repo", "plus", disabled(), true),
    );
  return config.repositories
    .map((r) => {
      const data = info[r.id];
      const last = status.history.find((h) => h.repositoryId === r.id);
      return `<article class="repo-card" data-repository="${e(r.id)}" aria-label="${e(r.name)}"><header class="repo-header"><div class="repo-title"><div class="profile-icon">${icon(r.location.startsWith("ssh:") ? "cloud" : "hard-drive")}</div><div><div class="repo-name-heading"><h2>${e(r.name)}</h2>${repositoryLockIndicator(r.id)}</div><code title="${e(r.location)}">${e(r.location)}</code></div></div><div class="repo-actions">${repositoryLockButton(r.id)}${button("Inspect", "info", "refresh-cw", `data-id="${e(r.id)}" title="Inspect this repository to load encryption and storage details." ${disabled()}`)}${(["overview", "profiles", "archives"] as RepositoryPanel[]).map((panel) => `<button class="button panel-toggle" data-action="repo-panel" data-id="${e(r.id)}" data-panel="${panel}" aria-expanded="${repositoryPanels.get(r.id) === panel}" aria-label="${panel === "overview" ? "Overview" : panel === "profiles" ? "Profiles" : "Archives"}" title="${panel === "overview" ? "Overview" : panel === "profiles" ? "Profiles" : "Archives"}" aria-controls="repository-panel-${e(r.id)}">${icon(panel === "overview" ? "layout-dashboard" : panel === "profiles" ? "folders" : "archive")}${panel === "overview" ? "Overview" : panel === "profiles" ? "Profiles" : "Archives"}</button>`).join("")}${button("Check", "check", "shield-check", `data-id="${e(r.id)}" ${disabled()}`)}${button("Initialize", "initialize", "plus", `data-id="${e(r.id)}" ${disabled()}`)}<button class="text-button danger push-right" data-action="forget-repo" data-id="${e(r.id)}" ${status.busy ? "disabled" : ""} aria-label="Forget repository" title="Forget repository (leave all archives on disk)">${icon("trash-2")}<span class="button-label">Forget</span></button></div></header><div class="repo-summary"><div class="repo-graph-column">${repositoryRhythm(
        status.history.filter((h) => h.repositoryId === r.id),
        inspectedStorage([r], info)[0]?.size,
      )}</div><div class="repo-side-column"><div class="repo-details" aria-label="Repository details"><div><small>ENCRYPTION</small><strong>${e(data?.encryption?.mode || "Not inspected")}</strong></div><div><small>STORED</small><strong>${bytes(data?.cache?.stats?.unique_csize)}</strong></div><div><small>ORIGINAL SIZE</small><strong>${bytes(data?.cache?.stats?.total_size)}</strong></div><div><small>ARCHIVES</small><strong>${e(archives[r.id]?.length ?? data?.archives?.length ?? "--")}</strong></div></div>${repositoryQuickProfiles(r.id)}</div></div>${last && last.exitCode > 1 ? `<div class="repository-error" role="status"><strong>Last operation failed</strong><p>${e(last.message)}</p>${last.message.includes("Repository passphrase is missing or incorrect") ? button("Set session passphrase", "unlock", "key-round", `data-id="${e(r.id)}" ${disabled()}`) : ""}<button class="text-button" data-route="activity">View activity ${icon("arrow-right")}</button></div>` : ""}<div data-unlock-host="${e(r.id)}"></div>${repositoryPanels.has(r.id) ? `<section class="repository-panel" id="repository-panel-${e(r.id)}" aria-label="${e(r.name)} ${repositoryPanels.get(r.id)}">${repositoryPanels.get(r.id) === "overview" ? repositoryOverview(r.id) : repositoryPanels.get(r.id) === "profiles" ? repositoryProfiles(r.id) : archiveView(r.id)}</section>` : ""}</article>`;
    })
    .join("");
}
let archiveMenu: HTMLElement | null = null;
let archiveMenuRow: HTMLElement | null = null;
function closeArchiveMenu(restoreFocus = false) {
  archiveMenu?.remove();
  archiveMenu = null;
  if (restoreFocus) archiveMenuRow?.focus({ preventScroll: true });
  archiveMenuRow = null;
}
function showArchiveMenu(row: HTMLElement, x: number, y: number) {
  closeArchiveMenu();
  archiveMenuRow = row;
  const id = row.dataset.repository!,
    name = row.dataset.archiveRow!;
  const menu = document.createElement("div");
  archiveMenu = menu;
  menu.className = "archive-context-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Archive actions");
  menu.innerHTML = '<button type="button" role="menuitem">View diff</button>';
  document.body.append(menu);
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  const item = menu.querySelector<HTMLButtonElement>("button")!;
  item.onclick = () => {
    closeArchiveMenu();
    void openArchiveDiff(id, name);
  };
  item.focus({ preventScroll: true });
}
interface ArchiveDiffEntry {
  path: string;
  changes: Array<Record<string, unknown>>;
}
let diffRepository = "",
  diffSelected = "",
  diffBase = "",
  diffError = "";
let diffLoading = false,
  diffGeneration = 0,
  diffVisible = 200;
let diffEntries: ArchiveDiffEntry[] | null = null;
const diffSupported = () =>
  !status.workerRunning || status.archiveDiffSupported === true;
async function openArchiveDiff(id: string, name: string) {
  if (!repo(id)) return;
  diffGeneration++;
  diffRepository = id;
  diffSelected = name;
  diffError = "";
  diffEntries = null;
  diffLoading = false;
  diffVisible = 200;
  const list = (archives[id] ?? []).filter((a) => a.name !== name);
  const selectedTime = Date.parse(
    archives[id]?.find((a) => a.name === name)?.time ?? "",
  );
  const older = list
    .filter((a) => Date.parse(a.time) < selectedTime)
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  diffBase = (older[0] ?? list[0])?.name ?? "";
  route = "archiveDiff";
  render();
  if (diffBase && diffSupported() && !status.busy && !status.workerOffline)
    await loadArchiveDiff();
}
async function loadArchiveDiff() {
  if (diffLoading || !diffBase || diffBase === diffSelected || !diffSupported())
    return;
  const generation = ++diffGeneration;
  const id = diffRepository,
    base = diffBase,
    selected = diffSelected;
  diffLoading = true;
  diffError = "";
  diffEntries = null;
  diffVisible = 200;
  render();
  try {
    const output = await operation("diff", id, {
      archive: base,
      compareArchive: selected,
    });
    if (
      !Array.isArray(output.data) ||
      !output.data.every(
        (item: any) =>
          typeof item?.path === "string" && Array.isArray(item.changes),
      )
    )
      throw new Error("Invalid archive diff response");
    if (generation === diffGeneration) diffEntries = output.data;
  } catch (error) {
    if (generation === diffGeneration) diffError = String(error);
  } finally {
    if (generation === diffGeneration) {
      diffLoading = false;
      render();
    }
  }
}
function archiveDiffView() {
  const choices = (archives[diffRepository] ?? []).filter(
    (a) => a.name !== diffSelected,
  );
  const changes = (entry: ArchiveDiffEntry) =>
    entry.changes
      .map((change) => {
        const type = typeof change.type === "string" ? change.type : "changed";
        const details = Object.entries(change)
          .filter(([key]) => key !== "type")
          .map(
            ([key, value]) =>
              `${key.replaceAll("_", " ")}: ${typeof value === "number" && ["added", "removed", "size"].includes(key) ? bytes(value) : JSON.stringify(value)}`,
          )
          .join(" · ");
        return `<span class="diff-change" data-change="${e(type)}"><strong>${e(type.replaceAll("_", " "))}</strong>${details ? ` · ${e(details)}` : ""}</span>`;
      })
      .join("");
  return `<section class="archive-diff" aria-label="Archive comparison"><p class="archive-diff-context"><strong>${e(repo(diffRepository)?.name)}</strong> · Selected archive: <code>${e(diffSelected)}</code></p><p class="muted">File-level Borg comparison: added, removed, changed files and metadata; not a line-by-line text patch. Direction: comparison archive → selected archive.</p><div class="archive-diff-controls"><label class="field">Compare with<select id="diff-base" ${diffLoading ? "disabled" : ""}>${choices.length ? choices.map((a) => `<option value="${e(a.name)}" ${a.name === diffBase ? "selected" : ""}>${e(a.name)}</option>`).join("") : '<option value="">No other archives available</option>'}</select></label>${button("Compare archives", "diff-run", "git-compare-arrows", `${disabled()} ${!diffBase || diffLoading || !diffSupported() ? "disabled" : ""}`)}</div>${
    !choices.length
      ? '<p role="status">At least two archives in this repository are needed for a diff.</p>'
      : !diffSupported()
        ? '<p class="notice" role="status">The running worker needs an update for archive diffs. In Settings, Stop and Start the worker, then unlock this repository again. Existing jobs will finish safely first.</p>'
        : diffLoading
          ? '<p role="status">Comparing archive contents…</p>'
          : diffError
            ? `<div class="repository-error" role="alert"><strong>Could not compare archives</strong><p>${e(diffError)}</p>${button("Retry comparison", "diff-run", "refresh-cw", disabled())}</div>`
            : diffEntries === null
              ? `<p role="status">${status.busy ? "Wait for the active operation to finish, then compare these archives." : "Choose a comparison archive, then Compare archives."}</p>`
              : diffEntries.length === 0
                ? '<p role="status">No differences found between these archives.</p>'
                : `<div class="archive-diff-actions"><span>${diffEntries.length.toLocaleString()} changed paths · Showing ${Math.min(diffVisible, diffEntries.length).toLocaleString()}</span>${diffEntries.length > diffVisible ? button("Show more changes", "diff-more", "plus") : ""}</div><div class="table-wrap"><table class="archive-diff-table"><thead><tr><th>Path</th><th>Changes</th></tr></thead><tbody>${diffEntries
                    .slice(0, diffVisible)
                    .map(
                      (entry) =>
                        `<tr><td><code>${e(entry.path)}</code></td><td>${changes(entry)}</td></tr>`,
                    )
                    .join("")}</tbody></table></div>`
  }</section>`;
}
function archiveView(id: string) {
  const {
    filter: archiveFilter,
    sort: archiveSort,
    direction: archiveDirection,
  } = archiveState(id);
  if (!config.repositories.length)
    return empty(
      "Your timeline starts here",
      "Connect a repository, then create your first backup.",
    );
  const list = archives[id];
  const loadState = archiveLoadState.get(id);
  const loadError = archiveLoadErrors.get(id);
  const loadingMarkup = loadState
    ? `<p class="archive-load-status" role="status">${e(loadState)}</p>`
    : loadError
      ? `<div class="archive-load-error" role="alert"><strong>Could not load archives</strong><p>${e(loadError)}</p>${list ? "<p>Showing the previously loaded list; it may be out of date.</p>" : ""}${button("Retry loading archives", "load-archives", "refresh-cw", `data-id="${e(id)}" ${disabled()}`)}</div>`
      : "";
  const filtered = sortArchives(
    (list ?? []).filter((a) =>
      a.name.toLowerCase().includes(archiveFilter.toLowerCase()),
    ),
    archiveSort,
    archiveDirection,
  );
  const heading = (label: string, column: ArchiveColumn, title = "") =>
    `<th aria-sort="${archiveSort === column ? (archiveDirection === "asc" ? "ascending" : "descending") : "none"}"><button class="archive-sort" data-action="sort-archives" data-id="${e(id)}" data-column="${column}" title="${e(title || `Sort by ${label}`)}">${label}<span aria-hidden="true">${archiveSort === column ? (archiveDirection === "asc" ? "&#9650;" : "&#9660;") : "&#8597;"}</span></button></th>`;
  return `<div class="archive-toolbar"><label class="search">${icon("search")}<input class="archive-search" data-repository="${e(id)}" placeholder="Find an archive..." value="${e(archiveFilter)}" aria-label="Filter archives"></label>${button("Refresh", "load-archives", "refresh-cw", `data-id="${e(id)}" ${loadState ? "disabled" : disabled()}`)}</div>${loadingMarkup}${list?.length ? `<div class="table-wrap archive-list"><table class="archive-table"><thead><tr>${heading("Archive", "name")}${heading("Created", "time", `Sort by creation time. Displayed in your local time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`)}${heading("Files backed up", "files")}${heading("Total size", "size", "Original archive size before compression and deduplication, as reported by Borg")}<th class="align-right">Actions</th></tr></thead><tbody>${filtered!.map((a) => `<tr tabindex="0" data-archive-row="${e(a.name)}" data-repository="${e(id)}"><td><div class="archive-name">${icon("archive")}<code title="${e(a.name)}">${e(a.name)}</code></div></td><td class="nowrap">${e(Number.isFinite(Date.parse(a.time || a.start || "")) ? date(a.time || a.start) : "Unavailable")}</td><td class="nowrap">${typeof a.stats?.nfiles === "number" ? a.stats.nfiles.toLocaleString() : "Unavailable"}</td><td class="nowrap">${typeof a.stats?.original_size === "number" ? bytes(a.stats.original_size) : "Unavailable"}</td><td><div class="row-actions">${button("Browse", "files", "folder-search", `data-archive="${e(a.name)}" data-repository="${e(id)}" ${disabled()}`)}${button("Restore", "restore", "download", `data-archive="${e(a.name)}" data-repository="${e(id)}" ${disabled()}`)}</div></td></tr>`).join("") || '<tr><td colspan="5" class="table-empty">No matching archives.</td></tr>'}</tbody></table></div><p class="muted">${list.length} archives in this repository. Restores always go into an empty folder.</p>` : loadState || loadError ? "" : list ? empty("No archives yet", "This repository does not contain any archives. Create a backup using one of its profiles.") : `<p class="muted">Archives have not been loaded.</p>`}`;
}
function activity() {
  return `<section class="activity-workspace" aria-label="Operation activity"><div id="check-progress" aria-live="polite">${checkProgressMarkup()}</div><div class="activity-section-heading"><h2>Operation log</h2><span class="pill ${status.busy ? "success" : ""}" id="activity-state">${status.busy ? "Running" : "Idle"}</span></div><div class="activity-log-panel"><button class="copy-button copy-log" data-action="copy-log" aria-label="Copy operation log" title="Copy operation log" ${status.logs.length ? "" : "disabled"}>${icon("copy")}</button><pre class="terminal" id="terminal" tabindex="0" aria-label="Borg operation output">${e(status.logs.join("\n") || "No operations in this session.\nYour Borg output will appear here as it happens.")}</pre></div><div class="activity-section-heading"><h2>Recent activity</h2><span class="muted">Last 200 operations</span></div>${status.history.length ? `<div class="table-wrap activity-history" tabindex="0" role="region" aria-label="Recent activity history"><table><thead><tr><th>Operation</th><th>Repository</th><th>Time</th><th>Result</th><th class="copy-column"><span class="sr-only">Copy details</span></th></tr></thead><tbody>${status.history.map((h) => `<tr><td class="capitalize">${e(h.action)}</td><td>${e(h.repositoryName ?? repo(h.repositoryId)?.name ?? "Forgotten repository")}</td><td>${e(date(h.time))}</td><td><span title="${e(h.message)}" class="pill ${h.exitCode === 0 ? "success" : h.exitCode === 1 ? "warning" : "failure"}">${h.exitCode === 0 ? "Completed" : h.exitCode === 1 ? "Warning" : "Failed"}</span></td><td class="copy-column"><button class="copy-button" data-action="copy-history" data-id="${e(h.id ?? "")}" data-time="${e(h.time)}" data-operation="${e(h.action)}" data-repository="${e(h.repositoryId)}" aria-label="Copy details for ${e(h.action)} at ${e(date(h.time))}" title="Copy full operation details">${icon("copy")}</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="activity-empty">${empty("A clean slate", "Backup results, checks, and restores will be recorded here.")}</div>`}</section>`;
}
interface WorkerServiceInfo {
  manager: string;
  registered: boolean;
  conflict: boolean;
  running: boolean;
  stopping: boolean;
  paused: boolean;
  definition: string;
}
let workerServiceInfo: WorkerServiceInfo | null = null;
let workerServiceError = "";
let workerServicePending = "";
async function refreshWorkerService() {
  if (!isTauri() || workerServicePending) return;
  try {
    workerServiceInfo = await invoke<WorkerServiceInfo>("worker_service_info");
    workerServiceError = "";
  } catch (error) {
    workerServiceError = String(error);
  }
  if (route === "settings") render();
}
async function changeWorkerService(action: string) {
  if (workerServicePending || !isTauri()) return;
  modalRoot.querySelector<HTMLDialogElement>("dialog")?.close();
  workerServicePending = action;
  workerServiceError = "";
  render();
  try {
    workerServiceInfo = await invoke<WorkerServiceInfo>(
      "worker_service_action",
      { action },
    );
    await refreshStatus();
    notify(
      action === "register"
        ? "Worker startup registered. Existing jobs were not restarted."
        : action === "start"
          ? "Background worker started. Scheduled profiles can resume."
          : action === "stop"
            ? "Background worker stopped. Session passphrases cleared."
            : "Worker startup removed. Repositories and profiles were not deleted.",
    );
  } catch (error) {
    workerServiceError = String(error);
    notify(workerServiceError, true);
  } finally {
    workerServicePending = "";
    await refreshStatus().catch(() => {});
    render();
  }
}
function workerServiceSettings() {
  const data = workerServiceInfo;
  const blocked =
    !isTauri() || !data || !!workerServicePending || data.conflict;
  const attrs = (condition = false) => (blocked || condition ? "disabled" : "");
  return `<section class="settings-card worker-service-settings" aria-label="Background backups"><h2>${icon("clock-3")} Background backups <span class="pill ${status.workerRunning && !status.workerOffline ? "success" : ""}">${workerServicePending === "stop" || workerServicePending === "uninstall" || data?.stopping ? "Stopping" : status.workerRunning && !status.workerOffline ? "Worker connected" : "Worker stopped"}</span></h2><div class="worker-service-actions">${button("Register worker startup", "service-register", "plus", attrs())}${button("Start worker", "service-start", "play", attrs(!!status.workerRunning && !status.workerOffline))}${button("Stop worker", "service-stop", "square", attrs(!status.workerRunning || !!status.workerOffline))}${button("Uninstall worker startup", "service-uninstall", "trash-2", attrs(!data?.registered))}${button("Refresh worker status", "service-refresh", "refresh-cw", !isTauri() || workerServicePending ? "disabled" : "")}</div>${workerServicePending ? `<p role="status">${workerServicePending === "stop" || workerServicePending === "uninstall" ? "Stopping safely: waiting for accepted Borg operations to finish. No process is force-killed." : "Updating worker startup…"}</p>` : ""}${workerServiceError ? `<p class="form-error" role="status">${e(workerServiceError)}</p>` : ""}<p>${data ? `${e(data.manager)}. ${data.registered ? "Startup registered." : "Startup not registered."} <code>${e(data.definition)}</code>` : isTauri() ? "Checking this platform's background worker support…" : "Worker management is available in the desktop application."}</p>${data?.conflict ? '<p class="form-error">An existing startup definition belongs to another configuration. It will not be overwritten or removed.</p>' : ""}<p>Register enables startup at user login; it does not restart the current worker. Start also works without registration. Stop pauses background backups until you explicitly Start again, waits for active work, and clears memory-only passphrases. Uninstall removes only worker startup, not your repositories, profiles, or archives.</p><p>Set a profile interval to opt in; 0 means manual only. Encrypted repositories need unlocking after a worker restart or reboot. Computers cannot back up while powered off or suspended; overdue schedules run once on resume. Linux without systemd uses desktop-login autostart, not a boot service. Systemd boot/logout operation still requires user lingering configured separately.</p></section>`;
}
function settings() {
  return `${appearanceView()}<section class="settings-card"><h2>Button labels</h2><label class="button-mode-control"><span>Icon-only action buttons</span><input id="icon-buttons" role="switch" type="checkbox" ${iconButtons() ? "checked" : ""}><span class="toggle-track" aria-hidden="true"></span></label><p>Enabled by default. Turn off to show icons with text. Actions retain accessible labels and tooltips in either mode.</p><p>Zoom the application with Ctrl+ / Ctrl- (Cmd on macOS); Ctrl+0 resets to 100%.</p></section>${workerServiceSettings()}<section class="settings-card"><h2>${icon("terminal")} Borg engine</h2><p>borgd uses <strong>Borg Backup 1.x</strong> installed on your computer. Borg 2 repositories are not supported. Borg is not bundled inside the AppImage.</p><div class="engine-detail"><code>${e(version)}</code>${button("Check again", "probe", "refresh-cw")}${!available && isTauri() ? button("Install Borg Backup", "install-borg", "download") : ""}</div>${error ? `<p class="form-error" role="alert">${e(error)}</p>` : ""}<h3>Linux</h3><p>Install Borg using your distribution's package manager, then launch the borgd AppImage.</p><code class="code-block">sudo apt install borgbackup &nbsp; # Debian / Ubuntu<br>sudo pacman -S borg &nbsp; &nbsp; &nbsp; # Arch Linux</code><h3>macOS</h3><code class="code-block">brew install borgbackup</code><p>borgd also checks the standard Apple Silicon and Intel Homebrew locations when launched from Finder.</p><h3>Windows</h3><p>Install WSL and Borg inside your default Linux distribution. borgd invokes <code>wsl.exe --exec borg</code>. Use Linux paths such as <code>/mnt/c/Users/you/Documents</code> for sources and destinations. SSH keys and known hosts belong inside WSL.</p><code class="code-block">wsl --install<br>wsl -- sudo apt install borgbackup</code></section><section class="settings-card"><h2>${icon("shield-check")} Security, without surprises</h2><p>Repository passphrases are kept only for this session and passed to Borg through its environment, never command-line arguments or saved settings. ${status.workerRunning ? "Passphrases remain only in background-worker memory when this window closes. Use Lock to clear them; a worker restart or reboot forgets them." : "Unlock each encrypted repository again after restarting."}</p><p>Before using an SSH repository, connect once in your terminal to verify the server's host key and configure key-based authentication. borgd does not answer interactive SSH prompts.</p><p>Back up your repository key separately using <code>borg key export REPOSITORY keyfile</code>. Losing the key or passphrase can make encrypted backups unrecoverable.</p><p>Retention only affects archives created by the selected profile. Preview pruning first. No automatic prune, compact, archive deletion, or destructive repair is performed.</p></section><section class="settings-card"><h2>${icon("info")} About borgd</h2><p>Version 0.1.0 · Rust + Tauri · Developed by Chris Visser.</p><p>${status.workerRunning ? "The background worker owns all Borg operations and schedules. This window can close during backups. Registered startup runs at user login. Linux systemd additionally supports logout/boot operation when user lingering is separately enabled. Powered-off or suspended computers cannot run backups; overdue schedules run once on resume." : "Start the background worker above to run scheduled backups. Stopped workers do not execute schedules."} Borg operations are serialized; no parallel backups or force-unlocking.</p></section>`;
}

function modal(
  title: string,
  subtitle: string,
  body: string,
  submit: string,
  handler: (form: HTMLFormElement) => Promise<void>,
  wide = false,
) {
  modalRoot.innerHTML = `<dialog class="modal ${wide ? "wide" : ""}"><form><div class="modal-heading"><div><h2>${title}</h2><p>${subtitle}</p></div><button type="button" class="icon-button" data-close aria-label="Close dialog">${icon("x")}</button></div><div class="modal-body">${body}</div><p class="form-error" role="alert"></p><div class="modal-footer"><button type="button" class="button" data-close>Cancel</button><button type="submit" class="button primary">${submit}</button></div></form></dialog>`;
  const dialog = modalRoot.querySelector("dialog")!;
  const form = dialog.querySelector("form")!;
  let submitting = false;
  dialog.addEventListener("cancel", (event) => {
    if (submitting) event.preventDefault();
  });
  dialog.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!submitting) dialog.close();
    }),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    form
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = true));
    try {
      await handler(form);
      dialog.close();
    } catch (err) {
      form.querySelector(".form-error")!.textContent = String(err);
    } finally {
      submitting = false;
      form
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => (b.disabled = false));
    }
  });
  dialog.showModal();
  paintIcons();
}
const field = (
  label: string,
  name: string,
  value = "",
  placeholder = "",
  type = "text",
  required = true,
) =>
  `<label class="field">${label}<input name="${name}" type="${type}" value="${e(value)}" placeholder="${e(placeholder)}" ${required ? "required" : ""}></label>`;
const value = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) ?? "").trim();
async function save(next: Config) {
  next.onboardingComplete =
    !isFreshInstallation(config, status.history) ||
    next.repositories.length > 0 ||
    next.profiles.length > 0;
  await invoke("save_config", { config: next });
  config = next;
  render();
}
function addRepo() {
  modal(
    "Add a repository",
    "A secure destination for your backups.",
    `${field("Name", "name", "", "External drive, Home server...")}<label class="field">Repository type<select name="mode"><option value="existing">Connect existing repository</option><option value="new">Create encrypted repository</option><option value="plain">Create unencrypted repository</option></select></label><label class="field">Repository location<div class="input-action"><input required name="location" placeholder="/media/backup/borg or ssh://user@host/./repo"><button type="button" class="button" id="pick-repo" aria-label="Choose repository folder" title="Choose repository folder">${icon("folder-open")}</button></div></label>${field("Passphrase (session only)", "passphrase", "", "Leave empty for unencrypted repositories", "password", false)}<p class="field-help">New encrypted repositories use repokey-blake2. Use a strong, unique passphrase. On Windows enter WSL paths manually.</p>`,
    "Connect repository",
    async (form) => {
      const mode = value(form, "mode");
      const passphrase = String(new FormData(form).get("passphrase") ?? "");
      if (mode === "new" && !passphrase)
        throw new Error("An encryption passphrase is required.");
      const r: Repository = {
        id: crypto.randomUUID(),
        name: value(form, "name"),
        location: value(form, "location"),
      };
      await save({ ...config, repositories: [...config.repositories, r] });
      await invoke("unlock", { id: r.id, passphrase });
      repositoryId = r.id;
      try {
        if (mode !== "existing")
          await operation("init", r.id, { encrypted: mode === "new" });
        await operation("info", r.id);
      } catch {
        // Keep the connection after failure so it can be unlocked or initialized again.
        notify(
          "Connection saved, but Borg could not open it. Review Activity, then unlock or initialize the repository.",
          true,
        );
      }
      route = "repositories";
      render();
    },
  );
  document.querySelector("#pick-repo")!.addEventListener("click", async () => {
    try {
      const path = await pickFolder();
      if (path)
        (
          document.querySelector('[name="location"]') as HTMLInputElement
        ).value = path;
    } catch (err) {
      notify(String(err), true);
    }
  });
}
function profilePage(
  title: string,
  _subtitle: string,
  body: string,
  submit: string,
  handler: (form: HTMLFormElement) => Promise<void>,
  _wide = false,
) {
  profileTitle = title;
  const form = document.createElement("form");
  form.id = "profile-form";
  form.setAttribute("aria-label", title);
  form.innerHTML = `<p class="form-error" role="alert" hidden></p><fieldset class="profile-fields">${body}</fieldset><div class="inline-form-actions"><button type="button" class="button" data-action="profile-cancel">Cancel</button><button type="submit" class="button primary">${e(submit)}</button></div>`;
  let submitting = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submitting || !form.reportValidity()) return;
    submitting = true;
    form.setAttribute("aria-busy", "true");
    const message = form.querySelector<HTMLElement>('[role="alert"]')!;
    message.hidden = true;
    const fields = form.querySelector("fieldset")!;
    const buttons = [
      ...form.querySelectorAll<HTMLButtonElement>(
        ".inline-form-actions button",
      ),
    ];
    try {
      const pending = handler(form);
      fields.disabled = true;
      buttons.forEach((button) => (button.disabled = true));
      await pending;
      profileForm = null;
      route = "repositories";
      repositoryPanels.set(profileRepositoryId, "profiles");
      render();
    } catch (error) {
      message.textContent = String(error);
      message.hidden = false;
      message.scrollIntoView({ block: "nearest" });
    } finally {
      submitting = false;
      form.removeAttribute("aria-busy");
      fields.disabled = false;
      buttons.forEach((button) => (button.disabled = false));
    }
  };
  profileForm = form;
  route = "repositories";
  repositoryPanels.set(profileRepositoryId, "profiles");
  render();
}
function editProfile(id?: string, owner = repositoryId) {
  if (profileForm) {
    notify(
      "Save or cancel the current profile draft before opening another.",
      true,
    );
    return;
  }
  const p = config.profiles.find((p) => p.id === id);
  profileRepositoryId = p?.repositoryId ?? owner ?? config.repositories[0]?.id;
  if (!repo(profileRepositoryId))
    profileRepositoryId = config.repositories[0]?.id ?? "";
  const profileId = p?.id ?? crypto.randomUUID();
  if (!config.repositories.length) {
    addRepo();
    return;
  }
  profilePage(
    p ? "Edit backup profile" : "New backup profile",
    "A little setup. A lot of peace of mind.",
    `<div class="profile-form-grid"><section class="settings-card profile-inputs"><h2>Sources &amp; destination</h2>${field("Profile name", "name", p?.name, "My documents")}<label class="field">Repository<select name="repositoryId">${config.repositories.map((r) => `<option value="${e(r.id)}" ${r.id === profileRepositoryId ? "selected" : ""}>${e(r.name)}</option>`).join("")}</select></label><div class="field"><div class="source-heading"><label for="profile-sources">Source folders<span class="label-note">One absolute path per line</span></label><button type="button" class="button" id="pick-source">+ Source</button></div><textarea id="profile-sources" required name="sources" rows="6" placeholder="/home/you/Documents">${e(p?.sources.join("\n"))}</textarea></div><label class="field">Exclude patterns <span class="label-note">Optional, one Borg pattern per line</span><textarea name="excludes" rows="2" placeholder="sh:**/node_modules\nsh:**/.cache">${e(p?.excludes.join("\n"))}</textarea></label></section><section class="settings-card profile-policy"><h2>Retention &amp; schedule</h2><div class="form-section"><h3>Retention</h3><p>Applied only when you run prune. Other profiles are never touched.</p><div class="form-columns">${field("Daily", "keepDaily", String(p?.keepDaily ?? 7), "", "number")}${field("Weekly", "keepWeekly", String(p?.keepWeekly ?? 4), "", "number")}${field("Monthly", "keepMonthly", String(p?.keepMonthly ?? 6), "", "number")}</div></div>${field("Backup interval in hours (0 = manual)", "intervalHours", String(p?.intervalHours ?? 0), "", "number")}<p class="field-help">${status.workerRunning ? "The background worker runs schedules even when this window is closed. Encrypted repositories need a passphrase in worker memory after each worker restart. Missed intervals run once when the worker resumes." : "Schedules on this platform require borgd to stay open and the repository to be unlocked."} The first scheduled backup runs within a minute.</p>${p ? `<div class="profile-tools">${button("Preview prune", "prune-preview", "list-filter", `type="button" data-id="${e(p.id)}" ${disabled()}`)}${button("Apply retention", "prune-apply", "scissors", `type="button" data-id="${e(p.id)}" ${disabled()}`)}<button type="button" class="text-button danger" data-action="delete-profile" data-id="${e(p.id)}">Delete profile</button></div>` : ""}</section></div>`,
    "Save profile",
    async (form) => {
      const number = (key: string) => {
        const n = Number(value(form, key));
        if (!Number.isInteger(n) || n < 0 || n > 65535)
          throw new Error(
            "Retention and intervals must be whole numbers between 0 and 65535.",
          );
        return n;
      };
      const next: Profile = {
        id: profileId,
        name: value(form, "name"),
        repositoryId: value(form, "repositoryId"),
        sources: lines(value(form, "sources")),
        excludes: lines(value(form, "excludes")),
        keepDaily: number("keepDaily"),
        keepWeekly: number("keepWeekly"),
        keepMonthly: number("keepMonthly"),
        intervalHours: number("intervalHours"),
      };
      await save({
        ...config,
        profiles: p
          ? config.profiles.map((x) => (x.id === p.id ? next : x))
          : [...config.profiles, next],
      });
      profileRepositoryId = next.repositoryId;
      notify("Backup profile saved.");
    },
    true,
  );
  profileForm!
    .querySelectorAll<HTMLInputElement>('input[type="number"]')
    .forEach((input) => {
      input.min = "0";
      input.max = "65535";
    });
  const pickerForm = profileForm!;
  pickerForm
    .querySelector("#pick-source")!
    .addEventListener("click", async () => {
      try {
        const folder = await pickFolder();
        if (folder) {
          const area =
            pickerForm.querySelector<HTMLTextAreaElement>('[name="sources"]')!;
          area.value = [...new Set([...lines(area.value), folder])].join("\n");
        }
      } catch (err) {
        notify(String(err), true);
      }
    });
}
async function pickFolder() {
  if (navigator.userAgent.includes("Windows"))
    throw new Error("Enter a WSL directory path manually on Windows.");
  return (await open({ directory: true, multiple: false })) as string | null;
}
function checkProgressMarkup(): string {
  const progress = checkProgress(status);
  if (!progress) return "";
  const entry = status.history[0];
  return `<section class="check-progress-panel" aria-label="Integrity check progress"><div class="activity-section-heading"><h2>${e(progress.label)}</h2><span>${progress.value === null ? (status.busy ? "In progress" : "Stopped") : `${progress.value}%`}</span></div>${status.busy || progress.value !== null ? `<progress max="100" ${progress.value === null ? "" : `value="${progress.value}"`} aria-label="${e(progress.label)}"></progress>` : ""}<p>${e(progress.detail)}</p>${progress.needsPassphrase && entry ? button("Set session passphrase", "unlock", "key-round", `data-id="${e(entry.repositoryId)}"`) : ""}</section>`;
}
function clearUnlock() {
  const input = unlockForm?.querySelector<HTMLInputElement>(
    'input[type="password"]',
  );
  if (input) input.value = "";
  unlockForm = null;
  unlockRepositoryId = "";
}
function unlockInline(id: string) {
  if (unlockForm?.getAttribute("aria-busy") === "true") return;
  if (unlockForm && unlockRepositoryId === id) {
    unlockForm.querySelector<HTMLInputElement>("input")?.focus();
    return;
  }
  clearUnlock();
  unlockRepositoryId = id;
  const form = document.createElement("form");
  form.className = "inline-unlock";
  form.setAttribute("aria-label", `Unlock ${repo(id)?.name ?? "repository"}`);
  form.innerHTML = `<div class="unlock-entry"><label class="field">Repository passphrase<input name="passphrase" type="password" autocomplete="off" spellcheck="false" aria-label="Repository passphrase"></label><button type="submit" class="button primary">Set session passphrase</button><button type="button" class="button" data-cancel-unlock>Cancel</button></div><p class="field-help">${status.workerRunning ? "Kept only in background-worker memory when this window closes. Lock, worker restart, or reboot clears it." : "Kept only in memory until borgd exits."} Empty is valid for an unencrypted repository. Setting a passphrase does not verify it; Inspect verifies repository access.</p><p class="form-error" role="alert" hidden></p>`;
  const input = form.querySelector<HTMLInputElement>("input")!;
  form.querySelector<HTMLButtonElement>("[data-cancel-unlock]")!.onclick =
    () => {
      if (form.getAttribute("aria-busy") === "true") return;
      clearUnlock();
      render();
    };
  form.onkeydown = (event) => {
    if (event.key === "Escape" && form.getAttribute("aria-busy") !== "true") {
      event.preventDefault();
      clearUnlock();
      render();
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;
    form.setAttribute("aria-busy", "true");
    input.readOnly = true;
    const error = form.querySelector<HTMLElement>('[role="alert"]')!;
    error.hidden = true;
    const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")];
    buttons.forEach((button) => (button.disabled = true));
    try {
      await invoke("unlock", { id, passphrase: input.value });
      input.value = "";
      if (unlockForm === form) clearUnlock();
      await refreshStatus();
      render();
      notify(
        "Session passphrase set. Inspect the repository to verify access.",
      );
    } catch (failure) {
      input.value = "";
      error.textContent = String(failure);
      error.hidden = false;
      input.focus();
    } finally {
      form.removeAttribute("aria-busy");
      input.readOnly = false;
      buttons.forEach((button) => (button.disabled = false));
    }
  };
  unlockForm = form;
  route = "repositories";
  render();
  input.focus();
}
async function operation(
  action: string,
  id: string,
  extras: Record<string, unknown> = {},
): Promise<Result> {
  if (!available)
    throw new Error("Borg 1.x is not available. See Settings & help.");
  if (status.busy) throw new Error("Wait for the current operation to finish.");
  operationPending = true;
  status.busy = true;
  status.action = action;
  status.logs = [];
  render();
  try {
    const output = await runWithRelocation(
      { action, repositoryId: id, ...extras },
      async () => {
        operationPending = false;
        await refreshStatus();
        render();
        return status.relocation;
      },
      () => {
        operationPending = true;
        status.busy = true;
        status.logs = [];
        render();
      },
    );
    if (action === "info") info[id] = output.data;
    if (action === "archives")
      archives[id] = output.data.archives.map((archive: Archive) => ({
        ...archive,
        time: archive.time || archive.start || "",
      }));
    if (action === "files") {
      archiveBrowser.load(output.data);
      fileArchive = String(extras.archive);
    }
    if (action === "backup") {
      delete archives[id];
      delete info[id];
    }
    notify(
      output.exitCode === 0
        ? `${action.charAt(0).toUpperCase() + action.slice(1)} completed.`
        : "Borg completed with warnings. Review Activity.",
      output.exitCode !== 0,
    );
    return output;
  } catch (err) {
    notify(String(err), true);
    throw err;
  } finally {
    operationPending = false;
    await refreshStatus();
    render();
  }
}
async function refreshStatus() {
  if (isTauri()) {
    status = await invoke<Status>("get_status");
    status.busy ||= operationPending;
  }
}
async function probe() {
  initialized = true;
  try {
    version = await invoke<string>("probe");
    available = true;
    error = "";
  } catch (err) {
    version = "Borg unavailable";
    available = false;
    error = String(err);
  }
  render();
  if (!available && !installPromptShown && isTauri()) {
    installPromptShown = true;
    try {
      await offerBorgInstall();
    } catch {
      /* Setup guide remains available if planning is unsupported. */
    }
  }
}
function restoreDialog(
  selectedRepository: string,
  selectedArchive: string,
  paths?: string[],
) {
  if (status.busy) {
    notify("Wait for the current operation to finish.", true);
    return;
  }
  const selection = paths?.slice();
  if (selection && !selection.length) return;
  modal(
    selection ? "Restore selected items" : "Restore an archive",
    e(selectedArchive),
    `<p class="field-help">Choose an existing, empty destination. Stored archive paths are recreated beneath it; non-empty destinations are rejected. Only restore archives you trust. ${selection ? "Only the selected paths are restored; folders include their descendants." : "This restores the whole archive."}</p>${selection ? `<ul class="restore-paths">${selection.map((path) => `<li><code>${e(path)}</code></li>`).join("")}</ul>` : ""}<label class="field">Destination folder<div class="input-action"><input required name="destination" placeholder="/home/you/Restored"><button class="button" type="button" id="pick-restore">${icon("folder-open")}</button></div></label>`,
    selection
      ? `Restore ${selection.length} selected item${selection.length === 1 ? "" : "s"}`
      : "Restore archive",
    async (form) => {
      modalRoot.querySelector<HTMLDialogElement>("dialog[open]")?.close();
      route = "activity";
      await operation("restore", selectedRepository, {
        archive: selectedArchive,
        destination: value(form, "destination"),
        ...(selection ? { selectedPaths: selection } : {}),
      });
    },
  );
  document
    .querySelector("#pick-restore")!
    .addEventListener("click", async () => {
      try {
        const path = await pickFolder();
        if (path)
          document.querySelector<HTMLInputElement>(
            '[name="destination"]',
          )!.value = path;
      } catch (error) {
        notify(String(error), true);
      }
    });
}
interface InstallPlan {
  installedVersion?: string | null;
  id: string;
  available: boolean;
  title: string;
  message: string;
  commands: string[];
}
async function offerBorgInstall() {
  if (!isTauri() || installPlanning || modalRoot.querySelector("dialog[open]"))
    return;
  installPlanning = true;
  let plan: InstallPlan;
  try {
    plan = await invoke<InstallPlan>("get_install_plan");
  } finally {
    installPlanning = false;
  }
  if (modalRoot.querySelector("dialog[open]")) {
    await invoke("dismiss_install_plan", { planId: plan.id });
    return;
  }
  if (plan.installedVersion) {
    await invoke("dismiss_install_plan", { planId: plan.id });
    await probe();
    return;
  }
  modal(
    plan.available ? "Install Borg Backup?" : "Borg setup needs a prerequisite",
    e(plan.title),
    `<p id="install-message" class="field-help">${e(plan.message)}</p><pre id="install-commands" class="install-commands">${e(plan.commands.join("\n"))}</pre><p class="field-help">Installation starts only after your approval. Administrator passwords, if needed, are handled by your operating system, never entered into borgd. borgd requires Borg 1.2+ within the 1.x series. Compatibility is verified before backups are enabled.</p><div id="install-progress" role="status" aria-live="polite"></div>`,
    plan.available ? "Install Borg Backup" : "View setup guide",
    async () => {
      if (!plan.available) {
        route = "settings";
        render();
        return;
      }
      const progress = document.querySelector("#install-progress")!;
      progress.innerHTML =
        '<p>Installing Borg and dependencies. Approve any operating-system authorization prompt and keep borgd open.</p><progress aria-label="Borg installation progress"></progress>';
      try {
        const installed = await invoke<string>("install_borg", {
          planId: plan.id,
        });
        await probe();
        if (!available) throw new Error(error);
        notify(`${installed} is ready and verified.`);
      } catch (failure) {
        progress.textContent =
          "Installation did not complete. No backup was started. You can retry with a fresh approval or use the setup guide.";
        try {
          plan = await invoke<InstallPlan>("get_install_plan");
          document.querySelector("#install-message")!.textContent =
            plan.message;
          document.querySelector("#install-commands")!.textContent =
            plan.commands.join("\n");
        } catch {
          /* Keep the original failure visible. */
        }
        throw failure;
      }
    },
  );
  modalRoot.querySelector("dialog")!.addEventListener(
    "close",
    () => {
      void invoke("dismiss_install_plan", { planId: plan.id }).catch(() => {});
    },
    { once: true },
  );
}
function archiveFilesView(): string {
  const context = "";
  if (archiveLoading)
    return `${context}<p role="status">Loading archive contents from Borg...</p>`;
  if (archiveError)
    return `${context}<div class="repository-error" role="alert"><strong>Could not load archive contents</strong><p>${e(archiveError)}</p>${button("Retry", "files", "refresh-cw", `data-archive="${e(fileArchive)}" data-repository="${e(fileRepositoryId)}" ${disabled()}`)}</div>`;
  return `${context}<div id="archive-browser-root">${archiveBrowser.html()}</div>`;
}
function confirmAction(
  title: string,
  description: string,
  label: string,
  handler: () => Promise<void>,
) {
  modal(
    title,
    "",
    `<p class="confirm-copy">${description}</p>`,
    label,
    handler,
  );
}
async function copyToClipboard(text: string, label: string) {
  if (isTauri()) await writeText(text);
  else if (navigator.clipboard) await navigator.clipboard.writeText(text);
  else throw new Error("Clipboard access is unavailable. Use the desktop app.");
  notify(`${label} copied to clipboard.`);
}
async function handleAction(action: string, element: HTMLElement) {
  const id = element.dataset.id || repositoryId;
  const profile = config.profiles.find((p) => p.id === id);
  if (
    profileForm?.getAttribute("aria-busy") === "true" &&
    [
      "add-profile",
      "edit-profile",
      "forget-repo",
      "delete-profile",
      "add-repo",
    ].includes(action)
  )
    throw new Error("Wait for the current profile save to finish.");
  switch (action) {
    case "open-project":
      if (isTauri()) await invoke("open_project_url");
      else
        window.open(
          "https://github.com/vcsoc/borgd",
          "_blank",
          "noopener,noreferrer",
        );
      break;
    case "copy-log":
      if (status.logs.length)
        await copyToClipboard(
          document.querySelector("#terminal")?.textContent ??
            status.logs.join("\n"),
          "Operation log",
        );
      break;
    case "copy-history": {
      const entry = status.history.find((h) =>
        element.dataset.id
          ? h.id === element.dataset.id
          : h.time === element.dataset.time &&
            h.action === element.dataset.operation &&
            h.repositoryId === element.dataset.repository,
      );
      if (!entry)
        throw new Error("This operation is no longer in recent history.");
      const button = element as HTMLButtonElement;
      button.disabled = true;
      try {
        const details =
          entry.id && entry.detailsAvailable
            ? await invoke<ActivityDetails>("get_history_details", {
                id: entry.id,
              })
            : undefined;
        await copyToClipboard(
          activityDetailsText(entry, config, details),
          "Operation details",
        );
      } finally {
        button.disabled = false;
      }
      break;
    }
    case "toggle-terminal":
      await terminalDock.toggle();
      break;
    case "add-repo":
      addRepo();
      break;
    case "profile-cancel":
      if (profileForm?.getAttribute("aria-busy") === "true") return;
      profileForm = null;
      route = "repositories";
      render();
      break;
    case "add-profile":
      editProfile(undefined, id);
      break;
    case "edit-profile":
      editProfile(id);
      break;
    case "new-backup":
      if (!config.repositories.length) addRepo();
      else if (!config.profiles.length) editProfile();
      else {
        route = "repositories";
        render();
      }
      break;
    case "setup":
      route = "settings";
      render();
      void refreshWorkerService();
      break;
    case "service-refresh":
      await refreshWorkerService();
      break;
    case "service-register":
    case "service-start":
      await changeWorkerService(action.slice(8));
      break;
    case "service-stop":
    case "service-uninstall": {
      const uninstall = action === "service-uninstall";
      confirmAction(
        uninstall ? "Uninstall worker startup?" : "Stop background backups?",
        "Accepted Borg operations will finish before shutdown; no process is force-killed. Background schedules pause until Start. Memory-only repository passphrases will be cleared. " +
          (uninstall
            ? "The startup registration will be removed; repositories, archives and profiles remain unchanged."
            : "The startup registration remains installed."),
        uninstall ? "Uninstall worker startup" : "Stop worker",
        () => changeWorkerService(uninstall ? "uninstall" : "stop"),
      );
      break;
    }
    case "probe":
      await probe();
      break;
    case "unlock":
      unlockInline(id);
      break;
    case "lock-repository":
      await invoke("lock_repository", { id });
      await refreshStatus();
      render();
      notify("Repository locked for this session.");
      break;
    case "backup":
      if (!profile) return;
      if (!status.unlocked.includes(profile.repositoryId)) {
        unlockInline(profile.repositoryId);
        return;
      }
      route = "activity";
      await operation("backup", profile.repositoryId, { profileId: id });
      break;
    case "info":
      await operation("info", id);
      break;
    case "check":
      confirmAction(
        "Check repository integrity?",
        "Borg will verify repository and archive consistency without repairing data. It still needs a writable repository lock and, for encrypted archives, the correct session passphrase. Progress appears in Activity; keep borgd open until it finishes.",
        "Run integrity check",
        async () => {
          modalRoot.querySelector<HTMLDialogElement>("dialog[open]")?.close();
          route = "activity";
          await operation("check", id);
        },
      );
      break;
    case "initialize":
      modal(
        "Initialize an encrypted repository",
        "Only for a new, empty repository location.",
        `${field("Encryption passphrase", "passphrase", "", "", "password")}<p class="field-help">Existing Borg repositories are never overwritten. Export the repository key after creation.</p>`,
        "Create repository",
        async (form) => {
          await invoke("unlock", {
            id,
            passphrase: String(new FormData(form).get("passphrase")),
          });
          await operation("init", id, { encrypted: true });
        },
      );
      break;
    case "repo-panel": {
      const panel = element.dataset.panel as RepositoryPanel;
      if (!["overview", "profiles", "archives"].includes(panel)) return;
      if (repositoryPanels.get(id) === panel) repositoryPanels.delete(id);
      else repositoryPanels.set(id, panel);
      repositoryId = id;
      render();
      app
        .querySelector<HTMLButtonElement>(
          `[data-action="repo-panel"][data-id="${CSS.escape(id)}"][data-panel="${panel}"]`,
        )
        ?.focus({ preventScroll: true });
      if (panel === "archives" && repositoryPanels.get(id) === "archives")
        await loadRepositoryArchives(id);
      break;
    }
    case "sort-archives": {
      const column = element.dataset.column as ArchiveColumn;
      if (!["name", "time", "files", "size"].includes(column)) return;
      const state = archiveState(id);
      state.direction =
        state.sort === column && state.direction === "asc" ? "desc" : "asc";
      state.sort = column;
      render();
      app
        .querySelector<HTMLButtonElement>(
          `[data-action="sort-archives"][data-id="${CSS.escape(id)}"][data-column="${column}"]`,
        )
        ?.focus({ preventScroll: true });
      break;
    }
    case "load-archives":
      await loadRepositoryArchives(id);
      break;
    case "diff-run":
      await loadArchiveDiff();
      break;
    case "diff-more":
      diffVisible += 200;
      render();
      break;
    case "diff-back":
      repositoryId = diffRepository;
      repositoryPanels.set(diffRepository, "archives");
      route = "repositories";
      render();
      break;
    case "archive-back":
      repositoryId = fileRepositoryId;
      repositoryPanels.set(fileRepositoryId, "archives");
      route = "repositories";
      render();
      break;
    case "files":
      fileRepositoryId = element.dataset.repository ?? repositoryId;
      fileArchive = element.dataset.archive ?? "";
      archiveLoading = true;
      archiveError = "";
      route = "archiveFiles";
      try {
        await operation("files", fileRepositoryId, { archive: fileArchive });
      } catch (error) {
        archiveError = String(error);
      } finally {
        archiveLoading = false;
        render();
      }
      break;
    case "restore":
      restoreDialog(
        element.dataset.repository ?? repositoryId,
        element.dataset.archive ?? "",
      );
      break;
    case "install-borg":
      await offerBorgInstall();
      break;
    case "appearance-reset":
      saveAppearance("mono", 14);
      render();
      break;
    case "prune-preview":
    case "prune-apply":
      if (!profile) return;
      modalRoot.querySelector("dialog")?.close();
      confirmAction(
        action === "prune-preview" ? "Preview retention" : "Apply retention?",
        action === "prune-preview"
          ? "List archives Borg would remove, without deleting anything. Review the results in Activity."
          : `This permanently removes archives for ${e(profile.name)} outside its retention policy. Other profiles are not affected. Preview first and make sure you have a recent, verified backup.`,
        action === "prune-preview" ? "Run preview" : "Prune archives",
        async () => {
          route = "activity";
          const output = await operation("prune", profile.repositoryId, {
            profileId: profile.id,
            dryRun: action === "prune-preview",
          });
          if (output.text) {
            status.logs.push(output.text);
            render();
          }
          delete archives[profile.repositoryId];
          delete info[profile.repositoryId];
        },
      );
      break;
    case "delete-profile":
      modalRoot.querySelector("dialog")?.close();
      confirmAction(
        "Delete this profile?",
        "The profile and its schedule are removed. Existing backup archives remain untouched.",
        "Delete profile",
        async () => {
          await save({
            ...config,
            profiles: config.profiles.filter((p) => p.id !== id),
          });
          profileForm = null;
          route = "repositories";
          render();
        },
      );
      break;
    case "forget-repo":
      confirmAction(
        "Forget this repository?",
        "Removes this connection and its backup profiles from borgd. The repository and all backups on disk are left untouched.",
        "Forget repository",
        async () => {
          await save({
            repositories: config.repositories.filter((r) => r.id !== id),
            profiles: config.profiles.filter((p) => p.repositoryId !== id),
          });
          if (profileRepositoryId === id) profileForm = null;
          if (unlockRepositoryId === id) clearUnlock();
          repositoryPanels.delete(id);
          archiveStates.delete(id);
          archiveLoadErrors.delete(id);
          archiveLoadState.delete(id);
          delete archives[id];
          delete info[id];
          render();
        },
      );
      break;
  }
}
document.addEventListener("click", (event) => {
  const element = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-action], [data-route], [data-repo]",
  );
  if (!element || element.hasAttribute("disabled")) return;
  if (element.dataset.action === "open-project") event.preventDefault();
  if (element.dataset.route) {
    route = element.dataset.route;
    render();
    if (route === "settings") void refreshWorkerService();
  } else if (element.dataset.repo) {
    repositoryId = element.dataset.repo;
    route = "repositories";
    repositoryPanels.set(repositoryId, "archives");
    render();
  } else if (element.dataset.action)
    void handleAction(element.dataset.action, element).catch((err) =>
      notify(String(err), true),
    );
});
document.addEventListener("contextmenu", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>(
    ".archive-table tbody tr[data-archive-row]",
  );
  if (!row) return;
  event.preventDefault();
  showArchiveMenu(row, event.clientX, event.clientY);
});
document.addEventListener("keydown", (event) => {
  if (archiveMenu && event.key === "Escape") {
    event.preventDefault();
    closeArchiveMenu(true);
    return;
  }
  const row = (event.target as HTMLElement).closest<HTMLElement>(
    ".archive-table tbody tr[data-archive-row]",
  );
  if (
    row &&
    (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
  ) {
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    showArchiveMenu(row, rect.left + 24, rect.top + 20);
  }
});
document.addEventListener("pointerdown", (event) => {
  if (archiveMenu && !archiveMenu.contains(event.target as Node))
    closeArchiveMenu();
});
window.addEventListener("resize", () => closeArchiveMenu());
window.addEventListener("wheel", () => closeArchiveMenu(), { passive: true });
document.addEventListener("change", (event) => {
  const target = event.target as HTMLSelectElement;
  if (target.id === "diff-base") {
    diffBase = target.value;
    diffGeneration++;
    diffEntries = null;
    diffError = "";
    diffLoading = false;
    render();
  }
  if (target.id === "icon-buttons")
    setIconButtons((event.target as HTMLInputElement).checked);
  if (target.id === "appearance-family" || target.id === "appearance-size") {
    saveAppearance(
      document.querySelector<HTMLSelectElement>("#appearance-family")!.value,
      Number(
        document.querySelector<HTMLSelectElement>("#appearance-size")!.value,
      ),
    );
  }
});
document.addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (target.classList.contains("archive-search")) {
    const id = target.dataset.repository!;
    archiveState(id).filter = target.value;
    const start = target.selectionStart;
    render();
    const search = app.querySelector<HTMLInputElement>(
      `.archive-search[data-repository="${CSS.escape(id)}"]`,
    )!;
    search.focus({ preventScroll: true });
    search.setSelectionRange(start, start);
  }
});

async function start() {
  render();
  if (!isTauri()) {
    version = "Browser preview";
    render();
    return;
  }
  try {
    config = await invoke<Config>("get_config");
    await refreshStatus();
    await probe();
  } catch (err) {
    error = String(err);
    notify(error, true);
    render();
  }
  setInterval(async () => {
    try {
      const previousBusy = status.busy;
      const previousUnlocks = JSON.stringify(status.unlocked);
      const previousWorker = `${status.workerRunning}:${status.workerOffline}:${status.archiveDiffSupported}`;
      const previousHistory =
        route === "repositories" ? overviewHistoryKey() : "";
      await refreshStatus();
      if (
        previousBusy !== status.busy ||
        previousWorker !==
          `${status.workerRunning}:${status.workerOffline}:${status.archiveDiffSupported}` ||
        previousUnlocks !== JSON.stringify(status.unlocked) ||
        (route === "repositories" &&
          (previousHistory !== overviewHistoryKey() ||
            overviewRenderedDay !== new Date().toDateString()))
      ) {
        render();
        return;
      }
      const progress = document.querySelector("#check-progress");
      if (progress && status.busy) {
        const markup = checkProgressMarkup();
        if (progress.innerHTML !== markup) progress.innerHTML = markup;
      }
      const copyLog = document.querySelector<HTMLButtonElement>(
        '[data-action="copy-log"]',
      );
      if (copyLog) copyLog.disabled = !status.logs.length;
      const terminal = document.querySelector("#terminal");
      if (terminal && status.busy) {
        terminal.textContent = status.logs.join("\n");
        terminal.scrollTop = terminal.scrollHeight;
      }
    } catch {
      /* Keep the last known state if IPC is temporarily unavailable. */
    }
  }, 750);
  setInterval(async () => {
    if (
      status.workerRunning ||
      status.workerOffline ||
      !available ||
      status.busy ||
      modalRoot.querySelector("dialog[open]")
    )
      return;
    const p = config.profiles.find(
      (p) => status.unlocked.includes(p.repositoryId) && due(p, status.history),
    );
    if (p) {
      try {
        await operation("backup", p.repositoryId, { profileId: p.id });
      } catch {
        /* Failure is recorded; interval is measured from the attempt. */
      }
    }
  }, 60000);
}
void start();
