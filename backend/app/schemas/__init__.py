"""Pydantic schemas for API input/output."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, EmailStr, Field, ConfigDict, field_validator


def _validate_password(v: str) -> str:
    """Enforce complexity: upper + lower + digit + special char."""
    if not any(c.isupper() for c in v):
        raise ValueError("Password must contain at least one uppercase letter.")
    if not any(c.islower() for c in v):
        raise ValueError("Password must contain at least one lowercase letter.")
    if not any(c.isdigit() for c in v):
        raise ValueError("Password must contain at least one digit.")
    if not any(c in "!@#$%^&*()_+-=[]{}|;':\",./<>?" for c in v):
        raise ValueError("Password must contain at least one special character.")
    return v


# L-03: enforced via the ``Department`` Literal below.
DEPARTMENTS = ["Data Team", "HR Team", "BD Team", "AI/ML Team", "DevOps Team"]
ROLES = ["admin", "user"]

Department = Literal["Data Team", "HR Team", "BD Team", "AI/ML Team", "DevOps Team"]

# L-04: existing users with shorter passwords keep their hashes; only NEW
# passwords going forward must be ≥12 characters.

# ============================================================
# Auth
# ============================================================
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SetupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(
        ...,
        min_length=12,
        max_length=72,
        description="Password (12-72 characters)",
    )

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        return _validate_password(v)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(
        ...,
        min_length=12,
        max_length=72,
        description="Password (12-72 characters)",
    )

    @field_validator("new_password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        return _validate_password(v)


class ChangePasswordRequest(BaseModel):
    """Authenticated self-service password change.

    Requires the caller's current password as a confirmation; on success the
    user's token_version is bumped so any other open sessions are invalidated.
    """
    old_password: str
    new_password: str = Field(
        ...,
        min_length=12,
        max_length=72,
        description="New password (12-72 characters)",
    )

    @field_validator("new_password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        return _validate_password(v)


class UpdateMeRequest(BaseModel):
    """Self-service profile patch. Only the user's own display name is
    editable here — role, email, phone, and department changes must go
    through the admin endpoints so they can be audited."""
    name: str = Field(..., min_length=1, max_length=255)


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
    password: str = Field(
        ...,
        min_length=12,
        max_length=72,
        description="Password (12-72 characters)",
    )
    role: str = Field("user", pattern="^(admin|user)$")
    department: Department

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        return _validate_password(v)


class UserAdminUpdate(BaseModel):
    name: str | None = None
    role: str | None = Field(None, pattern="^(admin|user)$")
    department: Department | None = None
    is_active: bool | None = None
    phone_number: str | None = None
    password: str | None = Field(
        None,
        min_length=12,
        max_length=72,
        description="Password (12-72 characters)",
    )

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v: str | None) -> str | None:
        return _validate_password(v) if v is not None else v


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
    assigned_numbers: list["PhoneNumberOut"] = []


# ============================================================
# Admin — phone number management
# ============================================================
class PhoneNumberOut(BaseModel):
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
    notes: str | None = Field(None, max_length=2000)
    is_favorite: bool = False


class ContactUpdate(BaseModel):
    name: str | None = None
    phone_number: str | None = None
    email: EmailStr | None = None
    company: str | None = None
    notes: str | None = Field(None, max_length=2000)
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
    call_sid: str | None
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


class RecordingControlRequest(BaseModel):
    """Body for /api/calls/recording/start|stop — identifies the exact call to
    (un)record by its Telnyx CallSid (which is what the WebRTC SDK exposes as
    ``activeCall.id``). Required so parallel/queued calls don't race on the
    "most recent unended call" heuristic (M-07).
    """
    call_sid: str = Field(..., min_length=1, max_length=128)


# ============================================================
# Message
# ============================================================
class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    message_sid: str | None
    direction: str
    from_number: str
    to_number: str
    body: str
    status: str
    media_url: str | None
    is_read: bool
    created_at: datetime
    client_id: str | None = None          # M-18: echo-only dedup key, never persisted


class MessageCreate(BaseModel):
    to_number: str = Field(..., min_length=1, max_length=32)
    body: str = Field(..., min_length=1)
    client_id: str | None = None          # M-18: client-generated UUID for optimistic dedup


class ConversationOut(BaseModel):
    """A conversation is a thread of messages with one phone number."""
    phone_number: str
    contact: ContactOut | None
    last_message: MessageOut
    unread_count: int


# ============================================================
# Voice Token
# ============================================================
class VoiceTokenResponse(BaseModel):
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
