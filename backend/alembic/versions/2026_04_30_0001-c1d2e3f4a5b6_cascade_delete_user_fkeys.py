"""add ON DELETE CASCADE to calls, messages, contacts owner_id fkeys

Revision ID: c1d2e3f4a5b6
Revises: a1b2c3d4e5f6
Create Date: 2026-04-30 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c1d2e3f4a5b6'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # calls.owner_id
    op.drop_constraint('calls_owner_id_fkey', 'calls', type_='foreignkey')
    op.create_foreign_key(
        'calls_owner_id_fkey', 'calls', 'users', ['owner_id'], ['id'], ondelete='CASCADE'
    )

    # messages.owner_id
    op.drop_constraint('messages_owner_id_fkey', 'messages', type_='foreignkey')
    op.create_foreign_key(
        'messages_owner_id_fkey', 'messages', 'users', ['owner_id'], ['id'], ondelete='CASCADE'
    )

    # contacts.owner_id
    op.drop_constraint('contacts_owner_id_fkey', 'contacts', type_='foreignkey')
    op.create_foreign_key(
        'contacts_owner_id_fkey', 'contacts', 'users', ['owner_id'], ['id'], ondelete='CASCADE'
    )


def downgrade() -> None:
    op.drop_constraint('calls_owner_id_fkey', 'calls', type_='foreignkey')
    op.create_foreign_key(
        'calls_owner_id_fkey', 'calls', 'users', ['owner_id'], ['id']
    )

    op.drop_constraint('messages_owner_id_fkey', 'messages', type_='foreignkey')
    op.create_foreign_key(
        'messages_owner_id_fkey', 'messages', 'users', ['owner_id'], ['id']
    )

    op.drop_constraint('contacts_owner_id_fkey', 'contacts', type_='foreignkey')
    op.create_foreign_key(
        'contacts_owner_id_fkey', 'contacts', 'users', ['owner_id'], ['id']
    )
