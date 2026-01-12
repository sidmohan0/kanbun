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
    # Enriched data from Firecrawl
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    og_image_url: Optional[str] = None
    company_description: Optional[str] = None
    mission_statement: Optional[str] = None
    founded_year: Optional[str] = None
    headquarters: Optional[str] = None
    company_size: Optional[str] = None
    industry: Optional[str] = None
    pricing_model: Optional[str] = None
    social_links: Optional[str] = None
    technologies: Optional[str] = None
    products_services: Optional[str] = None
    target_customers: Optional[str] = None


class ContactResponse(BaseModel):
    id: str
    company_id: Optional[str] = None
    job_id: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None
    company_name: Optional[str] = None


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
    duplicates_skipped: int = 0
    total_contacts: int = 0


class JobStatusResponse(BaseModel):
    status: str
    total: int
    processed: int
    failed_count: int
