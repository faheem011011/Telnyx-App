"""Telnyx TeXML webhook endpoints - all served under /api/telnyx/*.

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
  Outbound calls  - user resolved from SIP identity or caller number
  Inbound calls   - user resolved by matching PhoneNumber to the "To" number
  No fallback to a "primary user" - calls/SMS that cannot be routed to a
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

import app.events as ev
from app.config import settings
from app.database import get_db
from app.limiter import limiter
from app.models import Call, Message, PhoneNumber, User, WebhookEvent
from app.services.telnyx_service import (
    build_incoming_texml,
    build_outgoing_texml,
    build_voicemail_texml,
    call_hangup,
    fetch_recording_by_call_control_id,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telnyx", tags=["telnyx-webhooks"])


# Reject events whose timestamp is more than this many seconds away from now (C-01).
_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 3900  # 65 min - covers Telnyx's full retry schedule (max retry at 60 min)

# M-09: explicit allowlist of call statuses the application understands.
# Any value Telnyx sends that is not in this set is mapped to "failed" and
# logged at WARNING so operators can track unexpected upstream API changes.
_STATUS_ALLOWED: frozenset[str] = frozenset({
    "initiated",
    "ringing",
    "in-progress",
    "completed",
    "missed",
    "busy",
    "no-answer",
    "failed",
    "canceled",
})

# Statuses from which a call must not regress to a non-terminal state.
_TERMINAL: frozenset[str] = frozenset({
    "completed", "missed", "busy", "no-answer", "failed", "canceled",
})


def _normalize_call_status(raw: str) -> str:
    """Validate and normalise a Telnyx-supplied call status string.

    Returns the value unchanged when it is in the allowlist.  Unknown values
    are logged at WARNING (giving operators visibility into new or unexpected
    Telnyx status strings) and mapped to ``"failed"`` so the call reaches a
    known terminal state rather than being silently persisted verbatim.
    """
    if raw in _STATUS_ALLOWED:
        return raw
    log.warning(
        "call status %r is not in the allowed set %s; persisting as 'failed'",
        raw, sorted(_STATUS_ALLOWED),
    )
    return "failed"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _xml(content: str) -> Response:
    return Response(content=content, media_type="application/xml")


def _normalize_recording_url(url: str) -> str:
    # Telnyx recording URLs are complete API URLs - do NOT append .mp3.
    # Only apply the extension fix for legacy Twilio-style short paths.
    if not url:
        return url
    if "telnyx.com" in url or url.startswith("http"):
        return url          # Already a full URL; Telnyx provides the right format
    return url if url.endswith(".mp3") else url + ".mp3"


def _normalize_e164(raw) -> str:
    """Coerce a Telnyx-delivered or DB-stored phone number to ``+<digits>``.

    Returns "" when the input is empty, a SIP-credential string (e.g.
    ``gencredAbc123``), or otherwise not a pure E.164 candidate. The check
    below the call site uses an empty result to skip the leg - never silently
    drop a bare-digit PSTN number just because Telnyx omitted the "+".
    """
    if raw is None:
        return ""
    s = str(raw).strip()
    if not s:
        return ""
    # Strip any leading "+" so we can validate the body as digits-only.
    body = s[1:] if s.startswith("+") else s
    if not body.isdigit():
        return ""  # Contains letters (SIP-cred) or punctuation - not E.164.
    if not (7 <= len(body) <= 15):
        return ""  # E.164 spec: 7–15 digits inclusive.
    return f"+{body}"


# ---------------------------------------------------------------------------
# Multi-tenant user resolution
# ---------------------------------------------------------------------------

def _resolve_user_by_to_number(to_number: str, db: Session) -> User | None:
    """Look up the user who owns the Telnyx number that received the call or SMS.

    C-03: returns None when the inbound number is not assigned to any tenant -
    no fallback to a "primary user". Callers must handle None gracefully.

    C-08: PhoneNumber.assigned_to_user_id is the single authoritative source of
    routing truth. The legacy User.phone_number fallback has been removed; it
    allowed inbound calls/SMS to keep reaching a formerly-assigned user after an
    admin unassigned the number, because unassign_number() did not previously
    clear User.phone_number.  Both fields are now cleared atomically on unassign.
    """
    to_number = _normalize_e164(to_number)
    if not to_number:
        return None
    pn = db.query(PhoneNumber).filter(PhoneNumber.phone_number == to_number).first()
    if pn and pn.assigned_to_user_id:
        return db.query(User).filter(
            User.id == pn.assigned_to_user_id, User.is_active.is_(True)
        ).first()
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

    C-03: returns None when the identity does not resolve - no fallback to
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

    # Fallback: match by phone_number - some Telnyx app configs populate
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
    /voicemail-complete, /voicemail-transcription) - Telnyx's TeXML
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
      • Refuse-by-default when settings.telnyx_public_key is missing - no
        silent skip in production.
      • Verify the Ed25519 signature.
      • Enforce a 5-minute replay window using the telnyx-timestamp header,
        because Webhook.construct_event verifies the signature against the
        timestamp value but does not enforce a server-side freshness window.
    """
    if not settings.telnyx_public_key:
        log.critical(
            "Telnyx webhook public key is not configured - refusing webhook. "
            "Set TELNYX_PUBLIC_KEY in the environment to enable signature "
            "verification."
        )
        raise HTTPException(
            status_code=503, detail="Webhook signature key not configured"
        )

    sig_header = request.headers.get("telnyx-signature-ed25519", "")
    timestamp = request.headers.get("telnyx-timestamp", "")

    # Replay-window check on the timestamp header - Telnyx SDK does not do this.
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
    The row is flushed into the caller's open transaction rather than committed
    immediately - the caller's own db.commit() then persists the WebhookEvent
    together with all subsequent writes atomically (C-04 fix).
    Pass an empty event_id when no usable identifier exists - in that case we
    cannot dedupe, so we allow the event through.
    """
    if not event_id:
        return True  # Cannot dedupe; allow processing.
    try:
        db.add(WebhookEvent(telnyx_event_id=event_id, event_type=event_type))
        db.flush()  # C-04: stays in caller's transaction, not a premature commit
        return True
    except IntegrityError:
        db.rollback()
        log.info("Duplicate Telnyx webhook ignored: %s (%s)", event_id, event_type)
        return False


def _texml_event_id(route_name: str, form_data: dict) -> str:
    """Derive a stable event id for form-encoded TeXML retries.

    Primary key: route + CallSid + status (Telnyx retries with identical values).
    Fallback when CallSid is absent: route + From + To + timestamp so that a
    malformed or proxy-stripped webhook is still deduplicated and cannot create
    duplicate Call rows on retry.
    """
    call_sid = form_data.get("CallSid") or ""
    status = form_data.get("DialCallStatus") or form_data.get("CallStatus") or ""
    if call_sid:
        return f"{route_name}:{call_sid}:{status}"
    from_num = form_data.get("From") or ""
    to_num   = form_data.get("To") or ""
    ts       = form_data.get("Timestamp") or form_data.get("ApiVersion") or ""
    if from_num and to_num:
        return f"{route_name}:{from_num}:{to_num}:{ts}"
    return ""  # Still empty - _claim_event will allow through as before


# ---------------------------------------------------------------------------
# POST /api/telnyx/outbound-call
# TeXML Application → Voice Request URL
# ---------------------------------------------------------------------------

@router.post("/outbound-call")
@limiter.limit("1000/minute")
async def handle_outbound_call(request: Request, db: Session = Depends(get_db)):
    """Handle an outgoing call initiated from the browser via Telnyx WebRTC SDK.

    Dispatches by Content-Type:
      • application/json → Call Control v2 event (when SIP Connection is in
        Programmable Voice mode). Handled by ``_handle_outbound_call_v2``.
      • everything else  → TeXML form-encoded (the original design path).
    """
    raw_body = await request.body()
    content_type = request.headers.get("content-type", "")

    log.info(
        "outbound-call diagnostic: content_type=%r length=%d body_first_500=%r",
        content_type, len(raw_body), raw_body[:500],
    )

    if "application/json" in content_type:
        return await _handle_outbound_call_v2(db, raw_body)

    return await _handle_outbound_call_texml(request, db)


async def _handle_outbound_call_texml(request: Request, db: Session) -> Response:
    """TeXML form-encoded outbound webhook handler. Original design path.

    Telnyx sends ``CallSid``, ``From``, ``To`` etc. as form fields; we respond
    with TeXML markup containing ``<Dial>`` to instruct Telnyx to bridge the
    call to the destination.
    """
    form = await request.form()
    form_data = dict(form)
    log.info("outbound-call texml: payload keys=%s", sorted(form_data.keys()))

    to_number = form_data.get("To", "")
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
        log.warning("texml outbound rejected: no user for from=%r", from_field)
        return _xml(
            "<Response>"
            '<Say voice="Polly.Joanna">Your account was not found. '
            "Please contact your administrator.</Say>"
            "<Hangup/>"
            "</Response>"
        )

    caller_id = user.phone_number
    if not caller_id:
        log.warning("texml outbound rejected: user %s has no phone number", user.id)
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
            log.info("Outbound call created (texml): SID=%s user=%s to=%s", call_sid, user.id, to_number)
        except Exception:
            db.rollback()
            log.exception("Failed to persist texml outbound Call SID=%s", call_sid)

    return _xml(build_outgoing_texml(to_number, caller_id=caller_id))


# ---------------------------------------------------------------------------
# Call Control v2 outbound handler
#
# Used when the SIP Connection is in Programmable Voice mode. Telnyx fires
# JSON events to /outbound-call instead of TeXML form posts. Flow:
#
#   1. Browser SDK opens SIP INVITE to Telnyx with destination number.
#   2. Telnyx fires call.initiated event to this webhook with:
#        from = user's caller-id phone number (per WebRTC SDK callerNumber)
#        to   = destination phone number (E.164)
#   3. We resolve the user, persist a Call row, then issue:
#        POST /v2/calls/{id}/actions/answer    - accept the SIP leg
#        POST /v2/calls/{id}/actions/transfer  - atomically dials & bridges PSTN
#   4. Telnyx fires call.answered when destination picks up; we update status.
#   5. Telnyx fires call.hangup when either side hangs up; we mark Call ended.
#
# The same webhook also receives events for the secondary leg of inbound
# calls (TeXML's <Dial><Sip/></Dial> creates an outbound-direction SIP leg
# from Telnyx's perspective, also fires events here). We distinguish by
# checking whether ``to`` looks like an E.164 number - only PSTN-bound calls
# get the dial+transfer treatment; SIP-credential targets are ignored.
# ---------------------------------------------------------------------------

async def _handle_outbound_call_v2(db: Session, raw_body: bytes) -> Response:
    try:
        body = json.loads(raw_body)
    except Exception:
        log.warning("outbound-call v2: body is not JSON, ignoring")
        return Response(status_code=204)

    data = body.get("data", {})
    event_type = data.get("event_type", "")
    payload = data.get("payload", {}) or {}
    call_control_id = payload.get("call_control_id") or ""

    # C-06: dedupe by Telnyx event id.
    event_id = data.get("id") or ""
    if event_id and not _claim_event(db, event_id, event_type or "outbound-call-v2"):
        return Response(status_code=204)

    if not call_control_id:
        log.info("outbound-call v2: no call_control_id, ignoring event=%s", event_type)
        return Response(status_code=204)

    # Full payload dump for the three event types we care about - gives us
    # the hangup_cause / hangup_source / codec / SDP metadata Telnyx delivered
    # without having to re-derive it from a truncated body_first_500 log.
    # Especially useful for diagnosing PSTN-side rejections (STIR/SHAKEN,
    # carrier spam filtering) where the SIP leg between SDK and Telnyx is
    # healthy but the auto-bridged PSTN leg dies quickly.
    if event_type in ("call.initiated", "call.answered", "call.hangup"):
        log.info(
            "outbound-call v2 %s full payload: %s",
            event_type, json.dumps(payload, default=str)[:2000],
        )
    log.info(
        "outbound-call v2: event=%s call_control_id=%s from=%r to=%r",
        event_type, call_control_id, payload.get("from"), payload.get("to"),
    )

    if event_type == "call.initiated":
        return await _v2_handle_initiated(db, payload, call_control_id)
    if event_type == "call.answered":
        return _v2_handle_answered(db, call_control_id)
    if event_type == "call.hangup":
        return _v2_handle_hangup(db, payload, call_control_id)
    return Response(status_code=204)


async def _v2_handle_initiated(db: Session, payload: dict, call_control_id: str) -> Response:
    """Persist a Call row for the SIP leg of an outbound WebRTC dial.

    IMPORTANT - do NOT issue ``answer`` + ``transfer`` here.

    Telnyx Credential Connections auto-bridge SDK SIP INVITEs to PSTN the
    moment the INVITE arrives with a PSTN-shaped To header. Two
    ``call.initiated`` events fire per outbound call:

      * The SIP leg from the WebRTC SDK (``calling_party_type=sip``, has
        ``X-RTC-CALLID`` custom_headers, ``from_sip_uri`` set).
      * The auto-created PSTN leg (no ``calling_party_type``, no SDK
        headers, same ``call_session_id`` as the SIP leg).

    We persist a Call row only for the SIP leg and let Telnyx handle the
    bridge. Calling ``answer`` + ``transfer`` on top of the auto-bridge -
    which the previous version of this handler did - tears down Telnyx's
    bridge mid-setup and produces the "destination phone rings for ~1s
    then disconnects, logged as a missed call" symptom.
    """
    calling_party_type = (payload.get("calling_party_type") or "").lower()

    # Skip the auto-bridged PSTN leg entirely. Same session, but it's
    # Telnyx's internal bridge plumbing - we don't own it.
    if calling_party_type != "sip":
        log.info(
            "v2: skipping non-SIP call.initiated (calling_party_type=%r, state=%r)",
            calling_party_type, payload.get("state"),
        )
        return Response(status_code=204)

    from_field = _normalize_e164(payload.get("from"))
    to_field = _normalize_e164(payload.get("to"))

    # SIP-credential targets (e.g. 'gencredAbc...') return "" from
    # _normalize_e164 - those are the secondary leg of an inbound call and
    # are handled by the TeXML inbound flow, not this path.
    if not to_field:
        log.info("v2: skipping non-PSTN call.initiated (to=%r)", payload.get("to"))
        return Response(status_code=204)

    user = _resolve_user_by_caller(from_field, db)
    if not user:
        log.warning("v2 outbound rejected: no user for from=%r", from_field)
        call_hangup(call_control_id)
        return Response(status_code=204)

    caller_id = _normalize_e164(user.phone_number)
    if not caller_id:
        log.warning(
            "v2 outbound rejected: user %s has no/invalid phone number (raw=%r)",
            user.id, user.phone_number,
        )
        call_hangup(call_control_id)
        return Response(status_code=204)

    try:
        call = Call(
            owner_id=user.id,
            call_sid=call_control_id,
            direction="outbound",
            from_number=caller_id,
            to_number=to_field,
            status="initiated",
            started_at=_now(),
            is_read=True,
        )
        db.add(call)
        db.commit()
        log.info(
            "v2 outbound Call persisted (auto-bridge): id=%s SID=%s user=%s to=%s",
            call.id, call_control_id, user.id, to_field,
        )
    except IntegrityError:
        db.rollback()
        log.info("v2 outbound: Call row already exists for SID=%s (retry)", call_control_id)
    except Exception:
        db.rollback()
        log.exception("v2 outbound: failed to persist Call SID=%s", call_control_id)

    return Response(status_code=204)


def _v2_handle_answered(db: Session, call_control_id: str) -> Response:
    # H-26: lock so concurrent v2 event handlers serialize on the same call row.
    call = db.query(Call).filter(Call.call_sid == call_control_id).with_for_update().first()
    if call:
        call.status = "in-progress"
        try:
            db.commit()
        except Exception:
            db.rollback()
            log.exception("v2 answered: failed to update Call SID=%s", call_control_id)
    return Response(status_code=204)


def _v2_handle_hangup(db: Session, payload: dict, call_control_id: str) -> Response:
    # H-26: lock so concurrent hangup/answered events cannot race on status.
    call = db.query(Call).filter(Call.call_sid == call_control_id).with_for_update().first()
    if not call:
        return Response(status_code=204)

    if not call.ended_at:
        call.ended_at = _now()

    hangup_cause = payload.get("hangup_cause") or ""
    # H-04: skip status update if call already reached a terminal state.
    # A late hangup event must not overwrite a completed/missed/busy status.
    if call.status not in _TERMINAL:
        # Map Telnyx hangup_cause to our coarse status set.
        if hangup_cause == "normal_clearing":
            # Treat as completed only if the call was actually answered.
            call.status = "completed" if call.status == "in-progress" else "missed"
        elif hangup_cause in ("call_rejected", "user_busy", "callee_busy"):
            call.status = "busy"
        elif hangup_cause in ("no_answer", "no_user_response"):
            call.status = "no-answer"
        elif hangup_cause in ("originator_cancel",):
            call.status = "canceled"
        else:
            # Default - keep current unless still 'initiated'/'ringing'
            if call.status in ("initiated", "ringing", None):
                call.status = "failed"

    duration_raw = payload.get("call_duration_secs")
    try:
        duration = int(duration_raw) if duration_raw is not None else 0
    except (TypeError, ValueError):
        duration = 0
    if duration and duration > (call.duration_seconds or 0):
        call.duration_seconds = duration

    try:
        db.commit()
        log.info("v2 hangup: Call SID=%s status=%s cause=%s",
                 call_control_id, call.status, hangup_cause)
    except Exception:
        db.rollback()
        log.exception("v2 hangup: failed to update Call SID=%s", call_control_id)

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /api/telnyx/incoming-call
# ---------------------------------------------------------------------------

@router.post("/incoming-call")
@limiter.limit("1000/minute")
async def handle_incoming_call(request: Request, db: Session = Depends(get_db)):
    """Handle an incoming PSTN call to the Telnyx phone number."""
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config - see _verify_telnyx_signature docstring.
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
    # anyone - just send the caller to voicemail.
    if not user:
        log.warning("No user found for To=%s; sending to voicemail", to_number)
        return _xml(build_voicemail_texml())

    # H-01: if the user has no SIP username (never logged in since their
    # credential was created), we can't ring the browser. Insert the Call row
    # with the right terminal status before returning the voicemail TeXML so it
    # doesn't sit in "ringing" forever.
    if not user.telnyx_sip_username:
        log.warning(
            "User %s has no Telnyx SIP username yet - they have not logged in "
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
    else:
        try:
            await ev.broadcast(user.id, "call.incoming", {"from_number": from_number, "call_sid": call_sid})
        except Exception:
            pass

    return _xml(build_incoming_texml(user.telnyx_sip_username))


# ---------------------------------------------------------------------------
# POST /api/telnyx/post-dial
# ---------------------------------------------------------------------------

@router.post("/post-dial")
@limiter.limit("1000/minute")
async def handle_post_dial(request: Request, db: Session = Depends(get_db)):
    """Called by Telnyx after <Dial> resolves for an inbound call."""
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config - see _verify_telnyx_signature docstring.
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
        # H-26: lock the row so a concurrent /call-status handler cannot read
        # stale state, pass the terminal-state guard, and then overwrite this
        # handler's final status write (or vice-versa).
        call = db.query(Call).filter(Call.call_sid == call_sid).with_for_update().first()
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
            elif dial_status in ("no-answer", "busy", "failed"):
                call.status = "missed"
            elif dial_status == "canceled":
                call.status = "canceled"
                if not call.ended_at:
                    call.ended_at = _now()
            try:
                db.commit()
            except Exception:
                db.rollback()
                log.exception("Failed to update call %s in post-dial", call_sid)
            else:
                try:
                    await ev.broadcast(call.owner_id, "call.updated", {"call_sid": call_sid})
                except Exception:
                    pass

    if dial_status in ("no-answer", "busy", "failed"):
        return _xml(build_voicemail_texml())

    return _xml("<Response></Response>")


# ---------------------------------------------------------------------------
# POST /api/telnyx/call-status
# ---------------------------------------------------------------------------

@router.post("/call-status")
@limiter.limit("1000/minute")
async def handle_call_status(request: Request, db: Session = Depends(get_db)):
    """Receive call lifecycle status updates from Telnyx."""
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config - see _verify_telnyx_signature docstring.
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

    # H-26: lock the row so concurrent webhook deliveries for the same call
    # serialize here rather than racing through the terminal-state guard below.
    call = db.query(Call).filter(Call.call_sid == call_sid).with_for_update().first()
    if call:
        # Only write status when: current is not terminal, OR new value is terminal.
        # This stops a late "ringing"/"in-progress" webhook from overwriting
        # a "completed" status that arrived first.
        if call_status:
            safe_status = _normalize_call_status(call_status)
            if call.status not in _TERMINAL or safe_status in _TERMINAL:
                call.status = safe_status
        # M-08: only update duration when the incoming value is greater so a
        # racing /post-dial cannot reset duration to 0 after this handler set it.
        if duration and duration > (call.duration_seconds or 0):
            call.duration_seconds = duration
        if recording_url:
            call.recording_url = _normalize_recording_url(recording_url)
        if call_status in ("completed", "missed", "no-answer", "busy", "failed", "canceled"):
            if not call.ended_at:
                call.ended_at = _now()
        try:
            db.commit()
        except Exception:
            db.rollback()
            log.exception("Failed to update call status for SID=%s", call_sid)
        else:
            try:
                await ev.broadcast(call.owner_id, "call.updated", {"call_sid": call_sid})
            except Exception:
                pass

    return _xml("<Response></Response>")


# ---------------------------------------------------------------------------
# POST /api/telnyx/voicemail-complete
# ---------------------------------------------------------------------------

@router.post("/voicemail-complete")
@limiter.limit("1000/minute")
async def handle_voicemail_complete(request: Request, db: Session = Depends(get_db)):
    """Called by Telnyx after a voicemail recording finishes."""
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config - see _verify_telnyx_signature docstring.
    form = await request.form()
    form_data = dict(form)

    call_sid = form_data.get("CallSid")
    recording_url = form_data.get("RecordingUrl")

    # C-06: dedupe.
    if not _claim_event(db, _texml_event_id("voicemail-complete", form_data), "voicemail-complete"):
        return _xml("<Response><Hangup/></Response>")

    if call_sid and recording_url:
        # H-26: lock the row for the same reason as /post-dial and /call-status.
        call = db.query(Call).filter(Call.call_sid == call_sid).with_for_update().first()
        if call:
            call.voicemail_url = _normalize_recording_url(recording_url)
            # Extract recording ID from the Telnyx API URL at ingest time so
            # get_voicemail_url can re-sign without re-parsing the URL on every
            # request (mirrors the recording_id pattern for regular call recordings).
            vid = recording_url.rstrip("/").split("/")[-1] if recording_url else None
            if vid:
                call.voicemail_recording_id = vid
            # Only downgrade to "missed" if the call never reached a terminal state.
            # Without this guard a completed (answered) call would be overwritten.
            if call.status not in _TERMINAL:
                call.status = "missed"
            if not call.ended_at:
                call.ended_at = _now()
            try:
                db.commit()
                log.info("Voicemail saved for SID=%s", call_sid)
            except Exception:
                db.rollback()
                log.exception("Failed to save voicemail URL for SID=%s", call_sid)
            else:
                try:
                    await ev.broadcast(call.owner_id, "call.updated", {"call_sid": call_sid})
                except Exception:
                    pass

    return _xml("<Response><Hangup/></Response>")


# ---------------------------------------------------------------------------
# POST /api/telnyx/voicemail-transcription
# ---------------------------------------------------------------------------

@router.post("/voicemail-transcription")
@limiter.limit("1000/minute")
async def handle_voicemail_transcription(request: Request):
    # Telnyx TeXML <Record> does not support transcription callbacks - this
    # endpoint is kept so any stale webhook config doesn't cause 404 errors.
    # TeXML form-encoded webhooks don't carry an Ed25519 signature header in
    # this Telnyx app config - see _verify_telnyx_signature docstring.
    await request.body()
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /api/telnyx/incoming-sms
# ---------------------------------------------------------------------------

@router.post("/incoming-sms")
@limiter.limit("1000/minute")
async def handle_incoming_sms(request: Request, db: Session = Depends(get_db)):
    """Handle Telnyx messaging webhooks (message.received / message.sent / message.finalized / message.failed).

    Telnyx sends JSON for all messaging events - not form-encoded like Twilio.
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
    if event_type in ("message.sent", "message.finalized", "message.failed"):
        message_id = payload.get("id")
        to_list = payload.get("to", [])
        status = to_list[0].get("status") if to_list else None
        # M-03: message.failed may omit to[0].status - fall back to "failed" so
        # the record is never left stuck in "sent"/"queued" after a failure event.
        if event_type == "message.failed" and not status:
            status = "failed"
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

    # C-03: if no tenant owns this DID, drop the message - do NOT save it
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
    else:
        try:
            await ev.broadcast(user.id, "message.received", {"from_number": from_number, "to_number": to_number})
        except Exception:
            pass

    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /api/telnyx/recording-event
