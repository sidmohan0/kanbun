# Lead Enrichment Application Design

## Overview

Application to upload CSV of leads, scrape LinkedIn for company "About Us" descriptions, verify company identity via URL matching, and extract keywords using Claude.

## Requirements

- **Tech Stack:** Python + FastAPI
- **Data Source:** LinkedIn via MCP server (github.com/stickerdaniel/linkedin-mcp-server)
- **CSV Format:** Company name + website URL
- **Verification:** Match LinkedIn company website to CSV website
- **LLM:** Claude API for keyword extraction
- **Storage:** SQLite
- **Interface:** REST API + simple web UI
- **Rate Limiting:** Simple delays (5-15 seconds) between MCP calls
- **Batch Size:** 50-500 companies (background processing)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Web UI (HTML/JS)                     │
│              Upload CSV, View Progress, Export          │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                  FastAPI Application                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Upload API  │  │ Status API  │  │  Results API    │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│              Background Job Processor                    │
│  ┌───────────────┐ ┌─────────────┐ ┌─────────────────┐  │
│  │ MCP Client    │ │  Verifier   │ │    Keyword      │  │
│  │ (LinkedIn)    │ │             │ │   Extractor     │  │
│  └───────┬───────┘ └─────────────┘ └─────────────────┘  │
└──────────│──────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────┐
│           LinkedIn MCP Server (Docker)                   │
│  github.com/stickerdaniel/linkedin-mcp-server           │
│  Tools: get_company_profile, get_person_profile, etc.   │
└─────────────────────────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                SQLite Database                           │
│  Jobs │ Companies │ About Descriptions │ Keywords       │
└─────────────────────────────────────────────────────────┘
```

## Database Schema

```sql
-- Track batch upload jobs
jobs (
    id              TEXT PRIMARY KEY,    -- UUID
    filename        TEXT,                -- Original CSV filename
    status          TEXT,                -- pending, processing, completed, failed
    total_companies INTEGER,
    processed_count INTEGER DEFAULT 0,
    created_at      TIMESTAMP,
    completed_at    TIMESTAMP
)

-- Individual companies from CSV
companies (
    id              TEXT PRIMARY KEY,    -- UUID
    job_id          TEXT,                -- FK to jobs
    name            TEXT,                -- From CSV
    website_url     TEXT,                -- From CSV
    linkedin_url    TEXT,                -- Found via search
    url_verified    BOOLEAN,             -- LinkedIn website matches CSV
    status          TEXT,                -- pending, processing, completed, failed, unverified
    error_message   TEXT,                -- If failed, why
    created_at      TIMESTAMP
)

-- Scraped About Us content
about_descriptions (
    id              TEXT PRIMARY KEY,
    company_id      TEXT,                -- FK to companies
    raw_text        TEXT,                -- Full About Us text
    scraped_at      TIMESTAMP
)

-- LLM-extracted keywords
keywords (
    id              TEXT PRIMARY KEY,
    company_id      TEXT,                -- FK to companies
    category        TEXT,                -- core_product, category_language, industry_depth, pain_point, customer_segment
    keyword         TEXT,
    created_at      TIMESTAMP
)
```

## LinkedIn Data via MCP Server

### MCP Server Setup
The LinkedIn MCP Server (github.com/stickerdaniel/linkedin-mcp-server) runs in Docker and provides:
- `get_company_profile` - Extract company info including About Us, website, industry
- `get_person_profile` - Profile scraping (not needed for this use case)
- `search_jobs` - Job search (not needed)
- `close_session` - Browser session cleanup

### Authentication
Requires LinkedIn `li_at` session cookie:
1. Log into LinkedIn in browser
2. Open DevTools → Application → Cookies
3. Copy `li_at` cookie value
4. Set as environment variable or in .env

### Company Lookup Strategy
1. Google search for `"{company name}" site:linkedin.com/company` to get LinkedIn URL
2. Call MCP `get_company_profile` with the LinkedIn URL
3. Extract website URL and About Us description from response

### Verification Logic
```python
def verify_company(csv_website: str, linkedin_website: str) -> bool:
    # Normalize both URLs (remove www, https, trailing slashes)
    csv_domain = extract_domain(csv_website)
    linkedin_domain = extract_domain(linkedin_website)

    # Exact match
    if csv_domain == linkedin_domain:
        return True

    # Subdomain match (blog.acme.com vs acme.com)
    if csv_domain.endswith(linkedin_domain) or linkedin_domain.endswith(csv_domain):
        return True

    return False
