"""add voicemail_recording_id to calls

Regular call recordings already store a separate recording_id so
get_recording_url can mint fresh signed URLs without parsing the stored
voicemail_url string on every request. This column brings voicemails in
line with that pattern.

Revision ID: ff66aa77bb88
Revises: ee55ff66aa77
Create Date: 2026-05-19 00:02:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'ff66aa77bb88'
down_revision: Union[str, Sequence[str], None] = 'ee55ff66aa77'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('calls', sa.Column('voicemail_recording_id', sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column('calls', 'voicemail_recording_id')
