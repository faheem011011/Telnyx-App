"""Auth endpoints: login, logout, current user, forgot/reset password."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.limiter import limiter
from app.models import EmailVerificationToken, PasswordResetToken, User
from app.schemas import ForgotPasswordRequest, LoginRequest, ResetPasswordRequest, SetupRequest, TokenResponse, UserOut
from app.services.deps import get_current_user
from app.services.email import send_password_reset_email, send_verification_email
from app.services.security import create_access_token, hash_password, verify_password
from app.services.verification import issue_verification_token, make_verification_url

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not user.hashed_password or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if not user.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email address before logging in. Check your inbox for the verification link.",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    token = create_access_token(subject=user.id)
    return TokenResponse(access_token=token, user=UserOut.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(current_user: User = Depends(get_current_user)) -> None:
    """Logout — client must discard its token on receipt."""


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
def setup(request: Request, payload: SetupRequest, db: Session = Depends(get_db)) -> UserOut:
    """Create the first admin account. Permanently disabled once any user exists."""
    if db.query(User).first():
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
    try:
        send_verification_email(admin.email, verify_url)
    except Exception:
        pass

    return UserOut.model_validate(admin)


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("3/hour")
def forgot_password(
    request: Request, payload: ForgotPasswordRequest, db: Session = Depends(get_db)
) -> None:
    """Request a password reset email. Returns 404 if email is not registered."""
    user = db.query(User).filter(
        User.email == payload.email,
        User.is_active == True,  # noqa: E712
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account found for this email. Contact your admin to get registered.",
        )

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
        pass  # Never expose email-send failures to the caller


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
