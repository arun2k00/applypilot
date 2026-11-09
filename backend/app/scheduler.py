import asyncio
import logging
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import Engine, select, update
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from .matching import closed, evaluate, excluded_company, match_policy
from .models import (
    Application,
    DiscoveryRun,
    DiscoverySchedule,
    JobListing,
    Notification,
    SavedSearch,
    WorkspaceSettings,
)
from .routers.jobs import add_job, feed_items
from .routers.profile import latest

logger = logging.getLogger("applypilot.scheduler")
LEASE_SECONDS = 180


def timezone(database: Session) -> ZoneInfo:
    settings = database.get(WorkspaceSettings, 1)
    return ZoneInfo(settings.timezone if settings else "UTC")


def next_due(config: dict, zone: ZoneInfo, now: int) -> int:
    local = datetime.fromtimestamp(now, zone)
    hour = time.fromisoformat(config["at"])
    candidate = datetime.combine(local.date(), hour, zone)
    if config["frequency"] == "weekly":
        candidate += timedelta(days=(config["weekday"] - candidate.weekday()) % 7)
    if candidate.timestamp() <= now:
        candidate += timedelta(days=7 if config["frequency"] == "weekly" else 1)
    return int(candidate.timestamp())


def notify(database: Session, key: str, message: str) -> None:
    if database.scalar(select(Notification.id).where(Notification.dedupe_key == key)) is not None:
        return
    try:
        with database.begin_nested():
            database.add(Notification(dedupe_key=key, message=message[:400], read=False))
            database.flush()
    except IntegrityError:
        return


def reminders(database: Session, now: int) -> None:
    today = datetime.fromtimestamp(now, timezone(database)).date().isoformat()
    rows = database.execute(
        select(Application, JobListing)
        .join(
            JobListing,
            JobListing.id == Application.job_id,
        )
        .where(Application.status.not_in({"Rejected", "Withdrawn", "Expired", "Offer received"}))
    )
    for application, job in rows:
        for field, label in (("interview_on", "Interview"), ("follow_up_on", "Follow-up")):
            due = application.tracking.get(field)
            if due == today:
                notify(
                    database,
                    f"{field}:{application.id}:{due}",
                    f"{label} today for {job.title} at {job.company}.",
                )
    database.commit()


def run_one(engine: Engine, schedule_id: int, now: int) -> None:
    lease = now + LEASE_SECONDS
    with Session(engine) as database:
        claim = database.execute(
            update(DiscoverySchedule)
            .where(
                DiscoverySchedule.id == schedule_id,
                DiscoverySchedule.enabled.is_(True),
                DiscoverySchedule.next_run <= now,
                DiscoverySchedule.lease_until <= now,
            )
            .values(lease_until=lease)
        )
        if claim.rowcount != 1:
            return
        schedule = database.get(DiscoverySchedule, schedule_id)
        config = schedule.config.copy()
        started = DiscoveryRun(
            schedule_id=schedule_id, status="running", message="Checking authorized feed."
        )
        database.add(started)
        database.flush()
        run_id = started.id
        database.commit()

    try:
        entries = feed_items(config["url"], config["max_jobs"])
    except HTTPException as failure:
        entries = None
        error = str(failure.detail)[:200]

    finished = int(datetime.now(UTC).timestamp())
    with Session(engine) as database:
        schedule = database.get(DiscoverySchedule, schedule_id)
        run = database.get(DiscoveryRun, run_id)
        if schedule.lease_until != lease:
            run.status, run.message = "interrupted", "Schedule changed while the feed was running."
            database.commit()
            return
        if entries is None:
            schedule.attempts += 1
            run.status, run.message = "failed", error
            if schedule.attempts < 3:
                schedule.next_run = finished + 60 * (2 ** (schedule.attempts - 1))
            else:
                schedule.next_run = next_due(config, timezone(database), finished)
                schedule.attempts = 0
            notify(
                database,
                f"feed-failed:{schedule.id}:{finished // 86400}",
                f"Scheduled feed failed for {schedule.label}. Check the run history.",
            )
        else:
            profile = latest(database)
            search = database.get(SavedSearch, config["search_id"]) if config["search_id"] else None
            criteria = search.criteria if search else {}
            policy = match_policy(criteria)
            today = datetime.fromtimestamp(finished, timezone(database)).date().isoformat()
            created = 0
            for item in entries:
                try:
                    job, added = add_job(database, item, source="rss")
                except HTTPException:
                    continue
                if added:
                    created += 1
                    result = evaluate(job, profile.fields if profile else {}, criteria, policy)
                    if (
                        policy.meets(result, config["threshold"])
                        and not closed(job, today)
                        and not excluded_company(job.company, criteria)
                    ):
                        notify(
                            database,
                            f"match:{job.id}",
                            f"{result['score']}/100 match for {job.title} at {job.company}.",
                        )
            schedule.last_success = finished
            schedule.attempts = 0
            schedule.next_run = next_due(config, timezone(database), finished)
            run.status, run.message = "ok", f"Imported {created} new listings."
        schedule.lease_until = 0
        database.commit()


def tick(engine: Engine) -> None:
    now = int(datetime.now(UTC).timestamp())
    with Session(engine) as database:
        reminders(database, now)
        ids = list(
            database.scalars(
                select(DiscoverySchedule.id)
                .where(
                    DiscoverySchedule.enabled.is_(True),
                    DiscoverySchedule.next_run <= now,
                    DiscoverySchedule.lease_until <= now,
                )
                .order_by(DiscoverySchedule.next_run)
                .limit(3)
            )
        )
        stalled = (
            DiscoveryRun.status == "running",
            DiscoveryRun.schedule_id.in_(
                select(DiscoverySchedule.id).where(DiscoverySchedule.lease_until <= now)
            ),
        )
        if database.scalar(select(DiscoveryRun.id).where(*stalled).limit(1)) is not None:
            database.execute(
                update(DiscoveryRun)
                .where(*stalled)
                .values(status="interrupted", message="Previous run stopped before completing.")
            )
        database.commit()
    for schedule_id in ids:
        run_one(engine, schedule_id, now)


async def loop(engine: Engine, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await asyncio.to_thread(tick, engine)
        except SQLAlchemyError:
            logger.warning("Discovery scheduler could not reach local storage.")
        try:
            await asyncio.wait_for(stop.wait(), timeout=15)
        except TimeoutError:
            continue
