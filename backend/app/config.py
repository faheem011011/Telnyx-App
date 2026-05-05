"""Application configuration loaded from environment variables."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings."""

    # Telnyx
    telnyx_api_key: str = ""
    telnyx_public_key: str = ""          # Webhook public key from Telnyx portal
    telnyx_phone_number: str = ""
    telnyx_connection_id: str = ""       # SIP Connection ID for WebRTC credentials
    telnyx_messaging_profile_id: str = ""  # Messaging profile for SMS

    # App
    secret_key: str = "dev-secret-key-change-in-production"
    database_url: str = ""
    frontend_url: str = "http://localhost:5173"
    public_backend_url: str = "http://localhost:8000"

    # Resend (transactional email)
    resend_api_key: str = ""
    resend_from_email: str = "noreply@yourdomain.com"

    @property
    def resolved_database_url(self) -> str:
        """Railway provides postgres:// but SQLAlchemy requires postgresql://."""
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        return url

    # JWT
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    algorithm: str = "HS256"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()


settings = get_settings()
