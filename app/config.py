from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    firecrawl_api_key: str = ""
    linkedin_li_at: str = ""
    mcp_server_url: str = "http://localhost:3000"
    database_path: str = "data/kanbun.db"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
