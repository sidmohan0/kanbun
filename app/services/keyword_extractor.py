# app/services/keyword_extractor.py
import json
import anthropic
from typing import Dict, List, Optional

EXTRACTION_PROMPT = """Analyze this company's About Us description and extract keywords.

Company: {company_name}
About Us: {about_text}

Extract keywords in these categories:

1. Core Product Terms - What they sell/build (e.g., "CRM software", "payment processing")
2. Category Language - Market category they operate in (e.g., "B2B SaaS", "fintech")
3. Industry Depth Words - Technical/industry-specific terms (e.g., "API-first", "SOC 2 compliant")
4. Pain Point Words - Problems they solve (e.g., "reduce churn", "automate workflows")
5. Customer Segment Mentions - Who they serve (e.g., "enterprise", "SMB", "healthcare providers")

Return JSON only, no other text:
{{
  "core_product": ["term1", "term2"],
  "category_language": ["term1", "term2"],
  "industry_depth": ["term1", "term2"],
  "pain_points": ["term1", "term2"],
  "customer_segments": ["term1", "term2"]
}}"""

MIN_DESCRIPTION_LENGTH = 20


async def extract_keywords(
    company_name: str,
    about_text: str,
    api_key: str
) -> Optional[Dict[str, List[str]]]:
    if not about_text or len(about_text.strip()) < MIN_DESCRIPTION_LENGTH:
        return None

    client = anthropic.AsyncAnthropic(api_key=api_key)

    prompt = EXTRACTION_PROMPT.format(
        company_name=company_name,
        about_text=about_text
    )

    response = await client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )

    text = response.content[0].text.strip()

    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]

    result = json.loads(text)

    return {
        "core_product": result.get("core_product", []),
        "category_language": result.get("category_language", []),
        "industry_depth": result.get("industry_depth", []),
        "pain_points": result.get("pain_points", []),
        "customer_segments": result.get("customer_segments", [])
    }
