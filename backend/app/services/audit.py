"""Audit logging — records every admin action to the database."""
import re

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User


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
    """Append an audit entry to the session. Caller is responsible for commit."""
    entry = AuditLog(
        actor_id=actor.id,
        actor_email=actor.email,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        detail=_redact(detail),
        ip_address=ip_address,
    )
    db.add(entry)
