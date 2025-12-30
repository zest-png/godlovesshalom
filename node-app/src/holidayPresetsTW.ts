function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function* iterDateRange(startYmd: string, endYmd: string): Generator<string> {
  const start = new Date(`${startYmd}T00:00:00`);
  const end = new Date(`${endYmd}T00:00:00`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    yield toYmd(d);
  }
}

/**
 * 台灣「國定假日/連假(含補假)」預設清單
 *
 * 注意：此清單可能因政府公告或補班/補假調整而變動；仍建議由使用者在 UI 中確認/修正。
 */
export function getTaiwanHolidayPresetDates(year: number): string[] {
  if (year !== 2026) return [];

  const dates = new Set<string>();

  // 來源：依 2026（民國115年）行事曆常見公開資訊整理（可由 UI 再調整）
  // 元旦
  dates.add("2026-01-01");

  // 春節連假：2/14-2/22
  for (const d of iterDateRange("2026-02-14", "2026-02-22")) dates.add(d);

  // 228：2/27-3/1
  for (const d of iterDateRange("2026-02-27", "2026-03-01")) dates.add(d);

  // 兒童節+清明：4/3-4/6
  for (const d of iterDateRange("2026-04-03", "2026-04-06")) dates.add(d);

  // 勞動節：5/1-5/3
  for (const d of iterDateRange("2026-05-01", "2026-05-03")) dates.add(d);

  // 端午：6/19-6/21
  for (const d of iterDateRange("2026-06-19", "2026-06-21")) dates.add(d);

  // 中秋+教師節：9/25-9/28
  for (const d of iterDateRange("2026-09-25", "2026-09-28")) dates.add(d);

  // 國慶：10/9-10/11
  for (const d of iterDateRange("2026-10-09", "2026-10-11")) dates.add(d);

  // 光復：10/24-10/26
  for (const d of iterDateRange("2026-10-24", "2026-10-26")) dates.add(d);

  // 行憲：12/25-12/27
  for (const d of iterDateRange("2026-12-25", "2026-12-27")) dates.add(d);

  return [...dates].sort();
}


