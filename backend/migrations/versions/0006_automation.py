"""Persist discovery schedules, run history and notifications."""

import sqlalchemy as sa
from alembic import op

revision = "0006_automation"
down_revision = "0005_applications"
branch_labels = None
depends_on = None


def timestamp():
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )


def upgrade() -> None:
    op.create_table(
        "discovery_schedules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("next_run", sa.Integer(), nullable=False),
        sa.Column("lease_until", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("last_success", sa.Integer()),
    )
    op.create_index("ix_discovery_schedules_next_run", "discovery_schedules", ["next_run"])
    op.create_table(
        "discovery_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "schedule_id", sa.Integer(), sa.ForeignKey("discovery_schedules.id"), nullable=False
        ),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("message", sa.String(240), nullable=False),
        timestamp(),
    )
    op.create_index("ix_discovery_runs_schedule_id", "discovery_runs", ["schedule_id"])
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dedupe_key", sa.String(120), unique=True, nullable=False),
        sa.Column("message", sa.String(400), nullable=False),
        sa.Column("read", sa.Boolean(), nullable=False),
        timestamp(),
    )


def downgrade() -> None:
    op.drop_table("notifications")
    op.drop_index("ix_discovery_runs_schedule_id", table_name="discovery_runs")
    op.drop_table("discovery_runs")
    op.drop_index("ix_discovery_schedules_next_run", table_name="discovery_schedules")
    op.drop_table("discovery_schedules")
