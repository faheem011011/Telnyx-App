"""Call history + Telnyx voice token endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Call, Contact, User
from app.schemas import CallOut, CallUpdate, ContactOut, VoiceTokenResponse
from app.services.deps import get_current_user
from app.services.telnyx_service import (
    generate_voice_access_token,
    call_record_start,
    call_record_stop,
)


router = APIRouter(prefix="/api/calls", tags=["calls"])


def client_identity_for_user(user: User) -> str:
    """SIP username identity for this user (used by Telnyx WebRTC)."""
    return f"user_{user.id}"


def _attach_contacts(calls: list, db: Session, user_id: int) -> list[dict]:
    """Batch-lookup contacts for a list of calls (single query, no N+1)."""
    numbers = {
        (c.from_number if c.direction == "inbound" else c.to_number) for c in calls
    }
    contact_map: dict[str, dict] = {}
    if numbers:
        contacts = db.query(Contact).filter(
            Contact.owner_id == user_id,
            Contact.phone_number.in_(numbers),
        ).all()
        contact_map = {c.phone_number: ContactOut.model_validate(c).model_dump() for c in contacts}

    result = []
    for call in calls:
        other = call.from_number if call.direction == "inbound" else call.to_number
        data = CallOut.model_validate(call).model_dump()
        data["contact"] = contact_map.get(other)
        result.append(data)
    return result


@router.get("/token", response_model=VoiceTokenResponse)
def get_voice_token(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VoiceTokenResponse:
    """Mint a short-lived Telnyx credential token for the WebRTC SDK.

    Creates a Telnyx TelephonyCredential on first call and stores the resulting
    SIP username on the user row so inbound TeXML can route calls to the correct
    browser client. Subsequent calls reuse the same credential (stable SIP username).
    """
    identity = client_identity_for_user(current_user)
    try:
        token, cred_id, sip_username = generate_voice_access_token(
            existing_credential_id=current_user.telnyx_credential_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))

    if current_user.telnyx_credential_id != cred_id or not current_user.telnyx_sip_username:
        current_user.telnyx_credential_id = cred_id
        current_user.telnyx_sip_username = sip_username
        try:
            db.commit()
        except Exception:
            db.rollback()

    return VoiceTokenResponse(token=token, identity=identity)


@router.get("")
def list_calls(
    filter: str = Query("all", pattern="^(all|unread|missed|voicemails|recordings|starred)$"),
    search: str | None = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List calls filtered by tab."""
    q = db.query(Call).filter(Call.owner_id == current_user.id)

    if filter == "unread":
        q = q.filter(Call.is_read.is_(False))
    elif filter == "missed":
        q = q.filter(Call.status.in_(["missed", "no-answer", "busy", "failed"]))
    elif filter == "voicemails":
        q = q.filter(Call.voicemail_url.isnot(None))
    elif filter == "recordings":
        q = q.filter(Call.recording_url.isnot(None))
    elif filter == "starred":
        q = q.filter(Call.is_starred.is_(True))

    if search:
        pattern = f"%{search}%"
        q = q.filter(or_(Call.from_number.ilike(pattern), Call.to_number.ilike(pattern)))

    calls = q.order_by(desc(Call.started_at)).limit(limit).all()
    return _attach_contacts(calls, db, current_user.id)


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return count of unread calls for inbox badge."""
    count = db.query(Call).filter(
        Call.owner_id == current_user.id,
        Call.is_read.is_(False),
    ).count()
    return {"count": count}


@router.get("/{call_id}")
def get_call(
    call_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return a single call by ID."""
    call = db.query(Call).filter(
        Call.id == call_id,
        Call.owner_id == current_user.id,
    ).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return _attach_contacts([call], db, current_user.id)[0]


@router.patch("/{call_id}")
def update_call(
    call_id: int,
    payload: CallUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update call flags (read/starred/notes)."""
    call = db.query(Call).filter(
        Call.id == call_id,
        Call.owner_id == current_user.id,
    ).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(call, key, value)

    db.commit()
    db.refresh(call)
    return _attach_contacts([call], db, current_user.id)[0]


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark all calls as read."""
    db.query(Call).filter(
        Call.owner_id == current_user.id,
        Call.is_read.is_(False),
    ).update({"is_read": True})
    db.commit()


def _active_call(db: Session, user_id: int) -> Call:
    """Return the user's most recent call that has not yet ended, or raise 404."""
    call = (
        db.query(Call)
        .filter(
            Call.owner_id == user_id,
            Call.ended_at.is_(None),
            Call.call_sid.isnot(None),
        )
        .order_by(desc(Call.started_at))
        .first()
    )
    if not call:
        raise HTTPException(status_code=404, detail="No active call found")
    return call


@router.post("/recording/start", status_code=status.HTTP_204_NO_CONTENT)
def start_recording(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start recording the user's current active call via Telnyx Call Control.

    The Telnyx CallSid (stored in Call.call_sid) doubles as the call_control_id —
    Telnyx uses one identifier across both TeXML and Call Control paradigms.
    """
    call = _active_call(db, current_user.id)
    try:
        call_record_start(call.call_sid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Telnyx recording start failed: {e}")


@router.post("/recording/stop", status_code=status.HTTP_204_NO_CONTENT)
def stop_recording(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stop recording the user's current active call."""
    call = _active_call(db, current_user.id)
    try:
        call_record_stop(call.call_sid)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Telnyx recording stop failed: {e}")


@router.delete("/{call_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_call(
    call_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a call record."""
    call = db.query(Call).filter(
        Call.id == call_id,
        Call.owner_id == current_user.id,
    ).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    db.delete(call)
    db.commit()

