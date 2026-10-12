"""Vendor (rental) cars: a vendors table, and each car is either Epic-owned or a vendor's.

Revision ID: 0007
Revises: 0006
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

owner_enum = postgresql.ENUM("epic", "vendor", name="vehicle_owner", create_type=False)


def upgrade() -> None:
    op.create_table(
        "vendors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendors")),
    )
    op.create_index("uq_vendors_name_lower", "vendors", [sa.text("lower(name)")], unique=True)

    owner_enum.create(op.get_bind(), checkfirst=False)
    # Every car that exists already is an Epic car.
    op.add_column("vehicles", sa.Column("owner", owner_enum, server_default="epic", nullable=False))
    op.add_column("vehicles", sa.Column("vendor_id", sa.Integer(), nullable=True))
    op.create_foreign_key(op.f("fk_vehicles_vendor_id_vendors"), "vehicles", "vendors", ["vendor_id"], ["id"], ondelete="RESTRICT")
    op.create_index(op.f("ix_vehicles_vendor_id"), "vehicles", ["vendor_id"])
    op.create_check_constraint("vendor_matches_owner", "vehicles", "(owner = 'vendor') = (vendor_id IS NOT NULL)")


def downgrade() -> None:
    op.drop_constraint(op.f("ck_vehicles_vendor_matches_owner"), "vehicles", type_="check")
    op.drop_index(op.f("ix_vehicles_vendor_id"), table_name="vehicles")
    op.drop_constraint(op.f("fk_vehicles_vendor_id_vendors"), "vehicles", type_="foreignkey")
    op.drop_column("vehicles", "vendor_id")
    op.drop_column("vehicles", "owner")
    owner_enum.drop(op.get_bind(), checkfirst=False)
    op.drop_index("uq_vendors_name_lower", table_name="vendors")
    op.drop_table("vendors")
