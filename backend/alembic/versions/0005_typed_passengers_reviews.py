"""passengers can be added from the passenger page (name optional), remembered passenger phone, trip reviews

Revision ID: 0005
Revises: 0004
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '0005'
down_revision: Union[str, Sequence[str], None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('passengers', 'name', existing_type=sa.String(length=120), nullable=True)
    op.add_column('trips', sa.Column('passenger_key_hash', sa.String(length=64), nullable=True))
    op.create_table(
        'trip_reviews',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trip_id', sa.Integer(), nullable=False),
        sa.Column('rating', sa.Integer(), nullable=False),
        sa.Column('tags', postgresql.ARRAY(sa.String(length=30)), server_default=sa.text("'{}'"), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('rating BETWEEN 1 AND 5', name=op.f('ck_trip_reviews_rating_1_to_5')),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], name=op.f('fk_trip_reviews_trip_id_trips')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_trip_reviews')),
        sa.UniqueConstraint('trip_id', name=op.f('uq_trip_reviews_trip_id')),
    )
    op.create_index('ix_trip_reviews_created_at', 'trip_reviews', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_trip_reviews_created_at', table_name='trip_reviews')
    op.drop_table('trip_reviews')
    op.drop_column('trips', 'passenger_key_hash')
    op.execute("UPDATE passengers SET name = employee_id WHERE name IS NULL")
    op.alter_column('passengers', 'name', existing_type=sa.String(length=120), nullable=False)
