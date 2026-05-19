"""add unique constraints to telnyx_credential_id and telnyx_sip_username

Each Telnyx credential belongs to exactly one user. The advisory lock in
/api/calls/token prevents concurrent duplicate creation, but a DB-level
unique constraint is the guaranteed last line of defense.

NULL values are excluded from the uniqueness check in Postgres (each NULL
is distinct), so users without a credential yet are unaffected.

Revision ID: ee55ff66aa77
Revises: dd44ee55ff66
Create Date: 2026-05-19 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'ee55ff66aa77'
down_revision: Union[str, Sequence[str], None] = 'dd44ee55ff66'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        'uq_users_telnyx_credential_id', 'users', ['telnyx_credential_id']
    )
    op.create_unique_constraint(
        'uq_users_telnyx_sip_username', 'users', ['telnyx_sip_username']
    )


def downgrade() -> None:
    op.drop_constraint('uq_users_telnyx_sip_username', 'users', type_='unique')
    op.drop_constraint('uq_users_telnyx_credential_id', 'users', type_='unique')
