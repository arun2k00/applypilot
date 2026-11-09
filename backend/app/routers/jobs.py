import os
import re
from datetime import date
from heapq import nlargest
from html.parser import HTMLParser
from time import monotonic
from typing import Annotated, Literal
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from xml.etree import ElementTree

import httpx2 as httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..dependencies import Database, LocalHeader, require_local
from ..matching import MatchPolicy, closed, evaluate, excluded_company, match_policy
from ..models import JobListing, SavedSearch
from .profile import latest

router = APIRouter()
Arrangement = Literal["", "remote", "hybrid", "onsite"]
Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=180)]
Salary = Annotated[int | None, Field(default=None, ge=0, le=1_000_000_000)]


class JobInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Short
    company: Short
    url: str = Field(max_length=1600)
    description: str = Field(default="", max_length=20000)
    location: Short = ""
    arrangement: Arrangement = ""
    skills: str = Field(default="", max_length=1600)
    industry: Short = ""
    seniority: Short = ""
    experience: float | None = Field(default=None, ge=0, le=90)
    max_salary: Salary = None
    currency: Annotated[
        str, StringConstraints(strip_whitespace=True, pattern=r"^(|[A-Za-z]{3})$")
    ] = ""
    closes_on: date | None = None
    source: Literal["manual", "alert"] = "manual"


class SearchInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int | None = Field(default=None, gt=0)
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    titles: str = Field(default="", max_length=1000)
    locations: str = Field(default="", max_length=1000)
    arrangement: Arrangement = ""
    industry: str = Field(default="", max_length=1000)
    seniority: str = Field(default="", max_length=1000)
    excluded_companies: str = Field(default="", max_length=1000)
    min_salary: Salary = None
    currency: Annotated[
        str, StringConstraints(strip_whitespace=True, pattern=r"^(|[A-Za-z]{3})$")
    ] = ""

    match_policy: MatchPolicy = Field(default_factory=MatchPolicy)


class FeedInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(max_length=1600)


class ShortlistInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(gt=0)
    shortlisted: bool


def canonical_url(raw: str) -> str:
    raw = raw.strip()
    try:
        url = urlsplit(raw)
        port = url.port
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username is not None
            or any(char.isspace() or ord(char) < 32 for char in raw)
            or "\\" in raw
        ):
            raise ValueError
        host = url.hostname.lower()
        if ":" in host:
            host = f"[{host}]"
        if port is not None and port != (443 if url.scheme == "https" else 80):
            host += f":{port}"
        query = urlencode(
            [
                (key, value)
                for key, value in parse_qsl(url.query, keep_blank_values=True, max_num_fields=100)
                if not key.lower().startswith("utm_") and key.lower() not in {"trk", "trackingid"}
            ]
        )
        canonical = urlunsplit((url.scheme, host, url.path or "/", query, ""))
        if len(canonical) > 1600:
            raise ValueError
        return canonical
    except ValueError:
        raise HTTPException(422, "Enter a valid HTTP or HTTPS listing URL.") from None


def search_output(row: SavedSearch) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        **row.criteria,
        "match_policy": match_policy(row.criteria).model_dump(),
    }


def job_output(
    row: JobListing, profile: dict, criteria: dict, policy: MatchPolicy, today: str
) -> dict:
    match = evaluate(row, profile, criteria, policy)
    return {
        "id": row.id,
        "title": row.title,
        "company": row.company,
        "url": row.url,
        "source": row.source,
        "created_at": row.created_at,
        "shortlisted": row.shortlisted,
        "expired": closed(row, today),
        "excluded": excluded_company(row.company, criteria),
        **row.details,
        "match": {
            **match,
            "excellent": policy.meets(match, policy.excellent_score),
        },
    }


def recommendations(
    database: Database, profile: dict, criteria: dict, policy: MatchPolicy, today: str
):
    rows = database.scalars(select(JobListing).execution_options(yield_per=100))
    for row in rows:
        if closed(row, today) or excluded_company(row.company, criteria):
            continue
        match = evaluate(row, profile, criteria, policy)
        if policy.meets(match, policy.recommended_score):
            yield match["score"], match["evidence"], row.id


def add_job(
    database: Database, payload: JobInput, source: str | None = None
) -> tuple[JobListing, bool]:
    if not payload.title or not payload.company:
        raise HTTPException(422, "Enter a job title and company.")
    url = canonical_url(payload.url)
    existing = database.scalar(select(JobListing).where(JobListing.url == url))
    if existing:
        return existing, False
    row = JobListing(
        url=url,
        title=payload.title,
        company=payload.company,
        source=source or payload.source,
        details=payload.model_dump(mode="json", exclude={"url", "title", "company", "source"}),
    )
    try:
        with database.begin_nested():
            database.add(row)
            database.flush()
    except IntegrityError:
        existing = database.scalar(select(JobListing).where(JobListing.url == url))
        if existing is None:
            raise
        return existing, False
    return row, True


