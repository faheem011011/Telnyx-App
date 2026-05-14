"""SMS messaging endpoints."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, and_, case, desc, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Contact, Message, PhoneNumber, User
from app.schemas import ContactOut, ConversationOut, MessageCreate, MessageOut
from app.services.deps import get_current_user
from app.services.telnyx_service import send_sms

log = logging.getLogger(__name__)


router = APIRouter(prefix="/api/messages", tags=["messages"])


def _normalize_phone(raw: str) -> str:
    """Best-effort E.164 normalize: strips non-digits, prepends +1 for 10-digit US, + for 11-digit starting with 1."""
    digits = "".join(c for c in (raw or "") if c.isdigit())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    if (raw or "").startswith("+"):
        return raw
    return f"+{digits}" if digits else raw


def _from_number(user: User, db: Session) -> str:
    """Resolve the best SMS-capable sending number for this user.

    Priority: SMS-capable PhoneNumber assigned to user → user.phone_number.
    Raises HTTP 400 if no number is available.
    """
    tn = (
        db.query(PhoneNumber)
        .filter(
            PhoneNumber.assigned_to_user_id == user.id,
            PhoneNumber.cap_sms.is_(True),
        )
        .first()
    )
    if tn:
        return tn.phone_number
    if user.phone_number:
        return user.phone_number
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No phone number assigned to your account. Ask an admin to assign a Telnyx number before sending messages.",
    )


@router.get("/conversations")
def list_conversations(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List unique conversations grouped by phone number.

    A conversation is the thread of messages between the user and one other number.
    """
    # H-10: compute the latest message per "other" number entirely in SQL.
    # The "other" party is from_number for inbound and to_number for outbound.
    # We use Postgres DISTINCT ON to pick the newest row per group in one pass,
    # avoiding loading all of a user's messages into memory.
    other_col = case(
        (Message.direction == "inbound", Message.from_number),
        else_=Message.to_number,
    ).label("other")

    latest_sub = (
        db.query(Message.id.label("id"), other_col)
        .filter(Message.owner_id == current_user.id)
        .order_by(other_col, desc(Message.created_at))
        .distinct(other_col)
        .subquery()
    )

    latest_messages = (
        db.query(Message)
        .filter(Message.id.in_(db.query(latest_sub.c.id)))
        .all()
    )

    if not latest_messages:
        return []

    last_msg: dict[str, Message] = {}
    for msg in latest_messages:
        other = msg.from_number if msg.direction == "inbound" else msg.to_number
        last_msg[other] = msg

    numbers = list(last_msg.keys())

    # Batch load contacts for all numbers in one query
    contacts = db.query(Contact).filter(
        Contact.owner_id == current_user.id,
        Contact.phone_number.in_(numbers),
    ).all()
    contact_map = {c.phone_number: c for c in contacts}

    # Batch load unread counts for all numbers in one query
    unread_rows = (
        db.query(Message.from_number, func.count(Message.id))
        .filter(
            Message.owner_id == current_user.id,
            Message.direction == "inbound",
            Message.from_number.in_(numbers),
            Message.is_read.is_(False),
        )
        .group_by(Message.from_number)
        .all()
    )
    unread_map = {row[0]: row[1] for row in unread_rows}

    return [
        {
            "phone_number": other,
            "contact": ContactOut.model_validate(contact_map[other]).model_dump() if other in contact_map else None,
            "last_message": MessageOut.model_validate(msg).model_dump(),
            "unread_count": unread_map.get(other, 0),
        }
        for other, msg in last_msg.items()
    ]


@router.get("/thread/{phone_number}", response_model=list[MessageOut])
def get_thread(
    phone_number: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return paginated message history with a given phone number."""
    phone_number = _normalize_phone(phone_number)
    messages = db.query(Message).filter(
        Message.owner_id == current_user.id,
        or_(
            and_(Message.direction == "inbound", Message.from_number == phone_number),
            and_(Message.direction == "outbound", Message.to_number == phone_number),
        ),
    ).order_by(Message.created_at.asc()).offset(offset).limit(limit).all()

    # Mark inbound messages as read
    db.query(Message).filter(
        Message.owner_id == current_user.id,
        Message.direction == "inbound",
        Message.from_number == phone_number,
        Message.is_read.is_(False),
    ).update({"is_read": True})
    db.commit()

    return messages


@router.post("/send", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_message(
    payload: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send an SMS message from the user's assigned Telnyx number."""
    payload.to_number = _normalize_phone(payload.to_number)
    from_num = _from_number(current_user, db)
    try:
        result = send_sms(payload.to_number, payload.body, from_num)
    except ValueError as e:
        log.warning("SMS validation error to=%s: %s", payload.to_number, e)
        raise HTTPException(status_code=400, detail="Invalid phone number or message.")
    except Exception:
        log.exception("SMS send failed to=%s", payload.to_number)
        raise HTTPException(status_code=500, detail="SMS service temporarily unavailable.")

    msg = Message(
        owner_id=current_user.id,
        message_sid=result["sid"],
        direction="outbound",
        from_number=from_num,
        to_number=payload.to_number,
        body=payload.body,
        status=result["status"],
        is_read=True,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


@router.delete("/thread/{phone_number}", status_code=status.HTTP_204_NO_CONTENT)
def delete_thread(
    phone_number: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete all messages in a conversation with a given number."""
    phone_number = _normalize_phone(phone_number)

    # M-17: pre-flight count so unknown numbers return 404 instead of a
    # confusing 204 (which would otherwise indicate "deleted" with 0 rows).
    match_clause = or_(
        and_(Message.direction == "inbound", Message.from_number == phone_number),
        and_(Message.direction == "outbound", Message.to_number == phone_number),
    )
    existing = (
        db.query(func.count(Message.id))
        .filter(Message.owner_id == current_user.id, match_clause)
        .scalar()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="No conversation with that number")

    db.query(Message).filter(
        Message.owner_id == current_user.id,
        match_clause,
    ).delete(synchronize_session=False)
    db.commit()
