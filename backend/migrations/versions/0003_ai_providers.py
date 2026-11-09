"""Add local provider configuration, routing, and redacted usage records."""

import sqlalchemy as sa
from alembic import op

revision = "0003_ai_providers"
down_revision = "0002_profile_and_resumes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "provider_configs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("label", sa.String(80), unique=True, nullable=False),
        sa.Column("model", sa.String(160), nullable=False),
        sa.Column("endpoint", sa.String(400), nullable=False),
        sa.Column("credential", sa.LargeBinary(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("allow_candidate_data", sa.Boolean(), nullable=False),
        sa.Column("json_mode", sa.Boolean(), nullable=False),
        sa.Column("input_rate", sa.Float(), nullable=True),
        sa.Column("output_rate", sa.Float(), nullable=True),
    )
    op.create_table(
        "provider_routes",
        sa.Column("task", sa.String(32), primary_key=True),
        sa.Column("providers", sa.JSON(), nullable=False),
    )
    op.create_table(
        "provider_usage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(80), nullable=False),
        sa.Column("task", sa.String(32), nullable=False),
        sa.Column("model", sa.String(160), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("estimated_usd", sa.Float()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("provider_usage")
    op.drop_table("provider_routes")
    op.drop_table("provider_configs")
