"""Application settings, read from environment variables or backend/.env."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Example: postgresql+psycopg://scan2drive_app:PASSWORD@localhost:5432/scan2drive
    # If the password has special characters (@ : / #), URL-encode them.
    database_url: str


settings = Settings()
