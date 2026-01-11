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
