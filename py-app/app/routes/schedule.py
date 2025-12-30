from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session

from app.db import get_session
from app.schedule_service import GenerateParams, fill_month_off, generate_month_schedule

router = APIRouter(prefix="/schedule", tags=["schedule"])


class GenerateRequest(BaseModel):
    weekday_morning: int = 1
    weekday_evening: int = 1
    weekday_night: int = 1

    holiday_morning: int = 2
    holiday_evening: int = 2
    holiday_night: int = 1

    weekend_as_holiday: bool = True
    holiday_dates: list[date] = []
    overwrite: bool = False
    trim_overstaff_to_off: bool = True
    prefer_clustered_work: bool = True
    prefer_same_shift_within_block: bool = True
    max_consecutive_work_days: int = 6
    min_rest_days_per_7: int = 2


@router.post("/generate")
def generate(
    payload: GenerateRequest,
    month: str = Query(..., description="YYYY-MM"),
    session: Session = Depends(get_session),
) -> dict:
    result = generate_month_schedule(
        session,
        month=month,
        params=GenerateParams(
            weekday_morning=payload.weekday_morning,
            weekday_evening=payload.weekday_evening,
            weekday_night=payload.weekday_night,
            holiday_morning=payload.holiday_morning,
            holiday_evening=payload.holiday_evening,
            holiday_night=payload.holiday_night,
            weekend_as_holiday=payload.weekend_as_holiday,
            holiday_dates=frozenset(payload.holiday_dates),
            overwrite=payload.overwrite,
            trim_overstaff_to_off=payload.trim_overstaff_to_off,
            prefer_clustered_work=payload.prefer_clustered_work,
            prefer_same_shift_within_block=payload.prefer_same_shift_within_block,
            max_consecutive_work_days=payload.max_consecutive_work_days,
            min_rest_days_per_7=payload.min_rest_days_per_7,
        ),
    )
    return {
        "ok": True,
        "created": result.created,
        "deleted": result.deleted,
        "warnings": result.warnings,
    }


class FillOffRequest(BaseModel):
    active_only: bool = True


@router.post("/fill-off")
def fill_off(
    payload: FillOffRequest,
    month: str = Query(..., description="YYYY-MM"),
    session: Session = Depends(get_session),
) -> dict:
    result = fill_month_off(session, month=month, active_only=payload.active_only)
    return {"ok": True, "created": result.created, "warnings": result.warnings}


