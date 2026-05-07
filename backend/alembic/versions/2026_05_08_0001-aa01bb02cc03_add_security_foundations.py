"""add security foundations: token_version, deleted_at, webhook_events

Revision ID: aa01bb02cc03
Revises: f4a5b6c7d8e9
Create Date: 2026-05-08 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'aa01bb02cc03'
down_revision: Union[str, Sequence[str], None] = 'f4a5b6c7d8e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('token_version', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('users', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index('ix_users_deleted_at', 'users', ['deleted_at'])

    op.create_table(
        'webhook_events',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('telnyx_event_id', sa.String(length=128), nullable=False),
        sa.Column('event_type', sa.String(length=64), nullable=False),
        sa.Column(
            'processed_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint('telnyx_event_id', name='uq_webhook_events_telnyx_event_id'),
    )
    op.create_index(
        'ix_webhook_events_telnyx_event_id',
        'webhook_events',
        ['telnyx_event_id'],
        unique=True,
    )
    op.create_index('ix_webhook_events_id', 'webhook_events', ['id'])


def downgrade() -> None:
    op.drop_index('ix_webhook_events_id', table_name='webhook_events')
    op.drop_index('ix_webhook_events_telnyx_event_id', table_name='webhook_events')
    op.drop_table('webhook_events')
    op.drop_index('ix_users_deleted_at', table_name='users')
    op.drop_column('users', 'deleted_at')
    op.drop_column('users', 'token_version')
