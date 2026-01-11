# Lead Enrichment Application Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an application that uploads CSV leads, fetches LinkedIn About Us descriptions via MCP server, verifies companies by URL matching, and extracts keywords using Claude.

**Architecture:** FastAPI backend with SQLite storage. LinkedIn data fetched via external MCP server (Docker). Background job processor handles batches of 50-500 companies with rate limiting. Simple HTML/JS frontend.

**Tech Stack:** Python 3.11+, FastAPI, SQLite (aiosqlite), httpx, anthropic SDK, MCP client library, Tailwind CSS

---

## Task 1: Project Setup

**Files:**
- Create: `app/__init__.py`
- Create: `app/services/__init__.py`
- Create: `requirements.txt`
- Create: `.env.example`
- Create: `data/.gitkeep`

**Step 1: Create directory structure**

```bash
mkdir -p app/services app/static data tests
```

**Step 2: Create requirements.txt**

```
fastapi==0.109.0
uvicorn[standard]==0.27.0
python-multipart==0.0.6
aiosqlite==0.19.0
httpx==0.26.0
beautifulsoup4==4.12.3
anthropic==0.18.1
pydantic-settings==2.1.0
mcp==1.0.0
```

**Step 3: Create .env.example**

```
ANTHROPIC_API_KEY=sk-ant-...
LINKEDIN_LI_AT=your-linkedin-session-cookie
MCP_SERVER_URL=http://localhost:3000
DATABASE_PATH=data/sidcrm.db
```

**Step 4: Create __init__.py files**

Create empty `app/__init__.py` and `app/services/__init__.py`.

**Step 5: Create data/.gitkeep**

Empty file to preserve directory.

**Step 6: Install dependencies**

```bash
pip install -r requirements.txt
```

**Step 7: Commit**

```bash
git init
git add .
git commit -m "chore: initial project setup with dependencies"
```

---

## Task 2: Configuration Module

**Files:**
- Create: `app/config.py`
- Create: `tests/test_config.py`

**Step 1: Write the failing test**

```python
# tests/test_config.py
import os
import pytest


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_PATH", "test.db")

    from app.config import Settings
    settings = Settings()

    assert settings.anthropic_api_key == "test-key"
    assert settings.database_path == "test.db"


def test_settings_has_defaults(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    from app.config import Settings
    settings = Settings()

    assert settings.database_path == "data/sidcrm.db"
    assert settings.mcp_server_url == "http://localhost:3000"
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_config.py -v
```

Expected: FAIL with "No module named 'app.config'"

**Step 3: Write implementation**

```python
# app/config.py
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    linkedin_li_at: str = ""
    mcp_server_url: str = "http://localhost:3000"
    database_path: str = "data/sidcrm.db"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_config.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/config.py tests/test_config.py
git commit -m "feat: add configuration module with pydantic settings"
```

---

## Task 3: Database Schema and Connection

**Files:**
- Create: `app/database.py`
- Create: `tests/test_database.py`

**Step 1: Write the failing test**

```python
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
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_database.py -v
```

Expected: FAIL with "No module named 'app.database'"

**Step 3: Write implementation**

```python
# app/database.py
import aiosqlite
from contextlib import asynccontextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    filename TEXT,
    status TEXT DEFAULT 'pending',
    total_companies INTEGER DEFAULT 0,
    processed_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    name TEXT,
    website_url TEXT,
    linkedin_url TEXT,
    url_verified BOOLEAN,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS about_descriptions (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    raw_text TEXT,
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS keywords (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    category TEXT,
    keyword TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_companies_job_id ON companies(job_id);
CREATE INDEX IF NOT EXISTS idx_keywords_company_id ON keywords(company_id);
CREATE INDEX IF NOT EXISTS idx_about_company_id ON about_descriptions(company_id);
"""


async def init_db(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(db_path) as db:
        await db.executescript(SCHEMA)
        await db.commit()


@asynccontextmanager
async def get_db(db_path: str):
    db = await aiosqlite.connect(db_path)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_database.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/database.py tests/test_database.py
git commit -m "feat: add database schema and connection helpers"
```

---

## Task 4: Pydantic Models

**Files:**
- Create: `app/models.py`
- Create: `tests/test_models.py`

**Step 1: Write the failing test**

