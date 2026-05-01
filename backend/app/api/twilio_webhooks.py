"""Twilio webhook endpoints — all served under /api/twilio/*.

These URLs are called by Twilio's infrastructure, never the frontend.

=============================================================
Twilio Console configuration (three stable webhook URLs):
=============================================================

  TwiML App → Voice Request URL:
      POST {PUBLIC_BACKEND_URL}/api/twilio/outbound-call

  TwiML App → Status Callback URL:
      POST {PUBLIC_BACKEND_URL}/api/twilio/call-status

  Phone Number → Voice & Fax → A call comes in:
      POST {PUBLIC_BACKEND_URL}/api/twilio/incoming-call

  Phone Number → Messaging → A message comes in:
      POST {PUBLIC_BACKEND_URL}/api/twilio/incoming-sms

Internal action URLs (set in code, not in the Twilio Console):
      POST {PUBLIC_BACKEND_URL}/api/twilio/post-dial              (Dial action for inbound)
      POST {PUBLIC_BACKEND_URL}/api/twilio/voicemail-complete     (Record action)
      POST {PUBLIC_BACKEND_URL}/api/twilio/voicemail-transcription (async transcription)
=============================================================

Multi-tenant routing:
  Outbound calls  — user resolved from browser client identity ("client:user_<id>")
  Inbound calls   — user resolved by matching User.phone_number to the Twilio "To" number
  Fallback        — oldest user record (supports single-user / dev setups)
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session
from twilio.request_validator import RequestValidator

from app.config import settings
from app.database import get_db
from app.models import Call, Message, TwilioNumber, User
from app.services.twilio_service import (
    build_incoming_twiml,
    build_outgoing_twiml,
    build_voicemail_twiml,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/twilio", tags=["twilio-webhooks"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _xml(content: str) -> Response:
    """Return a TwiML XML response with the correct content-type."""
    return Response(content=content, media_type="application/xml")


def _normalize_recording_url(url: str) -> str:
    """Ensure recording URLs end with .mp3 for direct browser playback."""
    return url if url.endswith(".mp3") else url + ".mp3"


# ---------------------------------------------------------------------------
# Multi-tenant user resolution
# ---------------------------------------------------------------------------

def _get_primary_user(db: Session) -> User | None:
    """Fallback: return the oldest user account (supports single-user setups)."""
    return db.query(User).order_by(User.id.asc()).first()


def _resolve_user_by_to_number(to_number: str, db: Session) -> User | None:
    """Look up the user who owns the Twilio number that received the call or SMS.

    Checks TwilioNumber assignments first, then falls back to User.phone_number.
    Falls back to the primary (oldest) user when no match is found.
    """
    if to_number:
        # Check TwilioNumber inventory assignment first
        tn = db.query(TwilioNumber).filter(TwilioNumber.phone_number == to_number).first()
        if tn and tn.assigned_to_user_id:
            user = db.query(User).filter(
                User.id == tn.assigned_to_user_id, User.is_active == True
            ).first()
            if user:
                return user
        # Fall back to User.phone_number direct mapping
        user = db.query(User).filter(User.phone_number == to_number).first()
        if user:
            return user
    return _get_primary_user(db)


def _resolve_user_by_client_identity(from_field: str, db: Session) -> User | None:
    """Parse the browser client identity 'client:user_<id>' from the Twilio From field.

    The Twilio JS SDK sends From as 'client:<identity>' where identity is the
    string passed to AccessToken (e.g. 'user_3'). We encode the DB user ID there.
    Falls back to the primary user if parsing fails.
    """
    prefix = "client:user_"
    if from_field and from_field.startswith(prefix):
        try:
            user_id = int(from_field[len(prefix):])
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                return user
        except (ValueError, IndexError):
            pass
    return _get_primary_user(db)


# ---------------------------------------------------------------------------
# Twilio signature validation
# ---------------------------------------------------------------------------

def _verify_twilio_signature(request: Request, form_data: dict) -> None:
    """Reject requests that do not carry a valid X-Twilio-Signature header.

    Skipped only when TWILIO_AUTH_TOKEN is absent AND the backend is on localhost
    (local dev without ngrok). In production this always enforces validation and
    fails closed — a missing token is treated as a misconfiguration, not a bypass.
    """
    if not settings.twilio_auth_token:
        is_production = (
            settings.public_backend_url
            and "localhost" not in settings.public_backend_url
            and "127.0.0.1" not in settings.public_backend_url
        )
        if is_production:
            log.error("TWILIO_AUTH_TOKEN is not set — rejecting webhook to prevent spoofing")
            raise HTTPException(status_code=403, detail="Forbidden: Twilio auth token not configured")
        return  # local dev without ngrok — skip validation

    validator = RequestValidator(settings.twilio_auth_token)
    signature = request.headers.get("X-Twilio-Signature", "")
    # Railway terminates TLS at its proxy — force https for Twilio signature validation
    url = str(request.url).replace("http://", "https://", 1)

    if not validator.validate(url, form_data, signature):
        log.warning("Rejected request with invalid Twilio signature for URL: %s", url)
        raise HTTPException(status_code=403, detail="Forbidden: invalid Twilio signature")


# ---------------------------------------------------------------------------
# POST /api/twilio/outbound-call
# TwiML App → Voice Request URL
# ---------------------------------------------------------------------------

@router.post("/outbound-call")
async def handle_outbound_call(request: Request, db: Session = Depends(get_db)):
    """Handle an outgoing call initiated from the browser via Twilio JS SDK.

    The browser calls Device.connect({params: {To: '+1...'}}).
    Twilio POSTs here; we respond with <Dial> TwiML that bridges the call.

    Call flow:
      Browser SDK → Twilio → POST /outbound-call → TwiML <Dial><Number>
      → Twilio calls destination → call bridges → <Dial action> fires /call-status
    """
    form = await request.form()
    form_data = dict(form)
    _verify_twilio_signature(request, form_data)

    to_number = form_data.get("To", "")
    from_field = form_data.get("From", "")
    call_sid = form_data.get("CallSid")

    # Resolve user from browser SDK client identity
    user = _resolve_user_by_client_identity(from_field, db)

    # Use the user's own Twilio number as caller ID, fall back to global setting
    caller_id = (
        user.phone_number
        if user and user.phone_number
        else settings.twilio_phone_number
    )

    if user and to_number:
        try:
            call = Call(
                owner_id=user.id,
                twilio_call_sid=call_sid,
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

    return _xml(build_outgoing_twiml(to_number, caller_id=caller_id))


# ---------------------------------------------------------------------------
# POST /api/twilio/incoming-call
# Phone Number → Voice & Fax → "A call comes in"
# ---------------------------------------------------------------------------

@router.post("/incoming-call")
async def handle_incoming_call(request: Request, db: Session = Depends(get_db)):
    """Handle an incoming PSTN call to the Twilio phone number.

    Rings the browser client. The <Dial action> fires after the dial attempt
    so /post-dial can decide whether to offer voicemail.

    Call flow:
      Caller → Twilio number → POST /incoming-call → TwiML <Dial><Client>
      → Twilio rings browser → (answered) → connected
      → (not answered) → <Dial action> fires /post-dial → voicemail TwiML
    """
    form = await request.form()
    form_data = dict(form)
    _verify_twilio_signature(request, form_data)

    to_number = form_data.get("To", "")
    from_number = form_data.get("From", "")
    call_sid = form_data.get("CallSid")

    # Route to the user who owns the dialled Twilio number
    user = _resolve_user_by_to_number(to_number, db)

    if user:
        try:
            call = Call(
                owner_id=user.id,
                twilio_call_sid=call_sid,
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
        identity = f"user_{user.id}"
    else:
        log.warning("No user found for To=%s; ringing user_1 as fallback", to_number)
        identity = "user_1"

    return _xml(build_incoming_twiml(identity))


# ---------------------------------------------------------------------------
# POST /api/twilio/post-dial
# Internal: set as <Dial action> in build_incoming_twiml()
# ---------------------------------------------------------------------------

@router.post("/post-dial")
async def handle_post_dial(request: Request, db: Session = Depends(get_db)):
    """Called by Twilio after <Dial> resolves for an inbound call.

    DialCallStatus values:
      completed  → browser answered and call ended normally → no voicemail
      no-answer  → browser didn't answer within timeout   → offer voicemail
      busy       → browser client is busy                 → offer voicemail
      failed     → connection error                       → offer voicemail
      canceled   → caller hung up before browser answered → silent end
    """
    form = await request.form()
    form_data = dict(form)
    _verify_twilio_signature(request, form_data)

    call_sid = form_data.get("CallSid")
    dial_status = form_data.get("DialCallStatus", "")
    duration_raw = form_data.get("DialCallDuration") or "0"
    duration = int(duration_raw) if duration_raw.isdigit() else 0

    if call_sid:
        call = db.query(Call).filter(Call.twilio_call_sid == call_sid).first()
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
                log.exception("Failed to update call %s in post-dial (status=%s)", call_sid, dial_status)

    # Offer voicemail only for unanswered / failed calls
    if dial_status in ("no-answer", "busy", "failed"):
        log.info("Call %s unanswered (%s) — serving voicemail TwiML", call_sid, dial_status)
        return _xml(build_voicemail_twiml())

    return _xml("<Response></Response>")


# ---------------------------------------------------------------------------
# POST /api/twilio/call-status
# TwiML App → Status Callback URL
# Internal: also set as <Dial action> in build_outgoing_twiml()
# ---------------------------------------------------------------------------

@router.post("/call-status")
async def handle_call_status(request: Request, db: Session = Depends(get_db)):
    """Receive call lifecycle status updates from Twilio.

    This endpoint serves two roles:
      1. TwiML App Status Callback — Twilio POSTs here at every call state
         change (CallStatus, CallDuration in the form body).
      2. <Dial action> for outbound calls — fires when the dialled leg ends
         (DialCallStatus, DialCallDuration in the form body).

    Both contexts are handled by checking DialCallStatus first, then CallStatus.
    Returning empty TwiML is correct for the Dial action context; the status
    callback context ignores the response body entirely.
    """
    form = await request.form()
    form_data = dict(form)
    _verify_twilio_signature(request, form_data)

    call_sid = form_data.get("CallSid")
    call_status = form_data.get("DialCallStatus") or form_data.get("CallStatus", "")
    duration_raw = form_data.get("DialCallDuration") or form_data.get("CallDuration") or "0"
    duration = int(duration_raw) if duration_raw.isdigit() else 0
    recording_url = form_data.get("RecordingUrl")

    if not call_sid:
        return Response(status_code=204)

    call = db.query(Call).filter(Call.twilio_call_sid == call_sid).first()
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
# POST /api/twilio/voicemail-complete
# Internal: set as <Record action> in build_voicemail_twiml()
# ---------------------------------------------------------------------------

@router.post("/voicemail-complete")
async def handle_voicemail_complete(request: Request, db: Session = Depends(get_db)):
    """Called by Twilio after a voicemail recording finishes.

    Stores the recording URL on the call record and ensures the call is
    marked as missed. Returns <Hangup/> to cleanly end the call leg.
    """
    form = await request.form()
    form_data = dict(form)
    _verify_twilio_signature(request, form_data)

    call_sid = form_data.get("CallSid")
    recording_url = form_data.get("RecordingUrl")

    if call_sid and recording_url:
        call = db.query(Call).filter(Call.twilio_call_sid == call_sid).first()
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
# POST /api/twilio/voicemail-transcription
# Internal: set as <Record transcribeCallback> in build_voicemail_twiml()
# ---------------------------------------------------------------------------

@router.post("/voicemail-transcription")
async def handle_voicemail_transcription(request: Request, db: Session = Depends(get_db)):
    """Called asynchronously by Twilio when voicemail transcription is ready.

    Only persists the text when TranscriptionStatus is 'completed' to avoid
    storing error or in-progress states.
    """
    form = await request.form()
    form_data = dict(form)
    _verify_twilio_signature(request, form_data)

    call_sid = form_data.get("CallSid")
    transcription = form_data.get("TranscriptionText")
    transcription_status = form_data.get("TranscriptionStatus", "")

    if call_sid and transcription and transcription_status == "completed":
        call = db.query(Call).filter(Call.twilio_call_sid == call_sid).first()
        if call:
            call.voicemail_transcription = transcription
            try:
                db.commit()
                log.info("Voicemail transcription saved for SID=%s", call_sid)
            except Exception:
                db.rollback()
                log.exception("Failed to save voicemail transcription for SID=%s", call_sid)

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /api/twilio/incoming-sms
# Phone Number → Messaging → "A message comes in"
# ---------------------------------------------------------------------------

@router.post("/incoming-sms")
async def handle_incoming_sms(request: Request, db: Session = Depends(get_db)):
    """Handle an incoming SMS to the Twilio phone number.

    Routes the message to the user who owns the destination Twilio number.
    """
    form = await request.form()
    form_data = dict(form)
    _verify_twilio_signature(request, form_data)

    to_number = form_data.get("To", "")
    from_number = form_data.get("From", "")

    user = _resolve_user_by_to_number(to_number, db)

    if user:
        try:
            msg = Message(
                owner_id=user.id,
                twilio_message_sid=form_data.get("MessageSid"),
                direction="inbound",
                from_number=from_number,
                to_number=to_number,
                body=form_data.get("Body", ""),
                status="received",
                media_url=form_data.get("MediaUrl0"),
                is_read=False,
            )
            db.add(msg)
            db.commit()
            log.info("Inbound SMS saved: from=%s to=%s", from_number, to_number)
        except Exception:
            db.rollback()
            log.exception("Failed to save inbound SMS from=%s", from_number)

    return _xml("<Response></Response>")
