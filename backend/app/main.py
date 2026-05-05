"""FastAPI application entry point."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api import analytics, auth, calls, contacts, messages, telnyx_webhooks
from app.api import admin
from app.config import settings
from app.limiter import limiter


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "https://call.alphabridgeconsulting.ai",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
def health():
    return {
        "status": "ok",
        "telnyx_configured": bool(settings.telnyx_api_key),
    }
