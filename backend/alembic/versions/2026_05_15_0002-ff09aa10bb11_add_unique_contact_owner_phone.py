"""add unique constraint on contacts (owner_id, phone_number)

Prevents multiple contacts per user with the same phone number, which caused
_resolve_contact / call-lookup to return an arbitrary row.

The upgrade deduplicates existing rows first (keeping the oldest contact per
owner+phone pair by MIN(id)) so the constraint can always be applied safely.

Revision ID: ff09aa10bb11
Revises: ee08ff09aa10
Create Date: 2026-05-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'ff09aa10bb11'
down_revision: Union[str, Sequence[str], None] = 'ee08ff09aa10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Remove duplicate contacts, keeping the one with the lowest id per
    # (owner_id, phone_number) pair.  Runs inside the migration transaction so
    # it rolls back automatically if anything goes wrong before the commit.
    op.execute(
        sa.text(
            """
            DELETE FROM contacts
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM contacts
                GROUP BY owner_id, phone_number
            )
            """
        )
    )
    op.create_unique_constraint(
        "uq_contact_owner_phone", "contacts", ["owner_id", "phone_number"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_contact_owner_phone", "contacts", type_="unique")
