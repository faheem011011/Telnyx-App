import bcrypt
from sqlalchemy import create_engine, text
from app.config import settings

engine = create_engine(settings.resolved_database_url)
password = "Admin@123"
hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

with engine.begin() as conn:
    conn.execute(text("""
        INSERT INTO users (email, name, hashed_password, role, is_active, email_verified, department, created_at)
        VALUES (:email, :name, :pw, 'admin', true, true, 'Data Team', NOW())
        ON CONFLICT (email) DO UPDATE SET
            hashed_password = :pw,
            email_verified = true,
            is_active = true,
            role = 'admin'
    """), {"email": "temp@local.dev", "name": "Temp Admin", "pw": hashed})

print("Temp admin created: temp@local.dev / Admin@123")
