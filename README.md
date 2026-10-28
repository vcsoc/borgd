# borgd

A quiet home for your Borg backups. A Rust + Tauri desktop application with a compact charcoal workspace inspired by Pigeon: a persistent sidebar, restrained blue accents, subtle borders, and an uncluttered backup workflow.

## What works

- Create encrypted (`repokey-blake2`) or unencrypted Borg repositories; connect existing local or SSH repositories.
- Inspect repository encryption, original size, and deduplicated disk usage.
- Create and edit backup profiles with multiple source folders, Borg exclude patterns, LZ4 compression, and independent retention policies.
- Run real Borg backups, inspect operation output, and keep the last 200 operation results across restarts.
- Copy the visible operation log or a history entry's saved request, original repository/profile context, diagnostic log, and Borg output. The history table scrolls independently while the top log stays visible.
- List and filter archives, browse their file paths, and restore entire archives into an existing empty directory.
- Run read-only integrity checks; preview retention or explicitly prune a profile's archives. Other profiles and manually created archives are preserved.
- Schedule backups at an hourly interval using the Linux background worker, including with the desktop window closed. Scheduling is opt-in per profile (0 means manual). Encrypted repositories need a passphrase in worker memory; unencrypted repositories work unattended. The first backup runs on the next minute tick; failed attempts wait a full interval before retrying. Other platforms currently require the desktop app to stay open.
- Lock/unlock repositories for the session. Passphrases are never saved to the configuration or history, and are passed through the child process environment rather than its arguments.
- Serialize Borg operations, block window closing during active jobs, and focus the existing window instead of starting a second app instance.
- Open a real OS terminal dock with independent PTY tabs, interactive input, Ctrl-C, and a resizable panel whose height persists.
- Show the welcome walkthrough only on fresh installs; remember completed setup even after all connections are forgotten.

## Integrated terminal

Click **Terminal** above Settings & help to toggle the bottom dock. Use **+** to start another independent shell (up to 12 tabs). Hiding the dock or switching app pages keeps the shells and their output alive. Closing a tab or exiting borgd stops its shell; sessions are not restored after restarting the app.

Drag the dock's top divider to resize it. The divider also accepts Arrow Up/Down and Home/End when keyboard-focused. The selected height is saved locally and restored on the next app launch, bounded to the available window space.

Linux/macOS use your login shell; Windows uses the native `COMSPEC` shell through ConPTY. On Windows you can start `powershell` or `wsl` inside a tab. The terminal is a real, unrestricted user shell, not a simulated command runner. Normal shell history rules apply; borgd itself does not save terminal transcripts. Direct Borg commands in the shell bypass the GUI's operation serialization, so avoid modifying the same repository concurrently.

Terminal output has a bounded 1 MiB pending buffer per tab and 5,000 lines of frontend scrollback. Extremely fast output can discard older pending bytes, with an explicit notice. Host processes use a clean environment rather than inheriting AppImage Python/library paths.

## Platform support

| Platform | Package         | Borg backend                          |
| -------- | --------------- | ------------------------------------- |
| Linux    | AppImage        | System-installed Borg 1.2+ (1.x only) |
| macOS    | `.app` / `.dmg` | Native Borg installed with Homebrew   |
| Windows  | NSIS installer  | Borg in the default WSL distribution  |

Borg itself does not support native Windows operation. The GUI is native Windows, but all repository and source paths use WSL syntax, for example `/mnt/c/Users/you/Documents`. The folder picker is disabled on Windows to avoid silently mixing Windows and Linux paths. Restores validate the destination using Python 3 inside WSL and run `borg extract` with WSL's working directory set to that destination. SSH credentials and known-host verification belong inside WSL.

Borg 2 repositories are **not** supported. Borg is deliberately not bundled: install and update it with the OS package manager. Linux AppImages still depend on the host's FUSE support (or extract-and-run) and system Borg. A locally built AppImage inherits the build machine's glibc baseline; the release workflow builds on Ubuntu 22.04 for broader compatibility.

