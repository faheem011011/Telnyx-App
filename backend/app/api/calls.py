"""Call history + Telnyx voice token endpoints."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_, desc, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Call, Contact, User
from app.schemas import CallOut, CallUpdate, ContactOut, RecordingControlRequest, VoiceTokenResponse
from app.services.audit import get_client_ip, log_audit
from app.services.deps import get_current_user
from app.services.telnyx_service import (
    TelnyxApiError,
    generate_voice_access_token,
    call_record_start,
    call_record_stop,
    fetch_recording_url,
)

log = logging.getLogger(__name__)


router = APIRouter(prefix="/api/calls", tags=["calls"])


def client_identity_for_user(user: User) -> str:
    """Opaque SIP identity for this user (used by Telnyx WebRTC)."""
    return user.voice_identity


def _attach_contacts(calls: list, db: Session, user_id: int, is_admin: bool = False) -> list[dict]:
    """Batch-lookup contacts for a list of calls (single query, no N+1).

    When ``is_admin`` is True, the owner_id filter is dropped so an admin viewing
    calls owned by other users can still see contact names attached to the call's
    counterparty number (M-01).
    """
    numbers = {
        (c.from_number if c.direction == "inbound" else c.to_number) for c in calls
    }
    contact_map: dict[str, dict] = {}
    if numbers:
        q = db.query(Contact).filter(Contact.phone_number.in_(numbers))
        if not is_admin:
            q = q.filter(Contact.owner_id == user_id)
        contacts = q.all()
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

    # H-04: serialize concurrent token requests for the same user via a
    # transaction-scoped Postgres advisory lock so we never double-create
    # Telnyx credentials. The lock is auto-released on commit/rollback.
    db.execute(
        text("SELECT pg_advisory_xact_lock(:uid)"),
        {"uid": current_user.id},
    )

    # Re-fetch the user inside the lock to pick up any credential another
    # concurrent request may have just persisted.
    db.refresh(current_user)
    existing_credential_id = current_user.telnyx_credential_id

    try:
        token, cred_id, sip_username = generate_voice_access_token(
            existing_credential_id=existing_credential_id,
        )
    except TelnyxApiError as e:
        # Surface the upstream Telnyx error so operators can debug config
        # problems (e.g. wrong connection_id, missing Outbound Voice Profile
        # on a freshly-created TeXML App) without needing Railway log access.
        log.error(
            "Telnyx voice token generation failed for user_id=%s: %s",
            current_user.id, e,
        )
        raise HTTPException(
            status_code=502,
            detail=f"Telnyx {e.endpoint} returned {e.status}: {e.reason}",
        )
    except Exception:
        log.exception("Telnyx voice token generation failed for user_id=%s", current_user.id)
        raise HTTPException(
            status_code=502,
            detail="Voice service unavailable. Please try again or contact support.",
        )

    if current_user.telnyx_credential_id != cred_id or not current_user.telnyx_sip_username:
        current_user.telnyx_credential_id = cred_id
        current_user.telnyx_sip_username = sip_username
        try:
            db.commit()
        except Exception:
            log.exception("Failed to persist Telnyx credential for user_id=%s", current_user.id)
            db.rollback()

    return VoiceTokenResponse(token=token, identity=identity)


@router.get("")
def list_calls(
    filter: str = Query("all", pattern="^(all|unread|missed|voicemails|recordings|starred)$"),
    search: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
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

    calls = q.order_by(desc(Call.started_at)).offset(offset).limit(limit).all()
    return _attach_contacts(calls, db, current_user.id, is_admin=current_user.role == "admin")


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
    return _attach_contacts([call], db, current_user.id, is_admin=current_user.role == "admin")[0]


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
    return _attach_contacts([call], db, current_user.id, is_admin=current_user.role == "admin")[0]


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


def _call_for_recording(db: Session, user_id: int, call_sid: str | None) -> Call:
    """Return the specific Call row targeted by a recording control request.

    Strategy:
      1. If ``call_sid`` is provided AND matches a row, use it (precise — the
         M-07 ideal: with parallel/queued calls we record the right one).
      2. Otherwise fall back to the user's most-recent unended call. This is
         needed because the Telnyx WebRTC SDK's ``activeCall.id`` is the SIP
         Call-ID, which does NOT necessarily equal the TeXML ``CallSid``
         stored on ``Call.call_sid`` from the webhook. The audit's M-07 fix
         assumed they were the same; they are not, which broke recording.
    """
    if call_sid:
        call = (
            db.query(Call)
            .filter(
                Call.call_sid == call_sid,
                Call.owner_id == user_id,
                Call.ended_at.is_(None),
            )
            .first()
        )
        if call:
            return call

    # Fallback: most-recent active call for this user. Trades exactness for
    # reliability — see docstring above.
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
    request: Request,
    payload: RecordingControlRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start recording the specified active call via Telnyx Call Control.

    The Telnyx CallSid (stored in Call.call_sid) doubles as the call_control_id —
    Telnyx uses one identifier across both TeXML and Call Control paradigms.
    """
    call = _call_for_recording(db, current_user.id, payload.call_sid)
    try:
        call_record_start(call.call_sid)
    except Exception:
        log.exception("Telnyx call_record_start failed for call_sid=%s", call.call_sid)
        raise HTTPException(
            status_code=502,
            detail="Recording service unavailable. Please try again or contact support.",
        )
    log_audit(
        db, current_user,
        action="call.recording.start",
        resource_type="call",
        resource_id=call.id,
        detail={"call_sid": call.call_sid},
        ip_address=get_client_ip(request),
    )


