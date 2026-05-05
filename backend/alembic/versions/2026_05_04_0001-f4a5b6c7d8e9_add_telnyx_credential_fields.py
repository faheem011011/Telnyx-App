"""add telnyx_credential_id and telnyx_sip_username to users

Revision ID: f4a5b6c7d8e9
Revises: e2f3a4b5c6d7
Create Date: 2026-05-04 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, Sequence[str], None] = 'e2f3a4b5c6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('telnyx_credential_id', sa.String(128), nullable=True))
    op.add_column('users', sa.Column('telnyx_sip_username', sa.String(128), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'telnyx_sip_username')
    op.drop_column('users', 'telnyx_credential_id')