```python
# tests/test_models.py
import pytest
from datetime import datetime


def test_job_response_model():
    from app.models import JobResponse

    job = JobResponse(
        id="123",
        filename="test.csv",
        status="pending",
        total_companies=10,
        processed_count=0,
        created_at=datetime.now()
    )

    assert job.id == "123"
    assert job.status == "pending"


def test_company_response_model():
    from app.models import CompanyResponse

    company = CompanyResponse(
        id="456",
        name="Acme Inc",
        website_url="https://acme.com",
        linkedin_url="https://linkedin.com/company/acme",
        url_verified=True,
        status="completed"
    )

    assert company.name == "Acme Inc"
    assert company.url_verified is True


def test_keywords_model():
    from app.models import KeywordsResponse

    keywords = KeywordsResponse(
        core_product=["CRM", "sales software"],
        category_language=["B2B SaaS"],
        industry_depth=["API-first"],
        pain_points=["reduce churn"],
        customer_segments=["enterprise"]
    )

    assert "CRM" in keywords.core_product
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_models.py -v
```

Expected: FAIL with "No module named 'app.models'"

**Step 3: Write implementation**

```python
# app/models.py
from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class JobResponse(BaseModel):
    id: str
    filename: str
    status: str
    total_companies: int
    processed_count: int
    created_at: datetime
    completed_at: Optional[datetime] = None


class CompanyResponse(BaseModel):
    id: str
    name: str
    website_url: str
    linkedin_url: Optional[str] = None
    url_verified: Optional[bool] = None
    status: str
    error_message: Optional[str] = None


class KeywordsResponse(BaseModel):
    core_product: list[str] = []
    category_language: list[str] = []
    industry_depth: list[str] = []
    pain_points: list[str] = []
    customer_segments: list[str] = []


class CompanyResultResponse(BaseModel):
    company: CompanyResponse
    about_text: Optional[str] = None
    keywords: Optional[KeywordsResponse] = None


class UploadResponse(BaseModel):
    job_id: str
    total_companies: int


class JobStatusResponse(BaseModel):
    status: str
    total: int
    processed: int
    failed_count: int
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_models.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/models.py tests/test_models.py
git commit -m "feat: add pydantic models for API responses"
```

---

## Task 5: CSV Parser Service

**Files:**
- Create: `app/services/csv_parser.py`
- Create: `tests/test_csv_parser.py`

**Step 1: Write the failing test**

```python
# tests/test_csv_parser.py
import pytest
import io


def test_parse_csv_valid():
    from app.services.csv_parser import parse_csv, CSVValidationError

    csv_content = b"company_name,website_url\nAcme Inc,https://acme.com\nFoo Corp,https://foo.io"
    file = io.BytesIO(csv_content)

    companies = parse_csv(file)

    assert len(companies) == 2
    assert companies[0]["company_name"] == "Acme Inc"
    assert companies[0]["website_url"] == "https://acme.com"


def test_parse_csv_missing_column():
    from app.services.csv_parser import parse_csv, CSVValidationError

    csv_content = b"company_name,email\nAcme Inc,test@acme.com"
    file = io.BytesIO(csv_content)

    with pytest.raises(CSVValidationError) as exc:
        parse_csv(file)

    assert "website_url" in str(exc.value)


def test_parse_csv_empty_file():
    from app.services.csv_parser import parse_csv, CSVValidationError

    csv_content = b""
    file = io.BytesIO(csv_content)

    with pytest.raises(CSVValidationError) as exc:
        parse_csv(file)

    assert "empty" in str(exc.value).lower()


def test_parse_csv_skips_empty_rows():
    from app.services.csv_parser import parse_csv

    csv_content = b"company_name,website_url\nAcme Inc,https://acme.com\n,\nFoo Corp,https://foo.io"
    file = io.BytesIO(csv_content)

    companies = parse_csv(file)

    assert len(companies) == 2
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_csv_parser.py -v
```

Expected: FAIL with "No module named 'app.services.csv_parser'"

**Step 3: Write implementation**

```python
# app/services/csv_parser.py
import csv
import io
from typing import BinaryIO


class CSVValidationError(Exception):
    pass


REQUIRED_COLUMNS = {"company_name", "website_url"}


def parse_csv(file: BinaryIO) -> list[dict]:
    content = file.read()
    if not content.strip():
        raise CSVValidationError("CSV file is empty")

    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise CSVValidationError("CSV file is empty")

    columns = set(reader.fieldnames)
    missing = REQUIRED_COLUMNS - columns
    if missing:
        raise CSVValidationError(f"Missing required columns: {', '.join(missing)}")

    companies = []
    for row in reader:
        name = row.get("company_name", "").strip()
        url = row.get("website_url", "").strip()
        if name and url:
            companies.append({
                "company_name": name,
                "website_url": url
            })

    if not companies:
        raise CSVValidationError("No valid company rows found in CSV")

    return companies
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_csv_parser.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/services/csv_parser.py tests/test_csv_parser.py
git commit -m "feat: add CSV parser with validation"
```

