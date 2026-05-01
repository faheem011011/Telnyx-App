"""add ON DELETE SET NULL to twilio_numbers.assigned_to_user_id fkey

Revision ID: d1e2f3a4b5c6
Revises: c1d2e3f4a5b6
Create Date: 2026-04-30 00:02:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c1d2e3f4a5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('twilio_numbers_assigned_to_user_id_fkey', 'twilio_numbers', type_='foreignkey')
    op.create_foreign_key(
        'twilio_numbers_assigned_to_user_id_fkey',
        'twilio_numbers', 'users',
        ['assigned_to_user_id'], ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint('twilio_numbers_assigned_to_user_id_fkey', 'twilio_numbers', type_='foreignkey')
    op.create_foreign_key(
        'twilio_numbers_assigned_to_user_id_fkey',
        'twilio_numbers', 'users',
        ['assigned_to_user_id'], ['id'],
    )
