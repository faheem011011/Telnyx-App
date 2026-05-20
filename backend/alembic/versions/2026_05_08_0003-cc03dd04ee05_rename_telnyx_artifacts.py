"""Rename twilio_* artifacts to telnyx-neutral names.

This is a metadata-only rename (Postgres ALTER TABLE / ALTER COLUMN RENAME).
No data is rewritten. Safe to run on a live DB but requires that no app
instance is mid-flight using the old names - coordinate with deploy.

WARNING: this migration is not safely reversible without downtime once
applications have been deployed expecting the new names. Plan deploy and
migration together: run the migration FIRST, then deploy the new app.

Revision ID: cc03dd04ee05
Revises: bb02cc03dd04
Create Date: 2026-05-08
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'cc03dd04ee05'
down_revision: Union[str, Sequence[str], None] = 'bb02cc03dd04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.rename_table('twilio_numbers', 'phone_numbers')
    op.alter_column('calls', 'twilio_call_sid', new_column_name='call_sid')
    op.alter_column('messages', 'twilio_message_sid', new_column_name='message_sid')


def downgrade() -> None:
    op.alter_column('messages', 'message_sid', new_column_name='twilio_message_sid')
    op.alter_column('calls', 'call_sid', new_column_name='twilio_call_sid')
    op.rename_table('phone_numbers', 'twilio_numbers')
