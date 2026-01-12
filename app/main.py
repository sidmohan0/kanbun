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
    get_job_contacts,
    get_job_results,
    process_job
)
from app.services.screenshot_service import get_screenshot_path, screenshot_exists, capture_screenshot


# Pydantic models for CRM endpoints
class ReminderCreate(BaseModel):
    due_date: str
    note: str


class ReminderUpdate(BaseModel):
    completed: Optional[bool] = None
    note: Optional[str] = None


class StageUpdate(BaseModel):
    stage: str


class OutreachCreate(BaseModel):
    outreach_type: str  # email, linkedin, call, other
    note: Optional[str] = None


VALID_STAGES = {"new", "reaching_out", "engaged", "meeting", "won", "lost"}
VALID_OUTREACH_TYPES = {"email", "linkedin", "call", "other"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db(settings.database_path)
    yield


app = FastAPI(title="sidcrm", lifespan=lifespan)


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
        async with get_db(settings.database_path) as db:
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

    job_id = await create_job(settings.database_path, file.filename, companies, contacts)

    asyncio.create_task(
        process_job(
            settings.database_path,
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


@app.get("/api/jobs/{job_id}/contacts")
async def get_job_contacts_endpoint(job_id: str):
    job = await get_job(settings.database_path, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    contacts = await get_job_contacts(settings.database_path, job_id)
    return {"contacts": contacts}


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
    async with get_db(settings.database_path) as db:
        cursor = await db.execute(
            "SELECT * FROM jobs ORDER BY created_at DESC LIMIT 50"
        )
        rows = await cursor.fetchall()
        return {"jobs": [dict(row) for row in rows]}


@app.delete("/api/jobs/{job_id}")
async def cancel_job(job_id: str):
    job = await get_job(settings.database_path, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async with get_db(settings.database_path) as db:
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
    job = await get_job(settings.database_path, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async with get_db(settings.database_path) as db:
        await db.execute(
            "UPDATE jobs SET status = 'processing' WHERE id = ?",
            (job_id,)
        )
        await db.commit()

    asyncio.create_task(
        process_job(
            settings.database_path,
            job_id,
            settings.firecrawl_api_key,
            settings.anthropic_api_key
        )
    )

    return {"message": "Job restarted", "job_id": job_id}


@app.post("/api/jobs/{job_id}/retry-failed")
async def retry_failed_companies(job_id: str):
    job = await get_job(settings.database_path, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async with get_db(settings.database_path) as db:
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
            settings.database_path,
            job_id,
            settings.firecrawl_api_key,
            settings.anthropic_api_key
        )
    )

    return {"message": f"Retrying {failed_count} failed companies", "job_id": job_id, "retried_count": failed_count}


@app.delete("/api/database/clear")
async def clear_database():
    """Clear all data from the database."""
    async with get_db(settings.database_path) as db:
        await db.execute("DELETE FROM keywords")
        await db.execute("DELETE FROM about_descriptions")
        await db.execute("DELETE FROM contacts")
        await db.execute("DELETE FROM companies")
        await db.execute("DELETE FROM jobs")
        await db.commit()

    return {"message": "Database cleared successfully"}


@app.get("/api/database/stats")
async def get_database_stats():
    async with get_db(settings.database_path) as db:
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
    async with get_db(settings.database_path) as db:
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
async def get_all_contacts(limit: int = 100, offset: int = 0, search: str = None):
    async with get_db(settings.database_path) as db:
        base_query = """
            SELECT ct.*, c.name as company_name, c.website_url as company_website
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
        """
        count_query = """
            SELECT COUNT(*) FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
        """
        params = []

        if search:
            search_clause = """
                WHERE ct.first_name LIKE ? OR ct.last_name LIKE ?
                OR ct.email LIKE ? OR c.name LIKE ? OR ct.title LIKE ?
            """
            search_param = f"%{search}%"
            params = [search_param] * 5
            base_query += search_clause
            count_query += search_clause

        base_query += " ORDER BY ct.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await db.execute(base_query, params)
        rows = await cursor.fetchall()

        count_params = [f"%{search}%"] * 5 if search else []
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
    async with get_db(settings.database_path) as db:
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

    async with get_db(settings.database_path) as db:
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
    async with get_db(settings.database_path) as db:
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

    async with get_db(settings.database_path) as db:
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
    async with get_db(settings.database_path) as db:
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
    async with get_db(settings.database_path) as db:
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

    async with get_db(settings.database_path) as db:
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

    async with get_db(settings.database_path) as db:
        cursor = await db.execute(
            "SELECT id FROM contacts WHERE id = ?",
            (contact_id,)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contact not found")

        await db.execute(
            "UPDATE contacts SET stage = ? WHERE id = ?",
            (stage_update.stage, contact_id)
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


@app.get("/api/contacts/{contact_id}/outreach")
async def get_contact_outreach(contact_id: str):
    """Get outreach history for a contact."""
    async with get_db(settings.database_path) as db:
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

    async with get_db(settings.database_path) as db:
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
    async with get_db(settings.database_path) as db:
        cursor = await db.execute(
            """
            SELECT
                ct.id,
                ct.first_name,
                ct.last_name,
                ct.title,
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

        # Group by stage
        pipeline = {stage: [] for stage in VALID_STAGES}
        for row in rows:
            contact = dict(row)
            stage = contact.get("stage") or "new"
            if stage in pipeline:
                pipeline[stage].append(contact)
            else:
                # Default to 'new' if stage is invalid
                pipeline["new"].append(contact)

        return pipeline


# Mount static files last to avoid conflicting with API routes
app.mount("/", StaticFiles(directory="app/static", html=True), name="static")
