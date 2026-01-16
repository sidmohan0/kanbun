# kanbun

A lightweight lead enrichment and personal CRM tool with Kanban pipeline management. Upload a CSV of companies/contacts, enrich with AI-powered website analysis and screenshots, then track your outreach through a drag-and-drop pipeline.

![kanbun screenshot](docs/screenshot.png)

## Features

### Lead Enrichment
- **CSV Import**: Upload company/contact lists from Apollo, LinkedIn exports, or custom CSVs with flexible column matching
- **Website Scraping**: Automatic website content extraction using Playwright Firefox (meta tags, headings, paragraphs)
- **AI-Powered Summaries**: Claude generates 2-3 sentence company descriptions from scraped content
- **Keyword Extraction**: Claude extracts structured keywords in 5 categories:
  - Core Product (what they sell/build)
  - Category Language (market positioning)
  - Industry Depth (technical terms)
  - Pain Points (problems they solve)
  - Customer Segments (who they serve)
- **Screenshot Capture**: Automatic homepage screenshots (1280x800px)
- **Bulk Operations**: Retry failed companies, regenerate screenshots in bulk

### CRM Pipeline
- **9-Stage Kanban Board**: Drag-and-drop contacts through customizable stages:
  - `backlog` → `contacted` → `reaching_out` → `engaged` → `meeting` → `won` / `lost` / `naf`
- **Personal Contacts**: Separate workflow for personal relationships (family, friend, acquaintance)
- **Activity Timeline**: Unified view of all contact interactions:
  - Notes and comments
  - Outreach logs (email, LinkedIn, call, other)
  - Reminders with completion tracking
  - Stage change history
- **Company Notes**: Add notes at the company level, visible to all contacts at that company
- **Global Search**: Search across contacts and companies instantly

### Outreach & Communication
- **Outreach Logging**: Track emails, LinkedIn messages, calls, and other touchpoints
- **Reminders**: Set follow-up reminders with due dates, view upcoming reminders dashboard
- **Email Templates**: Create and organize reusable email templates by category
- **Direct Email Sending**: Send emails via Gmail or Outlook OAuth without leaving the app
- **Email History**: Automatically fetch and display email history with contacts from connected accounts

## Quick Start

### Prerequisites

