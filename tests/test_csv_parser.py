# tests/test_csv_parser.py
import pytest
import io


def test_parse_csv_valid():
    from app.services.csv_parser import parse_csv, CSVValidationError

    csv_content = b"company_name,website_url\nAcme Inc,https://acme.com\nFoo Corp,https://foo.io"
    file = io.BytesIO(csv_content)

    companies = parse_csv(file)

    assert len(companies) == 2
    assert companies[0]["company_name"] == "Acme Inc"
    assert companies[0]["website_url"] == "https://acme.com"


def test_parse_csv_missing_column():
    from app.services.csv_parser import parse_csv, CSVValidationError

    csv_content = b"company_name,email\nAcme Inc,test@acme.com"
    file = io.BytesIO(csv_content)

    with pytest.raises(CSVValidationError) as exc:
        parse_csv(file)

    assert "website_url" in str(exc.value)


def test_parse_csv_empty_file():
    from app.services.csv_parser import parse_csv, CSVValidationError

    csv_content = b""
    file = io.BytesIO(csv_content)

    with pytest.raises(CSVValidationError) as exc:
        parse_csv(file)

    assert "empty" in str(exc.value).lower()


def test_parse_csv_skips_empty_rows():
    from app.services.csv_parser import parse_csv

    csv_content = b"company_name,website_url\nAcme Inc,https://acme.com\n,\nFoo Corp,https://foo.io"
    file = io.BytesIO(csv_content)

    companies = parse_csv(file)

    assert len(companies) == 2
