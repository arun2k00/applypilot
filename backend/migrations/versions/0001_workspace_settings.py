"""Create and initialize workspace settings."""

import sqlalchemy as sa
from alembic import op

revision = "0001_workspace_settings"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    settings = op.create_table(
        "workspace_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("workspace_name", sa.String(80), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_workspace_settings_singleton"),
    )
    op.bulk_insert(settings, [{"id": 1, "workspace_name": "My workspace", "timezone": "UTC"}])


def downgrade() -> None:
    op.drop_table("workspace_settings")
