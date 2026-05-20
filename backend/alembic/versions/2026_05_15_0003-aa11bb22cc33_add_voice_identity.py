"""add voice_identity to users

Replaces the guessable ``user_{id}`` Telnyx WebRTC identity with an opaque
UUID so the signaling layer cannot be used to enumerate user IDs.

Revision ID: aa11bb22cc33
Revises: ff09aa10bb11
Create Date: 2026-05-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'aa11bb22cc33'
down_revision: Union[str, Sequence[str], None] = 'ff09aa10bb11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add nullable first so Postgres can compute per-row defaults without
    # needing a single constant value; gen_random_uuid() produces a distinct
    # UUID for every existing row automatically.
    op.add_column(
        "users",
        sa.Column(
            "voice_identity",
            sa.String(36),
            nullable=True,
            server_default=sa.text("gen_random_uuid()::text"),
        ),
    )
    # Drop the server_default - new rows get the value from the Python-level
    # model default (_new_voice_identity) so the DB never needs to generate one.
    op.alter_column("users", "voice_identity", server_default=None, nullable=False)
    op.create_unique_constraint("uq_users_voice_identity", "users", ["voice_identity"])


def downgrade() -> None:
    op.drop_constraint("uq_users_voice_identity", "users", type_="unique")
    op.drop_column("users", "voice_identity")