---

## Task 6: URL Verifier Service

**Files:**
- Create: `app/services/verifier.py`
- Create: `tests/test_verifier.py`

**Step 1: Write the failing test**

```python
# tests/test_verifier.py
import pytest


def test_extract_domain_simple():
    from app.services.verifier import extract_domain

    assert extract_domain("https://acme.com") == "acme.com"
    assert extract_domain("http://www.acme.com") == "acme.com"
    assert extract_domain("https://acme.com/about") == "acme.com"


def test_extract_domain_with_subdomain():
    from app.services.verifier import extract_domain

    assert extract_domain("https://blog.acme.com") == "blog.acme.com"
    assert extract_domain("https://www.blog.acme.com") == "blog.acme.com"


def test_verify_company_exact_match():
    from app.services.verifier import verify_company

    assert verify_company("https://acme.com", "https://acme.com") is True
    assert verify_company("https://www.acme.com", "http://acme.com/") is True


def test_verify_company_subdomain_match():
    from app.services.verifier import verify_company

    assert verify_company("https://blog.acme.com", "https://acme.com") is True
    assert verify_company("https://acme.com", "https://blog.acme.com") is True


def test_verify_company_no_match():
    from app.services.verifier import verify_company

    assert verify_company("https://acme.com", "https://different.com") is False
    assert verify_company("https://acme.com", "https://notacme.com") is False
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_verifier.py -v
```

Expected: FAIL with "No module named 'app.services.verifier'"

**Step 3: Write implementation**

```python
# app/services/verifier.py
from urllib.parse import urlparse


def extract_domain(url: str) -> str:
    if not url:
        return ""

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    if domain.startswith("www."):
        domain = domain[4:]

    return domain


def verify_company(csv_website: str, linkedin_website: str) -> bool:
    csv_domain = extract_domain(csv_website)
    linkedin_domain = extract_domain(linkedin_website)

    if not csv_domain or not linkedin_domain:
        return False

    if csv_domain == linkedin_domain:
        return True

    if csv_domain.endswith("." + linkedin_domain):
        return True
    if linkedin_domain.endswith("." + csv_domain):
        return True

    return False
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_verifier.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/services/verifier.py tests/test_verifier.py
git commit -m "feat: add URL verification service"
```

---

## Task 7: Company Search Service (Google)

**Files:**
- Create: `app/services/company_search.py`
- Create: `tests/test_company_search.py`

**Step 1: Write the failing test**

```python
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
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_company_search.py -v
```

Expected: FAIL with "No module named 'app.services.company_search'"

**Step 3: Write implementation**

```python
# app/services/company_search.py
import httpx
import re
from urllib.parse import quote_plus

GOOGLE_SEARCH_URL = "https://www.google.com/search"
LINKEDIN_COMPANY_PATTERN = re.compile(
    r'https?://(?:www\.)?linkedin\.com/company/[\w-]+/?'
)


async def search_linkedin_url(company_name: str) -> str | None:
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
        if url.startswith("https://www."):
            url = "https://" + url[12:]
        return url

    return None
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_company_search.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/services/company_search.py tests/test_company_search.py
git commit -m "feat: add Google search for LinkedIn company URLs"
```

---

## Task 8: LinkedIn MCP Client

**Files:**
- Create: `app/services/linkedin_client.py`
- Create: `tests/test_linkedin_client.py`

**Step 1: Write the failing test**

```python
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
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_linkedin_client.py -v
```

Expected: FAIL with "No module named 'app.services.linkedin_client'"

**Step 3: Write implementation**

```python
# app/services/linkedin_client.py
import httpx
from typing import Any


class LinkedInMCPClient:
    def __init__(self, server_url: str):
        self.server_url = server_url.rstrip("/")

    async def _call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.server_url}/mcp/tools/call",
                json={
                    "name": tool_name,
                    "arguments": arguments
                },
                timeout=60.0
            )
            response.raise_for_status()
            return response.json()

    async def get_company_profile(self, linkedin_url: str) -> dict[str, Any]:
        result = await self._call_tool(
            "get_company_profile",
            {"url": linkedin_url}
        )
        return {
            "name": result.get("name"),
            "description": result.get("description") or result.get("about"),
            "website": result.get("website"),
            "industry": result.get("industry"),
            "raw": result
        }

    async def close_session(self) -> None:
        try:
            await self._call_tool("close_session", {})
        except Exception:
            pass
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_linkedin_client.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/services/linkedin_client.py tests/test_linkedin_client.py
git commit -m "feat: add LinkedIn MCP client wrapper"
```

---

