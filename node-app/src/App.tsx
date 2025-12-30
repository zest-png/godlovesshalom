import { useEffect, useMemo, useState } from "react";
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
  const [employeeQuery, setEmployeeQuery] = useState<string>("");
  const [showInactiveEmployees, setShowInactiveEmployees] = useState<boolean>(false);

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

  const visibleEmployees = useMemo(() => {
    const q = employeeQuery.trim().toLowerCase();
    return employees.filter((e) => {
      if (!showInactiveEmployees && !e.active) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q);
    });
  }, [employees, employeeQuery, showInactiveEmployees]);

  const holidayDateSet = useMemo(() => {
    return new Set(
      holidayDatesText
        .split(/[\s,]+/g)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }, [holidayDatesText]);

  function isHoliday(dayStr: string): boolean {
    if (holidayDateSet.has(dayStr)) return true;
    if (!weekendAsHoliday) return false;
    const d = new Date(`${dayStr}T00:00:00`);
    return d.getDay() === 0 || d.getDay() === 6;
  }

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
    holidayEvening,
    holidayMorning,
    holidayNight,
    month,
    weekdayEvening,
    weekdayMorning,
    weekdayNight,
    weekendAsHoliday,
    holidayDateSet,
  ]);

  return (
    <div className="app">
      <div className="container">
        <div className="header">
          <div>
            <h1 className="title">飯店櫃台排班（MVP）</h1>
            <div className="subtitle">
              列=員工、欄=日期（可手動改班）；自動排班會遵守「可上班天數 / 夜班限制 / 連上限制 / 每 7 日至少休 N 日」
              {loading ? "（載入中…）" : ""}
            </div>
          </div>

          <div className="toolbar">
            <label className="inline">
              <span className="muted">月份</span>
              <input className="input" value={month} onChange={(e) => setMonth(e.target.value)} type="month" />
            </label>
            <button className="btn" onClick={() => reloadAll(month).catch(() => undefined)} type="button" disabled={loading}>
              重新載入
            </button>
            <button className="btn btnPrimary" onClick={() => autoGenerate().catch(() => undefined)} type="button" disabled={loading}>
              自動排班
            </button>
            <button className="btn btnGhost" onClick={() => fillOff().catch(() => undefined)} type="button" disabled={loading}>
              補滿休假（O）
            </button>
            <button className="btn" onClick={exportExcel} type="button" disabled={loading}>
              匯出 Excel
            </button>
          </div>
        </div>

        {error ? (
          <div className="alert alertError">
            <div style={{ fontWeight: 900, marginBottom: 6 }}>發生錯誤</div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{error}</pre>
          </div>
        ) : null}

        {warnings.length ? (
          <div className="alert alertWarn">
            <div style={{ fontWeight: 900, marginBottom: 6 }}>自動排班提醒</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="row">
          <div className="card">
            <div className="cardHeader">
              <h2 className="cardTitle">設定</h2>
              <span className="badge">
                {employees.length} 人（啟用 {activeEmployees}）
              </span>
            </div>
            <div className="cardBody">
              <div className="controlGroup">
                <div className="inlineWrap">
                  <input
                    className="input"
                    value={newEmployeeName}
                    onChange={(e) => setNewEmployeeName(e.target.value)}
                    placeholder="新增員工姓名"
                  />
                  <button className="btn btnPrimary" onClick={() => createEmployee().catch(() => undefined)} type="button">
                    新增
                  </button>
                </div>

                <div className="kpiGrid">
                  <div className="kpi">
                    <div className="kpiTitle">預估需要人力（本月）</div>
                    <div className="kpiValue">{monthDemand.estimatedHeadcount} 人</div>
                    <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 6 }}>
                      需求工日 {monthDemand.totalWorkDays}（早 {monthDemand.totalM} / 晚 {monthDemand.totalE} / 夜 {monthDemand.totalN}）
                    </div>
                  </div>
                  <div className="kpi">
                    <div className="kpiTitle">目前啟用人力</div>
                    <div className="kpiValue">{activeEmployees} 人</div>
                    <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 6 }}>
                      平日 {monthDemand.weekdayCount} 天、假日 {monthDemand.holidayCount} 天
                    </div>
                  </div>
                </div>

                <div className="divider" />

                <div className="inlineWrap">
                  <input
                    className="input"
                    value={employeeQuery}
                    onChange={(e) => setEmployeeQuery(e.target.value)}
                    placeholder="搜尋員工（姓名）"
                  />
                  <label className="inline muted" style={{ fontSize: 12 }}>
                    <input checked={showInactiveEmployees} onChange={(e) => setShowInactiveEmployees(e.target.checked)} type="checkbox" />
                    顯示停用
                  </label>
                </div>

                <details open className="employeeCard">
                  <summary className="employeeSummary">
                    <div style={{ fontWeight: 900 }}>自動排班參數</div>
                    <span className="badge">可調</span>
                  </summary>
                  <div style={{ marginTop: 10 }} className="controlGroup">
                    <div className="kpiGrid">
                      <label className="fieldLabel">
                        平日 早
                        <input className="input" value={String(weekdayMorning)} onChange={(e) => setWeekdayMorning(Number(e.target.value))} type="number" min={0} />
                      </label>
                      <label className="fieldLabel">
                        平日 晚
                        <input className="input" value={String(weekdayEvening)} onChange={(e) => setWeekdayEvening(Number(e.target.value))} type="number" min={0} />
                      </label>
                      <label className="fieldLabel">
                        平日 夜
                        <input className="input" value={String(weekdayNight)} onChange={(e) => setWeekdayNight(Number(e.target.value))} type="number" min={0} />
                      </label>
                      <label className="fieldLabel">
                        假日 早
                        <input className="input" value={String(holidayMorning)} onChange={(e) => setHolidayMorning(Number(e.target.value))} type="number" min={0} />
                      </label>
                      <label className="fieldLabel">
                        假日 晚
                        <input className="input" value={String(holidayEvening)} onChange={(e) => setHolidayEvening(Number(e.target.value))} type="number" min={0} />
                      </label>
                      <label className="fieldLabel">
                        假日 夜
                        <input className="input" value={String(holidayNight)} onChange={(e) => setHolidayNight(Number(e.target.value))} type="number" min={0} />
                      </label>
                    </div>

                    <div className="inlineWrap">
                      <label className="inline muted" style={{ fontSize: 12 }}>
                        <input checked={weekendAsHoliday} onChange={(e) => setWeekendAsHoliday(e.target.checked)} type="checkbox" />
                        週末視為假日（六日）
                      </label>
                      <label className="fieldLabel" style={{ minWidth: 180 }}>
                        每人可工作（天）
                        <input
                          className="input"
                          value={String(estimateWorkDaysPerPerson)}
                          onChange={(e) => setEstimateWorkDaysPerPerson(Number(e.target.value))}
                          type="number"
                          min={1}
                        />
                      </label>
                    </div>

                    <label className="fieldLabel">
                      額外假日日期（YYYY-MM-DD；空白/逗號/換行分隔）
                      <textarea
                        className="textarea"
                        rows={2}
                        value={holidayDatesText}
                        onChange={(e) => setHolidayDatesText(e.target.value)}
                        placeholder="例如：2026-01-01 2026-02-28"
                      />
                    </label>

                    <div className="inlineWrap">
                      <button className="btn" type="button" onClick={loadTaiwanHolidays2026} disabled={loading}>
                        載入 2026 國定假日（合併）
                      </button>
                      <button className="btn btnGhost" type="button" onClick={() => setHolidayDatesText("")} disabled={loading}>
                        清空
                      </button>
                    </div>

                    <div className="kpiGrid">
                      <label className="fieldLabel">
                        每 7 日至少休（天）
                        <input
                          className="input"
                          value={String(minRestDaysPer7)}
                          onChange={(e) => setMinRestDaysPer7(Number(e.target.value))}
                          type="number"
                          min={0}
                          max={7}
                        />
                      </label>
                      <label className="fieldLabel">
                        最多連上（天）
                        <input
                          className="input"
                          value={String(maxConsecutiveWorkDays)}
                          onChange={(e) => setMaxConsecutiveWorkDays(Number(e.target.value))}
                          type="number"
                          min={0}
                        />
                      </label>
                    </div>

                    <div className="inlineWrap">
                      <label className="inline muted" style={{ fontSize: 12 }}>
                        <input checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} type="checkbox" />
                        覆蓋該月現有排班
                      </label>
                      <label className="inline muted" style={{ fontSize: 12 }}>
                        <input checked={preferClusteredWork} onChange={(e) => setPreferClusteredWork(e.target.checked)} type="checkbox" />
                        上班盡量集中
                      </label>
                      <label className="inline muted" style={{ fontSize: 12 }}>
                        <input checked={preferSameShiftWithinBlock} onChange={(e) => setPreferSameShiftWithinBlock(e.target.checked)} type="checkbox" />
                        連上盡量同班別
                      </label>
                      <label className="inline muted" style={{ fontSize: 12 }}>
                        <input
                          checked={trimOverstaffToOff}
                          onChange={(e) => setTrimOverstaffToOff(e.target.checked)}
                          type="checkbox"
                          disabled={overwrite}
                        />
                        超過人力自動改排休假（O）
                      </label>
                    </div>
                  </div>
                </details>

                <details open className="employeeCard">
                  <summary className="employeeSummary">
                    <div style={{ fontWeight: 900 }}>員工設定</div>
                    <span className="badge">{visibleEmployees.length} 人</span>
                  </summary>
                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {visibleEmployees.map((e) => {
                      const ed = employeeEdits.get(e.id);
                      if (!ed) return null;
                      return (
                        <details key={`edit-${e.id}`} className="employeeCard">
                          <summary className="employeeSummary">
                            <div>
                              <div className="inline" style={{ gap: 8 }}>
                                <div
                                  title={e.color ?? ""}
                                  style={{ width: 10, height: 10, borderRadius: 999, background: e.color ?? "#94a3b8" }}
                                />
                                <span style={{ fontWeight: 900 }}>{e.name}</span>
                              </div>
                              <div className="employeeMeta">{e.active ? "啟用" : "停用"}</div>
                            </div>
                            <span className={`badge ${e.active ? "badgeGreen" : "badgeRed"}`}>{e.active ? "ON" : "OFF"}</span>
                          </summary>

                          <div style={{ marginTop: 10 }} className="controlGroup">
                            <div className="inlineWrap">
                              <label className="inline muted" style={{ fontSize: 12 }}>
                                <input checked={e.active} onChange={(ev) => toggleActive(e, ev.target.checked)} type="checkbox" />
                                啟用
                              </label>
                              <button
                                className={`btn ${ed.dirty ? "btnPrimary" : ""}`}
                                type="button"
                                disabled={!ed.dirty || loading}
                                onClick={() => {
                                  setError(null);
                                  setEmployeeEdits((prev) => {
                                    const cur = prev.get(e.id);
                                    if (!cur) return prev;
                                    const next = new Map(prev);
                                    next.set(e.id, { ...cur, dirty: false });
                                    return next;
                                  });
                                  api
                                    .patchEmployee(e.id, {
                                      max_work_days_per_month: Math.max(0, Number(ed.max_work_days_per_month) || 0),
                                      max_consecutive_work_days: Math.max(0, Number(ed.max_consecutive_work_days) || 0),
                                      can_work_night: ed.night_only ? true : ed.can_work_night,
                                      night_only: ed.night_only,
                                      special_requirements: ed.special_requirements.trim() || null,
                                    })
                                    .then(() => reloadAll(month))
                                    .catch((err) => setError(String(err)));
                                }}
                              >
                                儲存變更
                              </button>
                            </div>

                            <div className="kpiGrid">
                              <label className="fieldLabel">
                                可上班天數（當月上限）
                                <input
                                  className="input"
                                  type="number"
                                  min={0}
                                  value={String(ed.max_work_days_per_month)}
                                  onChange={(ev) => {
                                    const v = Number(ev.target.value);
                                    setEmployeeEdits((prev) => {
                                      const next = new Map(prev);
                                      next.set(e.id, { ...ed, max_work_days_per_month: Number.isFinite(v) ? v : 0, dirty: true });
                                      return next;
                                    });
                                  }}
                                />
                              </label>
                              <label className="fieldLabel">
                                最多連上（天）
                                <input
                                  className="input"
                                  type="number"
                                  min={0}
                                  value={String(ed.max_consecutive_work_days)}
                                  onChange={(ev) => {
                                    const v = Number(ev.target.value);
                                    setEmployeeEdits((prev) => {
                                      const next = new Map(prev);
                                      next.set(e.id, { ...ed, max_consecutive_work_days: Number.isFinite(v) ? v : 0, dirty: true });
                                      return next;
                                    });
                                  }}
                                />
                              </label>
                            </div>

                            <div className="inlineWrap">
                              <label className="inline muted" style={{ fontSize: 12 }}>
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
                              <label className="inline muted" style={{ fontSize: 12 }}>
                                <input
                                  checked={ed.night_only}
                                  onChange={(ev) => {
                                    const v = ev.target.checked;
                                    setEmployeeEdits((prev) => {
                                      const next = new Map(prev);
                                      next.set(e.id, { ...ed, night_only: v, can_work_night: v ? true : ed.can_work_night, dirty: true });
                                      return next;
                                    });
                                  }}
                                  type="checkbox"
                                />
                                只排夜班（不排早/晚）
                              </label>
                            </div>

                            <label className="fieldLabel">
                              特殊需求（文字）
                              <textarea
                                className="textarea"
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
                        </details>
                      );
                    })}
                  </div>
                </details>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>班別代碼</div>
                  <div className="inlineWrap">
                    {shiftOptions.map((s) => (
                      <span key={s.id} className="badge">
                        <b>{s.code}</b>
                        <span className="muted">=</span>
                        <span>{s.name}</span>
                      </span>
                    ))}
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
                    小提示：夜班（夜）隔天不會自動排早班（早）；如你先把「請假（L）」或手動班別填好，再用「不覆蓋」自動排班，就能保留特殊需求。
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="card tableCard">
            <div className="cardHeader">
              <h2 className="cardTitle">班表</h2>
              <span className="badge">
                顯示 {visibleEmployees.length} 人 × {days} 天
              </span>
            </div>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="th thSticky">員工</th>
                    {Array.from({ length: days }, (_, i) => {
                      const day = i + 1;
                      const dayStr = toDateStr(month, day);
                      const h = isHoliday(dayStr);
                      return (
                        <th key={dayStr} className={`th ${h ? "isHoliday" : ""}`}>
                          <div style={{ fontWeight: 900 }}>{day}</div>
                          <div style={{ fontSize: 12, color: h ? "#7c2d12" : "#64748b" }}>({weekdayLabel(dayStr)})</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visibleEmployees.map((e) => (
                    <tr key={e.id} className="tr">
                      <td className="td tdSticky">
                        <div className="employeeName">{e.name}</div>
                        <div className="employeeMeta">{e.active ? "啟用" : "停用"}</div>
                      </td>
                      {Array.from({ length: days }, (_, i) => {
                        const day = i + 1;
                        const dayStr = toDateStr(month, day);
                        const k = keyOf(e.id, dayStr);
                        const a = assignments.get(k);
                        const saving = savingCell === k;
                        const h = isHoliday(dayStr);
                        return (
                          <td key={k} className={`td ${h ? "isHoliday" : ""}`}>
                            <select
                              value={a?.shift_type_id ?? ""}
                              onChange={(ev) => {
                                const v = ev.target.value;
                                void setCell(e.id, dayStr, v ? Number(v) : null);
                              }}
                              disabled={loading || saving}
                              className={`cellSelect ${saving ? "cellSelectSaving" : ""}`}
                              aria-label={`${e.name} ${dayStr} 班別`}
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
      </div>
    </div>
  );
}
