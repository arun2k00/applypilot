import re
import subprocess
import sys
from hashlib import sha256
from typing import Annotated
from urllib.parse import unquote

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

from ..dependencies import Database, LocalHeader, read_bounded, require_local
from ..models import ProfileRevision, ResumeSource
from ..resume_parser import MAX_UPLOAD

router = APIRouter()
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=240)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=3000)]
MEDIA_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
EMAIL_PATTERN = re.compile(r"[\w.+-]{1,64}@[\w.-]{1,190}\.[a-zA-Z]{2,24}")
SECTIONS = {
    "experience": "employment",
    "work experience": "employment",
    "employment": "employment",
    "skills": "skills",
    "technical skills": "skills",
    "education": "education",
    "certifications": "certifications",
    "projects": "projects",
    "languages": "languages",
    "achievements": "achievements",
    "summary": "summary",
    "profile": "summary",
}


class ProfileFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ShortText = ""
    email: ShortText = ""
    phone: ShortText = ""
    location: ShortText = ""
    headline: ShortText = ""
    total_experience: ShortText = ""
    links: LongText = ""
    summary: LongText = ""
    employment: LongText = ""
    achievements: LongText = ""
    skills: LongText = ""
    education: LongText = ""
    certifications: LongText = ""
    projects: LongText = ""
    languages: LongText = ""

    @field_validator("email")
    @classmethod
    def validate_email(cls, email: str) -> str:
        if email and not EMAIL_PATTERN.fullmatch(email):
            raise ValueError("Enter a valid email address.")
        return email


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=0)
    resume_id: int | None = Field(default=None, gt=0)
    fields: ProfileFields
    confirmed: bool


def resume_summary(row: ResumeSource) -> dict:
    return {"id": row.id, "name": row.name, "format": row.format, "created_at": row.created_at}


def profile_snapshot(row: ProfileRevision | None) -> dict:
    if row is None:
        return {"revision": 0, "resume_id": None, "fields": ProfileFields()}
    return {
        "revision": row.revision,
        "resume_id": row.resume_id,
        "fields": ProfileFields(**row.fields),
        "created_at": row.created_at,
    }


def latest(database: Database) -> ProfileRevision | None:
    return database.scalar(
        select(ProfileRevision).order_by(ProfileRevision.revision.desc()).limit(1)
    )


def suggest(text: str) -> ProfileFields:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    email = EMAIL_PATTERN.search(text)
    values = {"email": email[0] if email and len(email[0]) <= 240 else ""}
    first = lines[0]
    if re.fullmatch(r"[^\W\d_]+(?:[ .'’-][^\W\d_]+){1,5}", first) and first.lower() not in SECTIONS:
        values["name"] = first[:240]
    section = None
    for line in lines:
        heading = line.lower().rstrip(":")
        if heading in SECTIONS:
            section = SECTIONS[heading]
        elif section:
            values[section] = (values.get(section, "") + "\n" + line).strip()[:3000]
    return ProfileFields(**values)


def parse_resume(content: bytes, kind: str) -> str:
    try:
        result = subprocess.run(
            [sys.executable, "-m", "app.resume_parser", kind],
            input=content,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=12,
            check=True,
        )
        text = result.stdout.decode().strip()
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise HTTPException(
            422, "This document could not be read within the import limits."
        ) from None
    if not text:
        raise HTTPException(422, "No text found. Try a text-based PDF or DOCX.")
    return text


@router.get("/profile")
def get_profile(database: Database):
    return {
        **profile_snapshot(latest(database)),
        "resumes": [
            resume_summary(row)
            for row in database.scalars(
                select(ResumeSource).order_by(ResumeSource.id.desc()).limit(50)
            )
        ],
        "history": [
            {"revision": row.revision, "created_at": row.created_at}
            for row in database.scalars(
                select(ProfileRevision).order_by(ProfileRevision.revision.desc()).limit(25)
            )
        ],
    }


@router.get("/profile/{revision}")
def get_revision(revision: int, database: Database):
    row = database.get(ProfileRevision, revision)
    if not row:
        raise HTTPException(404, "Profile revision not found.")
    return profile_snapshot(row)


@router.put("/profile")
def save_profile(payload: ProfileUpdate, database: Database, local_request: LocalHeader = None):
    require_local(local_request, "profile")
    if not payload.confirmed or not payload.fields.name:
        raise HTTPException(422, "Enter your name and confirm the reviewed facts.")
    current = latest(database)
    if payload.revision != (current.revision if current else 0):
        raise HTTPException(409, "The profile changed in another tab. Reload before saving.")
    if payload.resume_id and not database.get(ResumeSource, payload.resume_id):
        raise HTTPException(404, "Resume not found.")
    fields = payload.fields.model_dump()
    if current and current.fields == fields and current.resume_id == payload.resume_id:
        return profile_snapshot(current)
    row = ProfileRevision(revision=payload.revision + 1, fields=fields, resume_id=payload.resume_id)
    database.add(row)
    try:
        database.commit()
    except IntegrityError:
        raise HTTPException(
            409, "The profile changed in another tab. Reload before saving."
        ) from None
    return profile_snapshot(row)


@router.post("/resumes", status_code=201)
async def upload_resume(
    request: Request,
    database: Database,
    filename: Annotated[str, Header(alias="X-ApplyPilot-Filename", max_length=2160)],
    local_request: LocalHeader = None,
):
    require_local(local_request, "resumes")
    name = unquote(filename).replace("\\", "/").split("/")[-1]
    name = "".join(char for char in name if char.isprintable())
    kind = name.rsplit(".", 1)[-1].lower()
    if (
        len(name) > 180
        or kind not in MEDIA_TYPES
        or request.headers.get("content-type") != MEDIA_TYPES[kind]
    ):
        raise HTTPException(415, "Choose a PDF or DOCX resume.")
    content = await read_bounded(request, MAX_UPLOAD)
    signature = b"%PDF-" if kind == "pdf" else b"PK\x03\x04"
    if not content.startswith(signature):
        raise HTTPException(422, "The file does not match its document format.")
    digest = sha256(content).hexdigest()
    row = database.scalar(select(ResumeSource).where(ResumeSource.digest == digest))
    if row is None:
        # Parsing can take seconds. Release the read transaction so scheduled writes
        # cannot invalidate its SQLite snapshot before the insert.
        database.rollback()
        extracted = await run_in_threadpool(parse_resume, content, kind)
        row = ResumeSource(
            digest=digest,
            name=name,
            format=kind,
            content=content,
            extracted_text=extracted,
        )
        database.add(row)
        try:
            database.commit()
        except IntegrityError:
            database.rollback()
            row = database.scalar(select(ResumeSource).where(ResumeSource.digest == digest))
            if row is None:
                raise
    return resume_detail(row)


def resume_detail(row: ResumeSource) -> dict:
    return {
        **resume_summary(row),
        "text": row.extracted_text,
        "suggestions": suggest(row.extracted_text),
    }


@router.get("/resumes/{resume_id}")
def get_resume(resume_id: int, database: Database):
    row = database.get(ResumeSource, resume_id)
    if not row:
        raise HTTPException(404, "Resume not found.")
    return resume_detail(row)


@router.get("/resumes/{resume_id}/original")
def download_resume(resume_id: int, database: Database):
    row = database.get(ResumeSource, resume_id)
    if not row:
        raise HTTPException(404, "Resume not found.")
    return Response(
        row.content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="resume-{row.id}.{row.format}"'},
    )
