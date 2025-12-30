from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.models import Assignment, ShiftType
from app.schedule_service import month_range

router = APIRouter(prefix="/assignments", tags=["assignments"])


class AssignmentDTO(BaseModel):
    employee_id: int
    day: date
    shift_type_id: int
    shift_code: str
    shift_name: str
    note: str | None = None


class AssignmentUpsert(BaseModel):
    employee_id: int
    day: date
    shift_type_id: int | None = None
    note: str | None = None


@router.get("")
def list_assignments(
    month: str = Query(..., description="YYYY-MM"),
    session: Session = Depends(get_session),
) -> list[AssignmentDTO]:
    start, end = month_range(month)
    items = session.exec(select(Assignment).where(Assignment.day >= start, Assignment.day <= end)).all()
    shift_ids = {a.shift_type_id for a in items}
    if not shift_ids:
        return []
    shift_map = {
        s.id: s
        for s in session.exec(select(ShiftType).where(ShiftType.id.in_(list(shift_ids)))).all()  # type: ignore[attr-defined]
    }

    out: list[AssignmentDTO] = []
    for a in items:
        s = shift_map.get(a.shift_type_id)
        if not s:
            continue
        out.append(
            AssignmentDTO(
                employee_id=a.employee_id,
                day=a.day,
                shift_type_id=a.shift_type_id,
                shift_code=s.code,
                shift_name=s.name,
                note=a.note,
            )
        )
    return out


@router.put("")
def upsert_assignment(payload: AssignmentUpsert, session: Session = Depends(get_session)) -> dict:
    # shift_type_id 為 null -> 刪除當天指派
    existing = session.exec(
        select(Assignment).where(Assignment.employee_id == payload.employee_id, Assignment.day == payload.day)
    ).first()

    if payload.shift_type_id is None:
        if existing:
            session.delete(existing)
            session.commit()
        return {"ok": True, "deleted": True}

    shift = session.get(ShiftType, payload.shift_type_id)
    if not shift:
        raise HTTPException(status_code=400, detail="shift_type_id 不存在")

    if existing:
        existing.shift_type_id = payload.shift_type_id
        existing.note = payload.note
        session.add(existing)
    else:
        session.add(
            Assignment(
                employee_id=payload.employee_id,
                day=payload.day,
                shift_type_id=payload.shift_type_id,
                note=payload.note,
            )
        )
    session.commit()
    return {"ok": True}


class BulkUpsertRequest(BaseModel):
    items: list[AssignmentUpsert]


@router.post("/bulk")
def bulk_upsert(payload: BulkUpsertRequest, session: Session = Depends(get_session)) -> dict:
    for item in payload.items:
        upsert_assignment(item, session)  # 共用邏輯（同一個 session）
    return {"ok": True, "count": len(payload.items)}


