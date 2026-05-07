"""Telnyx client wrapper — voice calls, SMS, and phone number management."""
import httpx
import telnyx

from app.config import settings


def _init():
    if settings.telnyx_api_key:
        telnyx.api_key = settings.telnyx_api_key


_init()


def _check_configured():
    if not settings.telnyx_api_key:
        raise ValueError(
            "Telnyx not configured. Set TELNYX_API_KEY in .env"
        )


def generate_voice_access_token(
    existing_credential_id: str | None = None,
) -> tuple[str, str, str]:
    """Generate a short-lived Telnyx login token for the browser WebRTC SDK.

    Returns (token, credential_id, sip_username).
    Uses the Telnyx REST API directly because TelephonyCredential was removed
    from the Python SDK in v2+.
    """
    _check_configured()
    if not settings.telnyx_connection_id:
        raise ValueError(
            "TELNYX_CONNECTION_ID not set. "
            "Create a Credential Connection in the Telnyx portal and paste its ID."
        )

    headers = {
        "Authorization": f"Bearer {settings.telnyx_api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    base = "https://api.telnyx.com/v2"

    credential_id: str | None = None
    sip_username: str | None = None

    if existing_credential_id:
        try:
            r = httpx.get(
                f"{base}/telephony_credentials/{existing_credential_id}",
                headers=headers,
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()["data"]
                credential_id = data["id"]
                sip_username = data.get("sip_username") or data.get("resource_name")
        except Exception:
            pass

    if credential_id is None:
        r = httpx.post(
            f"{base}/telephony_credentials",
            headers=headers,
            json={"connection_id": str(settings.telnyx_connection_id)},
            timeout=10,
        )
        if not r.is_success:
            raise ValueError(f"Telnyx credential create failed ({r.status_code}): {r.text}")
        data = r.json()["data"]
        credential_id = data["id"]
        sip_username = data.get("sip_username") or data.get("resource_name")

    r = httpx.post(
        f"{base}/telephony_credentials/{credential_id}/token",
        headers=headers,
        timeout=10,
    )
    if not r.is_success:
        raise ValueError(f"Telnyx token create failed ({r.status_code}): {r.text}")

    token = r.text.strip().strip('"')
    return token, credential_id, sip_username


def send_sms(to_number: str, body: str, from_number: str | None = None) -> dict:
    """Send an SMS via Telnyx. Returns dict with sid, status."""
    _check_configured()
    if not from_number:
        raise ValueError(
            "No phone number assigned to this account. "
            "Ask an admin to assign a Telnyx number before sending SMS."
        )
    kwargs: dict = {
        "from_": from_number,
        "to": to_number,
        "text": body,
    }
    if settings.telnyx_messaging_profile_id:
        kwargs["messaging_profile_id"] = settings.telnyx_messaging_profile_id
    message = telnyx.Message.create(**kwargs)
    status = message.to[0]["status"] if getattr(message, "to", None) else "queued"
    return {"sid": message.id, "status": status}


# ============================================================
# Phone number management
# ============================================================

def search_available_numbers(
    area_code: str = "",
    country_code: str = "US",
    contains: str = "",
    limit: int = 10,
) -> list[dict]:
    """Search for available phone numbers from Telnyx."""
    _check_configured()

    params: dict = {
        "filter[country_code]": country_code,
        "filter[limit]": limit,
    }
    if area_code:
        params["filter[national_destination_code]"] = area_code
    if contains:
        params["filter[phone_number][contains]"] = contains

    numbers = telnyx.AvailablePhoneNumber.list(**params)
    return [
        {
            "phone_number": n.phone_number,
            "friendly_name": n.phone_number,
            "locality": getattr(n, "city", None),
            "region": getattr(n, "state", None),
            "country": country_code,
            **_parse_features(getattr(n, "features", None)),
        }
        for n in numbers
    ]


def _parse_features(features) -> dict:
    """Extract voice/sms/mms booleans from Telnyx features list.

    Telnyx returns features as either a list of dicts {"name": "voice", ...}
    or a list of strings depending on the SDK version. Handle both.
    """
    if not features:
        return {"cap_voice": False, "cap_sms": False, "cap_mms": False}
    names = {
        (f["name"] if isinstance(f, dict) else f).lower()
        for f in features
    }
    return {
        "cap_voice": "voice" in names,
        "cap_sms": "sms" in names,
        "cap_mms": "mms" in names,
    }


def purchase_number(phone_number: str) -> dict:
    """Order a phone number from Telnyx."""
    _check_configured()
    order = telnyx.NumberOrder.create(
        phone_numbers=[{"phone_number": phone_number}],
    )
    n = order.phone_numbers[0]
    purchased = n.phone_number
    # Store the E.164 number as the sid — release_number resolves it to the
    # PhoneNumber resource ID at deletion time (order.id cannot be used for delete).
    return {
        "sid": purchased,
        "phone_number": purchased,
        "friendly_name": purchased,
        "cap_voice": True,
        "cap_sms": True,
        "cap_mms": False,
    }


def list_owned_numbers() -> list[dict]:
    """List all phone numbers owned in Telnyx account."""
    _check_configured()
    r = httpx.get(
        "https://api.telnyx.com/v2/phone_numbers",
        headers={"Authorization": f"Bearer {settings.telnyx_api_key}", "Accept": "application/json"},
        params={"page[size]": 250},
        timeout=15,
    )
    if not r.is_success:
        raise ValueError(f"Telnyx list numbers failed ({r.status_code}): {r.text}")
    items = r.json().get("data", [])
    return [
        {
            "sid": str(n["id"]),
            "phone_number": n["phone_number"],
            "friendly_name": n.get("friendly_name") or n["phone_number"],
            **_parse_features(n.get("features")),
        }
        for n in items
    ]


def release_number(sid: str) -> bool:
    """Release (delete) a phone number from the Telnyx account.

    sid may be either the Telnyx PhoneNumber resource ID (UUID) or an E.164
    number string — handle both since legacy rows stored the order ID and newer
    rows store the E.164 number.
    """
    _check_configured()
    if sid.startswith("+"):
        # E.164 — find the resource ID by listing owned numbers
        numbers = telnyx.PhoneNumber.list()
        resource_id = next(
            (str(n.id) for n in numbers if n.phone_number == sid), None
        )
        if not resource_id:
            return False
        telnyx.PhoneNumber.delete(resource_id)
    else:
        telnyx.PhoneNumber.delete(sid)
    return True


# ============================================================
# Call Control — recording (mixed TeXML + Call Control)
# ============================================================

def _cc_headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.telnyx_api_key}",
        "Content-Type": "application/json",
    }


