from __future__ import annotations

from datetime import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.models import ShiftType

router = APIRouter(prefix="/shift-types", tags=["shift-types"])


class ShiftTypeCreate(BaseModel):
    code: str
    name: str
    start_time: time | None = None
    end_time: time | None = None
    is_work: bool = True


class ShiftTypeUpdate(BaseModel):
    name: str | None = None
    start_time: time | None = None
    end_time: time | None = None
    is_work: bool | None = None


@router.get("")
def list_shift_types(session: Session = Depends(get_session)) -> list[ShiftType]:
    return session.exec(select(ShiftType).order_by(ShiftType.id)).all()


@router.post("", status_code=201)
def create_shift_type(payload: ShiftTypeCreate, session: Session = Depends(get_session)) -> ShiftType:
    code = payload.code.strip().upper()
    name = payload.name.strip()
    if not code or not name:
        raise HTTPException(status_code=400, detail="code/name 不可為空")
    exists = session.exec(select(ShiftType).where(ShiftType.code == code)).first()
    if exists:
        raise HTTPException(status_code=409, detail="code 已存在")
    s = ShiftType(code=code, name=name, start_time=payload.start_time, end_time=payload.end_time, is_work=payload.is_work)
    session.add(s)
    session.commit()
    session.refresh(s)
    return s


@router.patch("/{shift_type_id}")
def update_shift_type(
    shift_type_id: int, payload: ShiftTypeUpdate, session: Session = Depends(get_session)
) -> ShiftType:
    s = session.get(ShiftType, shift_type_id)
    if not s:
        raise HTTPException(status_code=404, detail="shift type not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    session.add(s)
    session.commit()
    session.refresh(s)
    return s


@router.delete("/{shift_type_id}", status_code=204)
def delete_shift_type(shift_type_id: int, session: Session = Depends(get_session)) -> None:
    s = session.get(ShiftType, shift_type_id)
    if not s:
        return
    session.delete(s)
    session.commit()


