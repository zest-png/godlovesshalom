from __future__ import annotations

from datetime import time

from sqlmodel import Session, select

from app.models import Assignment, ShiftType


DEFAULT_SHIFT_TYPES: list[dict] = [
    {"code": "早", "name": "早班", "is_work": True, "start_time": time(7, 0), "end_time": time(15, 0)},
    {"code": "晚", "name": "晚班", "is_work": True, "start_time": time(15, 0), "end_time": time(23, 0)},
    {"code": "夜", "name": "夜班", "is_work": True, "start_time": time(23, 0), "end_time": time(7, 0)},
    {"code": "O", "name": "休假", "is_work": False},
    {"code": "L", "name": "請假", "is_work": False},
]


def ensure_default_shift_types(session: Session) -> None:
    # 相容舊版：把舊代碼 M/E/N 合併成 早/晚/夜（保留既有 assignment）
    legacy_map = {"M": "早", "E": "晚", "N": "夜"}
    shifts = session.exec(select(ShiftType)).all()
    by_code_list: dict[str, list[ShiftType]] = {}
    for s in shifts:
        by_code_list.setdefault(s.code, []).append(s)

    def _pick_primary(items: list[ShiftType]) -> ShiftType:
        return sorted(items, key=lambda x: (x.id or 0))[0]

    def _repoint_assignments(src_shift_id: int, dst_shift_id: int) -> None:
        items = session.exec(select(Assignment).where(Assignment.shift_type_id == src_shift_id)).all()
        for a in items:
            a.shift_type_id = dst_shift_id
            session.add(a)

    for old_code, new_code in legacy_map.items():
        old_rows = by_code_list.get(old_code, [])
        new_rows = by_code_list.get(new_code, [])
        if not old_rows and not new_rows:
            continue

        if new_rows:
            primary = _pick_primary(new_rows)
        else:
            primary = _pick_primary(old_rows)
            primary.code = new_code

        # 合併其他重複班別（含舊碼/新碼的 duplicate），並把 assignment 轉到 primary
        for dup in (old_rows + new_rows):
            if (dup.id is None) or (primary.id is None) or (dup.id == primary.id):
                continue
            _repoint_assignments(dup.id, primary.id)
            session.delete(dup)

        session.add(primary)
        session.commit()

    # 重新讀取（避免 by_code_list 與資料不同步）
    by_code = {s.code: s for s in session.exec(select(ShiftType)).all()}
    for data in DEFAULT_SHIFT_TYPES:
        code = data["code"]
        existing = by_code.get(code)
        if not existing:
            session.add(ShiftType(**data))
            continue
        # 若已存在，更新成最新預設（避免舊 DB 沒有起迄時間）
        existing.name = data.get("name", existing.name)
        existing.is_work = bool(data.get("is_work", existing.is_work))
        existing.start_time = data.get("start_time", existing.start_time)
        existing.end_time = data.get("end_time", existing.end_time)
        session.add(existing)
    session.commit()


