"""Application settings, read from environment variables or backend/.env."""
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # Example: postgresql+psycopg://scan2drive_app:PASSWORD@localhost:5432/scan2drive
    # If the password has special characters (@ : / #), URL-encode them.
    database_url: str

    environment: str = "development"  # set to "production" on the server
    # Signs the login tokens. Generate one with:
    #   python -c "import secrets; print(secrets.token_urlsafe(48))"
    secret_key: str = DEV_SECRET

    driver_token_days: int = 30  # drivers stay signed in on their phone
    admin_token_minutes: int = 480  # admin / viewer sessions expire sooner
    login_max_failures: int = 5  # wrong tries before sign-in is paused
    login_lockout_minutes: int = 15

    # Base address of the web app; QR codes are links like {public_base_url}/p/<token>.
    public_base_url: str = "http://localhost:3000"
    # Where dashboard photos are saved in development (Azure Blob Storage comes later).
    storage_dir: str = "uploads"
    max_photo_mb: int = 5

    # Origins allowed to call the API from a browser (the Next.js dev server).
    cors_origins: list[str] = ["http://localhost:3000"]

    @model_validator(mode="after")
    def _no_dev_secret_in_production(self):
        if self.environment == "production" and (
            self.secret_key == DEV_SECRET or len(self.secret_key) < 32
        ):
            raise ValueError("Set a strong SECRET_KEY (32+ characters) in production")
        return self


settings = Settings()
