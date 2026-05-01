"""Audit logging — records every admin action to the database."""
from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog, User


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
        detail=detail,
        ip_address=ip_address,
    )
    db.add(entry)