## Task 9: Keyword Extractor Service

**Files:**
- Create: `app/services/keyword_extractor.py`
- Create: `tests/test_keyword_extractor.py`

**Step 1: Write the failing test**

```python
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
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_keyword_extractor.py -v
```

Expected: FAIL with "No module named 'app.services.keyword_extractor'"

**Step 3: Write implementation**

```python
# app/services/keyword_extractor.py
import json
import anthropic
from typing import Any

EXTRACTION_PROMPT = """Analyze this company's About Us description and extract keywords.

Company: {company_name}
About Us: {about_text}

Extract keywords in these categories:

1. Core Product Terms - What they sell/build (e.g., "CRM software", "payment processing")
2. Category Language - Market category they operate in (e.g., "B2B SaaS", "fintech")
3. Industry Depth Words - Technical/industry-specific terms (e.g., "API-first", "SOC 2 compliant")
4. Pain Point Words - Problems they solve (e.g., "reduce churn", "automate workflows")
5. Customer Segment Mentions - Who they serve (e.g., "enterprise", "SMB", "healthcare providers")

Return JSON only, no other text:
{{
  "core_product": ["term1", "term2"],
  "category_language": ["term1", "term2"],
  "industry_depth": ["term1", "term2"],
  "pain_points": ["term1", "term2"],
  "customer_segments": ["term1", "term2"]
}}"""

MIN_DESCRIPTION_LENGTH = 20


async def extract_keywords(
    company_name: str,
    about_text: str,
    api_key: str
) -> dict[str, list[str]] | None:
    if not about_text or len(about_text.strip()) < MIN_DESCRIPTION_LENGTH:
        return None

    client = anthropic.AsyncAnthropic(api_key=api_key)

    prompt = EXTRACTION_PROMPT.format(
        company_name=company_name,
        about_text=about_text
    )

    response = await client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    text = response.content[0].text.strip()

    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]

    result = json.loads(text)

    return {
        "core_product": result.get("core_product", []),
        "category_language": result.get("category_language", []),
        "industry_depth": result.get("industry_depth", []),
        "pain_points": result.get("pain_points", []),
        "customer_segments": result.get("customer_segments", [])
    }
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_keyword_extractor.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/services/keyword_extractor.py tests/test_keyword_extractor.py
git commit -m "feat: add keyword extraction with Claude API"
```

---

## Task 10: Job Processor Service

**Files:**
- Create: `app/services/job_processor.py`
- Create: `tests/test_job_processor.py`

**Step 1: Write the failing test**

```python
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
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_job_processor.py -v
```

Expected: FAIL with "No module named 'app.services.job_processor'"

**Step 3: Write implementation**

