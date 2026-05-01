"""Admin-only endpoints: user management, Twilio number management, audit log."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AuditLog, TwilioNumber, User
from app.services.email import send_verification_email
from app.services.verification import issue_verification_token, make_verification_url
from app.schemas import (
    AuditLogOut,
    NumberAssignRequest,
    NumberPurchaseRequest,
    NumberSearchResult,
    TwilioNumberOut,
    UserAdminCreate,
    UserAdminUpdate,
    UserOut,
    UserWithNumbersOut,
)
from app.services.audit import get_client_ip, log_audit
from app.services.deps import require_admin
from app.services.security import hash_password
from app.services.twilio_service import (
    list_owned_numbers,
    purchase_number,
    release_number,
    search_available_numbers,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ============================================================
# User management
# ============================================================

@router.get("/users", response_model=list[UserWithNumbersOut])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[UserWithNumbersOut]:
    users = db.query(User).order_by(User.created_at.asc()).all()
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
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

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
        pass

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

    deleted_info = {"email": user.email, "name": user.name, "role": user.role}

    db.delete(user)

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
        pass

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
# Twilio number management
# ============================================================

@router.get("/numbers", response_model=list[TwilioNumberOut])
def list_numbers(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[TwilioNumberOut]:
    numbers = (
        db.query(TwilioNumber)
        .outerjoin(User, TwilioNumber.assigned_to_user_id == User.id)
        .order_by(TwilioNumber.purchased_at.desc())
        .all()
    )
    return [TwilioNumberOut.model_validate(n) for n in numbers]


@router.post("/numbers/sync", response_model=list[TwilioNumberOut])
def sync_numbers(
    request: Request,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> list[TwilioNumberOut]:
    try:
        owned = list_owned_numbers()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))

    synced = []
    for n in owned:
        existing = db.query(TwilioNumber).filter(TwilioNumber.sid == n["sid"]).first()
        if existing is None:
            tn = TwilioNumber(
                sid=n["sid"],
                phone_number=n["phone_number"],
                friendly_name=n["friendly_name"],
                cap_voice=n["cap_voice"],
                cap_sms=n["cap_sms"],
                cap_mms=n["cap_mms"],
            )
            db.add(tn)
            synced.append(tn)
        else:
            synced.append(existing)

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
            pass

    return [TwilioNumberOut.model_validate(n) for n in synced]


@router.get("/numbers/search", response_model=list[NumberSearchResult])
def search_numbers(
    area_code: str = Query("", description="3-digit US area code"),
    country: str = Query("US"),
    contains: str = Query("", description="Pattern to match, e.g. 555"),
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
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Twilio error: {e}",
        )
    return [NumberSearchResult(**r) for r in results]


@router.post("/numbers/purchase", response_model=TwilioNumberOut, status_code=status.HTTP_201_CREATED)
def buy_number(
    request: Request,
    payload: NumberPurchaseRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> TwilioNumberOut:
    existing = db.query(TwilioNumber).filter(
        TwilioNumber.phone_number == payload.phone_number
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This number is already in your inventory",
        )

    try:
        result = purchase_number(payload.phone_number)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Twilio purchase failed: {e}",
        )

    tn = TwilioNumber(
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
    return TwilioNumberOut.model_validate(tn)


@router.post("/numbers/{number_id}/assign", response_model=TwilioNumberOut)
def assign_number(
    request: Request,
    number_id: int,
    payload: NumberAssignRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> TwilioNumberOut:
    tn = db.query(TwilioNumber).filter(TwilioNumber.id == number_id).first()
    if not tn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Number not found")

    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    tn.assigned_to_user_id = payload.user_id
    if not user.phone_number:
        user.phone_number = tn.phone_number

    log_audit(
        db, current_admin,
        action="number.assign",
        resource_type="number",
        resource_id=tn.phone_number,
        detail={"assigned_to_user_id": user.id, "assigned_to_email": user.email},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(tn)
    return TwilioNumberOut.model_validate(tn)


@router.post("/numbers/{number_id}/unassign", response_model=TwilioNumberOut)
def unassign_number(
    request: Request,
    number_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> TwilioNumberOut:
    tn = db.query(TwilioNumber).filter(TwilioNumber.id == number_id).first()
    if not tn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Number not found")

    previous_user_id = tn.assigned_to_user_id
    tn.assigned_to_user_id = None

    log_audit(
        db, current_admin,
        action="number.unassign",
        resource_type="number",
        resource_id=tn.phone_number,
        detail={"previous_user_id": previous_user_id},
        ip_address=get_client_ip(request),
    )
    db.commit()
    db.refresh(tn)
    return TwilioNumberOut.model_validate(tn)


@router.delete("/numbers/{number_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_number(
    request: Request,
    number_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_admin),
) -> None:
    tn = db.query(TwilioNumber).filter(TwilioNumber.id == number_id).first()
    if not tn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Number not found")

    released_info = {"phone_number": tn.phone_number, "sid": tn.sid}

    try:
        release_number(tn.sid)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Twilio release failed: {e}",
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

@router.get("/audit-logs", response_model=list[AuditLogOut])
def list_audit_logs(
    action: str | None = Query(None, description="Filter by action, e.g. user.create"),
    resource_type: str | None = Query(None),
    limit: int = Query(100, le=500),
    skip: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[AuditLogOut]:
    q = db.query(AuditLog)
    if action:
        q = q.filter(AuditLog.action == action)
    if resource_type:
        q = q.filter(AuditLog.resource_type == resource_type)
    logs = q.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()
    return [AuditLogOut.model_validate(entry) for entry in logs]
