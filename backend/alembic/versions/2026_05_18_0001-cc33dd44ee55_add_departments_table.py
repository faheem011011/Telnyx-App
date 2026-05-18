"""add departments table and seed initial departments

Replaces the hardcoded Department Literal in schemas with a DB-managed table.
Seeds the five original departments so existing user.department strings stay valid.

Revision ID: cc33dd44ee55
Revises: bb22cc33dd44
Create Date: 2026-05-18 00:01:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = 'cc33dd44ee55'
down_revision: Union[str, Sequence[str], None] = 'bb22cc33dd44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'departments',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(64), unique=True, nullable=False),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_departments_id', 'departments', ['id'])
    # Seed the five original hardcoded departments so existing user rows remain valid.
    op.execute(
        "INSERT INTO departments (name, is_active) VALUES "
        "('AI/ML Team', true), ('BD Team', true), ('Data Team', true), "
        "('DevOps Team', true), ('HR Team', true)"
    )


def downgrade() -> None:
    op.drop_index('ix_departments_id', table_name='departments')
    op.drop_table('departments')
