# app/services/verifier.py
from urllib.parse import urlparse


def extract_domain(url: str) -> str:
    if not url:
        return ""

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    parsed = urlparse(url)
    domain = parsed.netloc.lower()

    if domain.startswith("www."):
        domain = domain[4:]

    return domain


def verify_company(csv_website: str, linkedin_website: str) -> bool:
    csv_domain = extract_domain(csv_website)
    linkedin_domain = extract_domain(linkedin_website)

    if not csv_domain or not linkedin_domain:
        return False

    if csv_domain == linkedin_domain:
        return True

    if csv_domain.endswith("." + linkedin_domain):
        return True
    if linkedin_domain.endswith("." + csv_domain):
        return True

    return False
