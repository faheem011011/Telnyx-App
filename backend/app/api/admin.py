"""Admin-only endpoints: user management, Telnyx phone number management, audit log."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditLog, PhoneNumber, User
from app.services.email import send_verification_email
from app.services.verification import issue_verification_token, make_verification_url
from app.schemas import (
    AuditLogOut,
    DEPARTMENTS,
    NumberAssignRequest,
    NumberPurchaseRequest,
    NumberSearchResult,
    PhoneNumberOut,
    UserAdminCreate,
    UserAdminUpdate,
    UserOut,
    UserWithNumbersOut,
)
from app.services.audit import get_client_ip, log_audit
from app.services.deps import require_admin
from app.services.security import bump_token_version, hash_password
from app.services.telnyx_service import (
    list_owned_numbers,
    purchase_number,
    release_number,
    search_available_numbers,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ============================================================
# Departments
# ============================================================

@router.get("/departments", response_model=list[str])
def list_departments(_: User = Depends(require_admin)) -> list[str]:
    return list(DEPARTMENTS)


# ============================================================
# User management
# ============================================================

@router.get("/users", response_model=list[UserWithNumbersOut])
def list_users(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[UserWithNumbersOut]:
    users = (
        db.query(User)
        .filter(User.deleted_at.is_(None))
        .order_by(User.created_at.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [UserWithNumbersOut.model_validate(u) for u in users]


@router.post("/users", response_model=UserWithNumbersOut, status_code=status.HTTP_201_CREATED)
def create_user(
    request: Request,
    payload: UserAdminCreate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> UserWithNumbersOut:
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        if existing.deleted_at is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists",
            )
        # H-12: soft-deleted account occupies the unique email slot.
        # Tombstone its email so the constraint doesn't block re-registration.
        # The old row is preserved for audit purposes with a non-reusable address.
        existing.email = f"__deleted_{existing.id}__{existing.email}"
        db.flush()

    user = User(
        email=payload.email,
        name=payload.name,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        department=payload.department,
        is_active=True,
        email_verified=False,
    )
    db.add(user)
    db.flush()

    raw_token = issue_verification_token(user.id, db)

    log_audit(
        db, current_admin,
        action="user.create",
        resource_type="user",
        resource_id=str(user.id),
        detail={"email": user.email, "name": user.name, "role": user.role, "department": user.department},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(user)

    verify_url = make_verification_url(raw_token)
    try:
        send_verification_email(user.email, verify_url)
    except Exception:
        log.exception("Best-effort verification email send failed for new user_id=%s", user.id)

    return UserWithNumbersOut.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserWithNumbersOut)
def update_user(
    request: Request,
    user_id: int,
    payload: UserAdminUpdate,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> UserWithNumbersOut:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if user_id == current_admin.id and payload.role is not None and payload.role != current_admin.role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot change your own role. Ask another admin.",
        )

    changes: dict = {}
    if payload.name is not None and payload.name != user.name:
        changes["name"] = {"from": user.name, "to": payload.name}
        user.name = payload.name
    if payload.role is not None and payload.role != user.role:
        changes["role"] = {"from": user.role, "to": payload.role}
        user.role = payload.role
    if payload.department is not None and payload.department != user.department:
        changes["department"] = {"from": user.department, "to": payload.department}
        user.department = payload.department
    if payload.is_active is not None and payload.is_active != user.is_active:
        changes["is_active"] = {"from": user.is_active, "to": payload.is_active}
        user.is_active = payload.is_active
    if payload.phone_number is not None:
        changes["phone_number"] = {"from": user.phone_number, "to": payload.phone_number or None}
        user.phone_number = payload.phone_number or None
    if payload.password is not None:
        changes["password"] = "reset"
        user.hashed_password = hash_password(payload.password)
        bump_token_version(user)

    if changes:
        log_audit(
            db, current_admin,
            action="user.update",
            resource_type="user",
            resource_id=str(user_id),
            detail={"target_email": user.email, "changes": changes},
            ip_address=get_client_ip(request),
        )

    db.commit()
    db.refresh(user)
    return UserWithNumbersOut.model_validate(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    if user_id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    deleted_info = {
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "action": "soft_delete",
    }

    user.is_active = False
    user.deleted_at = datetime.now(timezone.utc)
    bump_token_version(user)

    log_audit(
        db, current_admin,
        action="user.delete",
        resource_type="user",
        resource_id=str(user_id),
        detail=deleted_info,
        ip_address=get_client_ip(request),
    )
    db.commit()


@router.post("/users/{user_id}/resend-verification", status_code=status.HTTP_204_NO_CONTENT)
def resend_verification(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.email_verified:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already verified")

    raw_token = issue_verification_token(user.id, db)
    db.commit()

    verify_url = make_verification_url(raw_token)
    try:
        send_verification_email(user.email, verify_url)
    except Exception:
        log.exception("Best-effort resend verification email failed for user_id=%s", user.id)

    log_audit(
        db, current_admin,
        action="user.resend_verification",
        resource_type="user",
        resource_id=str(user_id),
        detail={"email": user.email},
        ip_address=get_client_ip(request),
    )
    db.commit()


# ============================================================
# Phone number management
# ============================================================

@router.get("/numbers", response_model=list[PhoneNumberOut])
def list_numbers(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[PhoneNumberOut]:
    numbers = (
        db.query(PhoneNumber)
        .outerjoin(User, PhoneNumber.assigned_to_user_id == User.id)
        .order_by(PhoneNumber.purchased_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [PhoneNumberOut.model_validate(n) for n in numbers]


@router.post("/numbers/sync", response_model=list[PhoneNumberOut])
def sync_numbers(
    request: Request,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> list[PhoneNumberOut]:
    try:
        owned = list_owned_numbers()
    except Exception:
        log.exception("Telnyx list_owned_numbers failed during sync")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Number sync service unavailable. Please try again or contact support.",
        )

    synced = []
    for n in owned:
        # Match by phone_number first (stable across sid format changes),
        # then fall back to sid. This prevents IntegrityError when the DB
        # has a different sid format (E.164 vs UUID) than what the API returns.
        # M-19: per-number try/except IntegrityError so a duplicate sid (rare
        # but possible if Telnyx returns dupes) is logged + skipped instead of
        # nuking the entire sync.
        try:
            existing = (
                db.query(PhoneNumber)
                .filter(PhoneNumber.phone_number == n["phone_number"])
                .first()
            )
            if existing is None:
                tn = PhoneNumber(
                    sid=n["sid"],
                    phone_number=n["phone_number"],
                    friendly_name=n["friendly_name"],
                    cap_voice=n["cap_voice"],
                    cap_sms=n["cap_sms"],
                    cap_mms=n["cap_mms"],
                )
                db.add(tn)
                db.flush()
                synced.append(tn)
            else:
                # Update sid to the canonical resource ID returned by the API
                existing.sid = n["sid"]
                db.flush()
                synced.append(existing)
        except IntegrityError:
            db.rollback()
            log.warning(
                "Sync skipped duplicate sid=%s phone=%s",
                n.get("sid"),
                n.get("phone_number"),
            )
            continue

    log_audit(
        db, current_admin,
        action="number.sync",
        resource_type="number",
        detail={"total_in_account": len(owned)},
        ip_address=get_client_ip(request),
    )
    db.commit()
    for tn in synced:
        try:
            db.refresh(tn)
        except Exception:
            log.exception("Failed to refresh PhoneNumber row id=%s after sync", getattr(tn, "id", None))

    return [PhoneNumberOut.model_validate(n) for n in synced]


@router.get("/numbers/search", response_model=list[NumberSearchResult])
def search_numbers(
    area_code: str = Query("", pattern=r"^[0-9]{0,3}$", description="3-digit US area code"),
    country: str = Query("US"),
    contains: str = Query("", pattern=r"^[0-9]{0,15}$", description="Digit pattern to match, e.g. 555"),
    limit: int = Query(10, le=30),
    _: User = Depends(require_admin),
) -> list[NumberSearchResult]:
    try:
        results = search_available_numbers(
            area_code=area_code,
            country_code=country,
            contains=contains,
            limit=limit,
        )
    except ValueError:
        log.exception("Telnyx number search misconfiguration")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Number search service unavailable. Please try again or contact support.",
        )
    except Exception:
        log.exception("Telnyx number search failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Number search service unavailable. Please try again or contact support.",
        )
    return [NumberSearchResult(**r) for r in results]


@router.post("/numbers/purchase", response_model=PhoneNumberOut, status_code=status.HTTP_201_CREATED)
def buy_number(
    request: Request,
    payload: NumberPurchaseRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> PhoneNumberOut:
    existing = db.query(PhoneNumber).filter(
        PhoneNumber.phone_number == payload.phone_number
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This number is already in your inventory",
        )

    try:
        result = purchase_number(payload.phone_number)
    except ValueError:
        log.exception("Telnyx purchase_number misconfiguration for %s", payload.phone_number)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Number purchase service unavailable. Please try again or contact support.",
        )
    except Exception:
        log.exception("Telnyx purchase_number failed for %s", payload.phone_number)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Number purchase service unavailable. Please try again or contact support.",
        )

    tn = PhoneNumber(
        sid=result["sid"],
        phone_number=result["phone_number"],
        friendly_name=result["friendly_name"],
        cap_voice=result["cap_voice"],
        cap_sms=result["cap_sms"],
        cap_mms=result["cap_mms"],
    )
    db.add(tn)
    db.flush()

    log_audit(
        db, current_admin,
        action="number.purchase",
        resource_type="number",
        resource_id=tn.phone_number,
        detail={"sid": tn.sid, "friendly_name": tn.friendly_name},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(tn)
    return PhoneNumberOut.model_validate(tn)


@router.post("/numbers/{number_id}/assign", response_model=PhoneNumberOut)
def assign_number(
    request: Request,
    number_id: int,
    payload: NumberAssignRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> PhoneNumberOut:
    # H-14: acquire a row-level lock before reading assigned_to_user_id so two
    # concurrent assign requests serialize here rather than both seeing the
    # pre-assignment state and letting the last writer silently win.
    tn = db.query(PhoneNumber).filter(PhoneNumber.id == number_id).with_for_update().first()
    if not tn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Number not found")

    user = db.query(User).filter(User.id == payload.user_id).with_for_update().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # M-18: clear any other user whose users.phone_number still points at this
    # number so we don't leave a stale reverse-mapping. Cover both:
    #  (a) a previous assignee on this PhoneNumber row (tn.assigned_to_user_id)
    #  (b) any other user whose users.phone_number happens to match (defensive)
    cleared_user_ids: list[int] = []
    previous_assignee_id = tn.assigned_to_user_id
    if previous_assignee_id and previous_assignee_id != payload.user_id:
        prev = db.query(User).filter(User.id == previous_assignee_id).first()
        if prev and prev.phone_number == tn.phone_number:
            prev.phone_number = None
            cleared_user_ids.append(prev.id)

    stale_users = (
        db.query(User)
        .filter(
            User.phone_number == tn.phone_number,
            User.id != payload.user_id,
        )
        .all()
    )
    for stale in stale_users:
        if stale.id in cleared_user_ids:
            continue
        stale.phone_number = None
        cleared_user_ids.append(stale.id)

    tn.assigned_to_user_id = payload.user_id
    if not user.phone_number:
        user.phone_number = tn.phone_number

    audit_detail = {"assigned_to_user_id": user.id, "assigned_to_email": user.email}
    if cleared_user_ids:
        audit_detail["cleared_user_ids"] = cleared_user_ids
    if previous_assignee_id and previous_assignee_id != payload.user_id:
        audit_detail["previous_assigned_to_user_id"] = previous_assignee_id

    log_audit(
        db, current_admin,
        action="number.assign",
        resource_type="number",
        resource_id=tn.phone_number,
        detail=audit_detail,
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(tn)
    return PhoneNumberOut.model_validate(tn)


@router.post("/numbers/{number_id}/unassign", response_model=PhoneNumberOut)
def unassign_number(
    request: Request,
    number_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> PhoneNumberOut:
    # H-14: lock so concurrent assign/unassign requests on the same number serialize.
    tn = db.query(PhoneNumber).filter(PhoneNumber.id == number_id).with_for_update().first()
    if not tn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Number not found")

    previous_user_id = tn.assigned_to_user_id
    tn.assigned_to_user_id = None

    # C-08: also clear the legacy User.phone_number field for every user that
    # still holds this number. Without this, the User.phone_number fallback in
    # _resolve_user_by_to_number() would continue routing inbound calls/SMS to
    # the former assignee even after the admin believes access is revoked.
    cleared_user_ids: list[int] = []
    stale_users = db.query(User).filter(User.phone_number == tn.phone_number).all()
    for stale in stale_users:
        stale.phone_number = None
        cleared_user_ids.append(stale.id)

    audit_detail: dict = {"previous_user_id": previous_user_id}
    if cleared_user_ids:
        audit_detail["cleared_user_ids"] = cleared_user_ids

    log_audit(
        db, current_admin,
        action="number.unassign",
        resource_type="number",
        resource_id=tn.phone_number,
        detail=audit_detail,
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(tn)
    return PhoneNumberOut.model_validate(tn)


@router.delete("/numbers/{number_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_number(
    request: Request,
    number_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    tn = db.query(PhoneNumber).filter(PhoneNumber.id == number_id).first()
    if not tn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Number not found")

    released_info = {"phone_number": tn.phone_number, "sid": tn.sid}

    try:
        released = release_number(tn.sid)
    except HTTPException:
        raise
    except Exception:
        log.exception("Telnyx release_number failed for sid=%s", tn.sid)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Number release service unavailable. Please try again or contact support.",
        )

    if not released:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Number not found in Telnyx account; refusing to delete local row "
                "out of sync. Sync first via /api/admin/numbers/sync."
            ),
        )

    db.delete(tn)
    log_audit(
        db, current_admin,
        action="number.release",
        resource_type="number",
        resource_id=released_info["phone_number"],
        detail={"sid": released_info["sid"]},
        ip_address=get_client_ip(request),
    )
    db.commit()


# ============================================================
# Audit log
# ============================================================

@router.get("/audit-logs")
def list_audit_logs(
    action: str | None = Query(None, description="Filter by action, e.g. user.create"),
    resource_type: str | None = Query(None),
    actor_email: str | None = Query(None, description="Partial match on actor email"),
    limit: int = Query(50, le=200),
    skip: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    q = db.query(AuditLog)
    if action:
        q = q.filter(AuditLog.action == action)
    if resource_type:
        q = q.filter(AuditLog.resource_type == resource_type)
    if actor_email:
        q = q.filter(AuditLog.actor_email.ilike(f"%{actor_email}%"))
    total = q.count()
    logs = q.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()
    return {
        "items": [AuditLogOut.model_validate(entry) for entry in logs],
        "total": total,
        "offset": skip,
        "limit": limit,
    }