```python
# app/services/job_processor.py
import asyncio
import uuid
import random
from datetime import datetime
from typing import Any

from app.database import get_db
from app.services.company_search import search_linkedin_url
from app.services.linkedin_client import LinkedInMCPClient
from app.services.verifier import verify_company
from app.services.keyword_extractor import extract_keywords


async def create_job(db_path: str, filename: str, companies: list[dict]) -> str:
    job_id = str(uuid.uuid4())

    async with get_db(db_path) as db:
        await db.execute(
            "INSERT INTO jobs (id, filename, status, total_companies) VALUES (?, ?, ?, ?)",
            (job_id, filename, "pending", len(companies))
        )

        for company in companies:
            company_id = str(uuid.uuid4())
            await db.execute(
                "INSERT INTO companies (id, job_id, name, website_url, status) VALUES (?, ?, ?, ?, ?)",
                (company_id, job_id, company["company_name"], company["website_url"], "pending")
            )

        await db.commit()

    return job_id


async def get_job_status(db_path: str, job_id: str) -> dict[str, Any]:
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT status, total_companies, processed_count FROM jobs WHERE id = ?",
            (job_id,)
        )
        row = await cursor.fetchone()

        if not row:
            return None

        cursor = await db.execute(
            "SELECT COUNT(*) FROM companies WHERE job_id = ? AND status = 'failed'",
            (job_id,)
        )
        failed_row = await cursor.fetchone()

        return {
            "status": row["status"],
            "total": row["total_companies"],
            "processed": row["processed_count"],
            "failed_count": failed_row[0]
        }


async def get_job(db_path: str, job_id: str) -> dict[str, Any] | None:
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT * FROM jobs WHERE id = ?",
            (job_id,)
        )
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None


async def get_job_companies(db_path: str, job_id: str) -> list[dict]:
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT * FROM companies WHERE job_id = ? ORDER BY created_at",
            (job_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_job_results(db_path: str, job_id: str) -> list[dict]:
    async with get_db(db_path) as db:
        cursor = await db.execute("""
            SELECT c.*, a.raw_text as about_text
            FROM companies c
            LEFT JOIN about_descriptions a ON c.id = a.company_id
            WHERE c.job_id = ?
            ORDER BY c.created_at
        """, (job_id,))
        companies = await cursor.fetchall()

        results = []
        for company in companies:
            company_dict = dict(company)

            cursor = await db.execute(
                "SELECT category, keyword FROM keywords WHERE company_id = ?",
                (company_dict["id"],)
            )
            keyword_rows = await cursor.fetchall()

            keywords = {
                "core_product": [],
                "category_language": [],
                "industry_depth": [],
                "pain_points": [],
                "customer_segments": []
            }
            for kw in keyword_rows:
                cat = kw["category"]
                if cat in keywords:
                    keywords[cat].append(kw["keyword"])

            results.append({
                "company": company_dict,
                "about_text": company_dict.get("about_text"),
                "keywords": keywords
            })

        return results


async def process_job(
    db_path: str,
    job_id: str,
    mcp_server_url: str,
    anthropic_api_key: str
) -> None:
    async with get_db(db_path) as db:
        await db.execute(
            "UPDATE jobs SET status = 'processing' WHERE id = ?",
            (job_id,)
        )
        await db.commit()

    linkedin_client = LinkedInMCPClient(mcp_server_url)

    try:
        companies = await get_job_companies(db_path, job_id)

        for company in companies:
            await process_company(
                db_path,
                job_id,
                company,
                linkedin_client,
                anthropic_api_key
            )

            delay = random.uniform(5, 15)
            await asyncio.sleep(delay)

        async with get_db(db_path) as db:
            await db.execute(
                "UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?",
                (datetime.now().isoformat(), job_id)
            )
            await db.commit()

    except Exception as e:
        async with get_db(db_path) as db:
            await db.execute(
                "UPDATE jobs SET status = 'failed' WHERE id = ?",
                (job_id,)
            )
            await db.commit()
        raise

    finally:
        await linkedin_client.close_session()


async def process_company(
    db_path: str,
    job_id: str,
    company: dict,
    linkedin_client: LinkedInMCPClient,
    anthropic_api_key: str
) -> None:
    company_id = company["id"]

    async with get_db(db_path) as db:
        await db.execute(
            "UPDATE companies SET status = 'processing' WHERE id = ?",
            (company_id,)
        )
        await db.commit()

    try:
        linkedin_url = await search_linkedin_url(company["name"])

        if not linkedin_url:
            await mark_company_failed(db_path, job_id, company_id, "LinkedIn profile not found")
            return

        profile = await linkedin_client.get_company_profile(linkedin_url)

        linkedin_website = profile.get("website")
        url_verified = verify_company(company["website_url"], linkedin_website) if linkedin_website else False

        about_text = profile.get("description") or ""

        async with get_db(db_path) as db:
            await db.execute(
                "UPDATE companies SET linkedin_url = ?, url_verified = ? WHERE id = ?",
                (linkedin_url, url_verified, company_id)
            )

            if about_text:
                about_id = str(uuid.uuid4())
                await db.execute(
                    "INSERT INTO about_descriptions (id, company_id, raw_text) VALUES (?, ?, ?)",
                    (about_id, company_id, about_text)
                )

            await db.commit()

        if about_text:
            keywords = await extract_keywords(company["name"], about_text, anthropic_api_key)

            if keywords:
                async with get_db(db_path) as db:
                    for category, terms in keywords.items():
                        for term in terms:
                            kw_id = str(uuid.uuid4())
                            await db.execute(
                                "INSERT INTO keywords (id, company_id, category, keyword) VALUES (?, ?, ?, ?)",
                                (kw_id, company_id, category, term)
                            )
                    await db.commit()

        status = "completed" if url_verified else "unverified"
        await mark_company_done(db_path, job_id, company_id, status)

    except Exception as e:
        await mark_company_failed(db_path, job_id, company_id, str(e))


async def mark_company_done(db_path: str, job_id: str, company_id: str, status: str) -> None:
    async with get_db(db_path) as db:
        await db.execute(
            "UPDATE companies SET status = ? WHERE id = ?",
            (status, company_id)
        )
        await db.execute(
            "UPDATE jobs SET processed_count = processed_count + 1 WHERE id = ?",
            (job_id,)
        )
        await db.commit()


async def mark_company_failed(db_path: str, job_id: str, company_id: str, error: str) -> None:
    async with get_db(db_path) as db:
        await db.execute(
            "UPDATE companies SET status = 'failed', error_message = ? WHERE id = ?",
            (error, company_id)
        )
        await db.execute(
            "UPDATE jobs SET processed_count = processed_count + 1 WHERE id = ?",
            (job_id,)
        )
        await db.commit()
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_job_processor.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/services/job_processor.py tests/test_job_processor.py
git commit -m "feat: add job processor with full pipeline"
```

