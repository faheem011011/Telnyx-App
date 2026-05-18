"""Database models."""
import uuid
from datetime import datetime, timezone
from typing import Any
from sqlalchemy import JSON, String, Integer, DateTime, ForeignKey, Text, Boolean, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_voice_identity() -> str:
    return str(uuid.uuid4())


class User(Base):
    """User account."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone_number: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default="user", nullable=False)
    department: Mapped[str | None] = mapped_column(String(64), nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    voice_identity: Mapped[str] = mapped_column(
        String(36), unique=True, nullable=False, default=_new_voice_identity
    )
    telnyx_credential_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    telnyx_sip_username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    contacts: Mapped[list["Contact"]] = relationship(
        "Contact", back_populates="owner", cascade="all, delete-orphan"
    )
    calls: Mapped[list["Call"]] = relationship(
        "Call", back_populates="owner", cascade="all, delete-orphan"
    )
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="owner", cascade="all, delete-orphan"
    )
    assigned_numbers: Mapped[list["PhoneNumber"]] = relationship(
        "PhoneNumber",
        back_populates="assigned_user",
        foreign_keys="PhoneNumber.assigned_to_user_id",
        passive_deletes=True,
    )


class PhoneNumber(Base):
    """Telnyx phone number — purchased and optionally assigned to a user."""

    __tablename__ = "phone_numbers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    sid: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    phone_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    friendly_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    assigned_to_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    cap_voice: Mapped[bool] = mapped_column(Boolean, default=True)
    cap_sms: Mapped[bool] = mapped_column(Boolean, default=True)
    cap_mms: Mapped[bool] = mapped_column(Boolean, default=False)
    purchased_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    assigned_user: Mapped["User | None"] = relationship(
        "User",
        back_populates="assigned_numbers",
        foreign_keys=[assigned_to_user_id],
    )


class Contact(Base):
    """Contact/address book entry."""

    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    owner: Mapped["User"] = relationship("User", back_populates="contacts")

    __table_args__ = (
        UniqueConstraint("owner_id", "phone_number", name="uq_contact_owner_phone"),
    )


class Call(Base):
    """Call history record."""

    __tablename__ = "calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    call_sid: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    from_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    to_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    # recording_url holds the most recent signed URL Telnyx returned. It expires
    # ~10 min after the call.recording.saved webhook fires, so we cache the
    # Telnyx recording_id alongside it and refresh on demand via the
    # /api/calls/{id}/recording-url endpoint.
    recording_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    recording_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    voicemail_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    voicemail_transcription: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    is_starred: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    owner: Mapped["User"] = relationship("User", back_populates="calls")

    __table_args__ = (
        Index("ix_calls_owner_started", "owner_id", "started_at"),
        Index("ix_calls_owner_status", "owner_id", "status"),
        Index("ix_calls_owner_direction_started", "owner_id", "direction", "started_at"),
    )


class Message(Base):
    """SMS/MMS message record."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    message_sid: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    from_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    to_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    media_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )

    owner: Mapped["User"] = relationship("User", back_populates="messages")

    __table_args__ = (
        Index("ix_messages_owner_created", "owner_id", "created_at"),
        Index("ix_messages_owner_direction_read", "owner_id", "direction", "is_read"),
    )


class Department(Base):
    """Admin-managed department — replaces the old hardcoded Literal list."""

    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditLog(Base):
    """Immutable record of every admin action."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    actor_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    actor_email: Mapped[str] = mapped_column(String(255), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str] = mapped_column(String(32), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    detail: Mapped[Any] = mapped_column(JSON, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )


class EmailVerificationToken(Base):
    """Single-use email verification token (raw token never stored, only SHA-256 hash)."""

    __tablename__ = "email_verification_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PasswordResetToken(Base):
    """Single-use password reset token (raw token never stored, only SHA-256 hash)."""

    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class WebhookEvent(Base):
    """Telnyx webhook event — recorded for idempotency."""
    __tablename__ = "webhook_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    telnyx_event_id: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
