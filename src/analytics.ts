import { bytes, escape as e, type History, type Repository } from "./model";
export interface Day {
  date: string;
  count: number;
  failed: number;
}
const key = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function backupAnalytics(history: History[], now = new Date()) {
  const days: Day[] = Array.from({ length: 84 }, (_, index) => ({
    date: key(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() - 83 + index),
    ),
    count: 0,
    failed: 0,
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  const outcomes = [0, 0, 0];
  for (const entry of history) {
    const timestamp = new Date(entry.time);
    if (
      entry.action !== "backup" ||
      !Number.isFinite(timestamp.getTime()) ||
      timestamp > now
    )
      continue;
    const outcome = entry.exitCode === 0 ? 0 : entry.exitCode === 1 ? 1 : 2;
    outcomes[outcome]++;
    const day = byDate.get(key(timestamp));
    if (day) {
      day.count++;
      if (outcome === 2) day.failed++;
    }
  }
  return { days, trend: days.slice(-30), outcomes };
}
export function inspectedStorage(
  repositories: Repository[],
  info: Record<string, any>,
) {
  return repositories.flatMap((repository) => {
    const size = info[repository.id]?.cache?.stats?.unique_csize;
    return typeof size === "number" && Number.isFinite(size) && size >= 0
      ? [{ name: repository.name, size }]
      : [];
  });
}
const colors = [
  "#94cabc",
  "#e7bd7d",
  "#e4979c",
  "#94b9df",
  "#b7c596",
  "#8fb9c0",
];
function donut(
  values: { name: string; value: number }[],
  label: string,
  empty: string,
  format = (n: number) => n.toLocaleString(),
) {
  const total = values.reduce((sum, value) => sum + value.value, 0);
  if (total === 0) return `<p class="chart-empty">${e(empty)}</p>`;
  let offset = 0;
  const circles = values
    .map((value, index) => {
      const angle = (value.value / total) * 360;
      const position = (radius: number, degrees: number) =>
        `${80 + radius * Math.cos(((degrees - 90) * Math.PI) / 180)} ${80 + radius * Math.sin(((degrees - 90) * Math.PI) / 180)}`;
      const color = colors[index % colors.length];
      const title = `<title>${e(value.name)}: ${e(format(value.value))}</title>`;
      const node =
        value.value === total
          ? `<circle cx="80" cy="80" r="58" fill="none" stroke="${color}" stroke-width="18">${title}</circle>`
          : value.value
            ? `<path fill="${color}" d="M${position(67, offset)} A67 67 0 ${angle > 180 ? 1 : 0} 1 ${position(67, offset + angle)} L${position(49, offset + angle)} A49 49 0 ${angle > 180 ? 1 : 0} 0 ${position(49, offset)} Z">${title}</path>`
            : "";
      offset += angle;
      return node;
    })
    .join("");
  return `<div class="donut-layout"><svg class="donut-chart" viewBox="0 0 160 160" role="img" aria-label="${e(label)}">${circles}<text x="80" y="78" text-anchor="middle" class="donut-value">${e(format(total))}</text><text x="80" y="98" text-anchor="middle" class="donut-label">TOTAL</text></svg><ul class="chart-legend">${values.map((value, index) => `<li><span class="legend-dot" style="background:${colors[index % colors.length]}"></span><span>${e(value.name)}</span><strong>${e(format(value.value))}</strong></li>`).join("")}</ul></div>`;
}
export function analyticsView(
  history: History[],
  repositories: Repository[],
  info: Record<string, any>,
  now = new Date(),
) {
  const data = backupAnalytics(history, now);
  const trendTotal = data.trend.reduce((sum, day) => sum + day.count, 0);
  const max = Math.max(1, ...data.trend.map((day) => day.count));
  const point = (day: Day, index: number) => [
    28 + (index * 672) / 29,
    148 - (day.count / max) * 116,
  ];
  const path = data.trend
    .map((day, index) => `${index ? "L" : "M"}${point(day, index).join(" ")}`)
    .join(" ");
  const storage = inspectedStorage(repositories, info);
  const graph = trendTotal
    ? `<div class="trend-plot"><span class="chart-axis-max">${max}</span><span class="chart-axis-zero">0</span><svg class="trend-chart" viewBox="0 0 728 184" preserveAspectRatio="none" role="img" aria-label="${trendTotal} recorded backup attempts in the last 30 local calendar days"><line x1="28" y1="32" x2="700" y2="32" class="chart-grid"/><line x1="28" y1="148" x2="700" y2="148" class="chart-grid"/><path d="${path} L700 148 L28 148 Z" fill="var(--chart-ok)" opacity=".07"/><path d="${path}" fill="none" stroke="var(--chart-ok)" stroke-width="2"/>${data.trend.map((day, index) => (day.count ? `<circle cx="${point(day, index)[0]}" cy="${point(day, index)[1]}" r="3" fill="${day.failed ? "var(--chart-fail)" : "var(--chart-ok)"}"><title>${day.date}: ${day.count} recorded attempts, ${day.failed} failed</title></circle>` : "")).join("")}</svg><div class="chart-axis-dates"><span>${data.trend[0].date}</span><span>${data.trend[29].date}</span></div></div>`
    : '<p class="chart-empty">No backup runs recorded in this period. Your first backup will start the graph.</p>';
  return `<section class="analytics" aria-label="Backup analytics"><div class="analytics-row"><figure class="trend-figure"><figcaption><h2>Backup rhythm</h2><span>Last 30 days &middot; recorded attempts</span></figcaption>${graph}</figure><figure><figcaption><h2>Recorded outcomes</h2><span>All retained backup attempts</span></figcaption>${donut(
    data.outcomes.map((value, index) => ({
      name: ["Completed", "Warnings", "Failed"][index],
      value,
    })),
    "Recorded backup outcomes; completed, warnings, and failed",
    "No backup outcomes recorded yet.",
  )}</figure></div><div class="analytics-row analytics-row-secondary"><figure class="heatmap-figure"><figcaption><h2>Activity calendar</h2><span>Last 84 local calendar days</span></figcaption><div class="heatmap-layout"><div class="heatmap" role="img" aria-label="Backup activity heatmap, last 84 days. A blank day means no retained record, not proof that no backup occurred.">${data.days.map((day) => `<span class="heat-cell ${day.failed ? "has-failure" : ""}" data-level="${Math.min(day.count, 4)}" title="${day.date}: ${day.count} recorded backup attempts, ${day.failed} failed"></span>`).join("")}</div><div class="heatmap-summary"><strong>${data.days.reduce((sum, day) => sum + day.count, 0)}</strong><span>recorded attempts</span><strong>${data.days.filter((day) => day.count > 0).length}</strong><span>days with records</span></div></div><div class="heatmap-caption"><span>${data.days[0].date} &ndash; ${data.days[83].date}</span><span>Fewer <i class="heat-cell" data-level="0"></i><i class="heat-cell" data-level="1"></i><i class="heat-cell" data-level="3"></i> More &middot; red = failure</span></div><details class="chart-data"><summary>View daily counts</summary><table><caption>Retained backup attempts by local calendar date</caption><thead><tr><th>Date</th><th>Attempts</th><th>Failed</th></tr></thead><tbody>${data.days
    .slice()
    .reverse()
    .map(
      (day) =>
        `<tr><td>${day.date}</td><td>${day.count}</td><td>${day.failed}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></details></figure><figure><figcaption><h2>Stored by repository</h2><span>${storage.length} of ${repositories.length} inspected this window</span></figcaption>${donut(
    storage.map((item) => ({ name: item.name, value: item.size })),
    "Stored bytes by inspected repository, not disk capacity",
    storage.length
      ? "Inspected repositories report 0 B stored."
      : "Inspect a repository to load real storage figures. No usage is estimated.",
    bytes,
  )}<p class="chart-note">Deduplicated stored bytes from Borg; uninspected repositories are excluded.</p><button class="text-button chart-inspect" data-route="repositories">Inspect repositories &rarr;</button></figure></div><p class="analytics-disclosure">Based on retained operation history (up to 200 operations), not complete backup coverage. Empty calendar days mean no retained record. No charts use sample data.</p></section>`;
}

export function repositoryRhythm(
  history: History[],
  stored?: number,
  now = new Date(),
) {
  const days = backupAnalytics(history, now).trend;
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const failed = days.reduce((sum, day) => sum + day.failed, 0);
  const max = Math.max(1, ...days.map((day) => day.count));
  const path = days
    .map(
      (day, index) =>
        `${index ? "L" : "M"}${4 + (index * 252) / 29} ${45 - (day.count * 36) / max}`,
    )
    .join(" ");
  return `<div class="repo-rhythm"><div class="mini-caption"><span>Backup rhythm &middot; 30 days</span><span>${total} runs &middot; ${failed} failed &middot; ${bytes(stored)} stored</span></div><svg viewBox="0 0 260 52" preserveAspectRatio="none" role="img" aria-label="${total} recorded backup attempts, ${failed} failed, last 30 local calendar days"><path d="M4 45 H256" stroke="var(--line)" fill="none"/><path d="${path}" fill="none" stroke="var(--chart-ok)" stroke-width="1.8" vector-effect="non-scaling-stroke"/></svg>${total ? "" : '<span class="mini-empty">No retained backup runs in this period</span>'}</div>`;
}
