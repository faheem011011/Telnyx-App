"""Database models."""
from datetime import datetime, timezone
from typing import Any
from sqlalchemy import JSON, String, Integer, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    """User account."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone_number: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default="user", nullable=False)
    department: Mapped[str | None] = mapped_column(String(64), nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    telnyx_credential_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    telnyx_sip_username: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

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

    __tablename__ = "twilio_numbers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    sid: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    phone_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    friendly_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    assigned_to_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
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
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
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


class Call(Base):
    """Call history record."""

    __tablename__ = "calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    call_sid: Mapped[str | None] = mapped_column(
        "twilio_call_sid", String(64), unique=True, index=True, nullable=True
    )
    direction: Mapped[str] = mapped_column(String(16), nullable=False)
    from_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    to_number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    recording_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
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


class Message(Base):
    """SMS/MMS message record."""

    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    message_sid: Mapped[str | None] = mapped_column(
        "twilio_message_sid", String(64), unique=True, index=True, nullable=True
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
