# app/main.py
import asyncio
import csv
import io
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db, get_db
from app.models import UploadResponse, JobStatusResponse, JobResponse, CompanyResponse
from app.services.csv_parser import parse_csv, CSVValidationError
from app.services.job_processor import (
    create_job,
    get_job_status,
    get_job,
    get_job_companies,
    get_job_contacts,
    get_job_results,
    process_job
)
from app.services.screenshot_service import get_screenshot_path, screenshot_exists, capture_screenshot
from app.services.email import get_email_provider, TokenStore
from fastapi.responses import FileResponse, StreamingResponse, RedirectResponse


# Runtime settings storage (persists until server restart)
_runtime_settings = {
    "demo_mode": False
}


def get_current_db_path() -> str:
    """Get the current database path based on runtime demo mode setting."""
    if _runtime_settings.get("demo_mode", False):
        return "data/demo.db"
    return settings.effective_database_path


# Pydantic models for CRM endpoints
class ReminderCreate(BaseModel):
    due_date: str
    note: str


class ReminderUpdate(BaseModel):
    completed: Optional[bool] = None
    note: Optional[str] = None


class StageUpdate(BaseModel):
    stage: str


class NotesUpdate(BaseModel):
    notes: str


class RelationshipUpdate(BaseModel):
    relationship: str


class OutreachCreate(BaseModel):
    outreach_type: str  # email, linkedin, call, other
    note: Optional[str] = None


class TemplateCreate(BaseModel):
    name: str
    category: Optional[str] = None
    subject: str
    body: str


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None


class NoteCreate(BaseModel):
    content: str


VALID_STAGES = {"backlog", "contacted", "reaching_out", "engaged", "meeting", "won", "lost", "naf", "personal"}
VALID_OUTREACH_TYPES = {"email", "linkedin", "call", "other"}
VALID_CONTACT_TYPES = {"crm", "personal"}
VALID_PERSONAL_RELATIONSHIPS = {"family", "friend", "acquaintance"}


class ContactCreate(BaseModel):
    first_name: str
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    contact_type: str = "personal"
    relationship: Optional[str] = None
    company_id: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None


