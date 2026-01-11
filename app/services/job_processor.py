# app/services/job_processor.py
import asyncio
import uuid
import random
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.database import get_db
from app.services.company_search import search_linkedin_url
from app.services.linkedin_client import LinkedInMCPClient
from app.services.verifier import verify_company
from app.services.keyword_extractor import extract_keywords


async def create_job(db_path: str, filename: str, companies: List[dict]) -> str:
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


async def get_job_status(db_path: str, job_id: str) -> Optional[Dict[str, Any]]:
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
