# app/services/company_search.py
from typing import Optional

import httpx
import re
from urllib.parse import quote_plus

GOOGLE_SEARCH_URL = "https://www.google.com/search"
LINKEDIN_COMPANY_PATTERN = re.compile(
    r'https?://(?:www\.)?linkedin\.com/company/[\w-]+/?'
)


async def search_linkedin_url(company_name: str) -> Optional[str]:
    query = f'"{company_name}" site:linkedin.com/company'

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(
            GOOGLE_SEARCH_URL,
            params={"q": query},
            headers=headers,
            follow_redirects=True
        )

    if response.status_code != 200:
        return None

    matches = LINKEDIN_COMPANY_PATTERN.findall(response.text)
    if matches:
        url = matches[0].rstrip("/")
        if not url.startswith("https://"):
            url = "https://" + url.split("://", 1)[-1]
        return url

    return None