# Call Control Application → Webhook URL
# Handles call.recording.saved JSON events from Telnyx Call Control
# ---------------------------------------------------------------------------

@router.post("/recording-event")
@limiter.limit("1000/minute")
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
    recording_id = payload.get("recording_id") or payload.get("id")
    recording_urls = payload.get("recording_urls") or {}
    recording_url = recording_urls.get("mp3") or recording_urls.get("wav")

    log.info(
        "recording-event call.recording.saved: call_control_id=%r recording_id=%r recording_urls=%s",
        call_control_id, recording_id, recording_urls,
    )

    # M-08: recording_id absence means we cannot later call GET /v2/recordings/{id}
    # to mint a fresh signed URL. The pre-signed S3 link in recording_url expires
    # ~10 minutes after delivery, so without recording_id the recording becomes
    # permanently inaccessible shortly after this webhook fires.
    # Known cause: TeXML-initiated recordings may omit recording_id in the payload.
    # Fallback: query GET /v2/recordings?filter[call_control_id]={id} to resolve it.
    if not recording_id:
        log.warning(
            "recording-event: call.recording.saved arrived WITHOUT recording_id "
            "(call_control_id=%r). Attempting filter-API fallback. Full payload: %s",
            call_control_id, payload,
        )
        if call_control_id:
            resolved_id, resolved_url = fetch_recording_by_call_control_id(call_control_id)
            if resolved_id:
                recording_id = resolved_id
                if resolved_url:
                    recording_url = resolved_url
                log.info(
                    "recording-event: resolved recording_id=%r via filter lookup for call_control_id=%r",
                    recording_id, call_control_id,
                )
            else:
                log.warning(
                    "recording-event: filter lookup found no recording for call_control_id=%r; "
                    "pre-signed URL will expire in ~10 min and cannot be refreshed.",
                    call_control_id,
                )

    if not (call_control_id and recording_url):
        log.warning("recording-event: missing call_control_id or recording_url; ignoring")
        return Response(status_code=204)

    # Try exact match on call_sid first.
    # H-26: lock so a concurrent /call-status handler cannot race the recording write.
    call = db.query(Call).filter(Call.call_sid == call_control_id).with_for_update().first()

    if not call:
        # Cross-tenant fallback removed: querying without owner_id would attach
        # User A's recording to User B's call in a multi-user deployment.
        log.warning(
            "recording-event: no Call matched call_sid=%r; dropping event (multi-tenant safety)",
            call_control_id,
        )
        return Response(status_code=204)

    call.recording_url = recording_url
    # Keep the stable recording_id so we can mint a fresh signed URL when the
    # pre-signed S3 link in recording_url expires (~10 minutes after delivery).
    # If recording_id is absent the recording_url is our only reference; it will
    # stop working once the pre-signed window closes (see warning above).
    if recording_id:
        call.recording_id = recording_id
    try:
        db.commit()
        log.info(
            "Recording saved: Call.id=%s call_sid=%s recording_id=%s durable=%s",
            call.id, call.call_sid, recording_id, bool(recording_id),
        )
    except Exception:
        db.rollback()
        log.exception("Failed to save recording URL for call.id=%s", call.id)

    return Response(status_code=204)