def call_record_start(call_control_id: str) -> None:
    """Start recording via Telnyx Call Control API.

    call_control_id is the same value as the TeXML CallSid — Telnyx uses one ID
    for both paradigms, so the value stored in Call.call_sid works here directly.

    webhook_url is set explicitly so call.recording.saved events are delivered to
    our recording-event endpoint regardless of which Telnyx application owns the
    call (the TeXML app and the Call Control app are separate resources).
    """
    _check_configured()
    url = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/record_start"
    resp = httpx.post(
        url,
        json={
            "format": "mp3",
            "channels": "dual",
            "play_beep": True,
            "webhook_url": f"{settings.public_backend_url}/api/telnyx/recording-event",
            "webhook_url_method": "POST",
        },
        headers=_cc_headers(),
        timeout=10,
    )
    resp.raise_for_status()


def call_record_stop(call_control_id: str) -> None:
    """Stop an in-progress recording via Telnyx Call Control API."""
    _check_configured()
    url = f"https://api.telnyx.com/v2/calls/{call_control_id}/actions/record_stop"
    resp = httpx.post(
        url,
        json={},
        headers=_cc_headers(),
        timeout=10,
    )
    resp.raise_for_status()


# ============================================================
# TeXML builders (Telnyx equivalent of TwiML)
# ============================================================

def build_outgoing_texml(to_number: str, caller_id: str | None = None) -> str:
    """TeXML for an outgoing call from the browser."""
    if not caller_id:
        raise ValueError(
            "No phone number assigned to this account. "
            "Ask an admin to assign a Telnyx number before making calls."
        )
    action = f"{settings.public_backend_url}/api/telnyx/call-status"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Dial callerId="{caller_id}" timeout="30" action="{action}">'
        f"<Number>{to_number}</Number>"
        "</Dial>"
        "</Response>"
    )


def build_incoming_texml(sip_username: str) -> str:
    """TeXML for an incoming call — ring the browser WebRTC client via SIP."""
    if not sip_username:
        raise ValueError(
            "sip_username must not be empty — call build_voicemail_texml() instead "
            "when the user has no SIP credential yet."
        )
    action = f"{settings.public_backend_url}/api/telnyx/post-dial"
    sip_uri = f"sip:{sip_username}@sip.telnyx.com"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f'<Dial timeout="25" action="{action}">'
        f"<Sip>{sip_uri}</Sip>"
        "</Dial>"
        "</Response>"
    )


def build_voicemail_texml() -> str:
    """TeXML to prompt and record a voicemail after a missed call."""
    action = f"{settings.public_backend_url}/api/telnyx/voicemail-complete"
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        '<Say voice="Polly.Joanna">'
        "The person you are calling is not available. "
        "Please leave a message after the beep."
        "</Say>"
        f'<Record maxLength="120" playBeep="true" action="{action}"/>'
        "</Response>"
    )
