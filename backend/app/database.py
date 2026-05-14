"""SQLAlchemy database engine and session setup."""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import QueuePool

from app.config import settings

engine = create_engine(
    settings.resolved_database_url,
    poolclass=QueuePool,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=300,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
