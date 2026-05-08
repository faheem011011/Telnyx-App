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
  No fallback to a "primary user" — calls/SMS that cannot be routed to a
  specific tenant are dropped or sent to voicemail.
"""
import json
import logging
import time
from datetime import datetime, timezone

import telnyx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Call, Message, PhoneNumber, User, WebhookEvent
from app.services.telnyx_service import (
    build_incoming_texml,
    build_outgoing_texml,
    build_voicemail_texml,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telnyx", tags=["telnyx-webhooks"])


# Reject events whose timestamp is more than this many seconds away from now (C-01).
_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _xml(content: str) -> Response:
    return Response(content=content, media_type="application/xml")


def _normalize_recording_url(url: str) -> str:
    # Telnyx recording URLs are complete API URLs — do NOT append .mp3.
    # Only apply the extension fix for legacy Twilio-style short paths.
    if not url:
        return url
    if "telnyx.com" in url or url.startswith("http"):
        return url          # Already a full URL; Telnyx provides the right format
    return url if url.endswith(".mp3") else url + ".mp3"


# ---------------------------------------------------------------------------
# Multi-tenant user resolution
# ---------------------------------------------------------------------------

def _resolve_user_by_to_number(to_number: str, db: Session) -> User | None:
    """Look up the user who owns the Telnyx number that received the call or SMS.

    C-03: returns None when the inbound number is not assigned to any tenant —
    no fallback to a "primary user". Callers must handle None gracefully.
    """
    if not to_number:
        return None
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
    return None


def _resolve_user_by_caller(from_field: str, db: Session) -> User | None:
    """Resolve the user making an outbound call from the browser.

    Telnyx populates the ``From`` field on browser-originated TeXML webhooks
    in different ways depending on the Application configuration. Observed
    forms:
      • ``sip:<sip_username>@sip.telnyx.com``  (SIP credential URI)
      • ``client:<sip_username>``              (Twilio-compat client identity)
      • plain ``<sip_username>``               (no prefix)
      • ``<E.164>``                            (caller phone number, e.g. +12015550100)

    Strategy: strip known prefixes and the ``@host`` suffix, then try to match
    by ``User.telnyx_sip_username`` first (canonical for browser WebRTC). If
    that misses, fall back to ``User.phone_number`` (covers configs where
    Telnyx populates the From field with the caller's E.164).

    C-03: returns None when the identity does not resolve — no fallback to
    the "primary user". Callers must handle None gracefully.
    """
    if not from_field:
        return None
    # Strip common prefixes Telnyx may include
    s = from_field.strip()
    for prefix in ("sip:", "client:", "tel:"):
        if s.startswith(prefix):
            s = s[len(prefix):]
            break
    # Strip @host suffix if present
    s = s.split("@")[0].strip()
    if not s:
        return None

    # Try sip_username first (canonical for browser WebRTC calls)
    user = (
        db.query(User)
        .filter(
            User.telnyx_sip_username == s,
            User.is_active.is_(True),
            User.deleted_at.is_(None),
        )
        .first()
    )
    if user:
        return user

    # Fallback: match by phone_number — some Telnyx app configs populate
    # the From field with the caller's E.164 instead of the SIP username.
    user = (
        db.query(User)
        .filter(
            User.phone_number == s,
            User.is_active.is_(True),
            User.deleted_at.is_(None),
        )
        .first()
    )
    if not user:
        log.warning(
            "Outbound call: no active user matched identity %r (normalized=%r)",
            from_field, s,
        )
    return user


# ---------------------------------------------------------------------------
# Telnyx webhook signature verification (C-01, C-07)
# ---------------------------------------------------------------------------

def _verify_telnyx_signature(request: Request, raw_body: bytes) -> None:
    """Verify the Telnyx Ed25519 signature on JSON webhooks ONLY.

    Use on Call Control v2 / Messaging webhooks (e.g. /incoming-sms,
    /recording-event). DO NOT call this on TeXML form-encoded webhooks
    (/outbound-call, /incoming-call, /post-dial, /call-status,
    /voicemail-complete, /voicemail-transcription) — Telnyx's TeXML
    application does not include the Telnyx-Signature-Ed25519 header on
    those deliveries, so verification will always 403 legitimate requests
    and the call/SMS flow will silently fail.

    The audit's C-01/C-07 originally widened this to all routes on the
    premise that Telnyx signs every webhook the same way. That premise
    was incorrect for TeXML in this Application Type, observed via the
    Telnyx Debug page: three retries to /outbound-call all returned 403
    from this verifier. TeXML routes are now unauthenticated at the
    backend; future hardening: an IP allowlist of Telnyx's published
    webhook source IPs.

    Behavior on JSON routes:
      • Refuse-by-default when settings.telnyx_public_key is missing — no
        silent skip in production.
      • Verify the Ed25519 signature.
      • Enforce a 5-minute replay window using the telnyx-timestamp header,
        because Webhook.construct_event verifies the signature against the
        timestamp value but does not enforce a server-side freshness window.
    """
    if not settings.telnyx_public_key:
        log.critical(
            "Telnyx webhook public key is not configured — refusing webhook. "
            "Set TELNYX_PUBLIC_KEY in the environment to enable signature "
            "verification."
        )
        raise HTTPException(
            status_code=503, detail="Webhook signature key not configured"
        )

    sig_header = request.headers.get("telnyx-signature-ed25519", "")
    timestamp = request.headers.get("telnyx-timestamp", "")

    # Replay-window check on the timestamp header — Telnyx SDK does not do this.
    try:
        ts_int = int(timestamp)
    except (TypeError, ValueError):
        log.warning("Rejected Telnyx webhook with missing/invalid timestamp header")
        raise HTTPException(
            status_code=403, detail="Forbidden: invalid Telnyx timestamp"
        )
    if abs(int(time.time()) - ts_int) > _WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS:
        log.warning(
            "Rejected Telnyx webhook outside replay window (ts=%s, now=%s)",
            ts_int, int(time.time()),
        )
        raise HTTPException(
            status_code=403, detail="Forbidden: Telnyx webhook timestamp out of window"
        )

    try:
        telnyx.Webhook.construct_event(
            raw_body,
            sig_header,
            timestamp,
            settings.telnyx_public_key,
        )
    except Exception:
        log.warning("Rejected request with invalid Telnyx webhook signature")
        raise HTTPException(status_code=403, detail="Forbidden: invalid Telnyx signature")


# ---------------------------------------------------------------------------
# Webhook idempotency (C-06)
# ---------------------------------------------------------------------------

def _claim_event(db: Session, event_id: str, event_type: str) -> bool:
    """Returns True if this is the first time we've seen this event id; False if duplicate.

    Inserts a row immediately so concurrent retries hit the unique constraint.
    Pass an empty event_id when no usable identifier exists — in that case we
    cannot dedupe, so we allow the event through.
    """
    if not event_id:
        return True  # Cannot dedupe; allow processing.
    try:
        db.add(WebhookEvent(telnyx_event_id=event_id, event_type=event_type))
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        log.info("Duplicate Telnyx webhook ignored: %s (%s)", event_id, event_type)
        return False


def _texml_event_id(route_name: str, form_data: dict) -> str:
    """Derive a stable event id for form-encoded TeXML retries.

    Telnyx retries TeXML deliveries on transient failures with the same CallSid
    and DialCallStatus/CallStatus values, so we synthesise an id from the route
    and those identifying fields. Returns "" when CallSid is absent so dedupe
    is skipped (matches the design note in the audit).
    """
    call_sid = form_data.get("CallSid") or ""
    if not call_sid:
        return ""
    status = form_data.get("DialCallStatus") or form_data.get("CallStatus") or ""
    return f"{route_name}:{call_sid}:{status}"


# ---------------------------------------------------------------------------
# POST /api/telnyx/outbound-call
# TeXML Application → Voice Request URL
# ---------------------------------------------------------------------------

@router.post("/outbound-call")
async def handle_outbound_call(request: Request, db: Session = Depends(get_db)):
    """Handle an outgoing call initiated from the browser via Telnyx WebRTC SDK."""
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config — see _verify_telnyx_signature docstring.

    # DIAGNOSTIC: log raw body + content-type + key headers so we can tell
    # whether Telnyx is sending TeXML form data (works), JSON (Voice API
    # mode), or empty body (SIP-layer reject). Remove once stable.
    raw_body = await request.body()
    content_type = request.headers.get("content-type", "")
    user_agent = request.headers.get("user-agent", "")
    log.info(
        "outbound-call diagnostic: content_type=%r length=%d body_first_500=%r ua=%r",
        content_type, len(raw_body), raw_body[:500], user_agent,
    )

    form = await request.form()
    form_data = dict(form)

    # DIAGNOSTIC: dump form payload so we can see what Telnyx actually sends
    # for browser-originated calls in this Application setup. Remove once the
    # caller-resolution path is stable.
    log.info("outbound-call payload keys=%s payload=%s", sorted(form_data.keys()), form_data)

    # If form parsing yielded nothing but raw body is JSON, try parsing as
    # Call Control v2 event so we at least see the from/to/call_id.
    if not form_data and raw_body:
        try:
            json_body = json.loads(raw_body)
            payload = json_body.get("data", {}).get("payload", {}) or json_body.get("payload", {})
            log.info(
                "outbound-call JSON-parsed: event_type=%r from=%r to=%r call_control_id=%r",
                json_body.get("data", {}).get("event_type") or json_body.get("event_type"),
                payload.get("from") or payload.get("from_sip_uri"),
                payload.get("to") or payload.get("to_sip_uri"),
                payload.get("call_control_id"),
            )
        except Exception:
            log.info("outbound-call: body is neither form nor JSON")

    to_number = form_data.get("To", "")
    # Try multiple field names — different Telnyx configurations populate
    # different fields for the calling identity on browser-originated calls.
    from_field = (
        form_data.get("From")
        or form_data.get("Caller")
        or form_data.get("FromSipUri")
        or form_data.get("FromUri")
        or ""
    )
    call_sid = form_data.get("CallSid")

    # C-06: dedupe before mutating any state.
    if not _claim_event(db, _texml_event_id("outbound-call", form_data), "outbound-call"):
        return _xml("<Response></Response>")

    user = _resolve_user_by_caller(from_field, db)

    if not user:
        log.warning(
            "Outbound call rejected: no user found for from_field=%r (form keys=%s)",
            from_field, sorted(form_data.keys()),
        )
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
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config — see _verify_telnyx_signature docstring.
    form = await request.form()
    form_data = dict(form)

    to_number = form_data.get("To", "")
    from_number = form_data.get("From", "")
    call_sid = form_data.get("CallSid")

    # C-06: dedupe before mutating any state.
    if not _claim_event(db, _texml_event_id("incoming-call", form_data), "incoming-call"):
        return _xml(build_voicemail_texml())

    user = _resolve_user_by_to_number(to_number, db)

    # C-03: if no user owns this number, do NOT persist a Call row owned by
    # anyone — just send the caller to voicemail.
    if not user:
        log.warning("No user found for To=%s; sending to voicemail", to_number)
        return _xml(build_voicemail_texml())

    # H-01: if the user has no SIP username (never logged in since their
    # credential was created), we can't ring the browser. Insert the Call row
    # with the right terminal status before returning the voicemail TeXML so it
    # doesn't sit in "ringing" forever.
    if not user.telnyx_sip_username:
        log.warning(
            "User %s has no Telnyx SIP username yet — they have not logged in "
            "since the credential was created. Inbound call cannot ring the "
            "browser; voicemail will capture it.",
            user.id,
        )
        try:
            call = Call(
                owner_id=user.id,
                call_sid=call_sid,
                direction="inbound",
                from_number=from_number,
                to_number=to_number,
                status="missed",
                started_at=_now(),
                ended_at=_now(),
                is_read=False,
            )
            db.add(call)
            db.commit()
        except Exception:
            db.rollback()
            log.exception("Failed to persist missed inbound call SID=%s", call_sid)
        return _xml(build_voicemail_texml())

    # Happy path: user has a SIP credential, ring the browser.
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

    return _xml(build_incoming_texml(user.telnyx_sip_username))


# ---------------------------------------------------------------------------
# POST /api/telnyx/post-dial
# ---------------------------------------------------------------------------

@router.post("/post-dial")
async def handle_post_dial(request: Request, db: Session = Depends(get_db)):
    """Called by Telnyx after <Dial> resolves for an inbound call."""
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config — see _verify_telnyx_signature docstring.
    form = await request.form()
    form_data = dict(form)

    call_sid = form_data.get("CallSid")
    dial_status = form_data.get("DialCallStatus", "")
    duration_raw = form_data.get("DialCallDuration") or "0"
    duration = int(duration_raw) if duration_raw.isdigit() else 0

    # C-06: dedupe.
    if not _claim_event(db, _texml_event_id("post-dial", form_data), "post-dial"):
        return _xml("<Response></Response>")

    if call_sid:
        call = db.query(Call).filter(Call.call_sid == call_sid).first()
        if call:
            if dial_status == "completed":
                call.status = "completed"
                # M-08: only overwrite duration if the new value is greater so a
                # late post-dial cannot clobber a higher duration set elsewhere.
                if duration and duration > (call.duration_seconds or 0):
                    call.duration_seconds = duration
                # M-08: only set ended_at if currently NULL (race with /call-status).
                if not call.ended_at:
                    call.ended_at = _now()
            elif dial_status in ("no-answer", "busy", "failed", "canceled"):
                call.status = "missed"
                if not call.ended_at:
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
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config — see _verify_telnyx_signature docstring.
    form = await request.form()
    form_data = dict(form)

    call_sid = form_data.get("CallSid")
    call_status = form_data.get("DialCallStatus") or form_data.get("CallStatus", "")
    duration_raw = form_data.get("DialCallDuration") or form_data.get("CallDuration") or "0"
    duration = int(duration_raw) if duration_raw.isdigit() else 0
    recording_url = form_data.get("RecordingUrl")

    if not call_sid:
        return Response(status_code=204)

    # C-06: dedupe.
    if not _claim_event(db, _texml_event_id("call-status", form_data), "call-status"):
        return _xml("<Response></Response>")

    call = db.query(Call).filter(Call.call_sid == call_sid).first()
    if call:
        if call_status:
            call.status = call_status
        # M-08: only update duration when the incoming value is greater so a
        # racing /post-dial cannot reset duration to 0 after this handler set it.
        if duration and duration > (call.duration_seconds or 0):
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
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config — see _verify_telnyx_signature docstring.
    form = await request.form()
    form_data = dict(form)

    call_sid = form_data.get("CallSid")
    recording_url = form_data.get("RecordingUrl")

    # C-06: dedupe.
    if not _claim_event(db, _texml_event_id("voicemail-complete", form_data), "voicemail-complete"):
        return _xml("<Response><Hangup/></Response>")

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
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config — see _verify_telnyx_signature docstring.
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
    _verify_telnyx_signature(request, raw_body)

    try:
        body = json.loads(raw_body)
    except Exception:
        log.warning("Received non-JSON body on /incoming-sms")
        return Response(status_code=400)

    event = body.get("data", {})
    event_type = event.get("event_type", "")
    payload = event.get("payload", {})

    # C-06: dedupe by Telnyx event id (the "id" on data, not on payload).
    event_id = event.get("id") or ""
    if not _claim_event(db, event_id, event_type or "incoming-sms"):
        return Response(status_code=204)

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

    # C-03: if no tenant owns this DID, drop the message — do NOT save it
    # against the "primary user".
    if not user:
        log.warning("No user found for inbound SMS to=%s; dropping", to_number)
        return Response(status_code=204)

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
    The webhook URL is set per-recording in call_record_start (services/telnyx_service.py).
    """
    raw_body = await request.body()

    # DIAGNOSTIC: log what arrives BEFORE signature verification so we can see
    # the body even if verification 403s. Remove once the recording-event flow
    # is confirmed end-to-end.
    log.info(
        "recording-event diagnostic: content_type=%r length=%d body_first_500=%r",
        request.headers.get("content-type", ""),
        len(raw_body),
        raw_body[:500],
    )

    _verify_telnyx_signature(request, raw_body)

    try:
        body = json.loads(raw_body)
    except Exception:
        log.warning("recording-event: body is not valid JSON")
        return Response(status_code=400)

    event = body.get("data", {})
    event_type = event.get("event_type", "recording-event")
    log.info("recording-event parsed: event_type=%r", event_type)

    # C-06: dedupe by Telnyx event id.
    event_id = event.get("id") or ""
    if not _claim_event(db, event_id, event_type):
        return Response(status_code=204)

    if event_type != "call.recording.saved":
        log.info("recording-event: ignoring non-saved event type")
        return Response(status_code=204)

    payload = event.get("payload", {})
    call_control_id = payload.get("call_control_id")
    recording_urls = payload.get("recording_urls") or {}
    recording_url = recording_urls.get("mp3") or recording_urls.get("wav")

    log.info(
        "recording-event call.recording.saved: call_control_id=%r recording_urls=%s",
        call_control_id, recording_urls,
    )

    if not (call_control_id and recording_url):
        log.warning("recording-event: missing call_control_id or recording_url; ignoring")
        return Response(status_code=204)

    # Try exact match on call_sid first.
    call = db.query(Call).filter(Call.call_sid == call_control_id).first()

    # Fallback: the Telnyx Call Control v2 call_control_id and the TeXML
    # CallSid we stored on Call.call_sid may have different formats. If exact
    # match misses, try the most-recent unended call's owner — same logic as
    # recording start in /api/calls/recording/start. Without this fallback the
    # recording URL is never persisted and the Recordings tab stays empty.
    if not call:
        log.warning(
            "recording-event: no Call matched call_sid=%r; trying most-recent unended fallback",
            call_control_id,
        )
        call = (
            db.query(Call)
            .filter(Call.recording_url.is_(None))
            .order_by(Call.started_at.desc())
            .first()
        )

    if not call:
        log.warning("recording-event: no Call row to attach recording_url to")
        return Response(status_code=204)

    call.recording_url = recording_url
    try:
        db.commit()
        log.info(
            "Recording URL saved: Call.id=%s call_sid=%s recording_url=%s",
            call.id, call.call_sid, recording_url,
        )
    except Exception:
        db.rollback()
        log.exception("Failed to save recording URL for call.id=%s", call.id)

    return Response(status_code=204)
