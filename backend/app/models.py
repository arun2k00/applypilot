from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class WorkspaceSettings(Base):
    __tablename__ = "workspace_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_workspace_settings_singleton"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    workspace_name: Mapped[str] = mapped_column(String(80))
    timezone: Mapped[str] = mapped_column(String(64))


class ResumeSource(Base):
    __tablename__ = "resume_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    digest: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(180))
    format: Mapped[str] = mapped_column(String(4))
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    extracted_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProfileRevision(Base):
    __tablename__ = "profile_revisions"

    revision: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    fields: Mapped[dict[str, str]] = mapped_column(JSON)
    resume_id: Mapped[int | None] = mapped_column(ForeignKey("resume_sources.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProviderConfig(Base):
    __tablename__ = "provider_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    label: Mapped[str] = mapped_column(String(80), unique=True)
    model: Mapped[str] = mapped_column(String(160))
    endpoint: Mapped[str] = mapped_column(String(400))
    credential: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    enabled: Mapped[bool] = mapped_column(Boolean)
    allow_candidate_data: Mapped[bool] = mapped_column(Boolean)
    json_mode: Mapped[bool] = mapped_column(Boolean)
    input_rate: Mapped[float | None] = mapped_column(Float)
    output_rate: Mapped[float | None] = mapped_column(Float)


class ProviderRoute(Base):
    __tablename__ = "provider_routes"

    task: Mapped[str] = mapped_column(String(32), primary_key=True)
    providers: Mapped[list[int]] = mapped_column(JSON)


class ProviderUsage(Base):
    __tablename__ = "provider_usage"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(80))
    task: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(24))
    input_tokens: Mapped[int | None]
    output_tokens: Mapped[int | None]
    estimated_usd: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JobListing(Base):
    __tablename__ = "job_listings"

    id: Mapped[int] = mapped_column(primary_key=True)
    url: Mapped[str] = mapped_column(String(1600), unique=True)
    title: Mapped[str] = mapped_column(String(180))
    company: Mapped[str] = mapped_column(String(180))
    details: Mapped[dict] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String(16))
    shortlisted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    criteria: Mapped[dict] = mapped_column(JSON)


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("job_listings.id"), unique=True)
    profile_revision: Mapped[int | None] = mapped_column(ForeignKey("profile_revisions.revision"))
    status: Mapped[str] = mapped_column(String(30))
    version: Mapped[int] = mapped_column()
    package: Mapped[dict] = mapped_column(JSON)
    tracking: Mapped[dict] = mapped_column(JSON)
    approval: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __mapper_args__ = {"version_id_col": version}


class ApplicationEvent(Base):
    __tablename__ = "application_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(ForeignKey("applications.id"), index=True)
    action: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SavedAnswer(Base):
    __tablename__ = "saved_answers"

    id: Mapped[int] = mapped_column(primary_key=True)
    question: Mapped[str] = mapped_column(String(600), unique=True)
    answer: Mapped[str] = mapped_column(Text)


class DiscoverySchedule(Base):
    __tablename__ = "discovery_schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(80))
    config: Mapped[dict] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(Boolean)
    next_run: Mapped[int] = mapped_column(index=True)
    lease_until: Mapped[int] = mapped_column(default=0)
    attempts: Mapped[int] = mapped_column(default=0)
    last_success: Mapped[int | None]


class DiscoveryRun(Base):
    __tablename__ = "discovery_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("discovery_schedules.id"), index=True)
    status: Mapped[str] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(String(240))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    dedupe_key: Mapped[str] = mapped_column(String(120), unique=True)
    message: Mapped[str] = mapped_column(String(400))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
