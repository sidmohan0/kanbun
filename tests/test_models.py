# tests/test_models.py
import pytest
from datetime import datetime


def test_job_response_model():
    from app.models import JobResponse

    job = JobResponse(
        id="123",
        filename="test.csv",
        status="pending",
        total_companies=10,
        processed_count=0,
        created_at=datetime.now()
    )

    assert job.id == "123"
    assert job.status == "pending"


def test_company_response_model():
    from app.models import CompanyResponse

    company = CompanyResponse(
        id="456",
        name="Acme Inc",
        website_url="https://acme.com",
        linkedin_url="https://linkedin.com/company/acme",
        url_verified=True,
        status="completed"
    )

    assert company.name == "Acme Inc"
    assert company.url_verified is True


def test_keywords_model():
    from app.models import KeywordsResponse

    keywords = KeywordsResponse(
        core_product=["CRM", "sales software"],
        category_language=["B2B SaaS"],
        industry_depth=["API-first"],
        pain_points=["reduce churn"],
        customer_segments=["enterprise"]
    )

    assert "CRM" in keywords.core_product
