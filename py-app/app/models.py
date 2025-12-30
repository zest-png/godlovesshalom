from __future__ import annotations

from datetime import date, time
from typing import Optional

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class Employee(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    active: bool = Field(default=True, index=True)
    color: Optional[str] = Field(default=None, description="前端顯示用色碼（例如 #3b82f6）")
    # 排班限制（MVP：先用「天數」處理，工時/加班等可再加強）
    max_work_days_per_month: int = Field(default=0, description="當月最多上班天數（0 表示不限制）")
    max_consecutive_work_days: int = Field(default=6, description="最多連續上班天數（含早/晚/夜；0 表示使用系統預設）")
    can_work_night: bool = Field(default=True, description="是否可排夜班（夜）")
    night_only: bool = Field(default=False, description="是否只排夜班（只允許 夜；不排早/晚）")
    special_requirements: Optional[str] = Field(default=None, description="特殊需求（文字備註）")


class ShiftType(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    code: str = Field(index=True, description="班別代碼：早/晚/夜/O/L ...")
    name: str
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    is_work: bool = Field(default=True, description="是否算工作班（O/L 不算）")


class Assignment(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("employee_id", "day", name="uq_assignment_employee_day"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    employee_id: int = Field(index=True, foreign_key="employee.id")
    day: date = Field(index=True)
    shift_type_id: int = Field(foreign_key="shifttype.id")
    note: Optional[str] = None


