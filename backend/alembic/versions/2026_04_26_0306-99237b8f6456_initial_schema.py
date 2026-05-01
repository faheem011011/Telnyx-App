"""initial schema

Revision ID: 99237b8f6456
Revises:
Create Date: 2026-04-26 03:06:00.784200

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '99237b8f6456'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('email', sa.String(255), unique=True, index=True, nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=True),
        sa.Column('phone_number', sa.String(32), nullable=True, index=True),
        sa.Column('role', sa.String(16), nullable=False, server_default='user'),
        sa.Column('department', sa.String(64), nullable=True),
        sa.Column('google_id', sa.String(128), unique=True, nullable=True, index=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )

    op.create_table(
        'twilio_numbers',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('sid', sa.String(64), unique=True, index=True, nullable=False),
        sa.Column('phone_number', sa.String(32), unique=True, nullable=False),
        sa.Column('friendly_name', sa.String(255), nullable=True),
        sa.Column('assigned_to_user_id', sa.Integer(),
                  sa.ForeignKey('users.id'), nullable=True),
        sa.Column('cap_voice', sa.Boolean(), server_default=sa.true()),
        sa.Column('cap_sms', sa.Boolean(), server_default=sa.true()),
        sa.Column('cap_mms', sa.Boolean(), server_default=sa.false()),
        sa.Column('purchased_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )

    op.create_table(
        'contacts',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('phone_number', sa.String(32), nullable=False, index=True),
        sa.Column('email', sa.String(255), nullable=True),
        sa.Column('company', sa.String(255), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('is_favorite', sa.Boolean(), server_default=sa.false()),
        sa.Column('is_blocked', sa.Boolean(), server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )

    op.create_table(
        'calls',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('twilio_call_sid', sa.String(64), unique=True, index=True, nullable=True),
        sa.Column('direction', sa.String(16), nullable=False),
        sa.Column('from_number', sa.String(32), nullable=False, index=True),
        sa.Column('to_number', sa.String(32), nullable=False, index=True),
        sa.Column('status', sa.String(32), server_default='pending'),
        sa.Column('duration_seconds', sa.Integer(), server_default='0'),
        sa.Column('recording_url', sa.String(512), nullable=True),
        sa.Column('voicemail_url', sa.String(512), nullable=True),
        sa.Column('voicemail_transcription', sa.Text(), nullable=True),
        sa.Column('is_read', sa.Boolean(), server_default=sa.false()),
        sa.Column('is_starred', sa.Boolean(), server_default=sa.false()),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now(), index=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        'messages',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('twilio_message_sid', sa.String(64), unique=True, index=True, nullable=True),
        sa.Column('direction', sa.String(16), nullable=False),
        sa.Column('from_number', sa.String(32), nullable=False, index=True),
        sa.Column('to_number', sa.String(32), nullable=False, index=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('status', sa.String(32), server_default='queued'),
        sa.Column('media_url', sa.String(512), nullable=True),
        sa.Column('is_read', sa.Boolean(), server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now(), index=True),
    )


def downgrade() -> None:
    op.drop_table('messages')
    op.drop_table('calls')
    op.drop_table('contacts')
    op.drop_table('twilio_numbers')
    op.drop_table('users')
