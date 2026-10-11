"""Photo details: size in pixels and bytes, the size the phone sent, and a fingerprint (SHA-256).

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("trip_photos", sa.Column("width", sa.Integer(), nullable=True))
    op.add_column("trip_photos", sa.Column("height", sa.Integer(), nullable=True))
    op.add_column("trip_photos", sa.Column("size_bytes", sa.Integer(), nullable=True))
    op.add_column("trip_photos", sa.Column("original_bytes", sa.Integer(), nullable=True))
    op.add_column("trip_photos", sa.Column("sha256", sa.String(64), nullable=True))
    op.create_index("ix_trip_photos_sha256", "trip_photos", ["sha256"])


def downgrade() -> None:
    op.drop_index("ix_trip_photos_sha256", table_name="trip_photos")
    for col in ("sha256", "original_bytes", "size_bytes", "height", "width"):
        op.drop_column("trip_photos", col)
