from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    firecrawl_api_key: str = ""
    linkedin_li_at: str = ""
    mcp_server_url: str = "http://localhost:3000"
    database_path: str = "data/kanbun.db"
    demo_mode: bool = False

    # Email OAuth Settings
    email_encryption_key: str = ""
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    gmail_redirect_uri: str = "http://localhost:8000/api/email/callback/gmail"
    outlook_client_id: str = ""
    outlook_client_secret: str = ""
    outlook_redirect_uri: str = "http://localhost:8000/api/email/callback/outlook"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def effective_database_path(self) -> str:
        """Returns demo database path if demo_mode is enabled."""
        if self.demo_mode:
            return "data/demo.db"
        return self.database_path


settings = Settings()
