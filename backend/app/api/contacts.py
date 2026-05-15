"""Contacts CRUD endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models import Contact, User
from app.schemas import ContactCreate, ContactOut, ContactUpdate
from app.services.audit import get_client_ip, log_audit
from app.services.deps import get_current_user


router = APIRouter(prefix="/api/contacts", tags=["contacts"])


def _resolve_contact(
    contact_id: int, current_user: User, db: Session
) -> Contact:
    """Return the contact or 404. Admins can access any contact."""
    query = db.query(Contact).filter(Contact.id == contact_id)
    if current_user.role != "admin":
        query = query.filter(Contact.owner_id == current_user.id)
    contact = query.first()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.get("", response_model=list[ContactOut])
def list_contacts(
    search: str | None = Query(None),
    favorites_only: bool = Query(False),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list:
    """List contacts. Admins see all users' contacts; regular users see only their own."""
    is_admin = current_user.role == "admin"

    query = db.query(Contact)
    if not is_admin:
        query = query.filter(Contact.owner_id == current_user.id)
    else:
        query = query.options(joinedload(Contact.owner))

    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                Contact.name.ilike(pattern),
                Contact.phone_number.ilike(pattern),
                Contact.email.ilike(pattern),
                Contact.company.ilike(pattern),
            )
        )

    if favorites_only:
        query = query.filter(Contact.is_favorite.is_(True))

    contacts = query.order_by(Contact.name.asc()).offset(offset).limit(limit).all()

    if is_admin:
        return [
            ContactOut(
                id=c.id,
                owner_id=c.owner_id,
                owner_name=c.owner.name if c.owner else None,
                name=c.name,
                phone_number=c.phone_number,
                email=c.email,
                company=c.company,
                notes=c.notes,
                is_favorite=c.is_favorite,
                is_blocked=c.is_blocked,
                created_at=c.created_at,
                updated_at=c.updated_at,
            )
            for c in contacts
        ]

    return contacts


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def create_contact(
    payload: ContactCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Contact:
    """Create a new contact owned by the current user."""
    # L-05: pin field list explicitly so future ContactCreate additions don't
    # silently set fields that the create endpoint shouldn't accept (e.g. is_blocked).
    data = payload.model_dump()

    # L-32: reject duplicate phone numbers per user
    existing = (
        db.query(Contact)
        .filter(
            Contact.owner_id == current_user.id,
            Contact.phone_number == data["phone_number"],
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"You already have a contact with this phone number ({existing.name}). "
                "Please enter a different number."
            ),
        )

    contact = Contact(
        owner_id=current_user.id,
        name=data["name"],
        phone_number=data["phone_number"],
        email=data.get("email"),
        company=data.get("company"),
        notes=data.get("notes"),
        is_favorite=data.get("is_favorite", False),
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


@router.get("/{contact_id}", response_model=ContactOut)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Contact:
    """Return a single contact by ID."""
    return _resolve_contact(contact_id, current_user, db)


@router.patch("/{contact_id}", response_model=ContactOut)
def update_contact(
    contact_id: int,
    payload: ContactUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Contact:
    """Partially update a contact."""
    contact = _resolve_contact(contact_id, current_user, db)

    updates = payload.model_dump(exclude_unset=True)

    # L-32: reject duplicate phone numbers per user when number is being changed
    if "phone_number" in updates and updates["phone_number"] != contact.phone_number:
        duplicate = (
            db.query(Contact)
            .filter(
                Contact.owner_id == contact.owner_id,
                Contact.phone_number == updates["phone_number"],
                Contact.id != contact.id,
            )
            .first()
        )
        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"You already have a contact with this phone number ({duplicate.name}). "
                    "Please enter a different number."
                ),
            )

    for key, value in updates.items():
        setattr(contact, key, value)

    # H-08: audit when an admin edits a contact owned by another user.
    if current_user.role == "admin" and contact.owner_id != current_user.id:
        log_audit(
            db, current_user,
            action="contact.update",
            resource_type="contact",
            resource_id=str(contact.id),
            detail={
                "target_owner_id": contact.owner_id,
                "contact_id": contact.id,
                "name": contact.name,
            },
            ip_address=get_client_ip(request),
        )

    db.commit()
    db.refresh(contact)
    return contact


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    """Delete a contact."""
    contact = _resolve_contact(contact_id, current_user, db)

    # H-08: audit when an admin deletes a contact owned by another user.
    if current_user.role == "admin" and contact.owner_id != current_user.id:
        log_audit(
            db, current_user,
            action="contact.delete",
            resource_type="contact",
            resource_id=str(contact.id),
            detail={
                "target_owner_id": contact.owner_id,
                "contact_id": contact.id,
                "name": contact.name,
            },
            ip_address=get_client_ip(request),
        )

    db.delete(contact)
    db.commit()
