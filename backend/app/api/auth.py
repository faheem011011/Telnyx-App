"""Auth endpoints: login, logout, current user, forgot/reset password."""
import hashlib
import logging
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.limiter import limiter
from app.models import EmailVerificationToken, PasswordResetToken, User
from app.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    ResetPasswordRequest,
    SetupRequest,
    TokenResponse,
    UpdateMeRequest,
    UserOut,
)
from app.services.deps import get_current_user
from app.services.email import send_password_reset_email, send_verification_email
from app.services.security import bump_token_version, create_access_token, hash_password, verify_password
from app.services.verification import issue_verification_token, make_verification_url

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Per-email rate limiting for password reset — max 3 requests per hour per address.
# In-memory only; resets on process restart, which is acceptable for this use-case.
_reset_attempts: dict[str, list] = defaultdict(list)
_RESET_EMAIL_MAX = 3
_RESET_EMAIL_WINDOW = timedelta(hours=1)


def _reset_email_allowed(email: str) -> bool:
    """Returns True and records the attempt if within the limit; False if exceeded."""
    now = datetime.now(timezone.utc)
    key = email.lower()
    cutoff = now - _RESET_EMAIL_WINDOW
    _reset_attempts[key] = [t for t in _reset_attempts[key] if t > cutoff]
    if len(_reset_attempts[key]) >= _RESET_EMAIL_MAX:
        return False
    _reset_attempts[key].append(now)
    return True


_INVALID_CREDS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid email or password",
)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(
    request: Request,
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> TokenResponse:
    user = db.query(User).filter(User.email == payload.email).first()

    # Unify all failure modes (no-such-user, wrong-password, unverified, inactive)
    # into a single 401 response to prevent user enumeration. The verify-email
    # case still emits a server-only header hint so the UI can suggest re-sending
    # the verification mail to a legitimate-but-unverified user.
    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise _INVALID_CREDS

    if not user.is_active:
        raise _INVALID_CREDS

    if not user.email_verified:
        # Side-channel hint, only set when the password is correct.
        response.headers["X-Auth-Hint"] = "verify-email"
        raise _INVALID_CREDS

    token = create_access_token(subject=user.id, token_version=user.token_version)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    """Bump token_version so the JWT is invalid on the next request."""
    bump_token_version(current_user)
    db.commit()


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UpdateMeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    """Self-service profile update — currently just the display name.

    Email/role/department/phone changes intentionally stay on the admin
    endpoint so they're auditable and authorised.
    """
    new_name = payload.name.strip()
    if new_name and new_name != current_user.name:
        current_user.name = new_name
        db.commit()
        db.refresh(current_user)
    return UserOut.model_validate(current_user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/hour")
def change_password(
    request: Request,
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Authenticated self-service password change.

    Caller must supply their current password. On success we bump
    token_version which invalidates *every* outstanding JWT for this user
    on the next request, including this caller's — the frontend therefore
    needs to send the user back to /login after a 204 response.
    """
    if not current_user.hashed_password or not verify_password(
        payload.old_password, current_user.hashed_password
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )
    if payload.old_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from current password.",
        )
    current_user.hashed_password = hash_password(payload.new_password)
    bump_token_version(current_user)
    db.commit()


_SETUP_GONE = HTTPException(
    status_code=status.HTTP_410_GONE,
    detail="Setup already completed. Use the Admin Panel to create additional admins.",
)


def _admin_exists(db: Session) -> bool:
    return db.query(User).filter(User.role == "admin").first() is not None


@router.get("/setup", status_code=status.HTTP_200_OK)
def check_setup(db: Session = Depends(get_db)) -> dict:
    """Return 200 if setup is available (no admin exists), 410 if already done."""
    if _admin_exists(db):
        raise _SETUP_GONE
    return {"available": True}


@router.post("/setup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
def setup(
    request: Request,
    payload: SetupRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_setup_token: str | None = Header(default=None, alias="X-Setup-Token"),
) -> UserOut:
    """Create the first admin account. Permanently disabled once any admin exists."""
    if _admin_exists(db):
        raise _SETUP_GONE

    # Gate the bootstrap endpoint behind a deployment-time secret so an
    # internet-facing instance cannot be claimed by the first caller.
    if not settings.initial_setup_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "INITIAL_SETUP_TOKEN is not configured. "
                "Set this environment variable to enable initial setup."
            ),
        )

    if not x_setup_token or not secrets.compare_digest(x_setup_token, settings.initial_setup_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid setup token",
        )

    # H-06: serialize concurrent setup requests so two simultaneous calls cannot
    # both pass the admin-exists check and create two admin accounts.
    # Lock key 0 is a fixed constant for the "setup" critical section.
    # Auto-released on commit/rollback (transaction-scoped).
    db.execute(text("SELECT pg_advisory_xact_lock(0)"))
    if _admin_exists(db):
        raise _SETUP_GONE

    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    admin = User(
        email=payload.email,
        name=payload.name,
        hashed_password=hash_password(payload.password),
        role="admin",
        is_active=True,
        email_verified=False,
        department="Data Team",
    )
    db.add(admin)
    db.flush()

    raw_token = issue_verification_token(admin.id, db)
    db.commit()
    db.refresh(admin)

    verify_url = make_verification_url(raw_token)
    background_tasks.add_task(send_verification_email, admin.email, verify_url)

    return UserOut.model_validate(admin)


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/hour")
def forgot_password(
    request: Request, payload: ForgotPasswordRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)
) -> None:
    """Request a password reset email. Always returns 204 to prevent email enumeration."""
    user = db.query(User).filter(
        User.email == payload.email,
        User.is_active == True,  # noqa: E712
    ).first()

    if not user:
        # Do not signal whether the address exists — silently no-op.
        return

    if not _reset_email_allowed(user.email):
        # Silently no-op so the rate limit doesn't reveal whether the address exists.
        return

    # Invalidate any outstanding tokens for this user
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user.id,
        PasswordResetToken.used == False,  # noqa: E712
    ).update({"used": True})

    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

    db.add(PasswordResetToken(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
    ))
    db.commit()

    reset_url = f"{settings.frontend_url}/reset-password?token={raw_token}"
    background_tasks.add_task(send_password_reset_email, user.email, reset_url)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/hour")
def reset_password(
    request: Request, payload: ResetPasswordRequest, db: Session = Depends(get_db)
) -> None:
    """Consume a reset token and set a new password."""
    token_hash = hashlib.sha256(payload.token.encode()).hexdigest()
    now = datetime.now(timezone.utc)

    record = db.query(PasswordResetToken).filter(
        PasswordResetToken.token_hash == token_hash,
        PasswordResetToken.used == False,  # noqa: E712
        PasswordResetToken.expires_at > now,
    ).first()

    if not record:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    user = db.query(User).filter(User.id == record.user_id, User.is_active == True).first()  # noqa: E712
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset token")

    user.hashed_password = hash_password(payload.new_password)
    bump_token_version(user)
    record.used = True
    db.commit()


@router.get("/verify-email", status_code=status.HTTP_200_OK)
def verify_email(token: str, db: Session = Depends(get_db)) -> dict:
    """Consume a verification token and activate the user's account."""
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = datetime.now(timezone.utc)

    record = db.query(EmailVerificationToken).filter(
        EmailVerificationToken.token_hash == token_hash,
        EmailVerificationToken.used == False,  # noqa: E712
        EmailVerificationToken.expires_at > now,
    ).first()

    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link.",
        )

    user = db.query(User).filter(User.id == record.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification link.",
        )

    user.email_verified = True
    record.used = True
    db.commit()
    return {"message": "Email verified successfully. You can now sign in."}
