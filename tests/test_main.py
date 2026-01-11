# tests/test_main.py
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, MagicMock
import io
import sys


@pytest.fixture
def test_db_path(tmp_path):
    return str(tmp_path / "test.db")


@pytest_asyncio.fixture
async def app(test_db_path):
    # Create mock settings before importing app.main
    mock_settings = MagicMock()
    mock_settings.database_path = test_db_path
    mock_settings.anthropic_api_key = "test-key"
    mock_settings.mcp_server_url = "http://localhost:3000"

    # Remove any cached imports
    modules_to_remove = [k for k in sys.modules.keys() if k.startswith('app.main')]
    for mod in modules_to_remove:
        del sys.modules[mod]

    with patch.dict('sys.modules', {'app.config': MagicMock(settings=mock_settings)}):
        # Now import app.main with patched settings
        from app import main
        main.settings = mock_settings

        from app.database import init_db
        await init_db(test_db_path)

        yield main.app


@pytest.mark.asyncio
async def test_upload_csv(app, test_db_path):
    csv_content = b"company_name,website_url\nAcme Inc,https://acme.com"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/jobs/upload",
            files={"file": ("test.csv", io.BytesIO(csv_content), "text/csv")}
        )

    assert response.status_code == 200
    data = response.json()
    assert "job_id" in data
    assert data["total_companies"] == 1


@pytest.mark.asyncio
async def test_upload_invalid_csv(app):
    csv_content = b"wrong_column,email\nAcme Inc,test@test.com"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/jobs/upload",
            files={"file": ("test.csv", io.BytesIO(csv_content), "text/csv")}
        )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_get_job_status(app, test_db_path):
    csv_content = b"company_name,website_url\nAcme Inc,https://acme.com"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Mock process_job to prevent background processing
        with patch("app.main.process_job"):
            upload_resp = await client.post(
                "/api/jobs/upload",
                files={"file": ("test.csv", io.BytesIO(csv_content), "text/csv")}
            )
            job_id = upload_resp.json()["job_id"]

            status_resp = await client.get(f"/api/jobs/{job_id}")

    assert status_resp.status_code == 200
    data = status_resp.json()
    assert data["status"] == "pending"
    assert data["total"] == 1