- Python 3.11+
- [Anthropic API key](https://console.anthropic.com/) (required for AI enrichment)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/sidmohan0/kanbun.git
   cd kanbun
   ```

2. Create a virtual environment and install dependencies:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. Install Playwright browser:
   ```bash
   playwright install firefox
   ```

4. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

5. Run the application:
   ```bash
   uvicorn app.main:app --reload
   ```

6. Open http://localhost:8000 in your browser

### Docker Setup

Alternatively, use Docker Compose:

```bash
# Set your API keys
export ANTHROPIC_API_KEY=your-key

# Run
docker compose up --build
```

## Usage

### Basic Workflow

1. **Import Contacts**: On the Home tab, upload a CSV file. Use `sample-data.csv` to test.
2. **Enrich Companies**: Jobs run automatically to scrape websites, generate AI summaries, and capture screenshots.
3. **Manage Pipeline**: Go to the Pipeline tab to see contacts in a Kanban board. Drag cards between columns.
4. **Track Outreach**: Click a contact to open details. Log emails/LinkedIn messages, add notes and reminders.
5. **View Timeline**: See all activity history for a contact in chronological order.

### Job Management

- **Cancel Jobs**: Stop in-progress enrichment jobs
- **Restart Jobs**: Re-run processing for a job
- **Retry Failed**: Retry only the companies that failed during enrichment
- **Export Results**: Download enriched data as CSV with all extracted fields and keywords

### Personal Contacts

Create contacts outside of company imports for personal relationship tracking:
- Add contacts with relationship type (family, friend, acquaintance)
- Personal contacts use a separate "personal" stage
- Full CRM features available (notes, reminders, timeline)

## Email Integration (Optional)

Kanbun can send emails directly via Gmail or Outlook using OAuth, and fetch email history with your contacts.

### Quick Setup

1. Generate an encryption key:
   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

2. Add to your `.env`:
   ```bash
   EMAIL_ENCRYPTION_KEY=your-generated-key
   ```

3. Follow the provider-specific setup below.

### Gmail Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the Gmail API:
   - APIs & Services → Library → Search "Gmail API" → Enable
4. Create OAuth credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:8000/api/email/callback/gmail`
5. Add to `.env`:
   ```bash
   GMAIL_CLIENT_ID=your-client-id
   GMAIL_CLIENT_SECRET=your-client-secret
   ```

### Outlook Setup

1. Go to [Azure Portal](https://portal.azure.com/) → App registrations
2. New registration:
   - Name: "Kanbun" (or any name)
   - Supported account types: Personal Microsoft accounts only (or your preference)
   - Redirect URI: Web → `http://localhost:8000/api/email/callback/outlook`
3. Add client secret:
   - Certificates & secrets → New client secret
4. Add API permissions:
   - API permissions → Add permission → Microsoft Graph → Delegated permissions
   - Add: `Mail.Send`, `Mail.Read`, `User.Read`
5. Add to `.env`:
   ```bash
   OUTLOOK_CLIENT_ID=your-application-client-id
   OUTLOOK_CLIENT_SECRET=your-client-secret-value
   ```

### Using Email

1. Click "Connect" next to "Email:" in the header
2. Choose Gmail or Outlook and authorize Kanbun
3. Open any contact to see email history and compose new emails
4. Create email templates for quick, consistent outreach

## CSV Format

Required columns (flexible matching):
- `company_name` (or `company name`, `companyname`, `company`)
- `website` (or `website_url`, `url`, `company website`, `site`)

Optional columns:
- `company linkedin url`
- `first_name`, `last_name`, `email`, `phone`, `title`
- `person linkedin url`

The importer automatically:
- Deduplicates companies by name
- Skips companies already in the database (configurable)
- Preserves contact-to-company relationships

## API Endpoints

### Jobs
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jobs/upload` | POST | Upload CSV and start enrichment |
| `/api/jobs` | GET | List all jobs |
| `/api/jobs/{id}` | GET | Get job status |
| `/api/jobs/{id}` | DELETE | Cancel job |
| `/api/jobs/{id}/restart` | POST | Restart job |
| `/api/jobs/{id}/retry-failed` | POST | Retry failed companies |
| `/api/jobs/{id}/export` | GET | Export results as CSV |

### Contacts
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/contacts` | POST | Create contact |
| `/api/contacts/{id}/full` | GET | Get full contact details |
| `/api/contacts/{id}` | PATCH | Update contact fields |
| `/api/contacts/{id}/stage` | PUT | Update pipeline stage |
| `/api/contacts/{id}/timeline` | GET | Get activity timeline |
| `/api/contacts/{id}/notes` | POST | Add note |
| `/api/contacts/{id}/outreach` | POST | Log outreach |
| `/api/contacts/{id}/reminders` | GET/POST | Manage reminders |
| `/api/database/contacts` | GET | List contacts with search |

### Companies
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/companies/{id}/full` | GET | Get full company details |
| `/api/companies/{id}/contacts` | GET | Get company contacts |
| `/api/companies/{id}/notes` | GET/POST | Manage company notes |
| `/api/screenshots/{id}` | GET | Get company screenshot |
| `/api/screenshots/{id}/regenerate` | POST | Regenerate screenshot |
| `/api/database/companies` | GET | List companies |

### Pipeline & CRM
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pipeline` | GET | Get contacts by stage |
| `/api/reminders/upcoming` | GET | Get upcoming reminders |
| `/api/templates` | GET/POST | Manage email templates |
| `/api/search` | GET | Global search |

### Email
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/email/auth/{provider}` | GET | Start OAuth flow |
| `/api/email/status` | GET | Get connected accounts |
| `/api/email/send` | POST | Send email |
| `/api/email/history/{email}` | GET | Get email history |

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `DATABASE_PATH` | No | Database path (default: `data/kanbun.db`) |
| `SCREENSHOTS_DIR` | No | Screenshot directory (default: `data/screenshots`) |
| `EMAIL_ENCRYPTION_KEY` | For email | Fernet key for OAuth token encryption |
| `GMAIL_CLIENT_ID` | For Gmail | Google OAuth client ID |
| `GMAIL_CLIENT_SECRET` | For Gmail | Google OAuth client secret |
| `OUTLOOK_CLIENT_ID` | For Outlook | Azure app client ID |
| `OUTLOOK_CLIENT_SECRET` | For Outlook | Azure app client secret |

## Tech Stack

- **Backend**: FastAPI, Python 3.11+, aiosqlite (async SQLite)
- **Frontend**: Vanilla JavaScript, Tailwind CSS
- **AI**: Claude API (Haiku for summaries, Sonnet for keyword extraction)
- **Web Scraping**: Playwright (Firefox headless)
- **Email**: Gmail API (google-auth), Microsoft Graph API (MSAL)
- **Security**: Fernet encryption for OAuth tokens

## Project Structure

```
kanbun/
├── app/
│   ├── main.py              # FastAPI routes (50+ endpoints)
│   ├── config.py            # Settings/environment
│   ├── database.py          # SQLite schema (12 tables)
│   ├── models.py            # Pydantic models
│   ├── services/
│   │   ├── csv_parser.py    # Flexible CSV import
│   │   ├── job_processor.py # Background enrichment
│   │   ├── screenshot_service.py  # Playwright scraping
│   │   ├── keyword_extractor.py   # Claude keyword extraction
│   │   └── email/           # Gmail & Outlook providers
│   └── static/
│       └── index.html       # Single-page frontend
├── data/                    # SQLite DB, screenshots (gitignored)
├── tests/                   # Test suite
├── sample-data.csv          # Demo data for testing
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

## License

MIT
