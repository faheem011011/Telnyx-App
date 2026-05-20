"""SSE streaming endpoint - real-time push to authenticated browser clients."""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import app.events as ev
from app.database import get_db
from app.models import User
from app.services.security import decode_access_token

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/events", tags=["events"])

_HEARTBEAT_SECONDS = 25


def _get_user_from_token(
    token: str = Query(...),
    db: Session = Depends(get_db),
) -> User:
    """Authenticate SSE connection via ?token= query parameter."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )
    decoded = decode_access_token(token)
    if decoded is None:
        raise credentials_exc
    user_id_str, token_version = decoded
    try:
        uid = int(user_id_str)
    except (TypeError, ValueError):
        raise credentials_exc

    user = db.query(User).filter(
        User.id == uid,
        User.is_active.is_(True),
        User.deleted_at.is_(None),
    ).first()
    if user is None:
        raise credentials_exc
    if (user.token_version or 0) != token_version:
        raise credentials_exc
    return user


@router.get("/stream")
async def stream_events(current_user: User = Depends(_get_user_from_token)):
    """Long-lived SSE stream; authenticated via ?token= query parameter."""
    user_id = current_user.id
    queue = ev.subscribe(user_id)
    log.info("SSE stream opened user_id=%s", user_id)

    async def generate():
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                    yield chunk
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            ev.unsubscribe(user_id, queue)
            log.info("SSE stream closed user_id=%s", user_id)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
