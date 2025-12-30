from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable

from sqlmodel import Session, select

from app.models import Assignment, Employee, ShiftType


MORNING_CODE = "早"
EVENING_CODE = "晚"
NIGHT_CODE = "夜"
OFF_CODE = "O"
WORK_CODES: tuple[str, ...] = (MORNING_CODE, EVENING_CODE, NIGHT_CODE)


def month_range(month: str) -> tuple[date, date]:
    # month: "YYYY-MM"
    y, m = month.split("-")
    start = date(int(y), int(m), 1)
    if start.month == 12:
        end = date(start.year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(start.year, start.month + 1, 1) - timedelta(days=1)
    return start, end


@dataclass
class GenerateParams:
    # 平日需求
    weekday_morning: int = 1
    weekday_evening: int = 1
    weekday_night: int = 1
    # 假日需求（週末/國定假日/特休等）
    holiday_morning: int = 2
    holiday_evening: int = 2
    holiday_night: int = 1

    weekend_as_holiday: bool = True
    holiday_dates: frozenset[date] = frozenset()

    overwrite: bool = True
    trim_overstaff_to_off: bool = True
    # 排班偏好：上班盡量集中（避免上一天休一天）
    prefer_clustered_work: bool = True
    # 排班偏好：同一段連續上班（休假與休假之間）盡量維持同班別
    prefer_same_shift_within_block: bool = True
    max_consecutive_work_days: int = 6
    # 勞基法常見底線（可調參數）：每 7 日至少休 N 日（例假+休息日）
    min_rest_days_per_7: int = 2


@dataclass
class GenerateResult:
    created: int
    deleted: int
    warnings: list[str]


def _get_shift_by_code(session: Session) -> dict[str, ShiftType]:
    shifts = session.exec(select(ShiftType)).all()
    return {s.code: s for s in shifts}


def _iter_days(start: date, end: date) -> Iterable[date]:
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def generate_month_schedule(session: Session, month: str, params: GenerateParams) -> GenerateResult:
    start, end = month_range(month)
    warnings: list[str] = []

    employees = session.exec(select(Employee).where(Employee.active == True).order_by(Employee.id)).all()  # noqa: E712
    if not employees:
        return GenerateResult(created=0, deleted=0, warnings=["目前沒有任何啟用中的員工，無法自動排班。"])
    active_employee_ids = {e.id for e in employees if e.id is not None}

    shifts_by_code = _get_shift_by_code(session)
    missing = [c for c in [*WORK_CODES, OFF_CODE] if c not in shifts_by_code]
    if missing:
        return GenerateResult(created=0, deleted=0, warnings=[f"缺少班別代碼：{', '.join(missing)}（請先建立班別）"])
    shift_id_to_code = {s.id: s.code for s in shifts_by_code.values() if s.id is not None}
    off_shift_id = shifts_by_code[OFF_CODE].id  # type: ignore[assignment]

    def is_holiday(d: date) -> bool:
        if d in params.holiday_dates:
            return True
        if params.weekend_as_holiday and d.weekday() >= 5:  # 5=Sat,6=Sun
            return True
        return False

    def required_for_day(d: date) -> dict[str, int]:
        if is_holiday(d):
            req = {
                MORNING_CODE: max(0, params.holiday_morning),
                EVENING_CODE: max(0, params.holiday_evening),
                NIGHT_CODE: max(0, params.holiday_night),
            }
        else:
            req = {
                MORNING_CODE: max(0, params.weekday_morning),
                EVENING_CODE: max(0, params.weekday_evening),
                NIGHT_CODE: max(0, params.weekday_night),
            }
        return req

    # 既有排班
    existing = session.exec(
        select(Assignment).where(Assignment.day >= start, Assignment.day <= end)
    ).all()

    deleted = 0
    if params.overwrite and existing:
        for a in existing:
            session.delete(a)
            deleted += 1
        session.commit()
        existing = []

    # 方便查詢：day -> employee_id -> shift_code（不覆蓋時把既有排班當作固定排班）
    fixed_by_day: dict[date, dict[int, str]] = {}
    fixed_assignment_by_day: dict[date, dict[int, Assignment]] = {}
    if not params.overwrite:
        # 保留既有指派（不覆蓋）
        for a in existing:
            # 只處理「啟用員工」的既有排班，避免停用員工造成 KeyError
            if a.employee_id not in active_employee_ids:
                continue
            code = shift_id_to_code.get(a.shift_type_id)
            if not code:
                continue
            fixed_by_day.setdefault(a.day, {})[a.employee_id] = code
            fixed_assignment_by_day.setdefault(a.day, {})[a.employee_id] = a

    # 狀態追蹤
    emp_by_id = {e.id: e for e in employees if e.id is not None}
    last_shift: dict[int, tuple[date | None, str | None]] = {e.id: (None, None) for e in employees if e.id is not None}
    consecutive_work: dict[int, int] = {e.id: 0 for e in employees if e.id is not None}
    total_work: dict[int, int] = {e.id: 0 for e in employees if e.id is not None}
    per_shift_count: dict[int, dict[str, int]] = {
        e.id: {MORNING_CODE: 0, EVENING_CODE: 0, NIGHT_CODE: 0} for e in employees if e.id is not None
    }
    last6_work_flags: dict[int, list[bool]] = {e.id: [] for e in employees if e.id is not None}
    holiday_work: dict[int, int] = {e.id: 0 for e in employees if e.id is not None}
    # 追蹤「同一段連續上班」的班別（休假/請假等非工作班會重置）
    block_shift: dict[int, str | None] = {e.id: None for e in employees if e.id is not None}

    max_work_in_7 = max(0, min(7, 7 - max(0, min(7, params.min_rest_days_per_7))))

    def is_work_code(code: str | None) -> bool:
        if not code:
            return False
        st = shifts_by_code.get(code)
        if st is None:
            return code in WORK_CODES
        return bool(st.is_work)

    def worked_yesterday(emp_id: int, day: date) -> bool:
        prev_day, prev_code = last_shift.get(emp_id, (None, None))
        return prev_day == day - timedelta(days=1) and is_work_code(prev_code)

    def yesterday_work_shift_code(emp_id: int, day: date) -> str | None:
        prev_day, prev_code = last_shift.get(emp_id, (None, None))
        if prev_day != day - timedelta(days=1):
            return None
        if prev_code in WORK_CODES:
            return prev_code
        return None

    def block_shift_code(emp_id: int) -> str | None:
        return block_shift.get(emp_id)

    def block_ok(emp_id: int, target_code: str) -> bool:
        bs = block_shift_code(emp_id)
        return (bs is None) or (bs == target_code)

    def mark_assigned(emp_id: int, day: date, code: str) -> None:
        # 更新 last_shift / consecutive / block_shift
        last_shift[emp_id] = (day, code)
        if is_work_code(code):
            consecutive_work[emp_id] = consecutive_work.get(emp_id, 0) + 1
            total_work[emp_id] = total_work.get(emp_id, 0) + 1
            if is_holiday(day):
                holiday_work[emp_id] = holiday_work.get(emp_id, 0) + 1
            # 若昨天不是工作日，代表新的一段連上開始 -> 設定 block_shift
            if not worked_yesterday(emp_id, day):
                block_shift[emp_id] = code if code in WORK_CODES else None
            else:
                # 仍在同一段連上：若 block_shift 尚未設定，補上；否則維持
                if block_shift.get(emp_id) is None and code in WORK_CODES:
                    block_shift[emp_id] = code
        else:
            consecutive_work[emp_id] = 0
            block_shift[emp_id] = None

    def can_take(emp_id: int, day: date, code: str, assigned_today: set[int]) -> bool:
        if emp_id in assigned_today:
            return False
        # 若保留既有排班，該員工當天已有班就不可再排
        if day in fixed_by_day and emp_id in fixed_by_day[day]:
            return False
        emp = emp_by_id.get(emp_id)
        if emp is None:
            return False
        # 個人限制：只排夜班（不排早/晚）
        if bool(getattr(emp, "night_only", False)) and code in (MORNING_CODE, EVENING_CODE):
            return False
        # 個人限制：不可排夜班
        if code == NIGHT_CODE and not bool(emp.can_work_night):
            return False
        prev_day, prev_code = last_shift.get(emp_id, (None, None))
        if prev_day == day - timedelta(days=1) and prev_code == NIGHT_CODE and code == MORNING_CODE:
            return False
        # 連上限制（個人優先；若個人設定 0 則使用系統預設）
        emp_max_consec = int(getattr(emp, "max_consecutive_work_days", 0) or 0)
        cap_consec = emp_max_consec if emp_max_consec > 0 else params.max_consecutive_work_days
        if consecutive_work.get(emp_id, 0) >= cap_consec:
            return False
        # 當月最多上班天數（0 不限制）
        emp_max_days = int(getattr(emp, "max_work_days_per_month", 0) or 0)
        if emp_max_days > 0 and total_work.get(emp_id, 0) >= emp_max_days:
            return False
        # 每 7 日至少休 N 日 -> 任意 7 日內工作天數不得超過 max_work_in_7
        hist = last6_work_flags.get(emp_id, [])
        if max_work_in_7 < 7 and (sum(1 for x in hist if x) + 1) > max_work_in_7:
            return False
        return True

    created = 0

    for day in _iter_days(start, end):
        assigned_today: set[int] = set()
        today_code: dict[int, str] = {}

        required = required_for_day(day)
        total_needed = sum(required.get(c, 0) for c in WORK_CODES)
        if total_needed > len(employees):
            tag = "假日" if is_holiday(day) else "平日"
            warnings.append(
                f"{day.isoformat()}（{tag}）每日需求人數（{total_needed}）大於員工數（{len(employees)}），可能排不滿。"
            )

        # 把固定排班先算入狀態（不覆蓋模式）
        fixed = fixed_by_day.get(day, {})
        fixed_assignments = fixed_assignment_by_day.get(day, {})

        # 若固定排班超過需求：把多出來的人改排休假（O）
        if (not params.overwrite) and params.trim_overstaff_to_off and fixed and off_shift_id is not None:
            for code in WORK_CODES:
                assigned_emp_ids = [emp_id for emp_id, c in fixed.items() if c == code]
                surplus = len(assigned_emp_ids) - required.get(code, 0)
                if surplus <= 0:
                    continue

                def pick_score(emp_id: int) -> tuple[int, int, int, int, int]:
                    # 讓「昨天沒上班 / 連上較短 / 上較多」的人優先休假，
                    # 目標：上班集中成段、避免隔天休一天，同時仍維持大致公平
                    return (
                        0 if worked_yesterday(emp_id, day) else 1,
                        consecutive_work.get(emp_id, 0),
                        total_work.get(emp_id, 0),
                        holiday_work.get(emp_id, 0),
                        emp_id,
                    )

                # pick_score 越大越應該被改休（例如昨天沒上班的人）
                to_trim = sorted(assigned_emp_ids, key=pick_score, reverse=True)[:surplus]
                for emp_id in to_trim:
                    a = fixed_assignments.get(emp_id)
                    if a:
                        a.shift_type_id = off_shift_id
                        session.add(a)
                    fixed[emp_id] = OFF_CODE
                tag = "假日" if is_holiday(day) else "平日"
                warnings.append(
                    f"{day.isoformat()}（{tag}）{code} 班超過需求，已將 {len(to_trim)} 人改排休假（{OFF_CODE}）。"
                )
            session.commit()

        fixed_counts = {MORNING_CODE: 0, EVENING_CODE: 0, NIGHT_CODE: 0}
        for emp_id, code in fixed.items():
            # 防呆：若不是啟用員工（或資料不一致），跳過不計入
            if emp_id not in emp_by_id:
                continue
            assigned_today.add(emp_id)
            today_code[emp_id] = code
            if is_work_code(code):
                mark_assigned(emp_id, day, code)
                if code in WORK_CODES:
                    per_shift_count[emp_id][code] = per_shift_count[emp_id].get(code, 0) + 1
                    fixed_counts[code] = fixed_counts.get(code, 0) + 1
            else:
                mark_assigned(emp_id, day, code)

        # 若固定排班已經超過需求，提示「多餘人數」
        for code in WORK_CODES:
            if fixed_counts.get(code, 0) > required.get(code, 0):
                tag = "假日" if is_holiday(day) else "平日"
                warnings.append(
                    f"{day.isoformat()}（{tag}）{code} 班固定排班 {fixed_counts[code]} 人，已超過需求 {required[code]} 人。"
                )

        for code in WORK_CODES:
            # 若不覆蓋：需求要扣掉已存在的固定排班人數，避免同班多餘人數
            need = max(0, required[code] - fixed_counts.get(code, 0))
            for _ in range(need):
                candidates: list[int] = []
                for e in employees:
                    if e.id is None:
                        continue
                    if not can_take(e.id, day, code, assigned_today):
                        continue
                    candidates.append(e.id)

                if not candidates:
                    tag = "假日" if is_holiday(day) else "平日"
                    warnings.append(f"{day.isoformat()}（{tag}）{code} 班缺人（需求 {need}）。")
                    break

                # 強力達成「同一段連上盡量同班別」：先嘗試只從 block_ok 的候選人挑
                candidates_pref = candidates
                if params.prefer_same_shift_within_block:
                    pref = [emp_id for emp_id in candidates if block_ok(emp_id, code)]
                    if pref:
                        candidates_pref = pref
                    else:
                        tag = "假日" if is_holiday(day) else "平日"
                        warnings.append(f"{day.isoformat()}（{tag}）{code} 班無法維持同班別連上（已被迫換班）。")

                if params.prefer_clustered_work:
                    # 上班盡量集中：優先派昨天有上班的人、且讓連上延續（在 max_consecutive_work_days 內）
                    def score(emp_id: int) -> tuple[int, int, int, int, int, int]:
                        y_code = yesterday_work_shift_code(emp_id, day)
                        same_shift_penalty = (
                            0
                            if (not params.prefer_same_shift_within_block) or (y_code is None) or (y_code == code)
                            else 1
                        )
                        return (
                            0 if worked_yesterday(emp_id, day) else 1,
                            same_shift_penalty,
                            # 同班別優先度提高：放在班別均衡之前，避免「休假~休假」之間一直換班
                            per_shift_count[emp_id].get(code, 0),
                            -consecutive_work.get(emp_id, 0),
                            total_work.get(emp_id, 0),
                            holiday_work.get(emp_id, 0) if is_holiday(day) else 0,
                            emp_id,
                        )
                else:
                    # 平均分散：避免一直連上
                    def score(emp_id: int) -> tuple[int, int, int, int, int, int]:
                        y_code = yesterday_work_shift_code(emp_id, day)
                        same_shift_penalty = (
                            0
                            if (not params.prefer_same_shift_within_block) or (y_code is None) or (y_code == code)
                            else 1
                        )
                        return (
                            consecutive_work.get(emp_id, 0),
                            same_shift_penalty,
                            per_shift_count[emp_id].get(code, 0),
                            total_work.get(emp_id, 0),
                            holiday_work.get(emp_id, 0) if is_holiday(day) else 0,
                            emp_id,
                        )

                chosen = sorted(candidates_pref, key=score)[0]

                session.add(
                    Assignment(
                        employee_id=chosen,
                        day=day,
                        shift_type_id=shifts_by_code[code].id,  # type: ignore[arg-type]
                    )
                )
                created += 1
                assigned_today.add(chosen)
                today_code[chosen] = code
                mark_assigned(chosen, day, code)
                per_shift_count[chosen][code] = per_shift_count[chosen].get(code, 0) + 1

        # 未被排到工作班的人，若不是固定班，補上休假（O）讓表格更清楚
        # 讓表格更清楚：補上休假（O）
        for e in employees:
            if e.id is None:
                continue
            if e.id in assigned_today:
                continue
            if day in fixed_by_day and e.id in fixed_by_day[day]:
                continue
            if off_shift_id is None:
                continue
            session.add(Assignment(employee_id=e.id, day=day, shift_type_id=off_shift_id))
            created += 1
            today_code[e.id] = OFF_CODE
            mark_assigned(e.id, day, OFF_CODE)

        # 更新每人最近 6 天工作旗標（用來檢查「任意 7 日」規則）
        for e in employees:
            if e.id is None:
                continue
            hist = last6_work_flags.get(e.id)
            if hist is None:
                hist = []
                last6_work_flags[e.id] = hist
            hist.append(is_work_code(today_code.get(e.id, OFF_CODE)))
            while len(hist) > 6:
                hist.pop(0)

    session.commit()
    return GenerateResult(created=created, deleted=deleted, warnings=warnings)


@dataclass
class FillOffResult:
    created: int
    warnings: list[str]


def fill_month_off(session: Session, month: str, active_only: bool = True) -> FillOffResult:
    """
    把指定月份所有「未排班的格子」補成休假（O）。
    - 不會覆蓋既有排班（早/晚/夜/O/L 等都保留）
    - 適合手動排完後，一鍵補齊空白
    """
    start, end = month_range(month)
    warnings: list[str] = []

    shifts_by_code = _get_shift_by_code(session)
    if "O" not in shifts_by_code or not shifts_by_code["O"].id:
        return FillOffResult(created=0, warnings=["缺少休假班別 O（請先建立/seed 班別）"])
    off_shift_id = shifts_by_code["O"].id  # type: ignore[assignment]

    q = select(Employee)
    if active_only:
        q = q.where(Employee.active == True)  # noqa: E712
    employees = session.exec(q.order_by(Employee.id)).all()
    emp_ids = [e.id for e in employees if e.id is not None]
    if not emp_ids:
        return FillOffResult(created=0, warnings=["目前沒有任何員工可補休假。"])

    existing = session.exec(select(Assignment).where(Assignment.day >= start, Assignment.day <= end)).all()
    exist_set = {(a.employee_id, a.day) for a in existing}

    created = 0
    for day in _iter_days(start, end):
        for emp_id in emp_ids:
            key = (emp_id, day)
            if key in exist_set:
                continue
            session.add(Assignment(employee_id=emp_id, day=day, shift_type_id=off_shift_id))
            created += 1
    session.commit()
    return FillOffResult(created=created, warnings=warnings)


