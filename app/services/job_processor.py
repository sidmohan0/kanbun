# app/services/job_processor.py
import asyncio
import uuid
import random
import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

from app.database import get_db
from app.services.firecrawl_scraper import FirecrawlClient
from app.services.keyword_extractor import extract_keywords
from app.services.screenshot_service import capture_screenshot, screenshot_exists

# Thread pool for sync Firecrawl operations
_executor = ThreadPoolExecutor(max_workers=2)


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
    firecrawl_api_key: str,
    anthropic_api_key: str
) -> None:
    """Process a job using Firecrawl for website scraping."""
    async with get_db(db_path) as db:
        await db.execute(
            "UPDATE jobs SET status = 'processing' WHERE id = ?",
            (job_id,)
        )
        await db.commit()

    firecrawl_client = FirecrawlClient(firecrawl_api_key)

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
                firecrawl_client,
                anthropic_api_key
            )

            # Rate limiting - Firecrawl has 21 req/min limit, each company uses 2 calls
            # So we need ~6 seconds between companies to stay under limit
            delay = random.uniform(6, 8)
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

    except Exception as e:
        async with get_db(db_path) as db:
            await db.execute(
                "UPDATE jobs SET status = 'failed' WHERE id = ?",
                (job_id,)
            )
            await db.commit()
        raise


async def process_company(
    db_path: str,
    job_id: str,
    company: dict,
    firecrawl_client: FirecrawlClient,
    anthropic_api_key: str
) -> None:
    """Process a single company using Firecrawl."""
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
            # Skip scraping, just do keyword extraction
            about_text = existing["company_description"]
        else:
            # Scrape website with Firecrawl
            loop = asyncio.get_event_loop()
            scraped_data = await loop.run_in_executor(
                _executor,
                firecrawl_client.scrape_company_sync,
                website_url
            )

            if scraped_data.get("error"):
                await mark_company_failed(db_path, job_id, company_id, scraped_data["error"])
                return

            # Store enriched data
            about_text = scraped_data.get("company_description") or scraped_data.get("meta_description") or ""
            raw_content = scraped_data.get("raw_content", "")

            async with get_db(db_path) as db:
                await db.execute(
                    """UPDATE companies SET
                        meta_title = ?,
                        meta_description = ?,
                        og_image_url = ?,
                        company_description = ?,
                        mission_statement = ?,
                        founded_year = ?,
                        headquarters = ?,
                        company_size = ?,
                        industry = ?,
                        pricing_model = ?,
                        social_links = ?,
                        technologies = ?,
                        products_services = ?,
                        target_customers = ?
                    WHERE id = ?""",
                    (
                        scraped_data.get("meta_title"),
                        scraped_data.get("meta_description"),
                        scraped_data.get("og_image_url"),
                        scraped_data.get("company_description"),
                        scraped_data.get("mission_statement"),
                        scraped_data.get("founded_year"),
                        scraped_data.get("headquarters"),
                        scraped_data.get("company_size"),
                        scraped_data.get("industry"),
                        scraped_data.get("pricing_model"),
                        scraped_data.get("social_links"),
                        scraped_data.get("technologies"),
                        scraped_data.get("products_services"),
                        scraped_data.get("target_customers"),
                        company_id
                    )
                )

                # Store raw content in about_descriptions for keyword extraction
                if raw_content:
                    about_id = str(uuid.uuid4())
                    await db.execute(
                        "INSERT OR REPLACE INTO about_descriptions (id, company_id, raw_text) VALUES (?, ?, ?)",
                        (about_id, company_id, raw_content[:10000])
                    )

                await db.commit()

        # Extract keywords from description
        text_for_keywords = about_text or scraped_data.get("raw_content", "")
        if text_for_keywords and len(text_for_keywords) > 20:
            keywords = await extract_keywords(company["name"], text_for_keywords, anthropic_api_key)

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

        # Capture screenshot if we don't already have one
        if not screenshot_exists(company_id):
            try:
                await capture_screenshot(website_url, company_id)
            except Exception as e:
                # Screenshot failure shouldn't fail the whole company
                print(f"[WARN] Screenshot failed for {website_url}: {e}")

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
