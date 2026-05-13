"""Application configuration loaded from environment variables."""
from functools import lru_cache
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_SECRET = "dev-secret-key-change-in-production"


class Settings(BaseSettings):
    """Application settings."""

    # Telnyx
    telnyx_api_key: str = ""
    telnyx_public_key: str = ""          # Webhook public key from Telnyx portal
    telnyx_phone_number: str = ""
    telnyx_connection_id: str = ""       # SIP Connection ID for WebRTC credentials
    telnyx_messaging_profile_id: str = ""  # Messaging profile for SMS

    # App
    secret_key: str = _DEV_SECRET

    @model_validator(mode="after")
    def _require_strong_secret(self) -> "Settings":
        if self.secret_key == _DEV_SECRET:
            raise ValueError(
                "SECRET_KEY is still the dev default — set a strong random value "
                "in your environment before starting the server. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        if len(self.secret_key) < 32:
            raise ValueError("SECRET_KEY must be at least 32 characters.")
        return self
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

    # Initial setup token — gates POST /api/auth/setup. Empty disables endpoint.
    initial_setup_token: str = ""

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