@router.get("/jobs")
def list_jobs(
    database: Database,
    page: int = 1,
    search: int | None = None,
    view: Literal["all", "recommended", "saved"] = "all",
):
    if not 1 <= page <= 10000:
        raise HTTPException(422, "Invalid page number.")
    saved = database.get(SavedSearch, search) if search else None
    candidate = latest(database)
    profile = candidate.fields if candidate else {}
    criteria = saved.criteria if saved else {}
    policy = match_policy(criteria)
    today = date.today().isoformat()
    offset = (page - 1) * 30
    if view == "recommended":
        ranked = nlargest(offset + 31, recommendations(database, profile, criteria, policy, today))
        ids = [item[2] for item in ranked[offset:]]
        by_id = {
            row.id: row
            for row in database.scalars(select(JobListing).where(JobListing.id.in_(ids)))
        }
        rows = [by_id[item] for item in ids]
    else:
        query = select(JobListing)
        if view == "saved":
            query = query.where(JobListing.shortlisted.is_(True))
        rows = list(database.scalars(query.order_by(JobListing.id.desc()).offset(offset).limit(31)))
    return {
        "items": [job_output(row, profile, criteria, policy, today) for row in rows[:30]],
        "next_page": page + 1 if len(rows) > 30 else None,
        "match_policy": policy.model_dump(),
        "searches": [
            search_output(row)
            for row in database.scalars(select(SavedSearch).order_by(SavedSearch.name).limit(100))
        ],
    }


@router.post("/jobs")
def import_job(payload: JobInput, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "jobs")
    job, created = add_job(database, payload)
    database.commit()
    return {"id": job.id, "created": created}


@router.put("/jobs/shortlist")
def shortlist(payload: ShortlistInput, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "job-shortlist")
    job = database.get(JobListing, payload.id)
    if not job:
        raise HTTPException(404, "Job listing not found.")
    job.shortlisted = payload.shortlisted
    database.commit()
    return {"id": job.id, "shortlisted": job.shortlisted}


@router.put("/jobs/searches")
def save_search(payload: SearchInput, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "job-searches")
    search = database.get(SavedSearch, payload.id) if payload.id else SavedSearch()
    if search is None:
        raise HTTPException(404, "Saved search not found.")
    policy = payload.match_policy
    if payload.id and "match_policy" not in payload.model_fields_set:
        policy = match_policy(search.criteria)
    search.name = payload.name
    search.criteria = {
        **payload.model_dump(exclude={"id", "name", "match_policy"}),
        "match_policy": policy.model_dump(),
    }
    database.add(search)
    try:
        database.commit()
    except IntegrityError:
        raise HTTPException(409, "A search with that name already exists.") from None
    return search_output(search)


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data: str):
        self.parts.append(data)


def feed_items(url: str, limit: int = 30) -> list[JobInput]:
    if url not in {
        entry.strip() for entry in os.getenv("APPLYPILOT_AUTHORIZED_FEEDS", "").split(",")
    }:
        raise HTTPException(403, "Add an authorized feed URL to APPLYPILOT_AUTHORIZED_FEEDS first.")
    canonical_url(url)
    deadline = monotonic() + 16
    try:
        with httpx.Client(timeout=10, trust_env=False, follow_redirects=False) as client:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                content = bytearray()
                for chunk in response.iter_bytes():
                    if monotonic() >= deadline:
                        raise ValueError
                    content.extend(chunk)
                    if len(content) > 512_000:
                        raise ValueError
        if re.search(rb"<!\s*(?:DOCTYPE|ENTITY)", content, flags=re.I) or b"\x00" in content:
            raise ValueError
        root = ElementTree.fromstring(content)
    except (httpx.HTTPError, ValueError, ElementTree.ParseError):
        raise HTTPException(502, "The authorized feed could not be read.") from None
    channel = root.find("channel")
    if channel is None:
        raise HTTPException(422, "Choose an RSS feed with a channel and job entries.")
    source = (channel.findtext("title") or urlsplit(url).hostname or "RSS").strip()[:180]
    entries = []
    for item in channel.findall("item")[:limit]:
        title, link = (item.findtext("title") or "").strip(), (item.findtext("link") or "").strip()
        if not title or not link or len(link) > 1600:
            continue
        description = PlainText()
        description.feed(item.findtext("description") or "")
        entries.append(
            JobInput(
                title=title[:180],
                company=(item.findtext("company") or source)[:180],
                url=link,
                description=" ".join(description.parts)[:20000],
            )
        )
    return entries


def import_feed(database: Database, url: str, limit: int = 30) -> int:
    count = 0
    for item in feed_items(url, limit):
        try:
            _, created = add_job(database, item, source="rss")
        except HTTPException:
            continue
        count += int(created)
    database.commit()
    return count


@router.post("/jobs/feed")
def import_authorized_feed(
    payload: FeedInput, database: Database, local_request: LocalHeader = None
):
    require_local(local_request, "job-feed")
    return {"imported": import_feed(database, payload.url)}
