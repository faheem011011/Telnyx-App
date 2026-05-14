"""FastAPI application entry point."""
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import Response
from sqlalchemy import text
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

import sentry_sdk

from app.api import analytics, auth, calls, contacts, messages, telnyx_webhooks
from app.api import admin
from app.config import settings
from app.database import engine, get_db
from app.limiter import limiter

if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        traces_sample_rate=0.1,
        environment="production",
    )

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

log = logging.getLogger("alphacall.access")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("AlphaCall API starting up")
    try:
        yield
    finally:
        log.info("AlphaCall API shutting down — disposing engine pool")
        engine.dispose()


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = int((time.perf_counter() - start) * 1000)
            log.exception(
                "request_failed method=%s path=%s request_id=%s duration_ms=%d",
                request.method, request.url.path, request_id, duration_ms,
            )
            raise
        duration_ms = int((time.perf_counter() - start) * 1000)
        log.info(
            "request method=%s path=%s status=%d duration_ms=%d request_id=%s",
            request.method, request.url.path, response.status_code, duration_ms, request_id,
        )
        response.headers["X-Request-ID"] = request_id
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "connect-src 'self' wss://*.telnyx.com https://*.telnyx.com https://api.telnyx.com; "
            "media-src 'self' https://api.telnyx.com blob:; "
            "img-src 'self' data: blob:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        # WebRTC needs microphone permission for self; camera disabled.
        response.headers["Permissions-Policy"] = "microphone=(self), camera=()"
        return response


app = FastAPI(
    title="AlphaCall API",
    description="Telnyx-powered browser phone — calls, SMS, voicemail",
    version="2.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Setup-Token"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(contacts.router)
app.include_router(calls.router)
app.include_router(messages.router)
app.include_router(telnyx_webhooks.router)
app.include_router(analytics.router)


@app.get("/")
def root():
    return {"status": "ok", "app": "alphacall", "version": "2.0.0"}


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        log.exception("Health check: database unreachable")
        db_status = "down"
    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "database": db_status,
        "telnyx_configured": bool(settings.telnyx_api_key),
    }