class ContactUpdate(BaseModel):
    """Partial update model - all fields optional."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None


class CompanyUpdate(BaseModel):
    """Partial update model for companies - all fields optional."""
    name: Optional[str] = None
    website_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    company_description: Optional[str] = None
    mission_statement: Optional[str] = None
    founded_year: Optional[str] = None
    headquarters: Optional[str] = None
    company_size: Optional[str] = None
    industry: Optional[str] = None
    pricing_model: Optional[str] = None
    products_services: Optional[str] = None
    target_customers: Optional[str] = None


class EmailSend(BaseModel):
    provider: str  # 'gmail' or 'outlook'
    to: str
    subject: str
    body: str
    cc: Optional[str] = None
    bcc: Optional[str] = None


VALID_EMAIL_PROVIDERS = {"gmail", "outlook"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db(get_current_db_path())

    # Auto-resume any jobs that were processing when server stopped
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT id FROM jobs WHERE status = 'processing'"
        )
        processing_jobs = await cursor.fetchall()

        for row in processing_jobs:
            job_id = row[0]
            print(f"[INFO] Auto-resuming job: {job_id}")
            asyncio.create_task(
                process_job(
                    get_current_db_path(),
                    job_id,
                    settings.firecrawl_api_key,
                    settings.anthropic_api_key
                )
            )

    yield


app = FastAPI(title="kanbun", lifespan=lifespan)


@app.post("/api/jobs/upload", response_model=UploadResponse)
async def upload_csv(
    file: UploadFile = File(...),
    skip_duplicates: bool = True
):
    try:
        parsed = parse_csv(file.file)
        companies = parsed["companies"]
        contacts = parsed["contacts"]
    except CSVValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Check for existing companies
    duplicates_skipped = 0
    if skip_duplicates:
        async with get_db(get_current_db_path()) as db:
            existing_names = set()
            cursor = await db.execute("SELECT LOWER(name) FROM companies")
            rows = await cursor.fetchall()
            existing_names = {row[0] for row in rows}

            original_count = len(companies)
            # Filter companies and their contacts
            kept_company_names = set()
            filtered_companies = []
            for c in companies:
                if c["company_name"].lower() not in existing_names:
                    filtered_companies.append(c)
                    kept_company_names.add(c["company_name"].lower())

            companies = filtered_companies
            duplicates_skipped = original_count - len(companies)

            # Filter contacts to only those for kept companies
            contacts = [ct for ct in contacts if ct["company_name"].lower() in kept_company_names]

    if not companies:
        raise HTTPException(
            status_code=400,
            detail=f"All {duplicates_skipped} companies already exist in database. Use skip_duplicates=false to create a new job anyway."
        )

    job_id = await create_job(get_current_db_path(), file.filename, companies, contacts)

    asyncio.create_task(
        process_job(
            get_current_db_path(),
            job_id,
            settings.firecrawl_api_key,
            settings.anthropic_api_key
        )
    )

    return UploadResponse(
        job_id=job_id,
        total_companies=len(companies),
        duplicates_skipped=duplicates_skipped,
        total_contacts=len(contacts)
    )


@app.get("/api/jobs/{job_id}", response_model=JobStatusResponse)
async def get_job_status_endpoint(job_id: str):
    status = await get_job_status(get_current_db_path(), job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusResponse(**status)


@app.get("/api/jobs/{job_id}/companies")
async def get_job_companies_endpoint(job_id: str):
    job = await get_job(get_current_db_path(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    companies = await get_job_companies(get_current_db_path(), job_id)
    return {"companies": companies}


@app.get("/api/jobs/{job_id}/contacts")
async def get_job_contacts_endpoint(job_id: str):
    job = await get_job(get_current_db_path(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    contacts = await get_job_contacts(get_current_db_path(), job_id)
    return {"contacts": contacts}


@app.get("/api/jobs/{job_id}/results")
async def get_job_results_endpoint(job_id: str):
    job = await get_job(get_current_db_path(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    results = await get_job_results(get_current_db_path(), job_id)
    return {"results": results}


@app.get("/api/jobs/{job_id}/export")
async def export_job_results(job_id: str):
    job = await get_job(get_current_db_path(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    results = await get_job_results(get_current_db_path(), job_id)

    output = io.StringIO()
    writer = csv.writer(output)

    # Enhanced CSV headers
    writer.writerow([
        # Company info
        "company_name", "website_url", "status",
        # Enriched data
        "company_description", "industry", "headquarters", "founded_year",
        "company_size", "pricing_model", "products_services", "target_customers",
        "technologies", "mission_statement",
        # Keywords
        "core_product", "category_language", "industry_depth",
        "pain_points", "customer_segments",
        # Contacts
        "contact_name", "contact_email", "contact_title", "contact_phone"
    ])

    for result in results:
        company = result["company"]
        keywords = result.get("keywords", {})
        contacts = result.get("contacts", [])

        # Get first contact for the main row
        first_contact = contacts[0] if contacts else {}

        writer.writerow([
            company.get("name", ""),
            company.get("website_url", ""),
            company.get("status", ""),
            company.get("company_description", ""),
            company.get("industry", ""),
            company.get("headquarters", ""),
            company.get("founded_year", ""),
            company.get("company_size", ""),
            company.get("pricing_model", ""),
            company.get("products_services", ""),
            company.get("target_customers", ""),
            company.get("technologies", ""),
            company.get("mission_statement", ""),
            "; ".join(keywords.get("core_product", [])),
            "; ".join(keywords.get("category_language", [])),
            "; ".join(keywords.get("industry_depth", [])),
            "; ".join(keywords.get("pain_points", [])),
            "; ".join(keywords.get("customer_segments", [])),
            f"{first_contact.get('first_name', '')} {first_contact.get('last_name', '')}".strip(),
            first_contact.get("email", ""),
            first_contact.get("title", ""),
            first_contact.get("phone", "")
        ])

        # Additional rows for extra contacts
        for contact in contacts[1:]:
            writer.writerow([
                company.get("name", ""),
                "", "", "", "", "", "", "", "", "", "", "", "",
                "", "", "", "", "",
                f"{contact.get('first_name', '')} {contact.get('last_name', '')}".strip(),
                contact.get("email", ""),
                contact.get("title", ""),
                contact.get("phone", "")
            ])

    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=enriched_{job_id}.csv"}
    )


@app.get("/api/jobs")
async def list_jobs():
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50"
        )
        rows = await cursor.fetchall()
        return {"jobs": [dict(row) for row in rows]}


@app.delete("/api/jobs/{job_id}")
async def cancel_job(job_id: str):
    job = await get_job(get_current_db_path(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async with get_db(get_current_db_path()) as db:
        await db.execute(
            "UPDATE jobs SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'processing')",
            (job_id,)
        )
        await db.execute(
            "UPDATE companies SET status = 'cancelled' WHERE job_id = ? AND status = 'pending'",
            (job_id,)
        )
        await db.commit()

    return {"message": "Job cancelled", "job_id": job_id}


@app.post("/api/jobs/{job_id}/restart")
async def restart_job(job_id: str):
    job = await get_job(get_current_db_path(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async with get_db(get_current_db_path()) as db:
        await db.execute(
            "UPDATE jobs SET status = 'processing' WHERE id = ?",
            (job_id,)
        )
        await db.commit()

    asyncio.create_task(
        process_job(
            get_current_db_path(),
            job_id,
            settings.firecrawl_api_key,
            settings.anthropic_api_key
        )
    )

    return {"message": "Job restarted", "job_id": job_id}


@app.post("/api/jobs/{job_id}/retry-failed")
async def retry_failed_companies(job_id: str):
    job = await get_job(get_current_db_path(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT COUNT(*) FROM companies WHERE job_id = ? AND status = 'failed'",
            (job_id,)
        )
        failed_count = (await cursor.fetchone())[0]

        if failed_count == 0:
            return {"message": "No failed companies to retry", "job_id": job_id, "retried_count": 0}

        await db.execute(
            "UPDATE companies SET status = 'pending', error_message = NULL WHERE job_id = ? AND status = 'failed'",
            (job_id,)
        )
        await db.execute(
            "UPDATE jobs SET status = 'processing' WHERE id = ?",
            (job_id,)
        )
        await db.commit()

    asyncio.create_task(
        process_job(
            get_current_db_path(),
            job_id,
            settings.firecrawl_api_key,
            settings.anthropic_api_key
        )
    )

    return {"message": f"Retrying {failed_count} failed companies", "job_id": job_id, "retried_count": failed_count}


@app.delete("/api/database/clear")
async def clear_database():
    """Clear all data from the database."""
    async with get_db(get_current_db_path()) as db:
        await db.execute("DELETE FROM keywords")
        await db.execute("DELETE FROM about_descriptions")
        await db.execute("DELETE FROM contacts")
        await db.execute("DELETE FROM companies")
        await db.execute("DELETE FROM jobs")
        await db.commit()

    return {"message": "Database cleared successfully"}


@app.get("/api/database/stats")
async def get_database_stats():
    async with get_db(get_current_db_path()) as db:
        jobs_cursor = await db.execute("SELECT COUNT(*) FROM jobs")
        jobs_count = (await jobs_cursor.fetchone())[0]

        companies_cursor = await db.execute("SELECT COUNT(*) FROM companies")
        companies_count = (await companies_cursor.fetchone())[0]

        completed_cursor = await db.execute("SELECT COUNT(*) FROM companies WHERE status = 'completed'")
        completed_count = (await completed_cursor.fetchone())[0]

        contacts_cursor = await db.execute("SELECT COUNT(*) FROM contacts")
        contacts_count = (await contacts_cursor.fetchone())[0]

        keywords_cursor = await db.execute("SELECT COUNT(*) FROM keywords")
        keywords_count = (await keywords_cursor.fetchone())[0]

        return {
            "total_jobs": jobs_count,
            "total_companies": companies_count,
            "completed_companies": completed_count,
            "total_contacts": contacts_count,
            "total_keywords": keywords_count
        }


@app.get("/api/database/companies")
async def get_all_companies(limit: int = 100, offset: int = 0, status: str = None):
    async with get_db(get_current_db_path()) as db:
        query = """
            SELECT c.*, j.filename as job_filename,
                   (SELECT GROUP_CONCAT(k.keyword, ', ') FROM keywords k WHERE k.company_id = c.id) as all_keywords,
                   (SELECT COUNT(*) FROM contacts ct WHERE ct.company_id = c.id) as contact_count
            FROM companies c
            LEFT JOIN jobs j ON c.job_id = j.id
        """
        params = []
        if status:
            query += " WHERE c.status = ?"
            params.append(status)
        query += " ORDER BY c.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()

        count_query = "SELECT COUNT(*) FROM companies"
        if status:
            count_query += " WHERE status = ?"
            count_cursor = await db.execute(count_query, [status])
        else:
            count_cursor = await db.execute(count_query)
        total = (await count_cursor.fetchone())[0]

        return {
            "companies": [dict(row) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset
        }


@app.get("/api/database/contacts")
async def get_all_contacts(limit: int = 100, offset: int = 0, search: str = None, contact_type: str = None):
    async with get_db(get_current_db_path()) as db:
        base_query = """
            SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone, ct.title,
                   ct.linkedin_url, ct.stage, ct.notes, ct.relationship, ct.company_id,
                   ct.contact_type,
                   c.name as company_name, c.website_url as company_website,
                   c.company_description, c.meta_title, c.meta_description
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
        """
        count_query = """
            SELECT COUNT(*) FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
        """
        params = []
        where_clauses = []

        if search:
            where_clauses.append("""
                (ct.first_name LIKE ? OR ct.last_name LIKE ?
                OR ct.email LIKE ? OR c.name LIKE ? OR ct.title LIKE ?)
            """)
            search_param = f"%{search}%"
            params.extend([search_param] * 5)

        if contact_type and contact_type in VALID_CONTACT_TYPES:
            where_clauses.append("ct.contact_type = ?")
            params.append(contact_type)

        if where_clauses:
            where_sql = " WHERE " + " AND ".join(where_clauses)
            base_query += where_sql
            count_query += where_sql

        base_query += " ORDER BY ct.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await db.execute(base_query, params)
        rows = await cursor.fetchall()

        count_params = params[:-2]
        count_cursor = await db.execute(count_query, count_params)
        total = (await count_cursor.fetchone())[0]

        return {
            "contacts": [dict(row) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset
        }


@app.get("/api/screenshots/{company_id}")
async def get_company_screenshot(company_id: str):
    """Get screenshot for a company."""
    screenshot_path = get_screenshot_path(company_id)
    if not screenshot_path:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(screenshot_path, media_type="image/png")


@app.get("/api/screenshots/{company_id}/exists")
async def check_screenshot_exists(company_id: str):
    """Check if a screenshot exists for a company."""
    return {"exists": screenshot_exists(company_id)}


@app.post("/api/screenshots/{company_id}/regenerate")
async def regenerate_screenshot(company_id: str):
    """Regenerate screenshot for a company."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT id, website_url FROM companies WHERE id = ?",
            (company_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Company not found")

        website_url = row["website_url"]
        if not website_url:
            raise HTTPException(status_code=400, detail="Company has no website URL")

    result = await capture_screenshot(website_url, company_id)
    if result:
        return {"success": True, "message": "Screenshot regenerated"}
    else:
        raise HTTPException(status_code=500, detail="Failed to capture screenshot")


# Track bulk screenshot progress
bulk_screenshot_status = {"running": False, "total": 0, "completed": 0, "failed": 0}


@app.post("/api/screenshots/regenerate-all")
async def regenerate_all_screenshots(job_id: str = None):
    """Regenerate screenshots for all companies (or all in a specific job)."""
    global bulk_screenshot_status

    if bulk_screenshot_status["running"]:
        raise HTTPException(status_code=409, detail="Bulk screenshot regeneration already in progress")

    async with get_db(get_current_db_path()) as db:
        if job_id:
            cursor = await db.execute(
                "SELECT id, website_url FROM companies WHERE job_id = ? AND website_url IS NOT NULL AND status = 'completed'",
                (job_id,)
            )
        else:
            cursor = await db.execute(
                "SELECT id, website_url FROM companies WHERE website_url IS NOT NULL AND status = 'completed'"
            )
        companies = await cursor.fetchall()

    if not companies:
        raise HTTPException(status_code=404, detail="No companies found to regenerate screenshots")

    bulk_screenshot_status = {"running": True, "total": len(companies), "completed": 0, "failed": 0}
    # Use asyncio.create_task for proper async background execution
    asyncio.create_task(bulk_regenerate_screenshots([dict(c) for c in companies]))

    return {"message": f"Started regenerating {len(companies)} screenshots", "total": len(companies)}


async def bulk_regenerate_screenshots(companies: list):
    """Background task to regenerate all screenshots."""
    global bulk_screenshot_status

    for company in companies:
        try:
            result = await capture_screenshot(company["website_url"], company["id"])
            if result:
                bulk_screenshot_status["completed"] += 1
            else:
                bulk_screenshot_status["failed"] += 1
        except Exception as e:
            print(f"[ERROR] Bulk screenshot failed for {company['id']}: {e}")
            bulk_screenshot_status["failed"] += 1

        # Small delay between screenshots to avoid overwhelming the system
        await asyncio.sleep(1)

    bulk_screenshot_status["running"] = False


@app.get("/api/screenshots/regenerate-all/status")
async def get_bulk_screenshot_status():
    """Get status of bulk screenshot regeneration."""
    return bulk_screenshot_status


# =============================================================================
# CRM Reminders and Stage Endpoints
# =============================================================================

@app.get("/api/contacts/{contact_id}/reminders")
async def get_contact_reminders(contact_id: str):
    """Get all reminders for a contact ordered by due_date."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT id, contact_id, due_date, note, completed, created_at
            FROM reminders
            WHERE contact_id = ?
            ORDER BY due_date
            """,
            (contact_id,)
        )
        rows = await cursor.fetchall()
        return {"reminders": [dict(row) for row in rows]}


