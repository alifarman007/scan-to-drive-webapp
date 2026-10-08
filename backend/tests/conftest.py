import pytest
from sqlalchemy.orm import Session

from app.db import engine


@pytest.fixture()
def db():
    """A session inside a transaction that is rolled back after every test."""
    conn = engine.connect()
    outer = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint")
    yield session
    session.close()
    outer.rollback()
    conn.close()
