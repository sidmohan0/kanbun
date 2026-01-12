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
    -- Enriched data from Firecrawl
    meta_title TEXT,
    meta_description TEXT,
    og_image_url TEXT,
    company_description TEXT,
    mission_statement TEXT,
    founded_year TEXT,
    headquarters TEXT,
    company_size TEXT,
    industry TEXT,
    pricing_model TEXT,
    social_links TEXT,  -- JSON: {"twitter": "...", "linkedin": "...", etc}
    technologies TEXT,  -- JSON array
    products_services TEXT,
    target_customers TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    job_id TEXT,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    title TEXT,
    linkedin_url TEXT,
    stage TEXT DEFAULT 'new',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id),
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

CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    due_date TEXT NOT NULL,
    note TEXT,
    completed BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

CREATE TABLE IF NOT EXISTS outreach_log (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL,
    outreach_type TEXT NOT NULL,
    note TEXT,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

CREATE INDEX IF NOT EXISTS idx_companies_job_id ON companies(job_id);
CREATE INDEX IF NOT EXISTS idx_keywords_company_id ON keywords(company_id);
CREATE INDEX IF NOT EXISTS idx_about_company_id ON about_descriptions(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_job_id ON contacts(job_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(stage);
CREATE INDEX IF NOT EXISTS idx_reminders_contact_id ON reminders(contact_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due_date ON reminders(due_date);
CREATE INDEX IF NOT EXISTS idx_outreach_log_contact_id ON outreach_log(contact_id);
"""

# Migration queries for existing databases
MIGRATIONS = [
    "ALTER TABLE companies ADD COLUMN meta_title TEXT",
    "ALTER TABLE companies ADD COLUMN meta_description TEXT",
    "ALTER TABLE companies ADD COLUMN og_image_url TEXT",
    "ALTER TABLE companies ADD COLUMN company_description TEXT",
    "ALTER TABLE companies ADD COLUMN mission_statement TEXT",
    "ALTER TABLE companies ADD COLUMN founded_year TEXT",
    "ALTER TABLE companies ADD COLUMN headquarters TEXT",
    "ALTER TABLE companies ADD COLUMN company_size TEXT",
    "ALTER TABLE companies ADD COLUMN industry TEXT",
    "ALTER TABLE companies ADD COLUMN pricing_model TEXT",
    "ALTER TABLE companies ADD COLUMN social_links TEXT",
    "ALTER TABLE companies ADD COLUMN technologies TEXT",
    "ALTER TABLE companies ADD COLUMN products_services TEXT",
    "ALTER TABLE companies ADD COLUMN target_customers TEXT",
    "ALTER TABLE contacts ADD COLUMN stage TEXT DEFAULT 'new'",
]


async def init_db(db_path: str) -> None:
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(db_path) as db:
        await db.executescript(SCHEMA)
        await db.commit()

        # Run migrations for existing databases (ignore errors for already-added columns)
        for migration in MIGRATIONS:
            try:
                await db.execute(migration)
                await db.commit()
            except Exception:
                pass  # Column likely already exists


@asynccontextmanager
async def get_db(db_path: str):
    db = await aiosqlite.connect(db_path)
    db.row_factory = aiosqlite.Row
    try:
        yield db
    finally:
        await db.close()
