"""Audit logging - records every admin action to the database."""
import logging
import re

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User

log = logging.getLogger(__name__)


_EMAIL_RE = re.compile(r"^([^@]+)@(.+)$")


def _mask_email(value: str) -> str:
    m = _EMAIL_RE.match(value)
    if not m:
        return value
    local, domain = m.groups()
    if len(local) <= 2:
        return f"{local[:1]}*@{domain}"
    return f"{local[0]}{'*' * (len(local) - 2)}{local[-1]}@{domain}"


def _redact(detail):
    if detail is None:
        return None
    if isinstance(detail, dict):
        return {k: _redact(v) for k, v in detail.items()}
    if isinstance(detail, list):
        return [_redact(v) for v in detail]
    if isinstance(detail, str):
        if "@" in detail and "." in detail.split("@")[-1]:
            return _mask_email(detail)
        return detail[:500]
    return detail


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def log_audit(
    db: Session,
    actor: User,
    action: str,
    resource_type: str,
    resource_id: str | int | None = None,
    detail: dict | None = None,
    ip_address: str | None = None,
) -> None:
    """Write an audit entry in its own transaction, independent of the caller's session.

    Using a separate session guarantees the record is committed even if the
    caller's transaction is later rolled back. Failures are logged but never
    propagated - audit must not break the primary operation.
    """
    from app.database import SessionLocal  # local import avoids circular dependency

    entry = AuditLog(
        actor_id=actor.id,
        actor_email=actor.email,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        detail=_redact(detail),
        ip_address=ip_address,
    )
    audit_db = SessionLocal()
    try:
        audit_db.add(entry)
        audit_db.commit()
    except Exception:
        audit_db.rollback()
        log.warning("Audit write failed: action=%s actor_id=%s", action, actor.id)
    finally:
        audit_db.close()
