"""Alembic migration environment."""
import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# ── Ensure `app` package is importable when alembic runs from backend/ ─────────
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.config import settings   # noqa: E402
from app.database import Base     # noqa: E402
import app.models                 # noqa: E402, F401 - registers all models on Base.metadata

# ── Alembic Config ──────────────────────────────────────────────────────────────
config = context.config

# Inject the real DATABASE_URL from .env (overrides alembic.ini placeholder)
# resolved_database_url normalises postgres:// → postgresql:// for Railway
config.set_main_option("sqlalchemy.url", settings.resolved_database_url)

# Wire up Python logging from the [loggers] section in alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# The metadata autogenerate compares against
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """
    Run in 'offline' mode - no live DB connection needed.
    Generates pure SQL that can be reviewed or applied manually.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # SQLite requires batch mode for ALTER TABLE
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run in 'online' mode against a live DB connection.
    Normal path used by `alembic upgrade head`.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,  # SQLite requires batch mode for ALTER TABLE
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
