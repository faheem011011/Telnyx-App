"""add indexes on contacts.owner_id and phone_numbers.assigned_to_user_id (C-07)

Both columns are FK columns filtered on every API request but had no explicit
index.  contacts.owner_id is partially covered by the composite unique index
uq_contact_owner_phone, but a dedicated single-column index is preferred by
the query planner for pure owner_id list queries.

Revision ID: bb22cc33dd44
Revises: aa11bb22cc33
Create Date: 2026-05-15 00:04:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'bb22cc33dd44'
down_revision: Union[str, Sequence[str], None] = 'aa11bb22cc33'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_contacts_owner_id', 'contacts', ['owner_id'])
    op.create_index('ix_phone_numbers_assigned_to_user_id', 'phone_numbers', ['assigned_to_user_id'])


def downgrade() -> None:
    op.drop_index('ix_phone_numbers_assigned_to_user_id', table_name='phone_numbers')
    op.drop_index('ix_contacts_owner_id', table_name='contacts')
