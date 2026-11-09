from datetime import date

from fastapi import APIRouter
from sqlalchemy import func, select

from ..dependencies import Database
from ..matching import closed, evaluate, excluded_company, match_policy
from ..models import Application, ApplicationEvent, DiscoveryRun, JobListing, SavedSearch
from .profile import latest

router = APIRouter()


@router.get("/overview")
def overview(database: Database):
    profile = latest(database)
    search = database.scalar(select(SavedSearch).order_by(SavedSearch.id.desc()).limit(1))
    fields, criteria = profile.fields if profile else {}, search.criteria if search else {}
    counts = {
        "jobs": database.scalar(select(func.count()).select_from(JobListing)),
        "excellent": 0,
        "in_progress": 0,
        "interviews": 0,
    }
    today = date.today().isoformat()
    policy = match_policy(criteria)
    for job in database.scalars(select(JobListing).execution_options(yield_per=100)):
        if closed(job, today) or excluded_company(job.company, criteria):
            continue
        result = evaluate(job, fields, criteria, policy)
        if policy.meets(result, policy.excellent_score):
            counts["excellent"] += 1
    followups = []
    for tracking, status, title, company in database.execute(
        select(Application.tracking, Application.status, JobListing.title, JobListing.company).join(
            JobListing, JobListing.id == Application.job_id
        )
    ):
        if status not in {"Offer received", "Rejected", "Withdrawn", "Expired"}:
            counts["in_progress"] += 1
            if tracking.get("follow_up_on") and tracking["follow_up_on"] >= today:
                followups.append(
                    {"date": tracking["follow_up_on"], "title": title, "company": company}
                )
            if tracking.get("interview_on") and tracking["interview_on"] >= today:
                counts["interviews"] += 1
    activity = [
        {"id": event.id, "action": event.action, "title": title, "company": company}
        for event, title, company in database.execute(
            select(ApplicationEvent, JobListing.title, JobListing.company)
            .join(Application, Application.id == ApplicationEvent.application_id)
            .join(JobListing, JobListing.id == Application.job_id)
            .order_by(ApplicationEvent.id.desc())
            .limit(4)
        )
    ]
    run = database.scalar(select(DiscoveryRun).order_by(DiscoveryRun.id.desc()).limit(1))
    return {
        "counts": counts,
        "excellent_score": policy.excellent_score,
        "activity": activity,
        "profile_ready": profile is not None,
        "followups": sorted(followups, key=lambda item: item["date"])[:5],
        "discovery": {"status": run.status, "message": run.message} if run else None,
    }
