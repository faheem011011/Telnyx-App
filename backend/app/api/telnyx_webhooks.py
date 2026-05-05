"""Telnyx TeXML webhook endpoints — all served under /api/telnyx/*.

These URLs are called by Telnyx's infrastructure, never the frontend.

=============================================================
Telnyx Console configuration (stable webhook URLs):
=============================================================

  TeXML Application → Voice Request URL:
      POST {PUBLIC_BACKEND_URL}/api/telnyx/outbound-call

  TeXML Application → Status Callback URL:
      POST {PUBLIC_BACKEND_URL}/api/telnyx/call-status

  Phone Number → Voice → Inbound call webhook:
      POST {PUBLIC_BACKEND_URL}/api/telnyx/incoming-call

  Phone Number → Messaging → Inbound message webhook:
      POST {PUBLIC_BACKEND_URL}/api/telnyx/incoming-sms

  Call Control Application → Webhook URL (for recording events):
      POST {PUBLIC_BACKEND_URL}/api/telnyx/recording-event

Internal action URLs (set in code, not in the Telnyx Console):
      POST {PUBLIC_BACKEND_URL}/api/telnyx/post-dial
      POST {PUBLIC_BACKEND_URL}/api/telnyx/voicemail-complete
=============================================================

Multi-tenant routing:
  Outbound calls  — user resolved from SIP identity or caller number
  Inbound calls   — user resolved by matching PhoneNumber to the "To" number
  Fallback        — oldest user record (supports single-user / dev setups)
"""
import json
import logging
from datetime import datetime, timezone

