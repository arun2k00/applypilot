"""Add application packages, approval state, activity history and reusable answers."""

import sqlalchemy as sa
from alembic import op

revision = "0005_applications"
down_revision = "0004_discovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "applications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "job_id", sa.Integer(), sa.ForeignKey("job_listings.id"), unique=True, nullable=False
        ),
        sa.Column("profile_revision", sa.Integer(), sa.ForeignKey("profile_revisions.revision")),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("package", sa.JSON(), nullable=False),
        sa.Column("tracking", sa.JSON(), nullable=False),
        sa.Column("approval", sa.String(64)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "application_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("application_id", sa.Integer(), sa.ForeignKey("applications.id"), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_application_events_application_id", "application_events", ["application_id"]
    )
    op.create_table(
        "saved_answers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("question", sa.String(600), unique=True, nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("saved_answers")
    op.drop_index("ix_application_events_application_id", table_name="application_events")
    op.drop_table("application_events")
    op.drop_table("applications")
