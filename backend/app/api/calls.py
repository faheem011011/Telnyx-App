"""Call history + Twilio voice token endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import or_, desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Call, Contact, User
from app.schemas import CallOut, CallUpdate, ContactOut, TwilioTokenResponse
from app.services.deps import get_current_user
from app.services.twilio_service import generate_voice_access_token, get_twilio_client


router = APIRouter(prefix="/api/calls", tags=["calls"])


def client_identity_for_user(user: User) -> str:
    """Stable Twilio Client identity for this user."""
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


@router.get("/token", response_model=TwilioTokenResponse)
def get_voice_token(current_user: User = Depends(get_current_user)) -> TwilioTokenResponse:
    """Mint a short-lived Twilio JWT for the Voice SDK."""
    identity = client_identity_for_user(current_user)
    try:
        token = generate_voice_access_token(identity)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return TwilioTokenResponse(token=token, identity=identity)


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


class _RecordingStartReq(BaseModel):
    call_sid: str


class _RecordingStopReq(BaseModel):
    call_sid: str
    recording_sid: str


@router.post("/recording/start")
def start_recording(
    payload: _RecordingStartReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start recording an active call via the Twilio REST API."""
    call = db.query(Call).filter(
        Call.twilio_call_sid == payload.call_sid,
        Call.owner_id == current_user.id,
    ).first()
    if not call:
        raise HTTPException(status_code=403, detail="Call not found or access denied")

    client = get_twilio_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Twilio not configured")
    try:
        rec = client.calls(payload.call_sid).recordings.create()
        return {"recording_sid": rec.sid}
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Failed to start recording")


@router.post("/recording/stop")
def stop_recording(
    payload: _RecordingStopReq,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stop a specific recording on an active call."""
    call = db.query(Call).filter(
        Call.twilio_call_sid == payload.call_sid,
        Call.owner_id == current_user.id,
    ).first()
    if not call:
        raise HTTPException(status_code=403, detail="Call not found or access denied")

    client = get_twilio_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Twilio not configured")
    try:
        client.calls(payload.call_sid).recordings(payload.recording_sid).update(status="stopped")
        return {"status": "stopped"}
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Failed to stop recording")


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
