"""Trips imported from the old Driver / Passenger Travel Log forms: which import they came from, and the
row they came from (so the same row is never imported twice).

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trips", sa.Column("import_batch", sa.String(32), nullable=True))
    op.add_column("trips", sa.Column("import_key", sa.String(60), nullable=True))
    op.create_index("ix_trips_import_batch", "trips", ["import_batch"])
    op.create_unique_constraint("uq_trips_import_key", "trips", ["import_key"])


def downgrade() -> None:
    op.drop_constraint("uq_trips_import_key", "trips", type_="unique")
    op.drop_index("ix_trips_import_batch", table_name="trips")
    op.drop_column("trips", "import_key")
    op.drop_column("trips", "import_batch")
