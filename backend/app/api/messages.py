"""SMS messaging endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, and_, desc, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Contact, Message, PhoneNumber, User
from app.schemas import ContactOut, ConversationOut, MessageCreate, MessageOut
from app.services.deps import get_current_user
from app.services.telnyx_service import send_sms


router = APIRouter(prefix="/api/messages", tags=["messages"])


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
    messages = db.query(Message).filter(
        Message.owner_id == current_user.id
    ).order_by(desc(Message.created_at)).all()

    # Collect the latest message per unique "other" number in one pass
    last_msg: dict[str, Message] = {}
    for msg in messages:
        other = msg.from_number if msg.direction == "inbound" else msg.to_number
        if other not in last_msg:
            last_msg[other] = msg

    if not last_msg:
        return []

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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the full message history with a given phone number."""
    messages = db.query(Message).filter(
        Message.owner_id == current_user.id,
        or_(
            and_(Message.direction == "inbound", Message.from_number == phone_number),
            and_(Message.direction == "outbound", Message.to_number == phone_number),
        ),
    ).order_by(Message.created_at.asc()).all()

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
    from_num = _from_number(current_user, db)
    try:
        result = send_sms(payload.to_number, payload.body, from_num)
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send SMS: {e}")

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
    db.query(Message).filter(
        Message.owner_id == current_user.id,
        or_(
            and_(Message.direction == "inbound", Message.from_number == phone_number),
            and_(Message.direction == "outbound", Message.to_number == phone_number),
        ),
    ).delete(synchronize_session=False)
    db.commit()