import telnyx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Call, Message, PhoneNumber, User
from app.services.telnyx_service import (
    build_incoming_texml,
    build_outgoing_texml,
    build_voicemail_texml,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telnyx", tags=["telnyx-webhooks"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _xml(content: str) -> Response:
    return Response(content=content, media_type="application/xml")


def _normalize_recording_url(url: str) -> str:
    return url if url.endswith(".mp3") else url + ".mp3"


# ---------------------------------------------------------------------------
# Multi-tenant user resolution
# ---------------------------------------------------------------------------

def _get_primary_user(db: Session) -> User | None:
    return db.query(User).order_by(User.id.asc()).first()


def _resolve_user_by_to_number(to_number: str, db: Session) -> User | None:
    """Look up the user who owns the Telnyx number that received the call or SMS."""
    if to_number:
        pn = db.query(PhoneNumber).filter(PhoneNumber.phone_number == to_number).first()
        if pn and pn.assigned_to_user_id:
            user = db.query(User).filter(
                User.id == pn.assigned_to_user_id, User.is_active.is_(True)
            ).first()
            if user:
                return user
        user = db.query(User).filter(User.phone_number == to_number).first()
        if user:
            return user
    return _get_primary_user(db)


def _resolve_user_by_caller(from_field: str, db: Session) -> User | None:
    """Resolve the user making an outbound call from the browser.

    Telnyx TeXML sends the SIP URI as From when calling from a WebRTC client,
    e.g. "sip:user_3@sip.telnyx.com". We parse the numeric user ID from the
    SIP username. Falls back to the primary user if parsing fails.
    """
    if from_field:
        # SIP URI format: sip:user_3@sip.telnyx.com → extract "user_3"
        sip_part = from_field.replace("sip:", "").split("@")[0]
        if sip_part.startswith("user_"):
            try:
                user_id = int(sip_part[len("user_"):])
                user = db.query(User).filter(User.id == user_id).first()
                if user:
                    return user
            except (ValueError, IndexError):
                pass
    return _get_primary_user(db)


# ---------------------------------------------------------------------------
# Telnyx webhook signature verification
# ---------------------------------------------------------------------------

def _verify_json_webhook_signature(request: Request, raw_body: bytes) -> None:
    """Verify the Telnyx Ed25519 signature on Call Control JSON webhooks.

    Only call this on JSON endpoints (recording-event, incoming-sms).
    TeXML webhooks are form-encoded and carry no Ed25519 header — calling
    this on them will always reject legitimate Telnyx requests.
    """
    if not settings.telnyx_public_key:
        return

    sig_header = request.headers.get("telnyx-signature-ed25519", "")
    timestamp = request.headers.get("telnyx-timestamp", "")

    try:
        telnyx.Webhook.construct_event(
            raw_body,
            sig_header,
            timestamp,
            settings.telnyx_public_key,
        )
    except Exception:
        log.warning("Rejected request with invalid Telnyx JSON webhook signature")
        raise HTTPException(status_code=403, detail="Forbidden: invalid Telnyx signature")


# ---------------------------------------------------------------------------
# POST /api/telnyx/outbound-call
# TeXML Application → Voice Request URL
# ---------------------------------------------------------------------------

@router.post("/outbound-call")
async def handle_outbound_call(request: Request, db: Session = Depends(get_db)):
    """Handle an outgoing call initiated from the browser via Telnyx WebRTC SDK."""
    raw_body = await request.body()

    form = await request.form()
    form_data = dict(form)

    to_number = form_data.get("To", "")
    from_field = form_data.get("From", "")
    call_sid = form_data.get("CallSid")

    user = _resolve_user_by_caller(from_field, db)

    if not user:
        log.warning("Outbound call rejected: no user found for From=%s", from_field)
        return _xml(
            "<Response>"
            '<Say voice="Polly.Joanna">Your account was not found. '
            "Please contact your administrator.</Say>"
            "<Hangup/>"
            "</Response>"
        )

    caller_id = user.phone_number
    if not caller_id:
        log.warning("Outbound call rejected: user %s has no phone number assigned", user.id)
        return _xml(
            "<Response>"
            '<Say voice="Polly.Joanna">Your account has no phone number assigned. '
            "Please ask your administrator to assign a number before making calls.</Say>"
            "<Hangup/>"
            "</Response>"
        )

    if to_number:
        try:
            call = Call(
                owner_id=user.id,
                call_sid=call_sid,
                direction="outbound",
                from_number=caller_id,
                to_number=to_number,
                status="initiated",
                started_at=_now(),
                is_read=True,
            )
            db.add(call)
            db.commit()
            log.info("Outbound call created: SID=%s user=%s to=%s", call_sid, user.id, to_number)
        except Exception:
            db.rollback()
            log.exception("Failed to persist outbound call record SID=%s", call_sid)

    return _xml(build_outgoing_texml(to_number, caller_id=caller_id))


# ---------------------------------------------------------------------------
# POST /api/telnyx/incoming-call
# ---------------------------------------------------------------------------

@router.post("/incoming-call")
async def handle_incoming_call(request: Request, db: Session = Depends(get_db)):
    """Handle an incoming PSTN call to the Telnyx phone number."""
    raw_body = await request.body()

    form = await request.form()
    form_data = dict(form)

    to_number = form_data.get("To", "")
    from_number = form_data.get("From", "")
    call_sid = form_data.get("CallSid")

    user = _resolve_user_by_to_number(to_number, db)

    if user:
        try:
            call = Call(
                owner_id=user.id,
                call_sid=call_sid,
                direction="inbound",
                from_number=from_number,
                to_number=to_number,
                status="ringing",
                started_at=_now(),
                is_read=False,
            )
            db.add(call)
            db.commit()
            log.info("Inbound call created: SID=%s user=%s from=%s", call_sid, user.id, from_number)
        except Exception:
            db.rollback()
            log.exception("Failed to persist inbound call record SID=%s", call_sid)
        if user.telnyx_sip_username:
            sip_username = user.telnyx_sip_username
        else:
            log.warning(
                "User %s has no Telnyx SIP username yet — they have not logged in since "
                "the credential was created. Inbound call cannot ring the browser; "
                "voicemail will capture it.",
                user.id,
            )
            return _xml(build_voicemail_texml())
    else:
        log.warning("No user found for To=%s; sending to voicemail", to_number)
        return _xml(build_voicemail_texml())

    return _xml(build_incoming_texml(sip_username))


# ---------------------------------------------------------------------------
# POST /api/telnyx/post-dial
# ---------------------------------------------------------------------------

@router.post("/post-dial")
async def handle_post_dial(request: Request, db: Session = Depends(get_db)):
    """Called by Telnyx after <Dial> resolves for an inbound call."""
    raw_body = await request.body()

    form = await request.form()
    form_data = dict(form)

    call_sid = form_data.get("CallSid")
    dial_status = form_data.get("DialCallStatus", "")
    duration_raw = form_data.get("DialCallDuration") or "0"
    duration = int(duration_raw) if duration_raw.isdigit() else 0

    if call_sid:
        call = db.query(Call).filter(Call.call_sid == call_sid).first()
        if call:
            if dial_status == "completed":
                call.status = "completed"
                call.duration_seconds = duration
                call.ended_at = _now()
            elif dial_status in ("no-answer", "busy", "failed", "canceled"):
                call.status = "missed"
                call.ended_at = _now()
            try:
                db.commit()
            except Exception:
                db.rollback()
                log.exception("Failed to update call %s in post-dial", call_sid)

    if dial_status in ("no-answer", "busy", "failed"):
        return _xml(build_voicemail_texml())

    return _xml("<Response></Response>")


# ---------------------------------------------------------------------------
# POST /api/telnyx/call-status
# ---------------------------------------------------------------------------

@router.post("/call-status")
async def handle_call_status(request: Request, db: Session = Depends(get_db)):
    """Receive call lifecycle status updates from Telnyx."""
    raw_body = await request.body()

    form = await request.form()
    form_data = dict(form)

    call_sid = form_data.get("CallSid")
    call_status = form_data.get("DialCallStatus") or form_data.get("CallStatus", "")
    duration_raw = form_data.get("DialCallDuration") or form_data.get("CallDuration") or "0"
    duration = int(duration_raw) if duration_raw.isdigit() else 0
    recording_url = form_data.get("RecordingUrl")

    if not call_sid:
        return Response(status_code=204)

    call = db.query(Call).filter(Call.call_sid == call_sid).first()
    if call:
        if call_status:
            call.status = call_status
        if duration:
            call.duration_seconds = duration
        if recording_url:
            call.recording_url = _normalize_recording_url(recording_url)
        if call_status in ("completed", "no-answer", "busy", "failed", "canceled"):
            if not call.ended_at:
                call.ended_at = _now()
        try:
            db.commit()
        except Exception:
            db.rollback()
            log.exception("Failed to update call status for SID=%s", call_sid)

    return _xml("<Response></Response>")


# ---------------------------------------------------------------------------
# POST /api/telnyx/voicemail-complete
# ---------------------------------------------------------------------------

@router.post("/voicemail-complete")
async def handle_voicemail_complete(request: Request, db: Session = Depends(get_db)):
    """Called by Telnyx after a voicemail recording finishes."""
    raw_body = await request.body()

    form = await request.form()
    form_data = dict(form)

    call_sid = form_data.get("CallSid")
    recording_url = form_data.get("RecordingUrl")

    if call_sid and recording_url:
        call = db.query(Call).filter(Call.call_sid == call_sid).first()
        if call:
            call.voicemail_url = _normalize_recording_url(recording_url)
            call.status = "missed"
            if not call.ended_at:
                call.ended_at = _now()
            try:
                db.commit()
                log.info("Voicemail saved for SID=%s", call_sid)
            except Exception:
                db.rollback()
                log.exception("Failed to save voicemail URL for SID=%s", call_sid)

    return _xml("<Response><Hangup/></Response>")


# ---------------------------------------------------------------------------
# POST /api/telnyx/voicemail-transcription
# ---------------------------------------------------------------------------

@router.post("/voicemail-transcription")
async def handle_voicemail_transcription(request: Request):
    # Telnyx TeXML <Record> does not support transcription callbacks — this
    # endpoint is kept so any stale webhook config doesn't cause 404 errors.
    await request.body()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /api/telnyx/incoming-sms
# ---------------------------------------------------------------------------

@router.post("/incoming-sms")
async def handle_incoming_sms(request: Request, db: Session = Depends(get_db)):
    """Handle Telnyx messaging webhooks (message.received / message.sent / message.finalized).

    Telnyx sends JSON for all messaging events — not form-encoded like Twilio.
    Payload structure:
      { "data": { "event_type": "...", "payload": { ... } } }
    """
    raw_body = await request.body()
    _verify_json_webhook_signature(request, raw_body)

    try:
        body = json.loads(raw_body)
    except Exception:
        log.warning("Received non-JSON body on /incoming-sms")
        return Response(status_code=400)

    event = body.get("data", {})
    event_type = event.get("event_type", "")
    payload = event.get("payload", {})

    # ── Delivery status update for outbound messages ──────────────────────────
    if event_type in ("message.sent", "message.finalized"):
        message_id = payload.get("id")
        to_list = payload.get("to", [])
        status = to_list[0].get("status") if to_list else None
        if message_id and status:
            msg = db.query(Message).filter(Message.message_sid == message_id).first()
            if msg:
                msg.status = status
                try:
                    db.commit()
                    log.info("Message %s status updated to %s", message_id, status)
                except Exception:
                    db.rollback()
                    log.exception("Failed to update status for message_sid=%s", message_id)
        return Response(status_code=204)

    # ── Inbound message ───────────────────────────────────────────────────────
    if event_type != "message.received":
        return Response(status_code=204)

    from_number = payload.get("from", {}).get("phone_number", "")
    to_list = payload.get("to", [])
    to_number = to_list[0].get("phone_number", "") if to_list else ""
    message_id = payload.get("id", "")
    text = payload.get("text", "")
    media_list = payload.get("media", [])
    media_url = media_list[0].get("url") if media_list else None

    if not from_number or not to_number:
        log.warning("Inbound SMS missing from/to fields, ignoring")
        return Response(status_code=204)

    user = _resolve_user_by_to_number(to_number, db)

    if user:
        try:
            msg = Message(
                owner_id=user.id,
                message_sid=message_id or None,
                direction="inbound",
                from_number=from_number,
                to_number=to_number,
                body=text,
                status="received",
                media_url=media_url,
                is_read=False,
            )
            db.add(msg)
            db.commit()
            log.info("Inbound SMS saved: from=%s to=%s", from_number, to_number)
        except Exception:
            db.rollback()
            log.exception("Failed to save inbound SMS from=%s", from_number)
    else:
        log.warning("No user found for inbound SMS to=%s", to_number)

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /api/telnyx/recording-event
# Call Control Application → Webhook URL
# Handles call.recording.saved JSON events from Telnyx Call Control
# ---------------------------------------------------------------------------

@router.post("/recording-event")
async def handle_recording_event(request: Request, db: Session = Depends(get_db)):
    """Receive call.recording.saved JSON events from Telnyx Call Control.

    Fired after call_record_stop() completes and Telnyx has processed the file.
    Configure this URL in the Telnyx portal under:
      Call Control Application → Webhook URL
    """
    raw_body = await request.body()
    _verify_json_webhook_signature(request, raw_body)

    try:
        body = json.loads(raw_body)
    except Exception:
        return Response(status_code=400)

    event = body.get("data", {})
    if event.get("event_type") != "call.recording.saved":
        return Response(status_code=204)

    payload = event.get("payload", {})
    call_control_id = payload.get("call_control_id")
    recording_url = (payload.get("recording_urls") or {}).get("mp3")

    if call_control_id and recording_url:
        call = db.query(Call).filter(Call.call_sid == call_control_id).first()
        if call:
            call.recording_url = recording_url
            try:
                db.commit()
                log.info("Recording URL saved for call_control_id=%s", call_control_id)
            except Exception:
                db.rollback()
                log.exception("Failed to save recording URL for call_control_id=%s", call_control_id)

    return Response(status_code=204)
