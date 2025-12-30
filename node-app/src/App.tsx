import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { api, type Assignment, type Employee, type ShiftType } from "./api";
import { daysInMonth, defaultMonthStr, toDateStr, weekdayLabel } from "./dateUtils";
import * as XLSX from "xlsx";
import { getTaiwanHolidayPresetDates } from "./holidayPresetsTW";

type AssignKey = `${number}|${string}`; // employee_id|YYYY-MM-DD

function keyOf(employee_id: number, day: string): AssignKey {
  return `${employee_id}|${day}` as const;
}

export default function App() {
  const [month, setMonth] = useState<string>(() => defaultMonthStr());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [assignments, setAssignments] = useState<Map<AssignKey, Assignment>>(new Map());

  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeeMaxDays, setNewEmployeeMaxDays] = useState<number>(20);
  const [newEmployeeCanNight, setNewEmployeeCanNight] = useState<boolean>(true);
  const [newEmployeeNightOnly, setNewEmployeeNightOnly] = useState<boolean>(false);
  const [newEmployeeSpecial, setNewEmployeeSpecial] = useState<string>("");
  const [employeeEdits, setEmployeeEdits] = useState<
    Map<
      number,
      {
        max_work_days_per_month: number;
        max_consecutive_work_days: number;
        can_work_night: boolean;
        night_only: boolean;
        special_requirements: string;
        dirty: boolean;
      }
    >
  >(new Map());

  const [weekdayMorning, setWeekdayMorning] = useState<number>(1);
  const [weekdayEvening, setWeekdayEvening] = useState<number>(1);
  const [weekdayNight, setWeekdayNight] = useState<number>(1);

  const [holidayMorning, setHolidayMorning] = useState<number>(2);
  const [holidayEvening, setHolidayEvening] = useState<number>(2);
  const [holidayNight, setHolidayNight] = useState<number>(1);

  const [weekendAsHoliday, setWeekendAsHoliday] = useState<boolean>(true);
  const [holidayDatesText, setHolidayDatesText] = useState<string>("");
  const [estimateWorkDaysPerPerson, setEstimateWorkDaysPerPerson] = useState<number>(20);
  const [overwrite, setOverwrite] = useState<boolean>(false);
  const [trimOverstaffToOff, setTrimOverstaffToOff] = useState<boolean>(true);
  const [preferClusteredWork, setPreferClusteredWork] = useState<boolean>(true);
  const [preferSameShiftWithinBlock, setPreferSameShiftWithinBlock] = useState<boolean>(true);
  const [minRestDaysPer7, setMinRestDaysPer7] = useState<number>(2);
  const [maxConsecutiveWorkDays, setMaxConsecutiveWorkDays] = useState<number>(6);
  const [loading, setLoading] = useState(false);
  const [savingCell, setSavingCell] = useState<AssignKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const shiftById = useMemo(() => new Map(shiftTypes.map((s) => [s.id, s])), [shiftTypes]);
  const shiftOptions = useMemo(() => {
    // 把常用班別放前面
    const order = new Map<string, number>([
      ["早", 1],
      ["晚", 2],
      ["夜", 3],
      ["O", 4],
      ["L", 5],
    ]);
    return [...shiftTypes].sort((a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999));
  }, [shiftTypes]);

  async function reloadAll(targetMonth = month) {
    setLoading(true);
    setError(null);
    try {
      const [emps, shifts, assigns] = await Promise.all([
        api.listEmployees(),
        api.listShiftTypes(),
        api.listAssignments(targetMonth),
      ]);
      setEmployees(emps);
      // 重要：如果使用者正在編輯（dirty=true），reload 不要覆蓋尚未儲存的內容
      setEmployeeEdits((prev) => {
        const next = new Map<number, (typeof prev extends Map<number, infer V> ? V : never)>();
        for (const e of emps) {
          const existing = prev.get(e.id);
          if (existing?.dirty) {
            next.set(e.id, existing);
            continue;
          }
          next.set(e.id, {
            max_work_days_per_month: e.max_work_days_per_month ?? 0,
            max_consecutive_work_days: e.max_consecutive_work_days ?? 6,
            can_work_night: e.can_work_night ?? true,
            night_only: e.night_only ?? false,
            special_requirements: e.special_requirements ?? "",
            dirty: false,
          });
        }
        return next;
      });
      setShiftTypes(shifts);
      setAssignments(new Map(assigns.map((a) => [keyOf(a.employee_id, a.day), a])));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadAll().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reloadAll(month).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function createEmployee() {
    const name = newEmployeeName.trim();
    if (!name) return;
    setError(null);
    try {
      await api.createEmployee({
        name,
        max_work_days_per_month: Math.max(0, Number(newEmployeeMaxDays) || 0),
        max_consecutive_work_days: 6,
        can_work_night: newEmployeeNightOnly ? true : newEmployeeCanNight,
        night_only: newEmployeeNightOnly,
        special_requirements: newEmployeeSpecial.trim() || null,
      });
      setNewEmployeeName("");
      setNewEmployeeSpecial("");
      setNewEmployeeNightOnly(false);
      await reloadAll();
    } catch (e) {
      setError(String(e));
    }
  }

  async function toggleActive(emp: Employee, active: boolean) {
    setError(null);
    try {
      await api.patchEmployee(emp.id, { active });
      await reloadAll();
    } catch (e) {
      setError(String(e));
    }
  }

  async function setCell(employee_id: number, day: string, shift_type_id: number | null) {
    const k = keyOf(employee_id, day);
    setSavingCell(k);
    setError(null);
    try {
      await api.upsertAssignment(employee_id, day, shift_type_id);
      // 本地立即更新，避免重整整個月
      setAssignments((prev) => {
        const next = new Map(prev);
        if (shift_type_id == null) {
          next.delete(k);
          return next;
        }
        const st = shiftById.get(shift_type_id);
        if (!st) return next;
        next.set(k, {
          employee_id,
          day,
          shift_type_id,
          shift_code: st.code,
          shift_name: st.name,
          note: null,
        });
        return next;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingCell(null);
    }
  }

  async function autoGenerate() {
    setError(null);
    setWarnings([]);
    try {
      const holiday_dates = holidayDatesText
        .split(/[\s,]+/g)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.generate(month, {
        weekday_morning: Math.max(0, Number(weekdayMorning) || 0),
        weekday_evening: Math.max(0, Number(weekdayEvening) || 0),
        weekday_night: Math.max(0, Number(weekdayNight) || 0),
        holiday_morning: Math.max(0, Number(holidayMorning) || 0),
        holiday_evening: Math.max(0, Number(holidayEvening) || 0),
        holiday_night: Math.max(0, Number(holidayNight) || 0),
        weekend_as_holiday: weekendAsHoliday,
        holiday_dates,
        overwrite,
        trim_overstaff_to_off: trimOverstaffToOff,
        prefer_clustered_work: preferClusteredWork,
        prefer_same_shift_within_block: preferSameShiftWithinBlock,
        min_rest_days_per_7: Math.max(0, Math.min(7, Number(minRestDaysPer7) || 0)),
        max_consecutive_work_days: Math.max(0, Number(maxConsecutiveWorkDays) || 0),
      });
      setWarnings(res.warnings || []);
      await reloadAll(month);
    } catch (e) {
      setError(String(e));
    }
  }

  async function fillOff() {
    setError(null);
    setWarnings([]);
    try {
      const res = await api.fillOff(month, { active_only: true });
      setWarnings(res.warnings || []);
      await reloadAll(month);
    } catch (e) {
      setError(String(e));
    }
  }

  function loadTaiwanHolidays2026() {
    const preset = getTaiwanHolidayPresetDates(2026);
    const existing = holidayDatesText
      .split(/[\s,]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = new Set<string>([...existing, ...preset]);
    setWeekendAsHoliday(true);
    setHolidayDatesText([...merged].sort().join("\n"));
  }

  function exportExcel() {
    const days = daysInMonth(month);

    const holidayDates = new Set(
      holidayDatesText
        .split(/[\s,]+/g)
        .map((s) => s.trim())
        .filter(Boolean),
    );

    function isHoliday(dayStr: string): boolean {
      if (holidayDates.has(dayStr)) return true;
      if (!weekendAsHoliday) return false;
      const d = new Date(`${dayStr}T00:00:00`);
      return d.getDay() === 0 || d.getDay() === 6;
    }

    function fmtTime(t: string | null): string {
      if (!t) return "";
      return t.slice(0, 5);
    }

    // Sheet 1: 排班表（矩陣）
    const dateCols = Array.from({ length: days }, (_, i) => toDateStr(month, i + 1));
    const header1 = ["員工", ...dateCols];
    const header2 = ["", ...dateCols.map((d) => `${weekdayLabel(d)}${isHoliday(d) ? "（假）" : ""}`)];

    const matrixRows = employees.map((e) => {
      const cols: (string | number)[] = [e.name];
      for (const dayStr of dateCols) {
        const a = assignments.get(keyOf(e.id, dayStr));
        cols.push(a?.shift_code ?? "");
      }
      return cols;
    });

    const sheetMatrix = XLSX.utils.aoa_to_sheet([header1, header2, ...matrixRows]);

    // Sheet 2: 明細（逐筆）
    const shiftById = new Map(shiftTypes.map((s) => [s.id, s]));
    const empById = new Map(employees.map((e) => [e.id, e]));

    const details: Array<Record<string, string>> = [];
    for (const a of assignments.values()) {
      const emp = empById.get(a.employee_id);
      const st = shiftById.get(a.shift_type_id);
      if (!emp || !st) continue;
      const dayStr = a.day;
      details.push({
        日期: dayStr,
        星期: weekdayLabel(dayStr),
        是否假日: isHoliday(dayStr) ? "Y" : "N",
        員工: emp.name,
        班別代碼: a.shift_code,
        班別名稱: a.shift_name,
        起: fmtTime(st.start_time),
        迄: fmtTime(st.end_time),
        備註: a.note ?? "",
        員工特殊需求: emp.special_requirements ?? "",
      });
    }

    details.sort((x, y) => (x["日期"] + x["班別代碼"] + x["員工"]).localeCompare(y["日期"] + y["班別代碼"] + y["員工"]));

    const sheetDetails = XLSX.utils.json_to_sheet(details);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetMatrix, "排班表");
    XLSX.utils.book_append_sheet(wb, sheetDetails, "明細");

    XLSX.writeFile(wb, `schedule-${month}.xlsx`);
  }

  const days = daysInMonth(month);
  const activeEmployees = useMemo(() => employees.filter((e) => e.active).length, [employees]);

  const monthDemand = useMemo(() => {
    const holidayDates = new Set(
      holidayDatesText
        .split(/[\s,]+/g)
        .map((s) => s.trim())
        .filter(Boolean),
    );

    function isHoliday(dayStr: string): boolean {
      if (holidayDates.has(dayStr)) return true;
      if (!weekendAsHoliday) return false;
      const d = new Date(`${dayStr}T00:00:00`);
      return d.getDay() === 0 || d.getDay() === 6;
    }

    let weekdayCount = 0;
    let holidayCount = 0;
    let totalM = 0;
    let totalE = 0;
    let totalN = 0;

    for (let d = 1; d <= days; d += 1) {
      const dayStr = toDateStr(month, d);
      const h = isHoliday(dayStr);
      if (h) {
        holidayCount += 1;
        totalM += Math.max(0, holidayMorning);
        totalE += Math.max(0, holidayEvening);
        totalN += Math.max(0, holidayNight);
      } else {
        weekdayCount += 1;
        totalM += Math.max(0, weekdayMorning);
        totalE += Math.max(0, weekdayEvening);
        totalN += Math.max(0, weekdayNight);
      }
    }

    const totalWorkDays = totalM + totalE + totalN; // 以「每班=1工日」估算
    const perPerson = Math.max(1, Number(estimateWorkDaysPerPerson) || 20);
    const estimatedHeadcount = Math.ceil(totalWorkDays / perPerson);

    return { weekdayCount, holidayCount, totalM, totalE, totalN, totalWorkDays, perPerson, estimatedHeadcount };
  }, [
    days,
    estimateWorkDaysPerPerson,
    holidayDatesText,
    holidayEvening,
    holidayMorning,
    holidayNight,
    month,
    weekdayEvening,
    weekdayMorning,
    weekdayNight,
    weekendAsHoliday,
  ]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>飯店櫃台排班（MVP）</h1>
          <div style={{ color: "#555", marginTop: 4 }}>
            月份排班表：列=員工、欄=日期（可手動改班）；自動排班會遵守「可上班天數 / 夜班限制 / 連上限制 / 每 7 日至少休 N 日」
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>月份</span>
            <input value={month} onChange={(e) => setMonth(e.target.value)} type="month" />
          </label>
          <button onClick={() => reloadAll(month).catch(() => undefined)} type="button" disabled={loading}>
            重新載入
          </button>
          <button onClick={() => autoGenerate().catch(() => undefined)} type="button" disabled={loading}>
            自動排班（依規則）
          </button>
          <button onClick={() => fillOff().catch(() => undefined)} type="button" disabled={loading}>
            補滿休假（O）
          </button>
          <button onClick={exportExcel} type="button" disabled={loading}>
            匯出 Excel
          </button>
        </div>
      </div>

      {error ? (
        <pre style={{ background: "#fee", padding: 12, marginTop: 12, whiteSpace: "pre-wrap" }}>{error}</pre>
      ) : null}

      {warnings.length ? (
        <div style={{ background: "#fff7ed", border: "1px solid #fdba74", padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>自動排班提醒</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, marginTop: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>員工</h2>
            <span style={{ color: "#666" }}>{employees.length} 人</span>
          </div>

          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newEmployeeName}
                onChange={(e) => setNewEmployeeName(e.target.value)}
                placeholder="新增員工姓名"
                style={{ flex: 1 }}
              />
              <button onClick={() => createEmployee().catch(() => undefined)} type="button">
                新增
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                可上班天數（當月上限）
                <input
                  value={String(newEmployeeMaxDays)}
                  onChange={(e) => setNewEmployeeMaxDays(Number(e.target.value))}
                  type="number"
                  min={0}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#444" }}>
                <input
                  checked={newEmployeeCanNight}
                  onChange={(e) => setNewEmployeeCanNight(e.target.checked)}
                  type="checkbox"
                  disabled={newEmployeeNightOnly}
                />
                可排夜班（夜）
              </label>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#444" }}>
              <input
                checked={newEmployeeNightOnly}
                onChange={(e) => {
                  const v = e.target.checked;
                  setNewEmployeeNightOnly(v);
                  if (v) setNewEmployeeCanNight(true);
                }}
                type="checkbox"
              />
              只排夜班（不排早/晚）
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
              特殊需求（文字）
              <textarea
                value={newEmployeeSpecial}
                onChange={(e) => setNewEmployeeSpecial(e.target.value)}
                placeholder="例如：每週三固定不能上班、不可連上 6 天、只想排早班…（文字備註）"
                rows={2}
              />
            </label>
          </div>

          <div style={{ marginTop: 12, borderTop: "1px dashed #e5e7eb", paddingTop: 12 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>自動排班參數（可調）</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
              <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#374151", fontWeight: 800 }}>平日需求</div>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                早班（早）
                <input value={String(weekdayMorning)} onChange={(e) => setWeekdayMorning(Number(e.target.value))} type="number" min={0} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                晚班（晚）
                <input value={String(weekdayEvening)} onChange={(e) => setWeekdayEvening(Number(e.target.value))} type="number" min={0} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                夜班（夜）
                <input value={String(weekdayNight)} onChange={(e) => setWeekdayNight(Number(e.target.value))} type="number" min={0} />
              </label>

              <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#374151", fontWeight: 800, marginTop: 6 }}>假日需求</div>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                早班（早）
                <input value={String(holidayMorning)} onChange={(e) => setHolidayMorning(Number(e.target.value))} type="number" min={0} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                晚班（晚）
                <input value={String(holidayEvening)} onChange={(e) => setHolidayEvening(Number(e.target.value))} type="number" min={0} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                夜班（夜）
                <input value={String(holidayNight)} onChange={(e) => setHolidayNight(Number(e.target.value))} type="number" min={0} />
              </label>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#444" }}>
              <input checked={weekendAsHoliday} onChange={(e) => setWeekendAsHoliday(e.target.checked)} type="checkbox" />
              週末視為假日（六日）
            </label>
            <label style={{ display: "grid", gap: 4, marginTop: 8, fontSize: 12, color: "#444" }}>
              額外假日日期（YYYY-MM-DD，用空白/逗號/換行分隔）
              <textarea
                rows={2}
                value={holidayDatesText}
                onChange={(e) => setHolidayDatesText(e.target.value)}
                placeholder="例如：2026-01-01 2026-02-28"
              />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" onClick={loadTaiwanHolidays2026} disabled={loading}>
                載入 2026 國定假日（合併）
              </button>
              <button type="button" onClick={() => setHolidayDatesText("")} disabled={loading}>
                清空
              </button>
            </div>

            <div style={{ marginTop: 10, padding: 10, border: "1px solid #e5e7eb", borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: "#111827", fontWeight: 800 }}>當月人力需求估算（以每人工作 20 天估算）</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                  每人可工作（天）
                  <input
                    value={String(estimateWorkDaysPerPerson)}
                    onChange={(e) => setEstimateWorkDaysPerPerson(Number(e.target.value))}
                    type="number"
                    min={1}
                  />
                </label>
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6 }}>
                  <div>
                    平日 {monthDemand.weekdayCount} 天、假日 {monthDemand.holidayCount} 天
                  </div>
                  <div>
                    需求工日：{monthDemand.totalWorkDays}（早 {monthDemand.totalM} / 晚 {monthDemand.totalE} / 夜 {monthDemand.totalN}）
                  </div>
                  <div style={{ fontWeight: 800, color: activeEmployees < monthDemand.estimatedHeadcount ? "#b91c1c" : "#065f46" }}>
                    估算需要人力：{monthDemand.estimatedHeadcount} 人（目前啟用 {activeEmployees} 人）
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                每 7 日至少休（天）
                <input
                  value={String(minRestDaysPer7)}
                  onChange={(e) => setMinRestDaysPer7(Number(e.target.value))}
                  type="number"
                  min={0}
                  max={7}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                最多連上（天）
                <input
                  value={String(maxConsecutiveWorkDays)}
                  onChange={(e) => setMaxConsecutiveWorkDays(Number(e.target.value))}
                  type="number"
                  min={0}
                />
              </label>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#444" }}>
              <input checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} type="checkbox" />
              覆蓋該月現有排班（不勾：會保留你手動選的班/請假，再補齊缺口）
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#444" }}>
              <input checked={preferClusteredWork} onChange={(e) => setPreferClusteredWork(e.target.checked)} type="checkbox" />
              上班盡量集中（避免上一天休一天）
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#444" }}>
              <input
                checked={preferSameShiftWithinBlock}
                onChange={(e) => setPreferSameShiftWithinBlock(e.target.checked)}
                type="checkbox"
              />
              休假與休假之間盡量同班別（同一段連上盡量不換班）
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#444" }}>
              <input
                checked={trimOverstaffToOff}
                onChange={(e) => setTrimOverstaffToOff(e.target.checked)}
                type="checkbox"
                disabled={overwrite}
              />
              超過人力自動改排休假（O）（不覆蓋模式適用）
            </label>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {employees.map((e) => {
              const ed = employeeEdits.get(e.id);
              if (!ed) return null;
              return (
                <div
                  key={`edit-${e.id}`}
                  style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, opacity: e.active ? 1 : 0.55 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div
                        title={e.color ?? ""}
                        style={{ width: 10, height: 10, borderRadius: 999, background: e.color ?? "#999" }}
                      />
                      <div style={{ fontWeight: 800 }}>{e.name}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#444", fontSize: 12 }}>
                        <input checked={e.active} onChange={(ev) => toggleActive(e, ev.target.checked)} type="checkbox" />
                        啟用
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          // 先把 dirty 清掉，避免 reloadAll 又把舊的 dirty 值留著
                          setEmployeeEdits((prev) => {
                            const cur = prev.get(e.id);
                            if (!cur) return prev;
                            const next = new Map(prev);
                            next.set(e.id, { ...cur, dirty: false });
                            return next;
                          });
                          api
                            .patchEmployee(e.id, {
                              max_work_days_per_month: ed.max_work_days_per_month,
                              max_consecutive_work_days: ed.max_consecutive_work_days,
                            can_work_night: ed.night_only ? true : ed.can_work_night,
                            night_only: ed.night_only,
                              special_requirements: ed.special_requirements || null,
                            })
                            .then(() => reloadAll(month))
                            .catch((err) => setError(String(err)));
                        }}
                        disabled={loading}
                      >
                        {ed.dirty ? "儲存*" : "儲存"}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                      可上班天數（當月上限）
                      <input
                        type="number"
                        min={0}
                        value={String(ed.max_work_days_per_month)}
                        onChange={(ev) => {
                          const v = Number(ev.target.value);
                          setEmployeeEdits((prev) => {
                            const next = new Map(prev);
                            next.set(e.id, {
                              ...ed,
                              max_work_days_per_month: Number.isFinite(v) ? v : 0,
                              dirty: true,
                            });
                            return next;
                          });
                        }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#444" }}>
                      最多連上（天）
                      <input
                        type="number"
                        min={0}
                        value={String(ed.max_consecutive_work_days)}
                        onChange={(ev) => {
                          const v = Number(ev.target.value);
                          setEmployeeEdits((prev) => {
                            const next = new Map(prev);
                            next.set(e.id, {
                              ...ed,
                              max_consecutive_work_days: Number.isFinite(v) ? v : 0,
                              dirty: true,
                            });
                            return next;
                          });
                        }}
                      />
                    </label>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#444" }}>
                    <input
                      checked={ed.can_work_night}
                      onChange={(ev) => {
                        const v = ev.target.checked;
                        setEmployeeEdits((prev) => {
                          const next = new Map(prev);
                          next.set(e.id, { ...ed, can_work_night: v, dirty: true });
                          return next;
                        });
                      }}
                      type="checkbox"
                      disabled={ed.night_only}
                    />
                    可排夜班（夜）
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: "#444" }}>
                    <input
                      checked={ed.night_only}
                      onChange={(ev) => {
                        const v = ev.target.checked;
                        setEmployeeEdits((prev) => {
                          const next = new Map(prev);
                          next.set(e.id, {
                            ...ed,
                            night_only: v,
                            can_work_night: v ? true : ed.can_work_night,
                            dirty: true,
                          });
                          return next;
                        });
                      }}
                      type="checkbox"
                    />
                    只排夜班（不排早/晚）
                  </label>
                  <label style={{ display: "grid", gap: 4, marginTop: 8, fontSize: 12, color: "#444" }}>
                    特殊需求（文字）
                    <textarea
                      rows={2}
                      value={ed.special_requirements}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setEmployeeEdits((prev) => {
                          const next = new Map(prev);
                          next.set(e.id, { ...ed, special_requirements: v, dirty: true });
                          return next;
                        });
                      }}
                    />
                  </label>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, color: "#333" }}>班別代碼</div>
            <div>
              {shiftOptions.map((s) => (
                <span key={s.id} style={{ marginRight: 10 }}>
                  <b>{s.code}</b>={s.name}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 6 }}>
              小提示：夜班（夜）隔天不會自動排早班（早）；如你先把「請假（L）」或手動班別填好，再用「不覆蓋」自動排班，就能保留特殊需求。
            </div>
          </div>
        </div>

        <div style={{ overflow: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={thStyleSticky}>員工</th>
                {Array.from({ length: days }, (_, i) => {
                  const day = i + 1;
                  const dayStr = toDateStr(month, day);
                  return (
                    <th key={dayStr} style={thStyle}>
                      <div style={{ fontWeight: 700 }}>{day}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>({weekdayLabel(dayStr)})</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td style={tdStyleSticky}>
                    <div style={{ fontWeight: 700 }}>{e.name}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>{e.active ? "啟用" : "停用"}</div>
                  </td>
                  {Array.from({ length: days }, (_, i) => {
                    const day = i + 1;
                    const dayStr = toDateStr(month, day);
                    const k = keyOf(e.id, dayStr);
                    const a = assignments.get(k);
                    const isSaving = savingCell === k;
                    return (
                      <td key={k} style={tdStyle}>
                        <select
                          value={a?.shift_type_id ?? ""}
                          onChange={(ev) => {
                            const v = ev.target.value;
                            void setCell(e.id, dayStr, v ? Number(v) : null);
                          }}
                          disabled={loading || isSaving}
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                            background: isSaving ? "#eef2ff" : "white",
                          }}
                        >
                          <option value="">（空）</option>
                          {shiftOptions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.code}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const thStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  background: "#f6f8fa",
  borderBottom: "1px solid #ddd",
  padding: 8,
  textAlign: "center",
  whiteSpace: "nowrap",
  zIndex: 1,
};

const thStyleSticky: CSSProperties = {
  ...thStyle,
  left: 0,
  zIndex: 2,
  textAlign: "left",
  minWidth: 180,
};

const tdStyle: CSSProperties = {
  borderBottom: "1px solid #eee",
  padding: 6,
  textAlign: "center",
  minWidth: 46,
};

const tdStyleSticky: CSSProperties = {
  ...tdStyle,
  position: "sticky",
  left: 0,
  background: "white",
  zIndex: 1,
  textAlign: "left",
  minWidth: 180,
};


