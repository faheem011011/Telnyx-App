"""add recording_id to calls so we can mint fresh signed URLs

Telnyx delivers a pre-signed S3 URL on call.recording.saved that expires in
~10 minutes. Storing it directly means playback returns 403 after the window
closes. Keep the recording_id instead so the backend can fetch a fresh signed
URL from /v2/recordings/{id} whenever the user replays the audio.

Revision ID: dd05ee06ff07
Revises: cc03dd04ee05
Create Date: 2026-05-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'dd05ee06ff07'
down_revision: Union[str, Sequence[str], None] = 'cc03dd04ee05'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('calls', sa.Column('recording_id', sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column('calls', 'recording_id')
