# tests/test_verifier.py
import pytest


def test_extract_domain_simple():
    from app.services.verifier import extract_domain

    assert extract_domain("https://acme.com") == "acme.com"
    assert extract_domain("http://www.acme.com") == "acme.com"
    assert extract_domain("https://acme.com/about") == "acme.com"


def test_extract_domain_with_subdomain():
    from app.services.verifier import extract_domain

    assert extract_domain("https://blog.acme.com") == "blog.acme.com"
    assert extract_domain("https://www.blog.acme.com") == "blog.acme.com"


def test_verify_company_exact_match():
    from app.services.verifier import verify_company

    assert verify_company("https://acme.com", "https://acme.com") is True
    assert verify_company("https://www.acme.com", "http://acme.com/") is True


def test_verify_company_subdomain_match():
    from app.services.verifier import verify_company

    assert verify_company("https://blog.acme.com", "https://acme.com") is True
    assert verify_company("https://acme.com", "https://blog.acme.com") is True


def test_verify_company_no_match():
    from app.services.verifier import verify_company

    assert verify_company("https://acme.com", "https://different.com") is False
    assert verify_company("https://acme.com", "https://notacme.com") is False
