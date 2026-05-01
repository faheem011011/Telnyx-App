import os
from sqlalchemy import create_engine, text
from app.config import settings

engine = create_engine(settings.resolved_database_url)

with engine.begin() as conn:
    conn.execute(text("DELETE FROM users WHERE email = 'temp@local.dev'"))

print("Temp admin removed.")

# Self-delete both scripts
os.remove(__file__)
os.remove(__file__.replace("remove_temp_admin.py", "create_temp_admin.py"))
print("Scripts cleaned up.")
