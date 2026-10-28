export interface Repository {
  id: string;
  name: string;
  location: string;
}
export interface Profile {
  id: string;
  name: string;
  repositoryId: string;
  sources: string[];
  excludes: string[];
  keepDaily: number;
  keepWeekly: number;
  keepMonthly: number;
  intervalHours: number;
}
export interface Config {
  onboardingComplete?: boolean;
  repositories: Repository[];
  profiles: Profile[];
}
export interface History {
  id?: string | null;
  detailsAvailable?: boolean;
  repositoryName?: string | null;
  repositoryLocation?: string | null;
  profileName?: string | null;
  time: string;
  action: string;
  repositoryId: string;
  profileId: string | null;
  exitCode: number;
  message: string;
}
export interface ActivityDetails {
  entry: History;
  request: Record<string, unknown>;
  repository: Repository | null;
  profile: Profile | null;
  log: string;
  output: string;
  truncated: boolean;
  processExitCode?: number | null;
  relocationConfirmation?: { oldPath: string; newPath: string } | null;
}
export function activityDetailsText(
  entry: History,
  config: Config,
  details?: ActivityDetails,
): string {
  const saved = details?.entry ?? entry;
  const repository = details
    ? details.repository
    : config.repositories.find((r) => r.id === saved.repositoryId);
  const profile = details
    ? details.profile
    : config.profiles.find((p) => p.id === saved.profileId);
  return [
    "borgd operation details",
    `Operation ID: ${saved.id ?? "Legacy record"}`,
    `Time: ${saved.time}`,
    `Operation: ${saved.action}`,
    `Repository: ${saved.repositoryName ?? repository?.name ?? "Forgotten repository"}`,
    `Repository ID: ${saved.repositoryId}`,
    `Repository location: ${saved.repositoryLocation ?? repository?.location ?? "Not recorded"}`,
    `Profile: ${saved.profileName ?? profile?.name ?? saved.profileId ?? "Not applicable"}`,
    `Profile ID: ${saved.profileId ?? "Not applicable"}`,
    `Result: ${saved.exitCode === 0 ? "Completed" : saved.exitCode === 1 ? "Warning" : "Failed"}`,
    `Operation exit code: ${saved.exitCode}`,
    `Borg exit code: ${details && "processExitCode" in details ? (details.processExitCode ?? "Not available") : saved.exitCode}`,
    `Message: ${saved.message}`,
    ...(details
      ? [
          "",
          ...(details.relocationConfirmation
            ? [
                "Relocation explicitly approved for this retry:",
                JSON.stringify(details.relocationConfirmation, null, 2),
                "",
              ]
            : []),
          "Request:",
          JSON.stringify(details.request, null, 2),
          "",
          "Profile snapshot:",
          details.profile
            ? JSON.stringify(details.profile, null, 2)
            : "Not applicable",
          "",
          "Operation log:",
          details.log || "No log output.",
          "",
          "Borg standard output:",
          details.output || "No standard output.",
          ...(details.truncated
            ? [
                "",
                "Some diagnostic output was truncated to the per-operation storage limit.",
              ]
            : []),
        ]
      : [
          "",
          "Detailed output was not saved for this operation (an older app version or a storage error). Only recorded metadata and the summary are available.",
        ]),
  ].join("\n");
}
export interface Relocation {
  token: string;
  repositoryId: string;
  action: string;
  paths: { oldPath: string; newPath: string };
}
export interface Status {
  workerRunning?: boolean;
  workerOffline?: boolean;
  busy: boolean;
  action: string;
  logs: string[];
  history: History[];
  unlocked: string[];
  relocation?: Relocation | null;
}
export interface Archive {
  name: string;
  time: string;
  start?: string;
  stats?: { nfiles?: number; original_size?: number };
  id: string;
}
export interface Result {
  exitCode: number;
  data: any;
  text: string;
}
export const escape = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function bytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  if (value === 0) return "0 B";
  const unit = Math.min(
    4,
    Math.max(0, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))),
  );
  return `${(value / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
export function due(
  profile: Profile,
  history: History[],
  now = Date.now(),
): boolean {
  if (!profile.intervalHours) return false;
  const last = history.find(
    (h) => h.action === "backup" && h.profileId === profile.id,
  );
  return (
    !last || now - Date.parse(last.time) >= profile.intervalHours * 3600000
  );
}
export function isFreshInstallation(
  config: Config,
  history: History[],
): boolean {
  return (
    !config.onboardingComplete &&
    !config.repositories.length &&
    !config.profiles.length &&
    !history.length
  );
}
export function terminalHeight(stored: string | null): number {
  const value = stored === null || !stored.trim() ? NaN : Number(stored);
  return Number.isFinite(value)
    ? Math.max(120, Math.min(2000, Math.round(value)))
    : 280;
}
export function lines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
