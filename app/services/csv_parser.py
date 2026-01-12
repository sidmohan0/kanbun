# app/services/csv_parser.py
import csv
import io
from typing import BinaryIO, Optional


class CSVValidationError(Exception):
    pass


# Column name variations we accept
COMPANY_NAME_VARIANTS = {"company_name", "company name", "companyname", "company"}
WEBSITE_URL_VARIANTS = {"website_url", "website", "url", "company website", "site", "website url"}
LINKEDIN_URL_VARIANTS = {"company linkedin url", "linkedin_url", "linkedin url", "company_linkedin_url", "linkedin"}

# Contact/Person column variations
FIRST_NAME_VARIANTS = {"first_name", "first name", "firstname", "first"}
LAST_NAME_VARIANTS = {"last_name", "last name", "lastname", "last"}
EMAIL_VARIANTS = {"email", "email address", "e-mail", "work email"}
PHONE_VARIANTS = {"phone", "phone number", "mobile", "mobile phone", "work phone", "corporate phone"}
TITLE_VARIANTS = {"title", "job title", "position", "role"}
PERSON_LINKEDIN_VARIANTS = {"person linkedin url", "linkedin url", "person linkedin", "contact linkedin"}


def find_column(fieldnames: list[str], variants: set[str]) -> Optional[str]:
    """Find the actual column name from a set of acceptable variants."""
    fieldnames_lower = {f.lower(): f for f in fieldnames}
    for variant in variants:
        if variant in fieldnames_lower:
            return fieldnames_lower[variant]
    return None


def parse_csv(file: BinaryIO) -> dict:
    """Parse CSV and return both companies and contacts."""
    content = file.read()
    if not content.strip():
        raise CSVValidationError("CSV file is empty")

    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise CSVValidationError("CSV file is empty")

    # Find company column names
    company_col = find_column(reader.fieldnames, COMPANY_NAME_VARIANTS)
    website_col = find_column(reader.fieldnames, WEBSITE_URL_VARIANTS)
    linkedin_col = find_column(reader.fieldnames, LINKEDIN_URL_VARIANTS)

    # Find contact column names
    first_name_col = find_column(reader.fieldnames, FIRST_NAME_VARIANTS)
    last_name_col = find_column(reader.fieldnames, LAST_NAME_VARIANTS)
    email_col = find_column(reader.fieldnames, EMAIL_VARIANTS)
    phone_col = find_column(reader.fieldnames, PHONE_VARIANTS)
    title_col = find_column(reader.fieldnames, TITLE_VARIANTS)
    person_linkedin_col = find_column(reader.fieldnames, PERSON_LINKEDIN_VARIANTS)

    missing = []
    if not company_col:
        missing.append("company_name (or 'Company Name')")
    if not website_col:
        missing.append("website_url (or 'Website')")

    if missing:
        raise CSVValidationError(f"Missing required columns: {', '.join(missing)}")

    companies = {}  # company_name.lower() -> company_data
    contacts = []

    for row in reader:
        company_name = row.get(company_col, "").strip()
        website_url = row.get(website_col, "").strip()
        company_linkedin = row.get(linkedin_col, "").strip() if linkedin_col else ""

        if not company_name or not website_url:
            continue

        # Add/update company (deduplicate by name)
        company_key = company_name.lower()
        if company_key not in companies:
            companies[company_key] = {
                "company_name": company_name,
                "website_url": website_url,
                "linkedin_url": company_linkedin
            }

        # Extract contact data if available
        first_name = row.get(first_name_col, "").strip() if first_name_col else ""
        last_name = row.get(last_name_col, "").strip() if last_name_col else ""
        email = row.get(email_col, "").strip() if email_col else ""

        if first_name or last_name or email:  # At least some contact info
            contact = {
                "company_name": company_name,  # Used to link to company
                "first_name": first_name,
                "last_name": last_name,
                "email": email,
                "phone": row.get(phone_col, "").strip() if phone_col else "",
                "title": row.get(title_col, "").strip() if title_col else "",
                "linkedin_url": row.get(person_linkedin_col, "").strip() if person_linkedin_col else ""
            }
            contacts.append(contact)

    if not companies:
        raise CSVValidationError("No valid company rows found in CSV")

    return {
        "companies": list(companies.values()),
        "contacts": contacts
    }
