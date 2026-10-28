import { escape as e } from "./model";
interface Topic {
  id: string;
  title: string;
  description: string;
  steps: string[];
  example: string;
  note: string;
}
export const helpTopics: Topic[] = [
  {
    id: "start",
    title: "Getting started",
    description:
      "borgd is a desktop companion for Borg Backup 1.x. Repositories hold saved snapshots; profiles define what to back up and when.",
    steps: [
      "Open Settings and check the Borg engine version. If Borg is missing, follow the setup guide for your platform.",
      "Add a repository in Repositories, then Inspect it to verify access.",
      "Create a backup profile for that repository and choose your source folders.",
      "Run Back up. Check Activity for the result, then open Archives to browse the saved files.",
      "Try restoring one file into a new, empty folder before relying on your backup.",
    ],
    example:
      "Repository: /mnt/backup/documents\nProfile: Documents\nSource: /home/alex/Documents\nInterval: 0 (manual)",
    note: "The browser preview cannot run real backups. Borg 2 repositories are not supported.",
  },
  {
    id: "repositories",
    title: "Repositories",
    description:
      "A repository is the destination where Borg stores deduplicated archives. Adding a connection does not create or overwrite a repository.",
    steps: [
      "Click Add repository and enter a descriptive name and an absolute local path or SSH repository location.",
      "For an existing repository, unlock it if encrypted and choose Inspect.",
      "For a new repository only, choose Initialize and follow the encryption confirmation. Keep the passphrase safe.",
      "Use Overview, Profiles, or Archives in that repository's header to open its scoped panel.",
      "Forget removes only the saved connection, not the repository or its archives.",
    ],
    example:
      "Local: /mnt/backup/borg/documents\nSSH: ssh://alex@backup.example:22/./borg/documents\nWindows / WSL source: /mnt/c/Users/Alex/Documents",
    note: "For SSH, connect in your terminal first to verify the host key and configure key-based authentication. Never initialize an existing backup repository.",
  },
  {
    id: "profiles",
    title: "Backup profiles",
    description:
      "Profiles connect a source list, exclusions, retention settings, and an optional schedule to one repository.",
    steps: [
      "Use Add profile in the repository's Quick profiles panel, or open Profiles and add one there.",
      "Enter a name and select the destination repository.",
      "Add one absolute source folder per line, or use the source picker.",
      "Optionally add exclusions, one Borg pattern per line.",
      "Set Daily, Weekly, and Monthly retention counts, and the backup interval in hours. Zero means manual backups.",
      "Save the profile. Use its Back up action to create a snapshot; check Activity before closing a standalone session.",
    ],
    example:
      "Sources:\n/home/alex/Documents\n/home/alex/Pictures\n\nExcludes:\nsh:**/node_modules\nsh:**/.cache\n\nInterval: 24 hours",
    note: "Editing a profile does not change existing archives. Retention settings do not automatically prune anything.",
  },
  {
    id: "worker",
    title: "Background schedules",
    description:
      "The background worker owns backup operations and can keep working after the desktop window closes.",
    steps: [
      "Open Settings → Background backups and review the detected startup mechanism.",
      "Register startup if you want the worker to start at user login, then Start it.",
      "Unlock encrypted repositories again after every worker restart; passphrases are kept only in memory.",
      "Edit a profile and set a nonzero interval, then save it.",
      "Check Activity for completed jobs. Missed intervals run once when the worker resumes.",
      "To stop safely, choose Stop and confirm. Accepted work finishes first; stopping clears in-memory passphrases.",
    ],
    example:
      "Interval 0: manual only\nInterval 6: approximately every six hours\nInterval 24: daily while the worker is available",
    note: "Powered-off or suspended computers cannot run backups. Startup registration is not a promise of boot-time operation; Linux logout/boot operation needs separately configured lingering. Standalone mode requires keeping borgd open.",
  },
  {
    id: "archives",
    title: "Browse archives",
    description:
      "Archives are saved snapshots. Browsing is read-only and does not extract or modify files.",
    steps: [
      "Open Archives in the correct repository's header. The archive list loads automatically.",
      "Filter by name or use a column heading to change the sort order. Created times use your local time zone.",
      "Right-click an archive and choose Browse, or use its Browse button.",
      "Expand folders in the tree, follow breadcrumbs, or search all indexed paths.",
      "Select files or folders with their checkboxes. Use Restore selected when ready.",
    ],
    example:
      "Archive: borgd-a1B2c3-2026-10-28T10-30-00.000\nSearch: Documents/report.pdf",
    note: "Lock icons indicate whether a session passphrase is held, not a filesystem lock or a guarantee of access. Unavailable archive statistics are not zero.",
  },
  {
    id: "diff",
    title: "Compare snapshots",
    description:
      "View diff compares two archives in the same repository at file and metadata level, without extracting them.",
    steps: [
      "Right-click an archive and choose View diff. At least two archives are required.",
      "Review the comparison archive. The nearest older snapshot is selected when available; choose another if needed.",
      "Read changes in the direction comparison archive → selected archive. Use Show more for large result sets.",
      "Right-click a changed path and choose Go to to open the matching archive browser with that item selected.",
      "For removed paths, Go to prefers the comparison snapshot. If a path is absent there, the other snapshot is checked.",
      "Choose Restore selected only if you want to extract that item, then complete the normal restore confirmation.",
    ],
    example:
      "Comparison: Monday snapshot\nSelected: Tuesday snapshot\nadded: new on Tuesday\nremoved: present on Monday, absent on Tuesday\nmodified: file contents or metadata changed",
    note: "This is not a line-by-line text patch. Go to never restores automatically. If the worker is too old, follow its update notice in Settings and unlock repositories after restarting it.",
  },
  {
    id: "restore",
    title: "Restore files",
    description:
      "Restore extracts selected files or a whole archive into a destination you explicitly choose.",
    steps: [
      "For a whole snapshot, right-click an archive and choose Restore.",
      "For individual paths, Browse the archive, select the needed items, and choose Restore selected or the file context-menu restore action.",
      "Choose a new or empty destination directory outside the repository and your live source folders.",
      "Review the selected archive, paths, and destination, then confirm.",
      "Check Activity for completion and inspect the extracted files before copying them into your working folders.",
    ],
    example:
      "Destination: /home/alex/restore-review\nSelected path: home/alex/Documents/report.pdf\nExtracted file: /home/alex/restore-review/home/alex/Documents/report.pdf",
    note: "Restores preserve archive-relative directory structure. borgd requires an empty destination to avoid overwriting existing files. No automatic extraction happens when browsing or using Go to.",
  },
  {
    id: "retention",
    title: "Retention",
    description:
      "Retention keeps selected daily, weekly, and monthly snapshots for one profile. Applying retention permanently removes archives outside that policy.",
    steps: [
      "Edit the profile and set its Daily, Weekly, and Monthly counts, then save.",
      "Use Preview retention in Quick profiles, or Preview prune in the profile editor.",
      "Review the preview in Activity. Verify the repository, profile, and archives that would be removed.",
      "Only after reviewing, use Apply retention in the profile editor and explicitly confirm.",
      "Keep a recent verified backup and a separate repository key backup before deleting any snapshots.",
    ],
    example:
      "Daily: 7\nWeekly: 4\nMonthly: 6\n\nPreview first; counts are Borg retention buckets, not a guarantee of an exact total archive count.",
    note: "Other profiles' archives must not be pruned. borgd refuses ambiguous archive ownership. No automatic pruning or archive deletion is performed.",
  },
  {
    id: "security",
    title: "Encryption & checks",
    description:
      "Passphrases unlock encrypted repositories for the current worker session. Integrity checks verify a repository without repairing it.",
    steps: [
      "Use the repository's unlock control and enter its passphrase. Inspect verifies access and loads repository details.",
      "Export the repository key separately using Borg's key export command and store it securely away from the repository.",
      "Choose Check in the repository header, review the confirmation, and watch progress in Activity.",
      "Use Lock to clear that repository's in-memory passphrase when finished.",
      "After a worker restart or reboot, unlock encrypted repositories again.",
    ],
    example:
      "borg key export /mnt/backup/borg/documents /safe/location/documents.key",
    note: "Passphrases are not saved to settings. Losing the key or passphrase can make backups unrecoverable. Do not force-unlock, repair, or modify a damaged repository without understanding the cause.",
  },
  {
    id: "themes",
    title: "Themes & controls",
    description:
      "Theme Studio changes this device's interface appearance without touching backup configuration.",
    steps: [
      "Click the palette icon beside Borg status to open Theme Studio.",
      "Choose Dark or Light, then select one of the eight theme previews.",
      "Choose Custom to edit the current mode's colors, font, size, corner radius, and spacing.",
      "Use Export theme JSON to save appearance preferences, or Import theme JSON to load a file into Custom.",
      "In Settings, toggle icon-only action buttons if you prefer text labels. Hover an icon for its tooltip.",
      "Use Ctrl/Cmd plus or minus to zoom and Ctrl/Cmd+0 to reset.",
    ],
    example:
      "Light → Ocean: pale blue workspace\nDark → Midnight: original charcoal workspace\nCustom: independent dark and light color palettes",
    note: "Theme files contain appearance preferences only, never repository configuration or secrets. Only validated JSON up to 128 KiB is accepted. Fonts are shared with Appearance.",
  },
  {
    id: "activity",
    title: "Activity & errors",
    description:
      "Activity shows progress, logs, and recent results. Overview charts use actual retained backup history and inspected storage data.",
    steps: [
      "Open Activity while a job is running to follow its output and progress.",
      "Review the result: success, warning, or failure. A warning needs attention even when some data was backed up.",
      "Use the copy controls to copy the operation log or detailed context for troubleshooting.",
      "For a moved repository, review the relocation prompt and approve only the correct new location.",
      "For read-only or disconnected disks, inspect the mount and access outside borgd before retrying. Avoid destructive repairs or force-unlocks.",
    ],
    example:
      "Missing source: check the profile's source paths.\nPermission denied: verify filesystem or SSH access.\nRead-only repository: check the drive and mount state.\nWorker stopped: Start it in Settings, then unlock again.",
    note: "History is bounded to the last 200 operations, so charts are not a lifetime audit. Logs may contain personal paths: review copied diagnostics before sharing them.",
  },
  {
    id: "terminal",
    title: "Integrated terminal",
    description:
      "The terminal is a real interactive shell running as your user, not a simulated command preview.",
    steps: [
      "Click the terminal icon in the toolbar to show the dock.",
      "Use the plus action to create another terminal tab if needed.",
      "Run read-only diagnostic commands first and review output carefully.",
      "Resize the dock with its separator; hide it with the toolbar toggle.",
      "Close a tab when finished. Closing a tab or borgd stops that tab's shell.",
    ],
    example: "borg --version\nborg info /mnt/backup/borg/documents",
    note: "Terminal commands are not made safe by borgd. Avoid concurrent operations on a busy repository, destructive commands, and putting passphrases into shell history.",
  },
];
let topicId = "start";
export function selectHelpTopic(id: string) {
  if (helpTopics.some((topic) => topic.id === id)) topicId = id;
}
export function helpView() {
  const topic =
    helpTopics.find((topic) => topic.id === topicId) ?? helpTopics[0];
  return `<div class="help-workspace"><nav class="help-bookmarks" aria-label="Help topics">${helpTopics.map((item) => `<button type="button" data-action="help-topic" data-topic="${item.id}" ${topic.id === item.id ? 'aria-current="true"' : ""}>${e(item.title)}</button>`).join("")}</nav><article class="help-detail" tabindex="0" aria-labelledby="help-topic-title"><h4 id="help-topic-title">${e(topic.title)}</h4><p>${e(topic.description)}</p><h5>Step by step</h5><ol>${topic.steps.map((step) => `<li>${e(step)}</li>`).join("")}</ol><h5>Example</h5><pre class="help-example">${e(topic.example)}</pre><p class="help-note"><strong>Keep in mind</strong><br>${e(topic.note)}</p></article></div>`;
}