---

## Task 11: FastAPI Application and Routes

**Files:**
- Create: `app/main.py`
- Create: `tests/test_main.py`

**Step 1: Write the failing test**

```python
# tests/test_main.py
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock
import io


@pytest.fixture
def test_db_path(tmp_path):
    return str(tmp_path / "test.db")


@pytest.fixture
async def app(test_db_path):
    with patch("app.main.settings") as mock_settings:
        mock_settings.database_path = test_db_path
        mock_settings.anthropic_api_key = "test-key"
        mock_settings.mcp_server_url = "http://localhost:3000"

        from app.main import app, lifespan
        from app.database import init_db

        await init_db(test_db_path)
        yield app


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
```

**Step 2: Run test to verify it fails**

```bash
pytest tests/test_main.py -v
```

Expected: FAIL with "No module named 'app.main'"

**Step 3: Write implementation**

```python
# app/main.py
import asyncio
import csv
import io
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse

from app.config import settings
from app.database import init_db, get_db
from app.models import UploadResponse, JobStatusResponse, JobResponse, CompanyResponse
from app.services.csv_parser import parse_csv, CSVValidationError
from app.services.job_processor import (
    create_job,
    get_job_status,
    get_job,
    get_job_companies,
    get_job_results,
    process_job
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db(settings.database_path)
    yield


app = FastAPI(title="Lead Enrichment API", lifespan=lifespan)


@app.post("/api/jobs/upload", response_model=UploadResponse)
async def upload_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    try:
        companies = parse_csv(file.file)
    except CSVValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    job_id = await create_job(settings.database_path, file.filename, companies)

    background_tasks.add_task(
        process_job,
        settings.database_path,
        job_id,
        settings.mcp_server_url,
        settings.anthropic_api_key
    )

    return UploadResponse(job_id=job_id, total_companies=len(companies))


@app.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status_endpoint(job_id: str):
    status = await get_job_status(settings.database_path, job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusResponse(**status)


@app.get("/api/jobs/{job_id}/companies")
async def get_job_companies_endpoint(job_id: str):
    job = await get_job(settings.database_path, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    companies = await get_job_companies(settings.database_path, job_id)
    return {"companies": companies}


@app.get("/api/jobs/{job_id}/results")
async def get_job_results_endpoint(job_id: str):
    job = await get_job(settings.database_path, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    results = await get_job_results(settings.database_path, job_id)
    return {"results": results}


@app.get("/api/jobs/{job_id}/export")
async def export_job_results(job_id: str):
    job = await get_job(settings.database_path, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    results = await get_job_results(settings.database_path, job_id)

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow([
        "company_name", "website_url", "linkedin_url", "url_verified", "status",
        "about_text", "core_product", "category_language", "industry_depth",
        "pain_points", "customer_segments"
    ])

    for result in results:
        company = result["company"]
        keywords = result.get("keywords", {})
        writer.writerow([
            company.get("name", ""),
            company.get("website_url", ""),
            company.get("linkedin_url", ""),
            company.get("url_verified", ""),
            company.get("status", ""),
            result.get("about_text", ""),
            "; ".join(keywords.get("core_product", [])),
            "; ".join(keywords.get("category_language", [])),
            "; ".join(keywords.get("industry_depth", [])),
            "; ".join(keywords.get("pain_points", [])),
            "; ".join(keywords.get("customer_segments", []))
        ])

    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=enriched_{job_id}.csv"}
    )


@app.get("/api/jobs")
async def list_jobs():
    async with get_db(settings.database_path) as db:
        cursor = await db.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50"
        )
        rows = await cursor.fetchall()
        return {"jobs": [dict(row) for row in rows]}


app.mount("/", StaticFiles(directory="app/static", html=True), name="static")
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/test_main.py -v
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/main.py tests/test_main.py
git commit -m "feat: add FastAPI routes for job management"
```

---

## Task 12: Web UI

**Files:**
- Create: `app/static/index.html`

