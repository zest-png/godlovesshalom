from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.db import get_session
from app.models import Employee

router = APIRouter(prefix="/employees", tags=["employees"])


class EmployeeCreate(BaseModel):
    name: str
    color: str | None = None
    max_work_days_per_month: int = 0
    max_consecutive_work_days: int = 6
    can_work_night: bool = True
    night_only: bool = False
    special_requirements: str | None = None


class EmployeeUpdate(BaseModel):
    name: str | None = None
    active: bool | None = None
    color: str | None = None
    max_work_days_per_month: int | None = None
    max_consecutive_work_days: int | None = None
    can_work_night: bool | None = None
    night_only: bool | None = None
    special_requirements: str | None = None


@router.get("")
def list_employees(session: Session = Depends(get_session)) -> list[Employee]:
    return session.exec(select(Employee).order_by(Employee.active.desc(), Employee.id)).all()


@router.post("", status_code=201)
def create_employee(payload: EmployeeCreate, session: Session = Depends(get_session)) -> Employee:
    can_work_night = payload.can_work_night
    if payload.night_only:
        can_work_night = True
    e = Employee(
        name=payload.name.strip(),
        color=payload.color,
        max_work_days_per_month=max(0, payload.max_work_days_per_month),
        max_consecutive_work_days=max(0, payload.max_consecutive_work_days),
        can_work_night=can_work_night,
        night_only=payload.night_only,
        special_requirements=payload.special_requirements,
    )
    if not e.name:
        raise HTTPException(status_code=400, detail="name 不可為空")
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@router.patch("/{employee_id}")
def update_employee(
    employee_id: int, payload: EmployeeUpdate, session: Session = Depends(get_session)
) -> Employee:
    e = session.get(Employee, employee_id)
    if not e:
        raise HTTPException(status_code=404, detail="employee not found")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        if k in ["max_work_days_per_month", "max_consecutive_work_days"] and v is not None:
            setattr(e, k, max(0, int(v)))
        else:
            setattr(e, k, v)
    # 若只排夜班，強制可排夜班，避免矛盾設定
    if getattr(e, "night_only", False):
        e.can_work_night = True
    if e.name is not None:
        e.name = e.name.strip()
    session.add(e)
    session.commit()
    session.refresh(e)
    return e


@router.delete("/{employee_id}", status_code=204)
def delete_employee(employee_id: int, session: Session = Depends(get_session)) -> None:
    e = session.get(Employee, employee_id)
    if not e:
        return
    session.delete(e)
    session.commit()


