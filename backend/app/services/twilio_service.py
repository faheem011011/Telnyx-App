"""Twilio client wrapper — voice calls, SMS, and phone number management."""
from twilio.jwt.access_token import AccessToken
from twilio.jwt.access_token.grants import VoiceGrant
from twilio.rest import Client
from twilio.twiml.voice_response import VoiceResponse, Dial

from app.config import settings


def get_twilio_client() -> Client | None:
    """Return a Twilio REST client, or None if credentials are missing."""
    if not settings.twilio_account_sid or not settings.twilio_auth_token:
        return None
    return Client(settings.twilio_account_sid, settings.twilio_auth_token)


def generate_voice_access_token(identity: str) -> str:
    """Generate a short-lived Twilio JWT for the browser Voice SDK."""
    if not all([
        settings.twilio_account_sid,
        settings.twilio_api_key_sid,
        settings.twilio_api_key_secret,
        settings.twilio_twiml_app_sid,
    ]):
        raise ValueError(
            "Missing Twilio credentials. Please configure TWILIO_ACCOUNT_SID, "
            "TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, and TWILIO_TWIML_APP_SID in .env"
        )

    token = AccessToken(
        settings.twilio_account_sid,
        settings.twilio_api_key_sid,
        settings.twilio_api_key_secret,
        identity=identity,
        ttl=3600,
    )
    voice_grant = VoiceGrant(
        outgoing_application_sid=settings.twilio_twiml_app_sid,
        incoming_allow=True,
    )
    token.add_grant(voice_grant)
    return token.to_jwt()


def send_sms(to_number: str, body: str, from_number: str | None = None) -> dict:
    """Send an SMS via Twilio. Returns dict with sid, status."""
    client = get_twilio_client()
    if client is None:
        raise ValueError("Twilio client not configured")

    message = client.messages.create(
        body=body,
        from_=from_number or settings.twilio_phone_number,
        to=to_number,
    )
    return {"sid": message.sid, "status": message.status}


# ============================================================
# Phone number management
# ============================================================

def search_available_numbers(
    area_code: str = "",
    country_code: str = "US",
    contains: str = "",
    limit: int = 10,
) -> list[dict]:
    """Search for available phone numbers from Twilio."""
    client = get_twilio_client()
    if client is None:
        raise ValueError("Twilio client not configured")

    kwargs: dict = {"limit": limit}
    if area_code:
        kwargs["area_code"] = area_code
    if contains:
        kwargs["contains"] = contains

    numbers = client.available_phone_numbers(country_code).local.list(**kwargs)
    return [
        {
            "phone_number": n.phone_number,
            "friendly_name": n.friendly_name,
            "locality": n.locality,
            "region": n.region,
            "country": country_code,
            "cap_voice": bool(getattr(n.capabilities, "voice", True)),
            "cap_sms": bool(getattr(n.capabilities, "sms", True)),
            "cap_mms": bool(getattr(n.capabilities, "mms", False)),
        }
        for n in numbers
    ]


def purchase_number(phone_number: str) -> dict:
    """Purchase a phone number from Twilio."""
    client = get_twilio_client()
    if client is None:
        raise ValueError("Twilio client not configured")

    result = client.incoming_phone_numbers.create(
        phone_number=phone_number,
        voice_url=f"{settings.public_backend_url}/api/twilio/incoming-call",
        voice_method="POST",
        sms_url=f"{settings.public_backend_url}/api/twilio/incoming-sms",
        sms_method="POST",
        status_callback=f"{settings.public_backend_url}/api/twilio/call-status",
        status_callback_method="POST",
    )
    return {
        "sid": result.sid,
        "phone_number": result.phone_number,
        "friendly_name": result.friendly_name,
        "cap_voice": bool(getattr(result.capabilities, "voice", True)),
        "cap_sms": bool(getattr(result.capabilities, "sms", True)),
        "cap_mms": bool(getattr(result.capabilities, "mms", False)),
    }


def list_owned_numbers() -> list[dict]:
    """List all phone numbers currently owned in Twilio account."""
    client = get_twilio_client()
    if client is None:
        raise ValueError("Twilio client not configured")

    numbers = client.incoming_phone_numbers.list()
    return [
        {
            "sid": n.sid,
            "phone_number": n.phone_number,
            "friendly_name": n.friendly_name,
            "cap_voice": bool(getattr(n.capabilities, "voice", True)),
            "cap_sms": bool(getattr(n.capabilities, "sms", True)),
            "cap_mms": bool(getattr(n.capabilities, "mms", False)),
        }
        for n in numbers
    ]


def release_number(sid: str) -> bool:
    """Release (delete) a phone number from the Twilio account."""
    client = get_twilio_client()
    if client is None:
        raise ValueError("Twilio client not configured")
    client.incoming_phone_numbers(sid).delete()
    return True


# ============================================================
# TwiML builders
# ============================================================

def build_outgoing_twiml(to_number: str, caller_id: str | None = None) -> str:
    """Build TwiML for an outgoing call from the browser."""
    response = VoiceResponse()
    dial = Dial(
        caller_id=caller_id or settings.twilio_phone_number,
        answer_on_bridge=True,
        action=f"{settings.public_backend_url}/api/twilio/call-status",
    )
    dial.number(to_number)
    response.append(dial)
    return str(response)


def build_incoming_twiml(client_identity: str) -> str:
    """Build TwiML for an incoming call — forward to the browser client."""
    response = VoiceResponse()
    dial = Dial(
        answer_on_bridge=True,
        timeout=25,
        action=f"{settings.public_backend_url}/api/twilio/post-dial",
    )
    dial.client(client_identity)
    response.append(dial)
    return str(response)


def build_voicemail_twiml() -> str:
    """TwiML to prompt and record a voicemail after a missed call."""
    response = VoiceResponse()
    response.say(
        "The person you are calling is not available. "
        "Please leave a message after the beep.",
        voice="Polly.Joanna",
    )
    response.record(
        max_length=120,
        transcribe=True,
        transcribe_callback=f"{settings.public_backend_url}/api/twilio/voicemail-transcription",
        action=f"{settings.public_backend_url}/api/twilio/voicemail-complete",
    )
    return str(response)
