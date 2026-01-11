# tests/test_job_processor.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
import uuid


@pytest.fixture
def test_db_path(tmp_path):
    return str(tmp_path / "test.db")


@pytest.mark.asyncio
async def test_create_job(test_db_path):
    from app.database import init_db
    from app.services.job_processor import create_job

    await init_db(test_db_path)

    companies = [
        {"company_name": "Acme Inc", "website_url": "https://acme.com"},
        {"company_name": "Foo Corp", "website_url": "https://foo.io"}
    ]

    job_id = await create_job(test_db_path, "test.csv", companies)

    assert job_id is not None
    assert len(job_id) == 36  # UUID format


@pytest.mark.asyncio
async def test_get_job_status(test_db_path):
    from app.database import init_db
    from app.services.job_processor import create_job, get_job_status

    await init_db(test_db_path)

    companies = [
        {"company_name": "Acme Inc", "website_url": "https://acme.com"}
    ]

    job_id = await create_job(test_db_path, "test.csv", companies)
    status = await get_job_status(test_db_path, job_id)

    assert status["status"] == "pending"
    assert status["total"] == 1
    assert status["processed"] == 0
