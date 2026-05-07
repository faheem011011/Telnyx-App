"""add performance composite indexes for calls and messages

Revision ID: bb02cc03dd04
Revises: aa01bb02cc03
Create Date: 2026-05-08 00:02:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'bb02cc03dd04'
down_revision: Union[str, Sequence[str], None] = 'aa01bb02cc03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index('ix_calls_owner_started', 'calls', ['owner_id', 'started_at'])
    op.create_index('ix_calls_owner_status', 'calls', ['owner_id', 'status'])
    op.create_index(
        'ix_calls_owner_direction_started',
        'calls',
        ['owner_id', 'direction', 'started_at'],
    )
    op.create_index('ix_messages_owner_created', 'messages', ['owner_id', 'created_at'])
    op.create_index(
        'ix_messages_owner_direction_read',
        'messages',
        ['owner_id', 'direction', 'is_read'],
    )


def downgrade() -> None:
    op.drop_index('ix_messages_owner_direction_read', table_name='messages')
    op.drop_index('ix_messages_owner_created', table_name='messages')
    op.drop_index('ix_calls_owner_direction_started', table_name='calls')
    op.drop_index('ix_calls_owner_status', table_name='calls')
    op.drop_index('ix_calls_owner_started', table_name='calls')
