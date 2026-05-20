"""drop redundant ix_webhook_events_telnyx_event_id index

unique=True on telnyx_event_id already creates a unique index.
The additional index=True created a second, non-unique index on the
same column - redundant and wasteful. This migration drops it.

Revision ID: dd44ee55ff66
Revises: cc33dd44ee55
Create Date: 2026-05-18 00:02:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'dd44ee55ff66'
down_revision: Union[str, Sequence[str], None] = 'cc33dd44ee55'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index('ix_webhook_events_telnyx_event_id', table_name='webhook_events')


def downgrade() -> None:
    op.create_index('ix_webhook_events_telnyx_event_id', 'webhook_events', ['telnyx_event_id'])
