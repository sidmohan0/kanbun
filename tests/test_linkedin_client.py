# tests/test_linkedin_client.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_get_company_profile_extracts_data():
    from app.services.linkedin_client import LinkedInMCPClient

    mock_result = {
        "name": "Acme Inc",
        "description": "We build awesome software.",
        "website": "https://acme.com",
        "industry": "Software"
    }

    client = LinkedInMCPClient("http://localhost:3000")

    with patch.object(client, "_call_tool", new_callable=AsyncMock) as mock_call:
        mock_call.return_value = mock_result

        result = await client.get_company_profile("https://linkedin.com/company/acme")

    assert result["name"] == "Acme Inc"
    assert result["description"] == "We build awesome software."
    assert result["website"] == "https://acme.com"


@pytest.mark.asyncio
async def test_get_company_profile_handles_missing_fields():
    from app.services.linkedin_client import LinkedInMCPClient

    mock_result = {
        "name": "Acme Inc"
    }

    client = LinkedInMCPClient("http://localhost:3000")

    with patch.object(client, "_call_tool", new_callable=AsyncMock) as mock_call:
        mock_call.return_value = mock_result

        result = await client.get_company_profile("https://linkedin.com/company/acme")

    assert result["name"] == "Acme Inc"
    assert result.get("description") is None
    assert result.get("website") is None
