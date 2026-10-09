"""passenger can't scan: skipped confirmations and admin approval

Revision ID: 0003
Revises: 0002
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trips', sa.Column('start_no_scan_reason', sa.Text(), nullable=True))
    op.add_column('trips', sa.Column('end_no_scan_reason', sa.Text(), nullable=True))
    op.add_column('trips', sa.Column('approval_status', sa.String(length=10), nullable=True))
    op.add_column('trips', sa.Column('approved_by', sa.Integer(), nullable=True))
    op.add_column('trips', sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('trips', sa.Column('approval_note', sa.Text(), nullable=True))
    op.create_foreign_key(op.f('fk_trips_approved_by_admin_users'), 'trips', 'admin_users', ['approved_by'], ['id'])
    # Hand-added: autogenerate does not detect CHECK constraints.
    op.create_check_constraint(
        op.f('ck_trips_approval_needs_a_skipped_step'), 'trips',
        "approval_status IS NULL OR (approval_status IN ('pending','approved','rejected') "
        "AND (start_no_scan_reason IS NOT NULL OR end_no_scan_reason IS NOT NULL))",
    )
    op.create_check_constraint(
        op.f('ck_trips_skipped_step_needs_approval_status'), 'trips',
        "approval_status IS NOT NULL OR (start_no_scan_reason IS NULL AND end_no_scan_reason IS NULL)",
    )
    op.create_check_constraint(
        op.f('ck_trips_decided_approval_has_admin'), 'trips',
        "approval_status IS NULL OR approval_status = 'pending' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)",
    )
    op.create_index('ix_trips_approval_status', 'trips', ['approval_status'])


def downgrade() -> None:
    op.drop_index('ix_trips_approval_status', table_name='trips')
    op.drop_constraint(op.f('ck_trips_decided_approval_has_admin'), 'trips', type_='check')
    op.drop_constraint(op.f('ck_trips_skipped_step_needs_approval_status'), 'trips', type_='check')
    op.drop_constraint(op.f('ck_trips_approval_needs_a_skipped_step'), 'trips', type_='check')
    op.drop_constraint(op.f('fk_trips_approved_by_admin_users'), 'trips', type_='foreignkey')
    for c in ('approval_note', 'approved_at', 'approved_by', 'approval_status', 'end_no_scan_reason', 'start_no_scan_reason'):
        op.drop_column('trips', c)
