# tests/test_company_search.py
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_search_linkedin_url_parses_result():
    from app.services.company_search import search_linkedin_url

    mock_html = '''
    <html>
    <body>
        <a href="https://www.linkedin.com/company/acme-inc">Acme Inc</a>
    </body>
    </html>
    '''

    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.text = mock_html
        mock_response.status_code = 200
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)

        result = await search_linkedin_url("Acme Inc")

    assert result == "https://www.linkedin.com/company/acme-inc"


@pytest.mark.asyncio
async def test_search_linkedin_url_returns_none_if_not_found():
    from app.services.company_search import search_linkedin_url

    mock_html = '<html><body>No results</body></html>'

    with patch("httpx.AsyncClient") as mock_client:
        mock_response = AsyncMock()
        mock_response.text = mock_html
        mock_response.status_code = 200
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(return_value=mock_response)

        result = await search_linkedin_url("NonexistentCompany12345")

    assert result is None