**Step 1: Create the HTML file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Lead Enrichment</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="container mx-auto px-4 py-8 max-w-6xl">
        <h1 class="text-3xl font-bold text-gray-800 mb-8">Lead Enrichment</h1>

        <!-- Upload Section -->
        <div class="bg-white rounded-lg shadow p-6 mb-8">
            <h2 class="text-xl font-semibold mb-4">Upload CSV</h2>
            <p class="text-gray-600 mb-4">CSV must have columns: <code class="bg-gray-100 px-2 py-1 rounded">company_name</code> and <code class="bg-gray-100 px-2 py-1 rounded">website_url</code></p>

            <div id="dropzone" class="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition-colors">
                <input type="file" id="fileInput" accept=".csv" class="hidden">
                <p class="text-gray-500">Drag & drop a CSV file here, or click to select</p>
            </div>

            <div id="uploadError" class="mt-4 text-red-600 hidden"></div>
            <div id="uploadSuccess" class="mt-4 text-green-600 hidden"></div>
        </div>

        <!-- Jobs List -->
        <div class="bg-white rounded-lg shadow p-6 mb-8">
            <h2 class="text-xl font-semibold mb-4">Recent Jobs</h2>
            <div id="jobsList" class="space-y-2">
                <p class="text-gray-500">Loading...</p>
            </div>
        </div>

        <!-- Job Detail -->
        <div id="jobDetail" class="bg-white rounded-lg shadow p-6 hidden">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">Job Details</h2>
                <button id="exportBtn" class="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 hidden">
                    Export CSV
                </button>
            </div>

            <!-- Progress -->
            <div id="progressSection" class="mb-6">
                <div class="flex justify-between text-sm text-gray-600 mb-1">
                    <span id="progressText">0 / 0 companies</span>
                    <span id="statusBadge" class="px-2 py-1 rounded text-xs font-medium"></span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                    <div id="progressBar" class="bg-blue-500 h-2 rounded-full transition-all" style="width: 0%"></div>
                </div>
            </div>

            <!-- Results Table -->
            <div class="overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-4 py-2 text-left">Company</th>
                            <th class="px-4 py-2 text-left">Status</th>
                            <th class="px-4 py-2 text-left">Verified</th>
                            <th class="px-4 py-2 text-left">Keywords</th>
                        </tr>
                    </thead>
                    <tbody id="resultsBody"></tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        let currentJobId = null;
        let pollInterval = null;

        // File upload handling
        const dropzone = document.getElementById('dropzone');
        const fileInput = document.getElementById('fileInput');

        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.classList.add('border-blue-500', 'bg-blue-50');
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.classList.remove('border-blue-500', 'bg-blue-50');
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('border-blue-500', 'bg-blue-50');
            if (e.dataTransfer.files.length) {
                uploadFile(e.dataTransfer.files[0]);
            }
        });
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length) {
                uploadFile(fileInput.files[0]);
            }
        });

        async function uploadFile(file) {
            const errorEl = document.getElementById('uploadError');
            const successEl = document.getElementById('uploadSuccess');
            errorEl.classList.add('hidden');
            successEl.classList.add('hidden');

            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch('/api/jobs/upload', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.detail || 'Upload failed');
                }

                const data = await response.json();
                successEl.textContent = `Uploaded! Job ID: ${data.job_id} (${data.total_companies} companies)`;
                successEl.classList.remove('hidden');

                loadJobs();
                selectJob(data.job_id);
            } catch (err) {
                errorEl.textContent = err.message;
                errorEl.classList.remove('hidden');
            }
        }

        async function loadJobs() {
            const response = await fetch('/api/jobs');
            const data = await response.json();

            const container = document.getElementById('jobsList');
            if (data.jobs.length === 0) {
                container.innerHTML = '<p class="text-gray-500">No jobs yet</p>';
                return;
            }

            container.innerHTML = data.jobs.map(job => `
                <div class="flex justify-between items-center p-3 bg-gray-50 rounded cursor-pointer hover:bg-gray-100"
                     onclick="selectJob('${job.id}')">
                    <div>
                        <span class="font-medium">${job.filename || 'Unknown'}</span>
                        <span class="text-gray-500 text-sm ml-2">${job.total_companies} companies</span>
                    </div>
                    <span class="px-2 py-1 rounded text-xs font-medium ${getStatusClass(job.status)}">
                        ${job.status}
                    </span>
                </div>
            `).join('');
        }

        function getStatusClass(status) {
            switch (status) {
                case 'completed': return 'bg-green-100 text-green-800';
                case 'processing': return 'bg-blue-100 text-blue-800';
                case 'failed': return 'bg-red-100 text-red-800';
                default: return 'bg-gray-100 text-gray-800';
            }
        }

        async function selectJob(jobId) {
            currentJobId = jobId;
            document.getElementById('jobDetail').classList.remove('hidden');

            if (pollInterval) clearInterval(pollInterval);

            await updateJobDetail();
            pollInterval = setInterval(updateJobDetail, 2000);
        }

        async function updateJobDetail() {
            if (!currentJobId) return;

            const [statusRes, resultsRes] = await Promise.all([
                fetch(`/api/jobs/${currentJobId}`),
                fetch(`/api/jobs/${currentJobId}/results`)
            ]);

            const status = await statusRes.json();
            const results = await resultsRes.json();

            // Update progress
            const percent = status.total > 0 ? (status.processed / status.total * 100) : 0;
            document.getElementById('progressBar').style.width = `${percent}%`;
            document.getElementById('progressText').textContent = `${status.processed} / ${status.total} companies`;

            const badge = document.getElementById('statusBadge');
            badge.textContent = status.status;
            badge.className = `px-2 py-1 rounded text-xs font-medium ${getStatusClass(status.status)}`;

            // Show export button when completed
            const exportBtn = document.getElementById('exportBtn');
            if (status.status === 'completed') {
                exportBtn.classList.remove('hidden');
                exportBtn.onclick = () => window.location.href = `/api/jobs/${currentJobId}/export`;
                clearInterval(pollInterval);
            }

            // Update results table
            const tbody = document.getElementById('resultsBody');
            tbody.innerHTML = results.results.map(r => {
                const c = r.company;
                const kw = r.keywords || {};
                const allKeywords = [
                    ...kw.core_product || [],
                    ...kw.category_language || [],
                    ...kw.customer_segments || []
                ].slice(0, 5);

                return `
                    <tr class="border-t">
                        <td class="px-4 py-2">
                            <div class="font-medium">${c.name}</div>
                            <div class="text-gray-500 text-xs">${c.website_url}</div>
                        </td>
                        <td class="px-4 py-2">
                            <span class="px-2 py-1 rounded text-xs ${getStatusClass(c.status)}">${c.status}</span>
                        </td>
                        <td class="px-4 py-2">
                            ${c.url_verified === true ? '✓' : c.url_verified === false ? '✗' : '-'}
                        </td>
                        <td class="px-4 py-2 text-xs">
                            ${allKeywords.map(k => `<span class="bg-gray-100 px-1 rounded mr-1">${k}</span>`).join('')}
                        </td>
                    </tr>
                `;
            }).join('');
        }

        // Initial load
        loadJobs();
    </script>
