"""Auth endpoints: login, logout, current user, forgot/reset password."""
import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.limiter import limiter
from app.models import EmailVerificationToken, PasswordResetToken, User
from app.schemas import ForgotPasswordRequest, LoginRequest, ResetPasswordRequest, SetupRequest, TokenResponse, UserOut
from app.services.deps import get_current_user
from app.services.email import send_password_reset_email, send_verification_email
from app.services.security import bump_token_version, create_access_token, hash_password, verify_password
from app.services.verification import issue_verification_token, make_verification_url

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


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
def logout(current_user: User = Depends(get_current_user)) -> None:
    """Client-side logout signal — JWTs are stateless and cannot be revoked
    server-side without a token-version bump (see ``bump_token_version``).
    The client MUST discard its token on receipt of 204.
    For forced server-side revocation (admin password reset, etc.), call
    ``bump_token_version`` and commit; outstanding tokens become invalid.
    """


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current_user)


_SETUP_GONE = HTTPException(
    status_code=status.HTTP_410_GONE,
    detail="Setup already completed. Use the Admin Panel to create additional admins.",
)


@router.get("/setup", status_code=status.HTTP_200_OK)
def check_setup(db: Session = Depends(get_db)) -> dict:
    """Return 200 if setup is available (no users exist), 410 if already done."""
    if db.query(User).first():
        raise _SETUP_GONE
    return {"available": True}


@router.post("/setup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/hour")
def setup(
    request: Request,
    payload: SetupRequest,
    db: Session = Depends(get_db),
    x_setup_token: str | None = Header(default=None, alias="X-Setup-Token"),
) -> UserOut:
    """Create the first admin account. Permanently disabled once any user exists."""
    if db.query(User).first():
        raise _SETUP_GONE

    # Gate the bootstrap endpoint behind a deployment-time secret so an
    # internet-facing instance cannot be claimed by the first caller.
    if not settings.initial_setup_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Initial setup not enabled",
        )

    if not x_setup_token or not secrets.compare_digest(x_setup_token, settings.initial_setup_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid setup token",
        )

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
    try:
        send_verification_email(admin.email, verify_url)
    except Exception:
        # M-10: best-effort send — log but never block setup on email failure.
        log.exception("Failed to send setup verification email to %s", admin.email)

    return UserOut.model_validate(admin)


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/hour")
def forgot_password(
    request: Request, payload: ForgotPasswordRequest, db: Session = Depends(get_db)
) -> None:
    """Request a password reset email. Always returns 204 to prevent email enumeration.

    NOTE: combined per-email rate limiting is a future enhancement; the IP-bucket
    limiter above is the only throttle today.
    """
    user = db.query(User).filter(
        User.email == payload.email,
        User.is_active == True,  # noqa: E712
    ).first()

    if not user:
        # Do not signal whether the address exists — silently no-op.
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
    try:
        send_password_reset_email(user.email, reset_url)
    except Exception:
        # M-10: best-effort send — log but never expose failures to the caller
        # (preserves the no-email-enumeration property of forgot-password).
        log.exception("Failed to send password reset email to %s", user.email)


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
