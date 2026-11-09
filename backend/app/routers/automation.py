import os
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select

from ..dependencies import Database, LocalHeader, require_local
from ..models import DiscoveryRun, DiscoverySchedule, Notification, SavedSearch
from ..scheduler import next_due, timezone

router = APIRouter()


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ScheduleInput(Input):
    id: int | None = Field(default=None, gt=0)
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    url: str = Field(max_length=1600)
    frequency: Literal["daily", "weekly"]
    at: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    weekday: int = Field(ge=0, le=6)
    threshold: int = Field(ge=0, le=100)
    max_jobs: int = Field(ge=1, le=50)
    search_id: int | None = Field(default=None, gt=0)
    enabled: bool = False


class ById(Input):
    id: int = Field(gt=0)


def now() -> int:
    return int(datetime.now(UTC).timestamp())


def schedule_output(schedule: DiscoverySchedule) -> dict:
    return {
        "id": schedule.id,
        "label": schedule.label,
        "enabled": schedule.enabled,
        "next_run": schedule.next_run,
        "last_success": schedule.last_success,
        "running": schedule.lease_until > now(),
        **schedule.config,
    }


@router.get("/automation")
def get_automation(database: Database):
    return {
        "timezone": timezone(database).key,
        "schedules": [
            schedule_output(row)
            for row in database.scalars(
                select(DiscoverySchedule).order_by(DiscoverySchedule.id).limit(100)
            )
        ],
        "runs": [
            {
                "id": run.id,
                "schedule_id": run.schedule_id,
                "status": run.status,
                "message": run.message,
                "created_at": run.created_at,
            }
            for run in database.scalars(
                select(DiscoveryRun).order_by(DiscoveryRun.id.desc()).limit(40)
            )
        ],
        "notifications": [
            {
                "id": item.id,
                "message": item.message,
                "read": item.read,
                "created_at": item.created_at,
            }
            for item in database.scalars(
                select(Notification).order_by(Notification.id.desc()).limit(50)
            )
        ],
        "searches": [
            {"id": row.id, "name": row.name}
            for row in database.scalars(select(SavedSearch).order_by(SavedSearch.name).limit(100))
        ],
    }


@router.put("/automation")
def save_schedule(payload: ScheduleInput, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "automation")
    if payload.url not in {
        entry.strip()
        for entry in os.getenv("APPLYPILOT_AUTHORIZED_FEEDS", "").split(",")
        if entry.strip()
    }:
        raise HTTPException(
            403, "Enable the authorized feed URL in your local configuration first."
        )
    if payload.search_id and not database.get(SavedSearch, payload.search_id):
        raise HTTPException(404, "Saved search not found.")
    row = database.get(DiscoverySchedule, payload.id) if payload.id else DiscoverySchedule()
    if row is None:
        raise HTTPException(404, "Schedule not found.")
    row.label = payload.label
    row.config = payload.model_dump(exclude={"id", "label", "enabled"})
    row.enabled = payload.enabled
    row.attempts = 0
    row.lease_until = 0
    row.next_run = next_due(row.config, timezone(database), now())
    database.add(row)
    database.commit()
    return schedule_output(row)


@router.post("/automation/run")
def run_soon(payload: ById, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "automation-run")
    row = database.get(DiscoverySchedule, payload.id)
    if not row:
        raise HTTPException(404, "Schedule not found.")
    if not row.enabled or row.lease_until > now():
        raise HTTPException(409, "Enable a schedule and wait for any active run to finish.")
    row.next_run = now()
    row.attempts = 0
    database.commit()
    return schedule_output(row)


@router.put("/automation/notifications")
def mark_read(payload: ById, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "notification-read")
    row = database.get(Notification, payload.id)
    if not row:
        raise HTTPException(404, "Notification not found.")
    row.read = True
    database.commit()
    return {"id": row.id, "read": True}


@router.get("/automation/notifications/latest")
def latest_notification(database: Database):
    item = database.scalar(
        select(Notification)
        .order_by(
            Notification.created_at.desc(),
            Notification.id.desc(),
        )
        .limit(1)
    )
    return {
        "latest": {"id": item.id, "created_at": item.created_at, "read": item.read}
        if item
        else None,
    }
