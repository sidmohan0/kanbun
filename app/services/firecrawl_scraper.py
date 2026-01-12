# app/services/firecrawl_scraper.py
"""
Firecrawl-based website scraper for company data extraction.
Uses Firecrawl v2 SDK for website scraping.
"""
import json
from typing import Optional
from firecrawl import FirecrawlApp


# Schema for structured data extraction
COMPANY_EXTRACT_PROMPT = """Extract the following information about this company from their website:

1. Company Description - A brief description of what the company does (2-3 sentences)
2. Mission Statement - The company's mission or vision statement if available
3. Products/Services - Main products or services they offer (comma-separated list)
4. Target Customers - Who their target customers are (e.g., "enterprise", "SMB", "developers")
5. Industry - The industry or market they operate in
6. Founded Year - Year the company was founded (just the year, e.g., "2020")
7. Headquarters - Company headquarters location (city, state/country)
8. Company Size - Employee count or size indicator (e.g., "50-100", "startup", "enterprise")
9. Pricing Model - Their pricing approach (e.g., "freemium", "enterprise", "subscription", "usage-based")
10. Technologies - Key technologies they use or offer (comma-separated)
11. Social Links - Social media URLs (Twitter, LinkedIn, etc.)

Return as JSON with these exact keys:
{
    "company_description": "...",
    "mission_statement": "...",
    "products_services": "...",
    "target_customers": "...",
    "industry": "...",
    "founded_year": "...",
    "headquarters": "...",
    "company_size": "...",
    "pricing_model": "...",
    "technologies": "...",
    "social_links": {"twitter": "...", "linkedin": "..."}
}

If information is not found, use null for that field."""


class FirecrawlClient:
    """Firecrawl client for website scraping using v2 SDK."""

    def __init__(self, api_key: str):
        self.client = FirecrawlApp(api_key=api_key)

    def scrape_company_sync(self, website_url: str) -> dict:
        """Synchronous scrape of company website."""
        try:
            # Basic scrape for metadata and markdown content
            result = self.client.scrape(
                website_url,
                formats=['markdown'],
            )

            if not result:
                return {"error": f"Failed to scrape {website_url}"}

            # Access attributes from the Document object
            metadata = result.metadata
            markdown_content = result.markdown or ''

            # Build result dict from Document attributes
            output = {
                "meta_title": metadata.title if metadata else '',
                "meta_description": metadata.description if metadata else '',
                "og_image_url": metadata.og_image if metadata else '',
                "raw_content": markdown_content[:10000] if markdown_content else '',
                # These will be populated from extract or left as None
                "company_description": None,
                "mission_statement": None,
                "products_services": None,
                "target_customers": None,
                "industry": None,
                "founded_year": None,
                "headquarters": None,
                "company_size": None,
                "pricing_model": None,
                "technologies": None,
                "social_links": None,
            }

            # Try to extract structured data using the extract endpoint
            try:
                extract_result = self.client.extract(
                    urls=[website_url],
                    prompt=COMPANY_EXTRACT_PROMPT
                )

                # The extract endpoint returns data directly in result.data
                if extract_result and extract_result.success and extract_result.data:
                    data = extract_result.data
                    if isinstance(data, dict):
                        output.update({
                            "company_description": data.get('company_description'),
                            "mission_statement": data.get('mission_statement'),
                            "products_services": data.get('products_services'),
                            "target_customers": data.get('target_customers'),
                            "industry": data.get('industry'),
                            "founded_year": data.get('founded_year'),
                            "headquarters": data.get('headquarters'),
                            "company_size": data.get('company_size'),
                            "pricing_model": data.get('pricing_model'),
                            "technologies": data.get('technologies'),
                            "social_links": json.dumps(data.get('social_links')) if data.get('social_links') else None,
                        })
            except Exception as e:
                # Extract failed, but we still have metadata
                print(f"[WARN] Extract failed for {website_url}: {e}")

                # Try to use meta description as company description fallback
                if not output["company_description"] and output["meta_description"]:
                    output["company_description"] = output["meta_description"]

            return output

        except Exception as e:
            return {"error": str(e)}
