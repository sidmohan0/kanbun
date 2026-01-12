import os
import pytest


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_PATH", "test.db")

    from app.config import Settings
    settings = Settings()

    assert settings.anthropic_api_key == "test-key"
    assert settings.database_path == "test.db"
    assert settings.effective_database_path == "test.db"


def test_settings_has_defaults(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    from app.config import Settings
    settings = Settings()

    assert settings.database_path == "data/kanbun.db"
    assert settings.mcp_server_url == "http://localhost:3000"
    assert settings.demo_mode == False


def test_demo_mode_uses_demo_database(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "true")

    from app.config import Settings
    settings = Settings()

    assert settings.demo_mode == True
    assert settings.effective_database_path == "data/demo.db"
