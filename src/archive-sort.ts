import type { Archive } from "./model";
export type ArchiveColumn = "name" | "time" | "files" | "size";
export function sortArchives(
  archives: Archive[],
  column: ArchiveColumn,
  direction: "asc" | "desc",
) {
  const value = (archive: Archive): string | number | undefined => {
    if (column === "name") return archive.name;
    if (column === "time") {
      const time = Date.parse(archive.time || archive.start || "");
      return Number.isFinite(time) ? time : undefined;
    }
    const number =
      column === "files" ? archive.stats?.nfiles : archive.stats?.original_size;
    return typeof number === "number" && Number.isFinite(number) && number >= 0
      ? number
      : undefined;
  };
  return [...archives].sort((a, b) => {
    const av = value(a),
      bv = value(b);
    if (av === undefined)
      return bv === undefined ? a.name.localeCompare(b.name) : 1;
    if (bv === undefined) return -1;
    const order =
      typeof av === "string"
        ? av.localeCompare(String(bv), undefined, {
            numeric: true,
            sensitivity: "base",
          })
        : av - Number(bv);
    return (
      (direction === "asc" ? order : -order) || a.name.localeCompare(b.name)
    );
  });
}
