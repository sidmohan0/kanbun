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


# Mount static files last to avoid conflicting with API routes
# The index.html will be served for the root path
app.mount("/", StaticFiles(directory="app/static", html=True), name="static")