@router.post("/recording/stop", status_code=status.HTTP_204_NO_CONTENT)
def stop_recording(
    request: Request,
    payload: RecordingControlRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stop recording the specified active call."""
    call = _call_for_recording(db, current_user.id, payload.call_sid)
    try:
        call_record_stop(call.call_sid)
    except Exception:
        log.exception("Telnyx call_record_stop failed for call_sid=%s", call.call_sid)
        raise HTTPException(
            status_code=502,
            detail="Recording service unavailable. Please try again or contact support.",
        )
    log_audit(
        db, current_user,
        action="call.recording.stop",
        resource_type="call",
        resource_id=call.id,
        detail={"call_sid": call.call_sid},
        ip_address=get_client_ip(request),
    )


@router.get("/{call_id}/voicemail-url")
def get_voicemail_url(
    call_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mint a fresh signed download URL for a voicemail recording.

    Uses the stored voicemail_recording_id (set at webhook time) to call
    GET /v2/recordings/{id} and return a fresh signed URL. Falls back to
    parsing voicemail_url for rows that pre-date this column.
    """
    call = db.query(Call).filter(
        Call.id == call_id,
        Call.owner_id == current_user.id,
    ).first()
    if not call or not call.voicemail_url:
        raise HTTPException(status_code=404, detail="No voicemail for this call")

    recording_id = call.voicemail_recording_id
    if not recording_id:
        # Legacy fallback for rows stored before voicemail_recording_id was added.
        recording_id = call.voicemail_url.rstrip("/").split("/")[-1] or None
        if recording_id:
            log.warning(
                "get_voicemail_url: call.id=%s has no voicemail_recording_id; "
                "falling back to URL parse (pre-migration row)",
                call_id,
            )
    if not recording_id:
        raise HTTPException(
            status_code=410,
            detail="Voicemail recording ID is unavailable and cannot be refreshed.",
        )

    url = fetch_recording_url(recording_id)
    if not url:
        raise HTTPException(status_code=404, detail="Voicemail is no longer available from Telnyx")
    return {"url": url}


@router.get("/{call_id}/recording-url")
def get_recording_url(
    call_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mint a fresh signed download URL for the call recording.

    The pre-signed S3 URL Telnyx delivers on call.recording.saved expires
    ~10 min later, so cached URLs in the DB return 403 once the window
    closes. This endpoint hits Telnyx's /v2/recordings/{id} on every call,
    which re-signs the underlying object and hands back a fresh URL we can
    feed directly to an <audio> tag.
    """
    call = db.query(Call).filter(
        Call.id == call_id,
        Call.owner_id == current_user.id,
    ).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    if not call.recording_id:
        # M-08: no recording_id means the call.recording.saved webhook arrived
        # without one (known to happen with TeXML-initiated recordings). We have
        # no way to re-mint a fresh signed URL via GET /v2/recordings/{id}.
        # The pre-signed S3 URL in recording_url expires ~10 min after the
        # webhook fired, so serving it beyond that window will produce a 403 on
        # the client side.  Return 410 Gone rather than silently handing back a
        # URL that is very likely already expired, so the frontend can show a
        # clear "no longer available" message instead of a silent playback failure.
        if not call.recording_url:
            raise HTTPException(status_code=404, detail="No recording for this call")
        log.warning(
            "get_recording_url: call.id=%s has recording_url but no recording_id "
            "(pre-signed URL may be expired; cannot refresh without recording_id)",
            call_id,
        )
        raise HTTPException(
            status_code=410,
            detail=(
                "Recording is no longer available. "
                "It was captured without a durable identifier and the temporary link has expired."
            ),
        )

    url = fetch_recording_url(call.recording_id)
    if not url:
        raise HTTPException(
            status_code=404,
            detail="Recording is no longer available from Telnyx",
        )
    # Refresh the cached URL opportunistically — saves a round-trip if the
    # same user replays within the next ten minutes.
    call.recording_url = url
    try:
        db.commit()
    except Exception:
        db.rollback()
    return {"url": url}


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

