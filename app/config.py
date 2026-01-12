from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    firecrawl_api_key: str = ""
    linkedin_li_at: str = ""
    mcp_server_url: str = "http://localhost:3000"
    database_path: str = "data/kanbun.db"
    demo_mode: bool = False

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
