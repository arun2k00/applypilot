"""Store source resumes and candidate-confirmed profile revisions."""

import sqlalchemy as sa
from alembic import op

revision = "0002_profile_and_resumes"
down_revision = "0001_workspace_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resume_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("digest", sa.String(64), unique=True, nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("format", sa.String(4), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("extracted_text", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "profile_revisions",
        sa.Column("revision", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("fields", sa.JSON(), nullable=False),
        sa.Column("resume_id", sa.Integer(), sa.ForeignKey("resume_sources.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("profile_revisions")
    op.drop_table("resume_sources")
