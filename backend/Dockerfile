FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

# CMD runs migrations + serves. This is fine for SINGLE-replica Railway deploys.
# For multi-replica: separate migrations (use scripts/migrate.sh from a one-off
# deploy step) and change CMD to just the uvicorn line below so replicas don't
# race on `alembic upgrade head`. See L-09 in the QA audit for context.
CMD ["/bin/sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