```

### Rate Limiting
- Random delay 5-15 seconds between MCP calls
- The MCP server handles browser automation internally
- If blocked, mark remaining companies as "rate_limited"

## Keyword Extraction

### Prompt
```
Analyze this company's About Us description and extract keywords.

Company: {company_name}
About Us: {about_text}

Extract keywords in these categories:

1. Core Product Terms - What they sell/build
2. Category Language - Market category they operate in
3. Industry Depth Words - Technical/industry-specific terms
4. Pain Point Words - Problems they solve
5. Customer Segment Mentions - Who they serve

Return JSON only:
{
  "core_product": ["term1", "term2"],
  "category_language": ["term1", "term2"],
  "industry_depth": ["term1", "term2"],
  "pain_points": ["term1", "term2"],
  "customer_segments": ["term1", "term2"]
}
```

### Processing
- Use Claude claude-3-5-sonnet for cost efficiency
- Parse JSON response, store each keyword with its category
- Mark company as "insufficient_data" if About Us is empty/too short

## API Endpoints

```
POST /api/jobs/upload
  - Accepts CSV file upload
  - Validates CSV has required columns (company_name, website_url)
  - Creates job, queues for processing
  - Returns: { job_id, total_companies }

GET /api/jobs/{job_id}
  - Returns job status, progress count, any errors
  - Returns: { status, total, processed, failed_count }

GET /api/jobs/{job_id}/companies
  - Returns list of companies with their status and verification result
  - Supports pagination

GET /api/jobs/{job_id}/results
  - Returns enriched data: companies + about descriptions + keywords
  - Returns: [{ company, verified, about_text, keywords }]

GET /api/jobs/{job_id}/export
  - Downloads enriched CSV with all extracted data
```

## Web UI

Single page with:
- Upload section: drag-drop CSV, validation errors
- Jobs list: recent jobs with status badges
- Job detail view: progress bar, company list with status icons
- Results view: table with company, verification status, keywords
- Export button: download enriched CSV

Tech: HTML + vanilla JS + Tailwind CSS via CDN

## Project Structure

```
sidcrm/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI app, routes
│   ├── config.py            # Settings, API keys
│   ├── database.py          # SQLite connection, schema init
│   ├── models.py            # Pydantic models for API
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── csv_parser.py    # CSV validation and parsing
│   │   ├── linkedin_client.py   # MCP client for LinkedIn server
│   │   ├── company_search.py    # Google search for LinkedIn URLs
│   │   ├── verifier.py      # URL matching logic
│   │   ├── keyword_extractor.py  # Claude API integration
│   │   └── job_processor.py # Background job orchestration
│   │
│   └── static/
│       └── index.html       # Single-page web UI
│
├── data/
│   └── sidcrm.db            # SQLite database file
│
├── docker-compose.yml       # LinkedIn MCP server + app
├── requirements.txt
├── .env                     # ANTHROPIC_API_KEY, LINKEDIN_LI_AT
└── README.md
```

## Dependencies

- fastapi + uvicorn
- python-multipart
- aiosqlite
- httpx
- beautifulsoup4
- anthropic
- pydantic-settings
- mcp                        # MCP client library

## Docker Setup

```yaml
# docker-compose.yml
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
      - MCP_SERVER_URL=http://linkedin-mcp:3000
    depends_on:
      - linkedin-mcp
```
