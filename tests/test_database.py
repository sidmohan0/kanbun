# tests/test_database.py
import pytest
import aiosqlite
import os
from pathlib import Path


@pytest.fixture
def test_db_path(tmp_path):
    return str(tmp_path / "test.db")


@pytest.mark.asyncio
async def test_init_db_creates_tables(test_db_path):
    from app.database import init_db

    await init_db(test_db_path)

    async with aiosqlite.connect(test_db_path) as db:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
        tables = {row[0] for row in await cursor.fetchall()}

    assert "jobs" in tables
    assert "companies" in tables
    assert "about_descriptions" in tables
    assert "keywords" in tables


@pytest.mark.asyncio
async def test_get_db_returns_connection(test_db_path):
    from app.database import init_db, get_db

    await init_db(test_db_path)

    async with get_db(test_db_path) as db:
        cursor = await db.execute("SELECT 1")
        result = await cursor.fetchone()

    assert result[0] == 1