### Install Borg

```sh
# Debian / Ubuntu
sudo apt install borgbackup
# Arch
sudo pacman -S borg
# macOS
brew install borgbackup
```

Windows, from PowerShell:

```powershell
wsl --install
wsl -- sudo apt update
wsl -- sudo apt install borgbackup
```

For SSH destinations, first connect with your terminal, verify the host fingerprint, and configure key-based authentication. Use `ssh://user@host/./relative-to-home` or `ssh://user@host/absolute/path`. Interactive SSH password or host-key prompts cannot be answered by the GUI.

## Development

Requires Node.js 22.12+ (Node 24 LTS recommended), a current stable Rust toolchain, and [Tauri's platform prerequisites](https://v2.tauri.app/start/prerequisites/). Linux needs WebKitGTK 4.1, GTK 3, OpenSSL, and the corresponding development packages.

```sh
npm ci
npm run tauri -- dev
```

The frontend uses port **1437**. `npm run dev` opens a browser-only design preview; it does not execute backups. All actual Borg access goes through the Rust command layer.

```sh
npm run build:linux     # AppImage, run on Linux
npm run build:macos     # app + DMG, run on macOS
npm run build:windows   # NSIS installer, run on Windows
```

Output: `src-tauri/target/release/bundle/`. Signing/notarization credentials are not included. macOS and Windows packages must be built on their respective OS; Linux cannot validate those runtime environments. The included GitHub Actions workflows provide OS-specific builds and upload artifacts when run.

On Linux:

```sh
chmod +x borgd_0.1.0_amd64.AppImage
./borgd_0.1.0_amd64.AppImage
# Without FUSE:
./borgd_0.1.0_amd64.AppImage --appimage-extract-and-run
```

## Verification

```sh
npm test                         # Display helpers and scheduling rules
npm run build                    # Typecheck and production frontend build
npm run test:rust                # Validation + real Borg integration tests
npx playwright install chromium
npm run test:ui                   # Browser layout and mocked IPC workflow
```

To use an existing Chromium install:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:ui
```

Real Borg tests use disposable temporary directories, not your repositories. On Unix with Borg installed, they exercise initialization, encrypted backup, JSON archive/file listings, repository inspection, integrity checks, retention preview/application, restoration with content verification, nonempty-destination rejection, and preservation of other profiles' archives. Without Borg those integration tests print a skip message. Windows runs the pure validation/session-state tests and native terminal tests; WSL backup runtime integration is not automatically exercised by CI.

UI tests are intentionally separate: the desktop workflow tests mock Tauri IPC and are not evidence of real Borg execution. They cover onboarding migration, error visibility, terminal tabs/input/hiding, navigation without losing the terminal, pointer/keyboard resizing, and persisted panel height. Rust terminal tests use real PTYs and real shells; AppImage environment regression tests execute the actual system Borg.

A separate **native Linux AppImage** smoke test uses real WebKit, IPC, Borg, keyboard input, and PTYs without mocks. It creates a disposable HOME/config and never opens your configured repositories. With WebKitWebDriver installed and tauri-driver available:

```sh
cargo install tauri-driver --locked
python3 tests/native/appimage-smoke.py --application src-tauri/target/release/bundle/appimage/borgd_0.1.0_amd64.AppImage
```

Screenshots and native driver logs land in `test-results/`.

## Inline archive browser

Choose **Repositories → a repository's Archives panel → Browse** to open an edge-to-edge file manager, not a modal. Archive identity, Back to archives, and whole-archive restore live in the compact top bar, leaving the workspace to the folder tree and contents. The left pane contains the expandable folder hierarchy; the right pane lists the selected folder's contents with name, size, modification time, and type. Breadcrumbs navigate ancestors, and archive-wide search finds paths without expanding every folder. Both panes scroll independently. Arrow keys move through visible folder buttons and expand/collapse branches; Enter opens the focused folder. Large folders use **Show more**, rather than silently stopping at 500 matches. Missing directory records are represented by inferred parent folders.

Browsing only reads Borg's listing. Symbolic links are displayed as links, never followed into the host filesystem, and filenames are not opened or extracted. Use checkboxes or Ctrl/Cmd-click to select multiple files/folders, then right-click a selected item and choose **Restore selected items**. Right-clicking an unselected item selects it first; Shift+F10 also opens the menu and Escape dismisses it. The destination dialog lists the selected paths and requires an existing empty directory. Folder selections include descendants, using literal Borg prefix patterns rather than glob matching, and all other paths are excluded. Empty selections and unsafe relative paths are rejected, never treated as whole-archive restore. Stored archive paths are recreated beneath the destination. **Restore whole archive** remains a separate explicit action and retains the original repository context. **Back to archives** returns to that repository's inline archive panel, preserving its filter and sort.

## Borg detection and installation

borgd checks for compatible **Borg 1.2+ (1.x)** at startup and when you choose Check again. If unavailable, it offers an installation dialog showing the exact package-manager commands. Nothing is installed until you approve. You can reopen it using **Settings & help → Install Borg Backup**.

Automatic setup uses the native package manager on supported Debian/Ubuntu, Arch-family, Fedora/RHEL-family, or openSUSE systems through `pkexec`; Homebrew when already installed on macOS; or apt inside an already initialized default WSL distribution on Windows. Linux needs a working graphical authorization agent. Missing Homebrew/WSL or unsupported systems receive prerequisite/manual setup instructions; borgd never downloads and executes a bootstrap script. Package repositories/signature checks are those configured by the OS or package manager. Arch installation does not force a system upgrade or perform an unsafe partial database sync; update the OS normally if its package database is stale.

Installation approval expires after ten minutes and is consumed once. Cancel invalidates it. While a package operation is running, the app must stay open and normal OS authorization handles administrator credentials—borgd never asks for them. Installation errors are shown without automatic retries. Compatibility is checked again before any package command; if Borg became available in the meantime, installation is skipped. The engine is re-probed afterward; an incompatible package is not reported as ready and no backup starts automatically.

Installer tests cover consent, cancellation, fixed trusted commands, expired approvals, bounded output, and unprivileged failure handling. Native smoke testing previews and cancels an installation plan without executing packages; a real privileged installation must be tested separately on clean target systems.

## Archive Table And Profile Editor

The archive table defaults to **Created, descending**. Click Archive, Created, Files backed up, or Total size to toggle ascending/descending sorting; column headers expose their sort direction to assistive technology. Counts/sizes sort numerically, and missing metadata remains last rather than being shown as zero. Filtering retains the selected sort.

Archive refresh uses Borg's archive-info metadata to retrieve each archive's file count and original size. **Total size means original archive size before compression/deduplication**, not additional physical disk usage. This can take longer than listing archive names alone, especially for older archives whose statistics must be calculated. The listing response and diagnostics retain only names, IDs, timestamps, and the requested statistics—not original stored command lines or host details.

Creating/editing a backup profile opens an inline editor inside the owning repository's **Profiles** panel, not a separate page or dialog. New profiles default to that repository; saving an explicit repository change moves the profile to the selected repository's panel. Sources/destination and retention/schedule use a two-column layout on wide screens and stack in smaller windows. **+ Source** beside the Source folders heading opens the folder picker and appends a unique path; canceling the picker changes nothing. Windows still requires manually entered WSL paths. Form drafts survive background status-driven redraws, failed saves retain the entered values, Cancel discards without saving, and save/delete/prune remain explicit actions. A profile's retention controls operate on its saved configuration; editing a draft does not change the scheduler until Save profile succeeds.

## Persistent Linux Worker

The same executable supports `borgd --worker [--config-dir ABSOLUTE_PATH]` without initializing a window or WebKit. On Linux the desktop connects to this worker for configuration, unlock/lock, operations, relocation confirmation, progress, and history. One backend owns the state and serializes both scheduled and manual jobs. A per-configuration OS file lock prevents duplicate workers; RPC uses a `0600` Unix socket in a private `0700` directory. Requests and responses are bounded; passphrases are neither logged nor written to disk. Interrupted operation responses are not automatically retried—check Activity first.

On systemd desktops, first launch installs/enables the user-level `borgd-worker.service` using the AppImage's stable absolute path. It restarts after failure and starts at login. To also run after logout and start at boot, enable user lingering with `loginctl enable-linger USER` (subject to OS authorization). This does not make encrypted passphrases survive a reboot, and sleeping/powered-off machines cannot run jobs. Due schedules run once on resume, not once per missed interval. No automatic prune, compact, repair, relocation approval, or force-unlock is added. The worker gracefully finishes active operations before stopping; the unit never sends stop signals to Borg children.

```sh
systemctl --user status borgd-worker.service
journalctl --user -u borgd-worker.service
systemctl --user stop borgd-worker.service         # waits for an active backup
systemctl --user disable --now borgd-worker.service # stop autostart; opening the app enables it again
```

Without a working systemd user manager, Linux starts a standalone worker that survives the desktop window; configure an external supervisor for boot/login startup. macOS/Windows persistent services are not implemented; their existing open-window scheduler remains. `BORGD_STANDALONE=1` is a developer/testing escape hatch for the original in-process backend. Builds require Rust 1.89+ for OS file locking.

Native AppImage testing uses an independently launched worker and temporary config, verifies GUI/worker shared state, closes the GUI, then observes a real scheduled Borg backup completing with no desktop window. It never enables or restarts the real user's service or accesses their repositories.

## Flat Workspace And Analytics

Repositories is the home workspace. Each repository has independently expandable **Overview**, **Profiles**, and **Archives** sections beneath its controls. There are no standalone Overview, Backup profiles, or Archives pages. Profile operations and charts are repository-scoped, and archive filters/sorts are independent per repository. Opening Overview or Profiles does not execute Borg. Opening Archives automatically requests that repository's listing; Refresh explicitly reloads it. Listings are serialized behind active work, duplicate in-flight requests are coalesced, and queued requests are skipped if their panel closes before starting. Loading and failures are never presented as an empty repository; **No archives yet** appears only after a successful empty listing. A failed refresh labels retained cached data as potentially out of date. Unsubmitted profile drafts survive collapsed panels, navigation, and status redraws until Save or Cancel. Only one profile draft can be edited at a time. The workspace uses flat rows, open sections, and thin dividers instead of boxed cards. Profiles, repositories, settings, archive tables, activity, and inline profile editing share this treatment. Destructive operations and package installation still require explicit confirmations.

Each repository's Overview section includes a 30-day recorded-backup graph, an 84-local-calendar-day activity heatmap with an accessible daily-count table, and doughnut charts for retained backup outcomes and inspected repository storage. Completed runs, warnings, and failures remain distinct. Charts use real retained history (up to 200 operations), not synthetic data or a complete audit history: blank days mean no retained record, not proof of no backup. Overview sections refresh when worker history changes or the local date rolls over. Each section includes only that repository's history and storage, never data belonging to another repository. Storage shows Borg's deduplicated stored bytes for currently configured repositories inspected in this window; uninspected repositories are excluded, not estimated, and the chart is not disk capacity or free space.

## Appearance

The default interface font is **JetBrains Mono, 14px**, with DejaVu Sans Mono as a local fallback. **Settings & help → Appearance** offers font family choices and a 12–20px text-size control, applied immediately and saved locally. Existing explicit preferences are preserved; Reset appearance restores JetBrains Mono/14px. No fonts are downloaded. The left navigation is a fixed narrow icon rail containing the logo/home button and only Repositories and Activity. Old saved sidebar width/collapse preferences are no longer applied. App branding/version live in the top bar; Borg availability/version replaces the idle slogan at the top right, next to icon-only Terminal and Settings & help buttons with accessible labels and native tooltips. Typography preferences remain supported without widening the rail.

## Integrity-check progress and passphrases

Starting an integrity check closes its confirmation immediately and opens Activity. The progress bar follows Borg's reported phase (repository segments, then archives); a phase percentage is not overall completion. Until Borg reports a percentage the bar is indeterminate, and only a successful result is shown as completed. Failures and warnings remain visible in the main window instead of trapping the result behind the confirmation dialog.

An encrypted repository can exist at the correct path and still reject Inspect or Check because its passphrase is missing or incorrect. Borg may check repository segments before it needs the key for encrypted archives. Choose **Unlock** or **Set session passphrase** to reveal an inline password form beneath that repository's controls, enter the repository passphrase, and submit **Set session passphrase**, then retry. Recovery links from Activity also open this inline form, never an unlock modal. Cancel, Escape, changing repositories, or leaving the page clears the unsent draft. Background redraws preserve typing and focus; failed submissions clear the password and show an inline error. An empty passphrase remains valid for unencrypted repositories. Drafts are never stored in browser storage. Setting a session passphrase does not verify it; successful inspection verifies access. On Linux, passphrases remain only in worker memory across desktop-window restarts, until Lock, worker restart, or reboot. On other platforms they are forgotten when the desktop app exits. Never paste a real passphrase into an operation report or support chat.

## Moved repositories

When Borg refuses access because a repository moved, borgd offers **Confirm repository relocation** with the previous and current locations. Verify both paths before choosing **Confirm and retry**. Cancel, Escape, or closing the dialog performs no retry.

Approval is a one-use, five-minute grant bound to the original operation and connection location. Changing configuration, starting another operation, or restarting the app invalidates it. Only the approved child process receives Borg's relocation confirmation; normal operations explicitly decline relocation rather than inheriting an ambient override. Other Borg safety checks remain enabled, and Windows forwards this per-process setting through WSL. After an approved operation, Borg may remember the new location normally. The successful retry's saved diagnostics record the approved paths, not its temporary authorization token.

Relocation approval does not repair a filesystem, resolve I/O errors, or prove repository integrity.

## Read-only repository errors

Borg normally writes a lock file even for commands such as `info` and archive listing. A session-unlocked passphrase does **not** make a read-only filesystem writable. borgd reports the actual storage/locking problem in the error summary and on the repository row, while keeping the traceback in the operation log and saved details.

On Linux, inspect mount options without modifying the drive:

```sh
findmnt -T /path/to/repository -o TARGET,SOURCE,FSTYPE,OPTIONS
```

If the filesystem is mounted `ro`, check the device and filesystem health before trying to mount it writable. I/O errors and a dirty NTFS volume require separate investigation; secure important data before repair, and use the appropriate filesystem tools (Windows `chkdsk` is commonly recommended for NTFS). borgd does not force-remount, repair filesystems, bypass locking, or delete lock files to hide this failure.

## Data and safety

Configuration and operation history live in Tauri's OS-specific application configuration directory under `com.borgd.desktop` (`~/.config/com.borgd.desktop` on typical Linux installations). Files are written using a temporary file and rename; on Unix they are created with mode `0600`. Configuration stores paths and policies, not passphrases. Passphrases remain in worker memory until locked or the worker exits (desktop process memory on platforms without the worker); this is not a secure OS keychain or a memory-zeroization guarantee. Source paths and filenames can appear in Borg logs.

New operation records save diagnostic snapshots under the configuration directory's `activity/` folder. Snapshot files are loaded only when copying an entry, not on every status poll. Each retains up to 128 KiB of log output and 128 KiB of standard output, with explicit truncation notices; snapshots follow the 200-entry history retention limit. Repository/profile context is captured at operation time, so later renaming or forgetting a connection does not change the copied diagnostic report. Older records without saved detailed output remain readable and copyable, but state that only metadata and the summary are available. No repository passphrase is included in snapshots.

The native clipboard permission allows **writing text only**, not reading clipboard contents. Copying is user-triggered. Browser tests mock the clipboard API; the native smoke test checks copy controls, real saved diagnostics, and denial of clipboard read access without inspecting or overwriting your clipboard.

A restore extracts the **whole archive**, recreating stored paths underneath an empty destination. Mounted archive browsing, repository key export, force-unlock, repair, compaction, archive deletion, operation cancellation, tray/background service scheduling, and automatic retention are not provided in this first version. The log ring keeps the latest 800 lines in memory; archive/file JSON is limited to 32 MiB and the inline archive browser indexes the complete returned listing, with expandable folder navigation and contents rendered in 200-item batches (Show more keeps every returned item reachable). Use Borg CLI for larger listings or advanced recovery.

After creating an encrypted repository, export its key to a safe, separate location:

```sh
borg key export /path/to/repository /safe/location/repository-key
```

Keep the key and passphrase safe, and periodically test restoration. Forgetting a connection or deleting a profile never deletes repository files. Pruning is destructive and always requires explicit confirmation; it does not compact the repository or reclaim all deleted space automatically.

## Structure

- `src/main.ts`: UI, dialogs, native bridge, and open-app scheduler.
- `src/model.ts`: UI models, escaping, formatting, scheduling/onboarding rules, and copied diagnostic reports.
- `src/activity.css`: fixed log layout, independent history scrolling, and copy controls.
- `src-tauri/src/activity.rs`: bounded diagnostic snapshots and actionable Borg error summaries.
- `src/terminal.ts`: persistent dock DOM, xterm instances, tab/input handling, and saved resizing.
- `src-tauri/src/terminal.rs`: bounded native PTY sessions and interactive shell lifecycle.
- `src-tauri/src/host.rs`: environment isolation for host tools launched from the AppImage.
- `src/style.css`: Pigeon-inspired visual language and responsive workspace.
- `src-tauri/src/engine.rs`: validated configuration, session secrets, bounded logs, command construction, and Borg integration tests.
- `src-tauri/src/lib.rs`: Tauri commands, native window lifecycle, and single-instance handling.

Licensed under the custom [borgd License](LICENSE): free use of the unmodified application; modifications and sale/resale require prior written developer approval. Earlier MIT-licensed revisions retain their original permissions. Third-party dependencies retain their own licenses. Not affiliated with the Borg or Vorta projects.

## Compact Controls, Zoom, And About

Action buttons default to icon-only with accessible labels and tooltips. Settings offers an **Icon-only action buttons** switch; turning it off restores icons with text. The preference persists locally and does not hide file/folder names or sortable column labels. Inspect guidance lives on its tooltip instead of a placeholder row. Each repository displays its own 30-day backup rhythm, recorded run/failure totals, and inspected stored bytes without opening Overview; unavailable storage is never estimated.

Ctrl+ / Ctrl- zooms the entire application from 50% to 200%, with Ctrl+0 resetting to 100%; Cmd shortcuts also work on macOS. Zoom is independent of saved font preferences and resets on launch. Clicking the top-bar branding opens an inline About page with version, developer attribution, the GitHub project link, and the complete license. The native project link opens only the fixed project URL in the default browser.

Repository lock controls appear first in each action row. Green/open-lock means a session passphrase is set; red/closed-lock means none is set. A matching icon appears beside the repository name, with accessible state text and a tooltip. This is session-unlock state, not Borg's filesystem lock or proof that a passphrase is correct; Inspect verifies actual access. Locking never force-unlocks a Borg lock or interrupts a running operation.
