# app/services/csv_parser.py
import csv
import io
from typing import BinaryIO


class CSVValidationError(Exception):
    pass


REQUIRED_COLUMNS = {"company_name", "website_url"}


def parse_csv(file: BinaryIO) -> list[dict]:
    content = file.read()
    if not content.strip():
        raise CSVValidationError("CSV file is empty")

    text = content.decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))

    if not reader.fieldnames:
        raise CSVValidationError("CSV file is empty")

    columns = set(reader.fieldnames)
    missing = REQUIRED_COLUMNS - columns
    if missing:
        raise CSVValidationError(f"Missing required columns: {', '.join(missing)}")

    companies = []
    for row in reader:
        name = row.get("company_name", "").strip()
        url = row.get("website_url", "").strip()
        if name and url:
            companies.append({
                "company_name": name,
                "website_url": url
            })

    if not companies:
        raise CSVValidationError("No valid company rows found in CSV")

    return companies
