"""Pydantic schemas for API input/output."""
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, ConfigDict


DEPARTMENTS = ["Data Team", "HR Team", "BD Team", "AI/ML Team", "DevOps Team"]
ROLES = ["admin", "user"]

# ============================================================
# Auth
# ============================================================
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SetupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=6)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=6)



class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str
    phone_number: str | None = None
    role: str
    department: str | None = None
    is_active: bool = True
    email_verified: bool = False


# ============================================================
# Admin — User management
# ============================================================
class UserAdminCreate(BaseModel):
    email: EmailStr
    name: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=6)
    role: str = Field("user", pattern="^(admin|user)$")
    department: str = Field(..., min_length=1)


class UserAdminUpdate(BaseModel):
    name: str | None = None
    role: str | None = Field(None, pattern="^(admin|user)$")
    department: str | None = None
    is_active: bool | None = None
    phone_number: str | None = None
    password: str | None = Field(None, min_length=6)


class UserWithNumbersOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str
    phone_number: str | None = None
    role: str
    department: str | None = None
    is_active: bool
    email_verified: bool
    created_at: datetime
    assigned_numbers: list["TwilioNumberOut"] = []


# ============================================================
# Admin — Twilio number management
# ============================================================
class TwilioNumberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sid: str
    phone_number: str
    friendly_name: str | None
    assigned_to_user_id: int | None
    cap_voice: bool
    cap_sms: bool
    cap_mms: bool
    purchased_at: datetime
    assigned_user: UserOut | None = None


class NumberSearchResult(BaseModel):
    phone_number: str
    friendly_name: str
    locality: str | None
    region: str | None
    country: str
    cap_voice: bool
    cap_sms: bool
    cap_mms: bool


class NumberPurchaseRequest(BaseModel):
    phone_number: str = Field(..., description="E.164 format, e.g. +14155551234")


class NumberAssignRequest(BaseModel):
    user_id: int


# ============================================================
# Contact
# ============================================================
class ContactCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    phone_number: str = Field(..., min_length=1, max_length=32)
    email: EmailStr | None = None
    company: str | None = None
    notes: str | None = None
    is_favorite: bool = False


class ContactUpdate(BaseModel):
    name: str | None = None
    phone_number: str | None = None
    email: EmailStr | None = None
    company: str | None = None
    notes: str | None = None
    is_favorite: bool | None = None
    is_blocked: bool | None = None


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    owner_name: str | None = None
    name: str
    phone_number: str
    email: str | None
    company: str | None
    notes: str | None
    is_favorite: bool
    is_blocked: bool
    created_at: datetime
    updated_at: datetime


# ============================================================
# Call
# ============================================================
class CallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    twilio_call_sid: str | None
    direction: str
    from_number: str
    to_number: str
    status: str
    duration_seconds: int
    recording_url: str | None
    voicemail_url: str | None
    voicemail_transcription: str | None
    is_read: bool
    is_starred: bool
    notes: str | None
    started_at: datetime
    ended_at: datetime | None
    contact: ContactOut | None = None


class CallCreate(BaseModel):
    to_number: str


class CallUpdate(BaseModel):
    is_read: bool | None = None
    is_starred: bool | None = None
    notes: str | None = None


# ============================================================
# Message
# ============================================================
class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    twilio_message_sid: str | None
    direction: str
    from_number: str
    to_number: str
    body: str
    status: str
    media_url: str | None
    is_read: bool
    created_at: datetime


class MessageCreate(BaseModel):
    to_number: str = Field(..., min_length=1, max_length=32)
    body: str = Field(..., min_length=1)


class ConversationOut(BaseModel):
    """A conversation is a thread of messages with one phone number."""
    phone_number: str
    contact: ContactOut | None
    last_message: MessageOut
    unread_count: int


# ============================================================
# Twilio Token
# ============================================================
class TwilioTokenResponse(BaseModel):
    token: str
    identity: str


# ============================================================
# Audit Log
# ============================================================
class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: int | None
    actor_email: str
    action: str
    resource_type: str
    resource_id: str | None
    detail: dict | None
    ip_address: str | None
    created_at: datetime


TokenResponse.model_rebuild()
UserWithNumbersOut.model_rebuild()
