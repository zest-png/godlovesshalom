export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function daysInMonth(yyyyMm: string): number {
  const [y, m] = yyyyMm.split("-").map((x) => Number(x));
  // JS month is 0-based; day 0 of next month = last day of target month
  return new Date(y, m, 0).getDate();
}

export function toDateStr(yyyyMm: string, day: number): string {
  return `${yyyyMm}-${pad2(day)}`;
}

export function weekdayLabel(yyyyMmDd: string): string {
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  const w = d.getDay(); // 0 Sun ... 6 Sat
  return ["日", "一", "二", "三", "四", "五", "六"][w]!;
}

export function defaultMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}


