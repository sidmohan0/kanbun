# tests/test_keyword_extractor.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_extract_keywords_parses_response():
    from app.services.keyword_extractor import extract_keywords

    mock_response = MagicMock()
    mock_response.content = [MagicMock()]
    mock_response.content[0].text = '''
    {
        "core_product": ["CRM software", "sales automation"],
        "category_language": ["B2B SaaS"],
        "industry_depth": ["API-first", "cloud-native"],
        "pain_points": ["reduce churn", "streamline sales"],
        "customer_segments": ["enterprise", "mid-market"]
    }
    '''

    with patch("anthropic.AsyncAnthropic") as mock_anthropic:
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)
        mock_anthropic.return_value = mock_client

        result = await extract_keywords("Acme Inc", "We build CRM software for enterprise.", "test-key")

    assert "CRM software" in result["core_product"]
    assert "B2B SaaS" in result["category_language"]
    assert "enterprise" in result["customer_segments"]


@pytest.mark.asyncio
async def test_extract_keywords_handles_empty_description():
    from app.services.keyword_extractor import extract_keywords

    result = await extract_keywords("Acme Inc", "", "test-key")

    assert result is None


@pytest.mark.asyncio
async def test_extract_keywords_handles_short_description():
    from app.services.keyword_extractor import extract_keywords

    result = await extract_keywords("Acme Inc", "Hi", "test-key")

    assert result is None