</body>
</html>
```

**Step 2: Test manually**

```bash
uvicorn app.main:app --reload
```

Open http://localhost:8000 and verify the UI loads.

**Step 3: Commit**

```bash
git add app/static/index.html
git commit -m "feat: add web UI for job management"
```

---

## Task 13: Docker Compose Setup

**Files:**
- Create: `docker-compose.yml`
- Create: `Dockerfile`

**Step 1: Create Dockerfile**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Step 2: Create docker-compose.yml**

```yaml
services:
  linkedin-mcp:
    image: ghcr.io/stickerdaniel/linkedin-mcp-server:latest
    environment:
      - LI_AT=${LINKEDIN_LI_AT}
    ports:
      - "3000:3000"

  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - LINKEDIN_LI_AT=${LINKEDIN_LI_AT}
      - MCP_SERVER_URL=http://linkedin-mcp:3000
      - DATABASE_PATH=/data/sidcrm.db
    volumes:
      - ./data:/data
    depends_on:
      - linkedin-mcp
```

**Step 3: Create .env file (from .env.example)**

```bash
cp .env.example .env
# Edit .env with your actual values
```

**Step 4: Test docker compose**

```bash
docker compose up --build
```

**Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: add Docker setup for deployment"
```

---

## Task 14: Final Integration Test

**Step 1: Create sample CSV**

Create `sample.csv`:
```csv
company_name,website_url
Anthropic,https://anthropic.com
OpenAI,https://openai.com
```

**Step 2: Run the application**

```bash
# Option 1: Local dev
uvicorn app.main:app --reload

# Option 2: Docker
docker compose up
```

**Step 3: Test the full flow**

1. Open http://localhost:8000
2. Upload sample.csv
3. Watch progress update
4. Verify companies are enriched with keywords
5. Export results

**Step 4: Final commit**

```bash
git add sample.csv
git commit -m "feat: add sample CSV for testing"
git tag v1.0.0
```

---

## Summary

Total tasks: 14
- Project setup and configuration
- Database layer
- CSV parsing
- URL verification
- Company search (Google)
- LinkedIn MCP client
- Keyword extraction (Claude)
- Job processor orchestration
- FastAPI routes
- Web UI
- Docker deployment
- Integration testing

Run all tests:
```bash
pytest tests/ -v
```
