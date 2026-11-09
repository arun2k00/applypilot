"""Add discovered jobs and saved search criteria."""

import sqlalchemy as sa
from alembic import op

revision = "0004_discovery"
down_revision = "0003_ai_providers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_listings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("url", sa.String(1600), unique=True, nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("company", sa.String(180), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("shortlisted", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "saved_searches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), unique=True, nullable=False),
        sa.Column("criteria", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("saved_searches")
    op.drop_table("job_listings")
