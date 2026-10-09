"""settings.value becomes text (the purposes list does not fit in 255 characters)

Revision ID: 0004
Revises: 0003
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('settings', 'value', existing_type=sa.String(length=255), type_=sa.Text(), existing_nullable=False)


def downgrade() -> None:
    op.alter_column('settings', 'value', existing_type=sa.Text(), type_=sa.String(length=255), existing_nullable=False)
