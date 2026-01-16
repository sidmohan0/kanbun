# app/services/job_processor.py
import asyncio
import uuid
import random
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import anthropic

from app.database import get_db
from app.services.keyword_extractor import extract_keywords
from app.services.screenshot_service import enrich_company_website, screenshot_exists


# Path to the backup script
BACKUP_SCRIPT = Path(__file__).parent.parent.parent / "scripts" / "backup_to_gdrive.sh"


async def trigger_cloud_backup():
    """Trigger a cloud backup after job completion."""
    if not BACKUP_SCRIPT.exists():
        print(f"[WARN] Backup script not found: {BACKUP_SCRIPT}")
        return

    try:
        # Run backup script in background (non-blocking)
        process = await asyncio.create_subprocess_exec(
            "/bin/bash", str(BACKUP_SCRIPT),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL
        )
        print(f"[INFO] Cloud backup triggered (pid: {process.pid})")
    except Exception as e:
        print(f"[WARN] Failed to trigger cloud backup: {e}")


async def create_job(
    db_path: str,
    filename: str,
    companies: List[dict],
    contacts: List[dict] = None
) -> str:
    """Create a new job with companies and optionally contacts."""
    job_id = str(uuid.uuid4())
    contacts = contacts or []

    # Map company names to IDs for linking contacts
    company_ids = {}

    async with get_db(db_path) as db:
        await db.execute(
            "INSERT INTO jobs (id, filename, status, total_companies) VALUES (?, ?, ?, ?)",
            (job_id, filename, "pending", len(companies))
        )

        # Insert companies
        for company in companies:
            company_id = str(uuid.uuid4())
            company_ids[company["company_name"].lower()] = company_id
            linkedin_url = company.get("linkedin_url", "")
            await db.execute(
                "INSERT INTO companies (id, job_id, name, website_url, linkedin_url, status) VALUES (?, ?, ?, ?, ?, ?)",
                (company_id, job_id, company["company_name"], company["website_url"], linkedin_url or None, "pending")
            )

        # Insert contacts
        for contact in contacts:
            contact_id = str(uuid.uuid4())
            company_id = company_ids.get(contact["company_name"].lower())
            await db.execute(
                """INSERT INTO contacts (id, company_id, job_id, first_name, last_name, email, phone, title, linkedin_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    contact_id,
                    company_id,
                    job_id,
                    contact.get("first_name"),
                    contact.get("last_name"),
                    contact.get("email"),
                    contact.get("phone"),
                    contact.get("title"),
                    contact.get("linkedin_url")
                )
            )

        await db.commit()

    return job_id


async def get_job_status(db_path: str, job_id: str) -> Optional[Dict[str, Any]]:
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT status, total_companies FROM jobs WHERE id = ?",
            (job_id,)
        )
        row = await cursor.fetchone()

        if not row:
            return None

        # Count actual completed and failed companies (not retry attempts)
        cursor = await db.execute(
            "SELECT COUNT(*) FROM companies WHERE job_id = ? AND status = 'completed'",
            (job_id,)
        )
        completed_count = (await cursor.fetchone())[0]

        cursor = await db.execute(
            "SELECT COUNT(*) FROM companies WHERE job_id = ? AND status = 'failed'",
            (job_id,)
        )
        failed_count = (await cursor.fetchone())[0]

        return {
            "status": row["status"],
            "total": row["total_companies"],
            "processed": completed_count + failed_count,
            "failed_count": failed_count
        }


async def get_job(db_path: str, job_id: str) -> Optional[Dict[str, Any]]:
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT * FROM jobs WHERE id = ?",
            (job_id,)
        )
        row = await cursor.fetchone()
        if row:
            return dict(row)
        return None


async def get_job_companies(db_path: str, job_id: str) -> List[dict]:
    async with get_db(db_path) as db:
        cursor = await db.execute(
            "SELECT * FROM companies WHERE job_id = ? ORDER BY created_at",
            (job_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_job_contacts(db_path: str, job_id: str) -> List[dict]:
    """Get all contacts for a job."""
    async with get_db(db_path) as db:
        cursor = await db.execute(
            """SELECT ct.*, c.name as company_name
               FROM contacts ct
               LEFT JOIN companies c ON ct.company_id = c.id
               WHERE ct.job_id = ?
               ORDER BY ct.created_at""",
            (job_id,)
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_job_results(db_path: str, job_id: str) -> List[dict]:
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

            # Get keywords
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

            # Get contacts for this company
            cursor = await db.execute(
                "SELECT * FROM contacts WHERE company_id = ?",
                (company_dict["id"],)
            )
            contact_rows = await cursor.fetchall()
            contacts = [dict(c) for c in contact_rows]

            results.append({
                "company": company_dict,
                "about_text": company_dict.get("about_text"),
                "keywords": keywords,
                "contacts": contacts
            })

        return results


async def process_job(
    db_path: str,
    job_id: str,
    firecrawl_api_key: str,  # Kept for API compatibility, no longer used
    anthropic_api_key: str
) -> None:
    """Process a job using Playwright + Claude for enrichment."""
    async with get_db(db_path) as db:
        await db.execute(
            "UPDATE jobs SET status = 'processing' WHERE id = ?",
            (job_id,)
        )
        await db.commit()

    try:
        companies = await get_job_companies(db_path, job_id)

        for company in companies:
            # Check if job was cancelled
            job_status = await get_job_status(db_path, job_id)
            if job_status and job_status["status"] == "cancelled":
                return

            # Skip already processed companies
            if company.get("status") not in ("pending", None):
                continue

            await process_company(
                db_path,
                job_id,
                company,
                anthropic_api_key
            )

            # Small delay between companies to be polite
            delay = random.uniform(1, 2)
            await asyncio.sleep(delay)

        # Mark job complete
        job_status = await get_job_status(db_path, job_id)
        if job_status and job_status["status"] != "cancelled":
            async with get_db(db_path) as db:
                await db.execute(
                    "UPDATE jobs SET status = 'completed', completed_at = ? WHERE id = ?",
                    (datetime.now().isoformat(), job_id)
                )
                await db.commit()

            # Trigger cloud backup after job completes
            await trigger_cloud_backup()

    except Exception as e:
        async with get_db(db_path) as db:
            await db.execute(
                "UPDATE jobs SET status = 'failed' WHERE id = ?",
                (job_id,)
            )
            await db.commit()
        raise


async def summarize_with_claude(extracted_text: str, anthropic_api_key: str) -> str:
    """Use Claude to generate a 2-3 sentence company summary."""
    if not extracted_text or len(extracted_text) < 50:
        return "Could not extract company information"

    try:
        client = anthropic.Anthropic(api_key=anthropic_api_key)
        message = client.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=200,
            messages=[{
                "role": "user",
                "content": f"""Based on this website content, write 2-3 sentences describing what this company does. Be specific about their product/service. If unclear, say so.

Content:
{extracted_text[:2000]}"""
            }]
        )
        return message.content[0].text.strip()
    except Exception as e:
        print(f"[WARN] Claude summarization failed: {e}")
        # Fall back to truncated extracted text
        return extracted_text[:500] if extracted_text else "Could not extract company information"


async def process_company(
    db_path: str,
    job_id: str,
    company: dict,
    anthropic_api_key: str
) -> None:
    """Process a single company using Playwright + Claude."""
    company_id = company["id"]
    website_url = company["website_url"]

    async with get_db(db_path) as db:
        await db.execute(
            "UPDATE companies SET status = 'processing' WHERE id = ?",
            (company_id,)
        )
        await db.commit()

    try:
        # Check if we already have data (from previous failed attempt)
        async with get_db(db_path) as db:
            cursor = await db.execute(
                "SELECT company_description FROM companies WHERE id = ?",
                (company_id,)
            )
            existing = await cursor.fetchone()
            has_existing_data = existing and existing["company_description"]

        if has_existing_data:
            # Skip enrichment, just do keyword extraction
            about_text = existing["company_description"]
        else:
            # Enrich with Playwright (screenshot + text extraction)
            enrichment = await enrich_company_website(website_url, company_id)

            if enrichment.error and not enrichment.screenshot_path:
                await mark_company_failed(db_path, job_id, company_id, enrichment.error)
                return

            # Generate summary with Claude
            company_description = await summarize_with_claude(
                enrichment.extracted_text,
                anthropic_api_key
            )

            about_text = company_description

            # Store enriched data
            async with get_db(db_path) as db:
                await db.execute(
                    """UPDATE companies SET
                        meta_title = ?,
                        meta_description = ?,
                        company_description = ?
                    WHERE id = ?""",
                    (
                        enrichment.meta_title,
                        enrichment.meta_description,
                        company_description,
                        company_id
                    )
                )

                # Store raw extracted text for keyword extraction
                if enrichment.extracted_text:
                    about_id = str(uuid.uuid4())
                    await db.execute(
                        "INSERT OR REPLACE INTO about_descriptions (id, company_id, raw_text) VALUES (?, ?, ?)",
                        (about_id, company_id, enrichment.extracted_text[:10000])
                    )

                await db.commit()

        # Extract keywords from description
        if about_text and len(about_text) > 20:
            keywords = await extract_keywords(company["name"], about_text, anthropic_api_key)

            if keywords:
                async with get_db(db_path) as db:
                    # Clear existing keywords for this company
                    await db.execute("DELETE FROM keywords WHERE company_id = ?", (company_id,))

                    for category, terms in keywords.items():
                        for term in terms:
                            kw_id = str(uuid.uuid4())
                            await db.execute(
                                "INSERT INTO keywords (id, company_id, category, keyword) VALUES (?, ?, ?, ?)",
                                (kw_id, company_id, category, term)
                            )
                    await db.commit()

        await mark_company_done(db_path, job_id, company_id, "completed")

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
