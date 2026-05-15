"""add unique constraint on users.phone_number

Prevents multiple users from sharing the same phone number, which would cause
_resolve_user_by_to_number to return an arbitrary user for inbound calls/SMS.

Revision ID: ee08ff09aa10
Revises: dd05ee06ff07
Create Date: 2026-05-15
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'ee08ff09aa10'
down_revision: Union[str, Sequence[str], None] = 'dd05ee06ff07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint('uq_users_phone_number', 'users', ['phone_number'])


def downgrade() -> None:
    op.drop_constraint('uq_users_phone_number', 'users', type_='unique')
