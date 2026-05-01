"""Email verification token helpers."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.config import settings
from app.models import EmailVerificationToken


def issue_verification_token(user_id: int, db: Session) -> str:
    """Invalidate outstanding tokens, create a new one, return the raw token."""
    db.query(EmailVerificationToken).filter(
        EmailVerificationToken.user_id == user_id,
        EmailVerificationToken.used == False,  # noqa: E712
    ).update({"used": True})

    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)

    db.add(EmailVerificationToken(
        user_id=user_id,
        token_hash=token_hash,
        expires_at=expires_at,
    ))
    return raw_token


def make_verification_url(raw_token: str) -> str:
    return f"{settings.frontend_url}/verify-email?token={raw_token}"