@app.post("/api/contacts/{contact_id}/reminders")
async def create_reminder(contact_id: str, reminder: ReminderCreate):
    """Create a new reminder for a contact."""
    reminder_id = str(uuid.uuid4())

    async with get_db(get_current_db_path()) as db:
        # Verify contact exists
        cursor = await db.execute(
            "SELECT id FROM contacts WHERE id = ?",
            (contact_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contact not found")

        await db.execute(
            """
            INSERT INTO reminders (id, contact_id, due_date, note, completed)
            VALUES (?, ?, ?, ?, 0)
            """,
            (reminder_id, contact_id, reminder.due_date, reminder.note)
        )
        await db.commit()

        # Fetch the created reminder
        cursor = await db.execute(
            "SELECT id, contact_id, due_date, note, completed, created_at FROM reminders WHERE id = ?",
            (reminder_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.put("/api/reminders/{reminder_id}")
async def update_reminder(reminder_id: str, reminder: ReminderUpdate):
    """Update a reminder's completed status or note."""
    async with get_db(get_current_db_path()) as db:
        # Verify reminder exists
        cursor = await db.execute(
            "SELECT id FROM reminders WHERE id = ?",
            (reminder_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Reminder not found")

        # Build update query dynamically based on provided fields
        updates = []
        params = []
        if reminder.completed is not None:
            updates.append("completed = ?")
            params.append(1 if reminder.completed else 0)
        if reminder.note is not None:
            updates.append("note = ?")
            params.append(reminder.note)

        if updates:
            params.append(reminder_id)
            await db.execute(
                f"UPDATE reminders SET {', '.join(updates)} WHERE id = ?",
                params
            )
            await db.commit()

        # Fetch the updated reminder
        cursor = await db.execute(
            "SELECT id, contact_id, due_date, note, completed, created_at FROM reminders WHERE id = ?",
            (reminder_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.delete("/api/reminders/{reminder_id}")
async def delete_reminder(reminder_id: str):
    """Delete a reminder."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT id FROM reminders WHERE id = ?",
            (reminder_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Reminder not found")

        await db.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))
        await db.commit()

    return {"success": True}


@app.get("/api/reminders/upcoming")
async def get_upcoming_reminders():
    """Get upcoming incomplete reminders for the next 7 days."""
    seven_days_from_now = (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")

    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT
                r.id as reminder_id,
                r.contact_id,
                ct.first_name || ' ' || ct.last_name as contact_name,
                c.name as company_name,
                r.due_date,
                r.note
            FROM reminders r
            JOIN contacts ct ON r.contact_id = ct.id
            LEFT JOIN companies c ON ct.company_id = c.id
            WHERE r.due_date <= ? AND r.completed = 0
            ORDER BY r.due_date
            """,
            (seven_days_from_now,)
        )
        rows = await cursor.fetchall()
        return {"reminders": [dict(row) for row in rows]}


@app.put("/api/contacts/{contact_id}/stage")
async def update_contact_stage(contact_id: str, stage_update: StageUpdate):
    """Update a contact's pipeline stage."""
    if stage_update.stage not in VALID_STAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid stage. Must be one of: {', '.join(sorted(VALID_STAGES))}"
        )

    async with get_db(get_current_db_path()) as db:
        # Get current stage
        cursor = await db.execute(
            "SELECT id, stage FROM contacts WHERE id = ?",
            (contact_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")

        old_stage = row["stage"]
        new_stage = stage_update.stage

        # Only log and update if stage actually changed
        if old_stage != new_stage:
            await db.execute(
                "UPDATE contacts SET stage = ? WHERE id = ?",
                (new_stage, contact_id)
            )

            # Log stage change
            change_id = str(uuid.uuid4())
            await db.execute(
                "INSERT INTO stage_changes (id, contact_id, from_stage, to_stage) VALUES (?, ?, ?, ?)",
                (change_id, contact_id, old_stage, new_stage)
            )
            await db.commit()

        # Fetch the updated contact
        cursor = await db.execute(
            """
            SELECT ct.*, c.name as company_name, c.website_url as company_website
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
            WHERE ct.id = ?
            """,
            (contact_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.put("/api/contacts/{contact_id}/notes")
async def update_contact_notes(contact_id: str, notes_update: NotesUpdate):
    """Update a contact's notes."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT id FROM contacts WHERE id = ?",
            (contact_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contact not found")

        await db.execute(
            "UPDATE contacts SET notes = ? WHERE id = ?",
            (notes_update.notes, contact_id)
        )
        await db.commit()

        return {"status": "updated", "notes": notes_update.notes}


@app.put("/api/contacts/{contact_id}/relationship")
async def update_contact_relationship(contact_id: str, rel_update: RelationshipUpdate):
    """Update a contact's relationship field."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT id FROM contacts WHERE id = ?",
            (contact_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contact not found")

        await db.execute(
            "UPDATE contacts SET relationship = ? WHERE id = ?",
            (rel_update.relationship, contact_id)
        )
        await db.commit()

        return {"status": "updated", "relationship": rel_update.relationship}


@app.get("/api/contacts/{contact_id}/full")
async def get_contact_full(contact_id: str):
    """Get full contact details including company info."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT
                ct.*,
                c.name as company_name,
                c.website_url as company_website,
                c.company_description,
                c.industry,
                c.headquarters,
                c.company_size,
                c.founded_year,
                c.meta_description,
                c.technologies,
                c.products_services
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
            WHERE ct.id = ?
            """,
            (contact_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")

        return dict(row)


@app.patch("/api/contacts/{contact_id}")
async def update_contact(contact_id: str, updates: ContactUpdate):
    """Update contact fields. Only provided fields are updated."""
    async with get_db(get_current_db_path()) as db:
        # Verify contact exists
        cursor = await db.execute("SELECT id FROM contacts WHERE id = ?", (contact_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contact not found")

        # Build update query from non-None fields
        update_data = updates.model_dump(exclude_none=True)
        if not update_data:
            raise HTTPException(status_code=400, detail="No fields to update")

        # Build SET clause
        set_clause = ", ".join(f"{key} = ?" for key in update_data.keys())
        values = list(update_data.values()) + [contact_id]

        await db.execute(
            f"UPDATE contacts SET {set_clause} WHERE id = ?",
            values
        )
        await db.commit()

        # Return updated contact
        cursor = await db.execute(
            """
            SELECT ct.*, c.name as company_name
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
            WHERE ct.id = ?
            """,
            (contact_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.get("/api/contacts/{contact_id}/timeline")
async def get_contact_timeline(contact_id: str):
    """Get unified activity timeline for a contact."""
    async with get_db(get_current_db_path()) as db:
        # Verify contact exists
        cursor = await db.execute("SELECT id FROM contacts WHERE id = ?", (contact_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contact not found")

        # Fetch all activity types
        activities = []

        # Notes
        cursor = await db.execute(
            "SELECT id, content, created_at FROM contact_notes WHERE contact_id = ? ORDER BY created_at DESC",
            (contact_id,)
        )
        for row in await cursor.fetchall():
            activities.append({
                "type": "note",
                "id": row["id"],
                "content": row["content"],
                "timestamp": row["created_at"]
            })

        # Outreach
        cursor = await db.execute(
            "SELECT id, outreach_type, note, sent_at FROM outreach_log WHERE contact_id = ? ORDER BY sent_at DESC",
            (contact_id,)
        )
        for row in await cursor.fetchall():
            activities.append({
                "type": "outreach",
                "id": row["id"],
                "outreach_type": row["outreach_type"],
                "note": row["note"],
                "timestamp": row["sent_at"]
            })

        # Reminders
        cursor = await db.execute(
            "SELECT id, due_date, note, completed, created_at FROM reminders WHERE contact_id = ? ORDER BY created_at DESC",
            (contact_id,)
        )
        for row in await cursor.fetchall():
            activities.append({
                "type": "reminder",
                "id": row["id"],
                "due_date": row["due_date"],
                "note": row["note"],
                "completed": bool(row["completed"]),
                "timestamp": row["created_at"]
            })

        # Stage changes
        cursor = await db.execute(
            "SELECT id, from_stage, to_stage, changed_at FROM stage_changes WHERE contact_id = ? ORDER BY changed_at DESC",
            (contact_id,)
        )
        for row in await cursor.fetchall():
            activities.append({
                "type": "stage_change",
                "id": row["id"],
                "from_stage": row["from_stage"],
                "to_stage": row["to_stage"],
                "timestamp": row["changed_at"]
            })

        # Sort all activities by timestamp descending
        activities.sort(key=lambda x: x["timestamp"] or "", reverse=True)

        return {"timeline": activities}


@app.post("/api/contacts/{contact_id}/notes")
async def create_contact_note(contact_id: str, note: NoteCreate):
    """Add a note to a contact."""
    note_id = str(uuid.uuid4())

    async with get_db(get_current_db_path()) as db:
        # Verify contact exists
        cursor = await db.execute("SELECT id FROM contacts WHERE id = ?", (contact_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contact not found")

        await db.execute(
            "INSERT INTO contact_notes (id, contact_id, content) VALUES (?, ?, ?)",
            (note_id, contact_id, note.content)
        )
        await db.commit()

        cursor = await db.execute(
            "SELECT id, contact_id, content, created_at FROM contact_notes WHERE id = ?",
            (note_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str):
    """Delete a note."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute("SELECT id FROM contact_notes WHERE id = ?", (note_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Note not found")

        await db.execute("DELETE FROM contact_notes WHERE id = ?", (note_id,))
        await db.commit()

        return {"status": "deleted"}


@app.get("/api/contacts/{contact_id}/outreach")
async def get_contact_outreach(contact_id: str):
    """Get outreach history for a contact."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT id, contact_id, outreach_type, note, sent_at
            FROM outreach_log
            WHERE contact_id = ?
            ORDER BY sent_at DESC
            """,
            (contact_id,)
        )
        rows = await cursor.fetchall()
        return {"outreach": [dict(row) for row in rows]}


@app.post("/api/contacts/{contact_id}/outreach")
async def log_outreach(contact_id: str, outreach: OutreachCreate):
    """Log an outreach attempt for a contact."""
    if outreach.outreach_type not in VALID_OUTREACH_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid outreach type. Must be one of: {', '.join(sorted(VALID_OUTREACH_TYPES))}"
        )

    outreach_id = str(uuid.uuid4())

    async with get_db(get_current_db_path()) as db:
        # Verify contact exists
        cursor = await db.execute(
            "SELECT id FROM contacts WHERE id = ?",
            (contact_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contact not found")

        await db.execute(
            """
            INSERT INTO outreach_log (id, contact_id, outreach_type, note)
            VALUES (?, ?, ?, ?)
            """,
            (outreach_id, contact_id, outreach.outreach_type, outreach.note)
        )
        await db.commit()

        # Fetch the created outreach log
        cursor = await db.execute(
            "SELECT id, contact_id, outreach_type, note, sent_at FROM outreach_log WHERE id = ?",
            (outreach_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.get("/api/pipeline")
async def get_pipeline():
    """Get all contacts grouped by stage with company info and next reminder."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT
                ct.id,
                ct.first_name,
                ct.last_name,
                ct.email,
                ct.phone,
                ct.title,
                ct.contact_type,
                ct.relationship,
                c.name as company_name,
                ct.company_id,
                ct.stage,
                (
                    SELECT MIN(r.due_date)
                    FROM reminders r
                    WHERE r.contact_id = ct.id AND r.completed = 0
                ) as next_reminder
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
            ORDER BY ct.stage, ct.last_name
            """
        )
        rows = await cursor.fetchall()

        pipeline = {stage: [] for stage in VALID_STAGES}
        for row in rows:
            contact = dict(row)
            stage = contact.get("stage") or "backlog"
            if stage in pipeline:
                pipeline[stage].append(contact)
            else:
                pipeline["backlog"].append(contact)

        return pipeline


# ============== Email Templates API ==============

@app.get("/api/templates")
async def get_templates():
    """Get all email templates grouped by category."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT * FROM email_templates ORDER BY category, name"
        )
        rows = await cursor.fetchall()
        templates = [dict(row) for row in rows]

        # Group by category
        grouped = {}
        for t in templates:
            cat = t.get("category") or "Uncategorized"
            if cat not in grouped:
                grouped[cat] = []
            grouped[cat].append(t)

        return {"templates": templates, "grouped": grouped}


@app.get("/api/templates/categories")
async def get_template_categories():
    """Get unique template categories."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT DISTINCT category FROM email_templates WHERE category IS NOT NULL ORDER BY category"
        )
        rows = await cursor.fetchall()
        return {"categories": [row["category"] for row in rows]}


@app.post("/api/templates")
async def create_template(template: TemplateCreate):
    """Create a new email template."""
    template_id = str(uuid.uuid4())

    async with get_db(get_current_db_path()) as db:
        await db.execute(
            """
            INSERT INTO email_templates (id, name, category, subject, body)
            VALUES (?, ?, ?, ?, ?)
            """,
            (template_id, template.name, template.category, template.subject, template.body)
        )
        await db.commit()

        cursor = await db.execute(
            "SELECT * FROM email_templates WHERE id = ?",
            (template_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.put("/api/templates/{template_id}")
async def update_template(template_id: str, template: TemplateUpdate):
    """Update an email template."""
    async with get_db(get_current_db_path()) as db:
        # Check template exists
        cursor = await db.execute(
            "SELECT id FROM email_templates WHERE id = ?",
            (template_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Template not found")

        # Build update query with only provided fields
        updates = []
        params = []
        if template.name is not None:
            updates.append("name = ?")
            params.append(template.name)
        if template.category is not None:
            updates.append("category = ?")
            params.append(template.category)
        if template.subject is not None:
            updates.append("subject = ?")
            params.append(template.subject)
        if template.body is not None:
            updates.append("body = ?")
            params.append(template.body)

        if updates:
            updates.append("updated_at = CURRENT_TIMESTAMP")
            params.append(template_id)
            await db.execute(
                f"UPDATE email_templates SET {', '.join(updates)} WHERE id = ?",
                params
            )
            await db.commit()

        cursor = await db.execute(
            "SELECT * FROM email_templates WHERE id = ?",
            (template_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.delete("/api/templates/{template_id}")
async def delete_template(template_id: str):
    """Delete an email template."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT id FROM email_templates WHERE id = ?",
            (template_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Template not found")

        await db.execute(
            "DELETE FROM email_templates WHERE id = ?",
            (template_id,)
        )
        await db.commit()

        return {"status": "deleted"}


@app.get("/api/companies/{company_id}/full")
async def get_company_full(company_id: str):
    """Get full company details with all enriched fields."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            """
            SELECT *
            FROM companies
            WHERE id = ?
            """,
            (company_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Company not found")

        return dict(row)


@app.get("/api/companies/{company_id}/contacts")
async def get_company_contacts(company_id: str):
    """Get all contacts at a company."""
    async with get_db(get_current_db_path()) as db:
        # Verify company exists
        cursor = await db.execute("SELECT id FROM companies WHERE id = ?", (company_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Company not found")

        # Define stage order for sorting
        stage_order = {
            'meeting': 1,
            'engaged': 2,
            'reaching_out': 3,
            'contacted': 4,
            'backlog': 5,
            'won': 6,
            'lost': 7,
            'naf': 8
        }

        cursor = await db.execute(
            """
            SELECT id, first_name, last_name, email, title, stage, relationship
            FROM contacts
            WHERE company_id = ?
            ORDER BY first_name, last_name
            """,
            (company_id,)
        )
        rows = await cursor.fetchall()
        contacts = [dict(row) for row in rows]

        # Sort by stage order, then by name
        contacts.sort(key=lambda c: (stage_order.get(c.get('stage', 'backlog'), 99), c.get('first_name', '').lower()))

        return {"contacts": contacts}


@app.get("/api/companies/{company_id}/notes")
async def get_company_notes(company_id: str):
    """Get all notes for a company."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT id, content, created_at FROM company_notes WHERE company_id = ? ORDER BY created_at DESC",
            (company_id,)
        )
        rows = await cursor.fetchall()
        return {"notes": [dict(row) for row in rows]}


@app.post("/api/companies/{company_id}/notes")
async def create_company_note(company_id: str, note: NoteCreate):
    """Add a note to a company."""
    note_id = str(uuid.uuid4())

    async with get_db(get_current_db_path()) as db:
        # Verify company exists
        cursor = await db.execute("SELECT id FROM companies WHERE id = ?", (company_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Company not found")

        await db.execute(
            "INSERT INTO company_notes (id, company_id, content) VALUES (?, ?, ?)",
            (note_id, company_id, note.content)
        )
        await db.commit()

        cursor = await db.execute(
            "SELECT id, content, created_at FROM company_notes WHERE id = ?",
            (note_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.delete("/api/company-notes/{note_id}")
async def delete_company_note(note_id: str):
    """Delete a company note."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute("SELECT id FROM company_notes WHERE id = ?", (note_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Note not found")

        await db.execute("DELETE FROM company_notes WHERE id = ?", (note_id,))
        await db.commit()

        return {"status": "deleted"}


@app.delete("/api/companies/{company_id}")
async def delete_company(company_id: str):
    """Delete a company. Associated contacts are orphaned (kept but unlinked)."""
    async with get_db(get_current_db_path()) as db:
        # Check if company exists
        cursor = await db.execute("SELECT id, name FROM companies WHERE id = ?", (company_id,))
        company = await cursor.fetchone()
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")

        company_name = company["name"]

        # Orphan associated contacts (set company_id to NULL)
        await db.execute("UPDATE contacts SET company_id = NULL WHERE company_id = ?", (company_id,))

        # Delete associated data
        await db.execute("DELETE FROM company_notes WHERE company_id = ?", (company_id,))
        await db.execute("DELETE FROM company_activities WHERE company_id = ?", (company_id,))
        await db.execute("DELETE FROM keywords WHERE company_id = ?", (company_id,))
        await db.execute("DELETE FROM about_descriptions WHERE company_id = ?", (company_id,))

        # Delete the company
        await db.execute("DELETE FROM companies WHERE id = ?", (company_id,))
        await db.commit()

    # Try to delete screenshot file if it exists
    try:
        screenshot_path = get_screenshot_path(company_id)
        if screenshot_path.exists():
            screenshot_path.unlink()
    except Exception:
        pass  # Ignore screenshot deletion errors

    return {
        "message": "Company deleted",
        "company_id": company_id,
        "name": company_name
    }


@app.put("/api/companies/{company_id}")
async def update_company(company_id: str, updates: CompanyUpdate):
    """Update company fields. Logs changes to activity timeline."""
    async with get_db(get_current_db_path()) as db:
        # Get current company data
        cursor = await db.execute("SELECT * FROM companies WHERE id = ?", (company_id,))
        company = await cursor.fetchone()
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")

        company = dict(company)
        update_data = updates.model_dump(exclude_unset=True)

        if not update_data:
            return company

        # Build update query and log changes
        set_clauses = []
        params = []
        for field, new_value in update_data.items():
            old_value = company.get(field)
            if old_value != new_value:
                set_clauses.append(f"{field} = ?")
                params.append(new_value)

                # Log the change to activity timeline
                activity_id = str(uuid.uuid4())
                await db.execute(
                    """INSERT INTO company_activities (id, company_id, activity_type, description, old_value, new_value)
                       VALUES (?, ?, 'field_update', ?, ?, ?)""",
                    (activity_id, company_id, f"Updated {field.replace('_', ' ')}",
                     str(old_value) if old_value else None,
                     str(new_value) if new_value else None)
                )

        if set_clauses:
            params.append(company_id)
            await db.execute(
                f"UPDATE companies SET {', '.join(set_clauses)} WHERE id = ?",
                params
            )
            await db.commit()

        # Return updated company
        cursor = await db.execute("SELECT * FROM companies WHERE id = ?", (company_id,))
        return dict(await cursor.fetchone())


@app.get("/api/companies/{company_id}/timeline")
async def get_company_timeline(company_id: str):
    """Get company activity timeline (notes + activities combined)."""
    async with get_db(get_current_db_path()) as db:
        # Check company exists
        cursor = await db.execute("SELECT id FROM companies WHERE id = ?", (company_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Company not found")

        # Get activities
        cursor = await db.execute(
            """SELECT id, activity_type, description, old_value, new_value, created_at
               FROM company_activities WHERE company_id = ?
               ORDER BY created_at DESC""",
            (company_id,)
        )
        activities = [dict(row) for row in await cursor.fetchall()]

        # Get notes (as 'note' type activities)
        cursor = await db.execute(
            """SELECT id, content, created_at
               FROM company_notes WHERE company_id = ?
               ORDER BY created_at DESC""",
            (company_id,)
        )
        notes = await cursor.fetchall()

        # Combine into unified timeline
        timeline = []
        for a in activities:
            timeline.append({
                "id": a["id"],
                "type": a["activity_type"],
                "description": a["description"],
                "old_value": a["old_value"],
                "new_value": a["new_value"],
                "created_at": a["created_at"],
                "deletable": False
            })

        for n in notes:
            timeline.append({
                "id": n["id"],
                "type": "note",
                "description": n["content"],
                "old_value": None,
                "new_value": None,
                "created_at": n["created_at"],
                "deletable": True
            })

        # Sort by created_at descending
        timeline.sort(key=lambda x: x["created_at"], reverse=True)

        return {"timeline": timeline}


@app.post("/api/companies/{company_id}/activity")
async def log_company_activity(company_id: str, activity_type: str, description: str = ""):
    """Log a manual activity for a company."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute("SELECT id FROM companies WHERE id = ?", (company_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Company not found")

        activity_id = str(uuid.uuid4())
        await db.execute(
            """INSERT INTO company_activities (id, company_id, activity_type, description)
               VALUES (?, ?, ?, ?)""",
            (activity_id, company_id, activity_type, description)
        )
        await db.commit()

        return {"id": activity_id, "activity_type": activity_type, "description": description}


@app.get("/api/companies/{company_id}/keywords")
async def get_company_keywords(company_id: str):
    """Get all keywords for a company."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute("SELECT id FROM companies WHERE id = ?", (company_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Company not found")

        cursor = await db.execute(
            "SELECT id, category, keyword, created_at FROM keywords WHERE company_id = ? ORDER BY category, keyword",
            (company_id,)
        )
        keywords = [dict(row) for row in await cursor.fetchall()]
        return {"keywords": keywords}


@app.post("/api/companies/{company_id}/keywords")
async def add_company_keyword(company_id: str, keyword: str, category: str = "manual"):
    """Add a keyword to a company."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute("SELECT id FROM companies WHERE id = ?", (company_id,))
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Company not found")

        # Check if keyword already exists
        cursor = await db.execute(
            "SELECT id FROM keywords WHERE company_id = ? AND keyword = ?",
            (company_id, keyword)
        )
        if await cursor.fetchone():
            raise HTTPException(status_code=400, detail="Keyword already exists")

        keyword_id = str(uuid.uuid4())
        await db.execute(
            "INSERT INTO keywords (id, company_id, category, keyword) VALUES (?, ?, ?, ?)",
            (keyword_id, company_id, category, keyword)
        )

        # Log activity
        activity_id = str(uuid.uuid4())
        await db.execute(
            """INSERT INTO company_activities (id, company_id, activity_type, description, new_value)
               VALUES (?, ?, 'keyword_added', ?, ?)""",
            (activity_id, company_id, f"Added keyword: {keyword}", keyword)
        )

        await db.commit()
        return {"id": keyword_id, "keyword": keyword, "category": category}


@app.delete("/api/companies/{company_id}/keywords/{keyword_id}")
async def delete_company_keyword(company_id: str, keyword_id: str):
    """Remove a keyword from a company."""
    async with get_db(get_current_db_path()) as db:
        cursor = await db.execute(
            "SELECT keyword FROM keywords WHERE id = ? AND company_id = ?",
            (keyword_id, company_id)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Keyword not found")

        keyword_text = row["keyword"]

        await db.execute("DELETE FROM keywords WHERE id = ?", (keyword_id,))

        # Log activity
        activity_id = str(uuid.uuid4())
        await db.execute(
            """INSERT INTO company_activities (id, company_id, activity_type, description, old_value)
               VALUES (?, ?, 'keyword_removed', ?, ?)""",
            (activity_id, company_id, f"Removed keyword: {keyword_text}", keyword_text)
        )

        await db.commit()
        return {"status": "deleted", "keyword": keyword_text}


@app.get("/api/search")
async def global_search(q: str = ""):
    """Search contacts and companies."""
    if not q or len(q) < 2:
        return {"contacts": [], "companies": []}

    search_term = f"%{q}%"

    async with get_db(get_current_db_path()) as db:
        # Search contacts
        cursor = await db.execute(
            """
            SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.title, ct.stage,
                   c.name as company_name, ct.company_id
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
            WHERE ct.first_name LIKE ? OR ct.last_name LIKE ? OR ct.email LIKE ?
                  OR ct.title LIKE ? OR c.name LIKE ?
            LIMIT 10
            """,
            (search_term, search_term, search_term, search_term, search_term)
        )
        contacts = [dict(row) for row in await cursor.fetchall()]

        # Search companies
        cursor = await db.execute(
            """
            SELECT id, name, website_url, industry
            FROM companies
            WHERE name LIKE ? OR website_url LIKE ? OR industry LIKE ?
            LIMIT 10
            """,
            (search_term, search_term, search_term)
        )
        companies = [dict(row) for row in await cursor.fetchall()]

        return {"contacts": contacts, "companies": companies}


@app.post("/api/contacts")
async def create_contact(contact: ContactCreate):
    """Create a new contact (CRM or personal)."""
    if contact.contact_type not in VALID_CONTACT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid contact_type. Must be one of: {', '.join(VALID_CONTACT_TYPES)}"
        )

    if contact.contact_type == "personal" and contact.relationship:
        if contact.relationship not in VALID_PERSONAL_RELATIONSHIPS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid relationship. Must be one of: {', '.join(VALID_PERSONAL_RELATIONSHIPS)}"
            )

    contact_id = str(uuid.uuid4())
    stage = "personal" if contact.contact_type == "personal" else "backlog"

    async with get_db(get_current_db_path()) as db:
        if contact.company_id:
            cursor = await db.execute("SELECT id FROM companies WHERE id = ?", (contact.company_id,))
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Company not found")

        await db.execute(
            """
            INSERT INTO contacts (id, first_name, last_name, email, phone, title,
                                  linkedin_url, company_id, stage, contact_type, relationship, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (contact_id, contact.first_name, contact.last_name, contact.email,
             contact.phone, contact.title, contact.linkedin_url, contact.company_id,
             stage, contact.contact_type, contact.relationship, contact.notes)
        )
        await db.commit()

        cursor = await db.execute(
            """
            SELECT ct.*, c.name as company_name
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
            WHERE ct.id = ?
            """,
            (contact_id,)
        )
        row = await cursor.fetchone()
        return dict(row)


@app.delete("/api/contacts/{contact_id}")
async def delete_contact(contact_id: str):
    """Delete a contact and all associated data (notes, reminders, outreach logs)."""
    async with get_db(get_current_db_path()) as db:
        # Check if contact exists
        cursor = await db.execute("SELECT id, first_name, last_name FROM contacts WHERE id = ?", (contact_id,))
        contact = await cursor.fetchone()
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")

        # Delete associated data
        await db.execute("DELETE FROM contact_notes WHERE contact_id = ?", (contact_id,))
        await db.execute("DELETE FROM reminders WHERE contact_id = ?", (contact_id,))
        await db.execute("DELETE FROM outreach_log WHERE contact_id = ?", (contact_id,))
        await db.execute("DELETE FROM stage_changes WHERE contact_id = ?", (contact_id,))

        # Delete the contact
        await db.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
        await db.commit()

    return {
        "message": "Contact deleted",
        "contact_id": contact_id,
        "name": f"{contact['first_name'] or ''} {contact['last_name'] or ''}".strip()
    }


# =============================================================================
# Email OAuth Endpoints
# =============================================================================

@app.get("/api/email/auth/{provider}")
async def email_auth(provider: str):
    """Initiate OAuth flow for email provider."""
    if provider not in VALID_EMAIL_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider. Must be one of: {', '.join(sorted(VALID_EMAIL_PROVIDERS))}"
        )

    email_provider = get_email_provider(provider)
    auth_url = email_provider.get_auth_url()
    return RedirectResponse(url=auth_url)


@app.get("/api/email/callback/{provider}")
async def email_callback(provider: str, code: str = None, error: str = None):
    """Handle OAuth callback from email provider."""
    # Handle error from provider
    if error:
        return RedirectResponse(url=f"/?email_error={error}")

    # Validate code exists
    if not code:
        return RedirectResponse(url="/?email_error=no_code")

    # Validate provider
    if provider not in VALID_EMAIL_PROVIDERS:
        return RedirectResponse(url=f"/?email_error=invalid_provider")

    try:
        email_provider = get_email_provider(provider)
        async with get_db(get_current_db_path()) as db:
            result = await email_provider.handle_callback(db, code)
            email = result.get("email", "")
        return RedirectResponse(url=f"/?email_connected={provider}&email={email}")
    except Exception as e:
        error_msg = str(e).replace(" ", "_")[:100]  # URL-safe error message
        return RedirectResponse(url=f"/?email_error={error_msg}")


@app.get("/api/email/status")
async def email_status():
    """Get connected email accounts."""
    token_store = TokenStore()
    async with get_db(get_current_db_path()) as db:
        accounts = await token_store.get_all_accounts(db)
    return {"accounts": accounts}


@app.post("/api/email/disconnect")
async def email_disconnect(provider: str):
    """Disconnect an email account."""
    if provider not in VALID_EMAIL_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider. Must be one of: {', '.join(sorted(VALID_EMAIL_PROVIDERS))}"
        )

    token_store = TokenStore()
    async with get_db(get_current_db_path()) as db:
        await token_store.delete_tokens(db, provider)

    return {"status": "disconnected", "provider": provider}


@app.post("/api/email/send")
async def email_send(email_data: EmailSend):
    """Send an email via connected OAuth account."""
    if email_data.provider not in VALID_EMAIL_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid provider. Must be one of: {', '.join(sorted(VALID_EMAIL_PROVIDERS))}"
        )

    try:
        email_provider = get_email_provider(email_data.provider)
        async with get_db(get_current_db_path()) as db:
            result = await email_provider.send_email(
                db,
                to=email_data.to,
                subject=email_data.subject,
                body=email_data.body,
                cc=email_data.cc,
                bcc=email_data.bcc
            )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")


@app.get("/api/email/history/{contact_email}")
async def get_email_history(contact_email: str, limit: int = 10):
    """
    Fetch email history with a specific contact.

    Returns emails to/from the contact's email address from all connected email accounts.
    """
    all_emails = []
    connected = False

    async with get_db(get_current_db_path()) as db:
        # Try Gmail
        try:
            gmail_provider = get_email_provider("gmail")
            gmail_tokens = await gmail_provider.token_store.get_tokens(db, "gmail")
            if gmail_tokens:
                connected = True
                gmail_emails = await gmail_provider.get_email_history(db, contact_email, limit)
                all_emails.extend(gmail_emails)
        except Exception as e:
            print(f"Gmail email history error: {e}")

        # Try Outlook
        try:
            outlook_provider = get_email_provider("outlook")
            outlook_tokens = await outlook_provider.token_store.get_tokens(db, "outlook")
            if outlook_tokens:
                connected = True
                outlook_emails = await outlook_provider.get_email_history(db, contact_email, limit)
                all_emails.extend(outlook_emails)
        except Exception as e:
            print(f"Outlook email history error: {e}")

    # Sort all emails by timestamp (newest first) and limit
    all_emails.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
    all_emails = all_emails[:limit]

    return {"emails": all_emails, "connected": connected}


# =============================================================================
# Settings Endpoints
# =============================================================================

class DemoModeToggle(BaseModel):
    enabled: bool


@app.get("/api/settings")
async def get_settings():
    """Get current application settings."""
    from pathlib import Path

    demo_db_exists = Path("data/demo.db").exists()
    main_db_exists = Path("data/kanbun.db").exists()

    return {
        "demo_mode": _runtime_settings.get("demo_mode", False),
        "demo_db_exists": demo_db_exists,
        "main_db_exists": main_db_exists,
        "current_database": "data/demo.db" if _runtime_settings.get("demo_mode") else "data/kanbun.db"
    }


@app.post("/api/settings/demo-mode")
async def toggle_demo_mode(toggle: DemoModeToggle):
    """Toggle demo mode on/off. Requires server restart to fully take effect."""
    from pathlib import Path

    if toggle.enabled and not Path("data/demo.db").exists():
        raise HTTPException(
            status_code=400,
            detail="Demo database does not exist. Please seed demo data first."
        )

    _runtime_settings["demo_mode"] = toggle.enabled

    return {
        "demo_mode": toggle.enabled,
        "message": f"Demo mode {'enabled' if toggle.enabled else 'disabled'}. Refresh the page to see changes.",
        "current_database": "data/demo.db" if toggle.enabled else "data/kanbun.db"
    }


@app.post("/api/settings/seed-demo")
async def seed_demo_database():
    """Seed the demo database with sample data."""
    import subprocess
    import sys
    from pathlib import Path

    script_path = Path("scripts/seed_demo_db.py")
    if not script_path.exists():
        raise HTTPException(status_code=500, detail="Demo seed script not found")

    try:
        result = subprocess.run(
            [sys.executable, str(script_path), "--output", "data/demo.db", "--clear"],
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Seed script failed: {result.stderr}")

        return {
            "success": True,
            "message": "Demo database seeded successfully",
            "output": result.stdout
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Seed script timed out")


@app.post("/api/settings/clear-data")
async def clear_current_database():
    """Clear all data from the current database (based on demo mode)."""
    db_path = get_current_db_path()

    async with get_db(db_path) as db:
        await db.execute("DELETE FROM keywords")
        await db.execute("DELETE FROM about_descriptions")
        await db.execute("DELETE FROM contact_notes")
        await db.execute("DELETE FROM company_notes")
        await db.execute("DELETE FROM stage_changes")
        await db.execute("DELETE FROM outreach_log")
        await db.execute("DELETE FROM reminders")
        await db.execute("DELETE FROM contacts")
        await db.execute("DELETE FROM companies")
        await db.execute("DELETE FROM jobs")
        await db.commit()

    return {"success": True, "message": "Database cleared", "database": db_path}


# Mount static files last to avoid conflicting with API routes
app.mount("/", StaticFiles(directory="app/static", html=True), name="static")
