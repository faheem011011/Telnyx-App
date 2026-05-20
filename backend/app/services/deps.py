"""FastAPI dependencies - current user auth and role guards."""
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.services.security import decode_access_token


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the current user from a JWT bearer token."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exc

    decoded = decode_access_token(token)
    if decoded is None:
        raise credentials_exc

    user_id, token_version = decoded

    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        raise credentials_exc

    user = db.query(User).filter(
        User.id == uid,
        User.is_active == True,  # noqa: E712
        User.deleted_at.is_(None),
    ).first()
    if user is None:
        raise credentials_exc

    if (user.token_version or 0) != token_version:
        raise credentials_exc

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Require the current user to have the admin role."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user
