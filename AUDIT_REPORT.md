# AlphaCall — End-to-End Audit Report

**Date:** 2026-05-14  
**Application:** AlphaCall (Telnyx-based multi-tenant communication platform)  
**Branch audited:** `audit-fixes`  
**Backend:** FastAPI + SQLAlchemy 2.0 + PostgreSQL (Railway)  
**Frontend:** React 18 + Vite + @telnyx/webrtc (Vercel)  
**Production:** back.alphabridgeconsulting.ai / call.alphabridgeconsulting.ai

---

## 1. Executive Summary

This audit covered the entire AlphaCall codebase across six parallel review streams: security, backend logic, database design, frontend React, Telnyx integration, and infrastructure/deployment. Every file was examined; no area was sampled.

**Overall risk posture: HIGH.** The application has a solid structural foundation — JWT replay protection, Ed25519 webhook signature verification, bcrypt passwords with complexity enforcement, soft-delete audit trails, and a well-organized service layer. However, several issues require remediation before the application can be considered production-ready at scale.

### Finding Count by Severity

| Severity  | Count   | Action Required |
|-----------|---------|-----------------|
| Critical  | 8       | Block deployment / fix immediately |
| High      | 31      | Fix before next release |
| Medium    | 38      | Fix within 30 days |
| Low       | 35      | Fix within 90 days |
| **Total** | **112** |

### Top 5 Issues Requiring Immediate Action

1. **Five TeXML webhook endpoints are completely unauthenticated** — any internet actor can forge call records, inject malicious URLs, and manipulate call statuses for any user.
2. **SMS send endpoint has no rate limit** — a compromised credential can generate unlimited Telnyx SMS charges in seconds.
3. **Database backup dump committed to the git repository** — full PII (emails, phone numbers, call records, hashed passwords) exposed to all repository readers.
4. **Phone numbers logged in plaintext** to Railway's unencrypted log stream — GDPR/CCPA exposure.
5. **Single uvicorn worker with synchronous blocking I/O** — any Telnyx API call (up to 15 s) freezes the entire application.

---

## 3. Critical Findings

### C-01 — All Five TeXML Webhook Endpoints Are Unauthenticated

**File:** `backend/app/api/telnyx_webhooks.py`  
**Endpoints:** `/api/telnyx/outbound-call`, `/incoming-call`, `/post-dial`, `/call-status`, `/voicemail-complete`

Telnyx does not sign TeXML form-encoded requests. These five endpoints perform no origin validation. Any internet actor can POST crafted form data and:

- Create fake inbound call records for any user (by setting `To` to a known number)
- Force a live call to status `completed` by POSTing to `/call-status` with a known `CallSid`
- Inject an attacker-controlled URL into `recording_url` or `voicemail_url` fields
- Flood a user's inbox via unlimited POST requests (the `_claim_event` dedup is bypassed when `CallSid` is absent)

**Fix:** Implement Telnyx's published webhook source IP allowlist at the network/proxy level. As application-level defense-in-depth, add a shared HMAC secret to all TeXML action URLs (`?sig=<HMAC>`), validate `CallSid` format strictly, and add rate limiting on each endpoint:

```python
@router.post("/incoming-call")
@limiter.limit("200/minute")
def incoming_call(request: Request, ...):
    _verify_texml_sig(request)  # check HMAC query param
```

---

### C-02 — SMS Send Has No Rate Limit (Financial DoS)

**File:** `backend/app/api/messages.py` — `POST /api/messages/send`

No `@limiter.limit()` decorator on the send endpoint. A single authenticated user can send unlimited SMS messages in a loop. Each is billed to the Telnyx account. A rogue employee or compromised session can generate hundreds of dollars of charges in under a minute.

**Fix:**
```python
@router.post("/send", response_model=MessageOut)
@limiter.limit("60/hour")
def send_message(request: Request, payload: MessageCreate, ...):
```

---

### C-03 — Database Backup Dump Committed to Git

**File:** `backups/railway_backup_2026_04_30.dump`

A full PostgreSQL dump is version-controlled. This dump contains user emails, bcrypt-hashed passwords, phone numbers, full SMS message bodies, call records, and any secrets that were ever stored in the database. Anyone with repository read access has this data permanently in git history.

**Fix:**
1. Immediately run `git filter-repo --path backups/ --invert-paths` to purge from all history
2. Force-push and notify all repository forks/clones
3. Add `backups/` to `.gitignore`
4. Rotate any secrets that may have been stored in the DB

---

### C-04 — Phone Numbers and Call Metadata Logged in Plaintext

**File:** `backend/app/api/telnyx_webhooks.py`, `backend/app/services/telnyx_service.py`

Multiple `log.info(...)` calls write E.164 phone numbers, full caller/callee identities, and complete Telnyx event payloads (up to 2000 characters) to stdout. Railway's log stream is not encrypted at rest and is accessible to all project members. This is a GDPR/CCPA violation for any non-US calling party.

Specific instances:
- `log.info("Inbound SMS saved: from=%s to=%s", from_number, to_number)`
- `log.info("outbound-call v2 %s full payload: %s", event_type, json.dumps(payload)[:2000])`
- `log.info("call_record_start: call_control_id=%s webhook_url=%s", ...)`

**Fix:** Mask all phone numbers in logs to last-4 digits. Move full-payload diagnostic logs to `log.debug(...)` gated by `LOG_LEVEL=DEBUG`. Extend `_mask_email()` in `audit.py` to a general `_mask_pii(value)` helper.

---

### C-05 — In-Memory Rate Limiter Resets on Restart and Is Ineffective with Multiple Workers

**File:** `backend/app/limiter.py`

`slowapi.Limiter` is initialized with no `storage_uri`, defaulting to an in-process dictionary. This means:

1. Every container restart (Railway deploy, crash, scaling event) resets all rate limit counters — login brute-force protection resets to zero on every deploy
2. If `--workers 4` is added, each worker has its own counter, giving attackers 4× their effective rate limit via round-robin load balancing
3. The per-email password-reset counter (`_reset_attempts` in `auth.py`) is also in-memory and resets the same way

**Fix:**
```python
# limiter.py
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.redis_url,  # add REDIS_URL env var + Railway Redis add-on
)
```

---

### C-06 — Microphone Stream Leaked When `newCall()` Throws

**File:** `frontend/src/context/TelnyxContext.jsx` — `makeCall()`

`getUserMedia()` acquires the microphone and stores the stream in `micStreamRef.current`. If the SDK's `newCall()` subsequently throws (SDK not ready, network error, missing destination), the `catch` block exits without calling `releaseLocalMedia()`. `releaseLocalMedia` only runs on terminal SDK state notifications, which never fire because no call object was created. The browser's microphone-in-use indicator stays on permanently until the tab is reloaded.

Additionally, if `newCall()` throws after `activeCallRef.current` was set, the `ActiveCallPanel` renders a ghost call UI with no real SDK backing.

**Fix:**
```js
let call;
try {
  call = clientRef.current.newCall({ destinationNumber, callerName, ... });
} catch (err) {
  releaseLocalMedia(null);
  micStreamRef.current = null;
  clearCallState();
  throw new Error('Failed to initiate call. Please try again.');
}
```

---

### C-07 — 401 Interceptor Swallows Verification / Reset Errors

**File:** `frontend/src/services/api.js` — response interceptor; `VerifyEmailPage.jsx`, `ResetPasswordPage.jsx`

All API calls share one axios instance. The 401 interceptor clears `auth_token` and redirects to `/login` before the calling page's `.catch()` can handle the error. `VerifyEmailPage` and `ResetPasswordPage` are unauthenticated flows — if the backend returns 401 for an expired token, users see a blank login page with no explanation instead of "Your verification link has expired."

**Fix:** Create a second axios instance (`publicApi`) without the auth interceptor for all unauthenticated endpoints (`verifyEmail`, `resetPassword`, `forgotPassword`, `setup`, `checkSetup`).

---

### C-08 — `unassign_number` Does Not Stop Call Routing to the Former User

**File:** `backend/app/api/admin.py` — `unassign_number()`; `backend/app/api/telnyx_webhooks.py` — `_resolve_user_by_to_number()`

`unassign_number` sets `PhoneNumber.assigned_to_user_id = None` but does not clear `User.phone_number`. The `_resolve_user_by_to_number` routing function has a fallback path that queries `User.phone_number` directly. After unassignment, inbound calls and SMS to that number still route to the previous user via this fallback. An admin who believes they have cut off a user's access to a number has not actually done so.

**Fix:** In `unassign_number`, add:
```python
prev_user = db.query(User).filter(User.phone_number == tn.phone_number).first()
if prev_user:
    prev_user.phone_number = None
db.commit()
```

---

## 4. High Findings

### H-01 — Single Uvicorn Worker with Synchronous Blocking I/O

**File:** `backend/Dockerfile`, `backend/railway.toml`, `backend/app/services/telnyx_service.py`

The `startCommand` launches a single uvicorn worker. All SQLAlchemy queries use the synchronous ORM, and all Telnyx API calls use synchronous `httpx` (not `httpx.AsyncClient`). During a voice token mint, three sequential blocking HTTP calls are made to Telnyx — best case ~9 seconds of total event-loop blockage per request. During this window, all other requests queue.

**Fix (immediate):** Add `--workers 4` to the start command. This does not fix the async/sync mismatch but gives 4× concurrency immediately. Add `--timeout-graceful-shutdown 30` for in-flight drain.

**Fix (proper):** Migrate `telnyx_service.py` to use `httpx.AsyncClient` with `async def` functions.

---

### H-02 — Migration Race Condition: `alembic upgrade head` Inside Container CMD

**File:** `backend/Dockerfile`

The CMD is `alembic upgrade head && uvicorn ...`. Railway starts the new container before stopping the old one (rolling deploy). During the migration window, new and old code run against a partially-migrated schema. With `--workers 4`, all 4 processes attempt `alembic upgrade head` concurrently, risking deadlocks on the `alembic_version` table.

**Fix:** Use Railway's pre-deploy command (Settings → Deploy → Pre-deploy command): set it to `alembic upgrade head` and remove it from the Dockerfile CMD.

---

### H-03 — `healthcheckTimeout = 300` Seconds Is Too Permissive

**File:** `backend/railway.toml`

A 5-minute timeout for a trivial `SELECT 1` health check means a hung, deadlocked, or OOM-killed process goes undetected for up to 5 minutes. During this window Railway continues routing traffic to a broken instance.

**Fix:** `healthcheckTimeout = 30`

---

### H-04 — Voice Token Endpoint Has No Rate Limit

**File:** `backend/app/api/calls.py` — `GET /api/calls/token`

No rate limit on the voice token endpoint. An attacker with a valid JWT can call it in a tight loop. Each call makes 1–3 sequential blocking Telnyx API requests (up to 15 seconds each), forcing the single-worker server into a prolonged block on every request. Also exhausts Telnyx API quota.

**Fix:** `@limiter.limit("20/minute")`

---

### H-05 — X-Forwarded-For Trusted Without Validation (IP Rate Limit Bypass)

**File:** `backend/app/services/audit.py` — `get_client_ip()`

`X-Forwarded-For` is trusted as-is (`forwarded.split(",")[0].strip()`). An attacker can set any spoofed IP in this header to bypass all IP-based rate limiting. slowapi's `get_remote_address` shares this vulnerability.

**Fix:** Trust only the rightmost IP in the chain (set by Railway's trusted proxy):
``` python
forwarded = request.headers.get("X-Forwarded-For", "")
ips = [ip.strip() for ip in forwarded.split(",") if ip.strip()]
return ips[-1] if ips else request.client.host
```

---

### H-06 — localhost CORS Origins in Production Default Configuration

**File:** `backend/app/config.py` — `cors_origins` default

The default value for `cors_origins` includes `http://localhost:5173` and `http://localhost:5174`. If `CORS_ORIGINS` is not explicitly overridden in Railway's environment variables, the production API accepts credentialed cross-origin requests from localhost. A malicious page running on a developer's machine can make authenticated API calls against production.

**Fix:** Remove localhost from the default. Use `.env` for dev overrides only.

---

### H-07 — `pool_pre_ping = False` Causes Errors After Container Restarts

**File:** `backend/app/database.py`

With `pool_pre_ping=False`, stale connections in the pool (after Railway deploys, Postgres restarts, or idle eviction) are not tested before use and raise `OperationalError` on the first query. This is a reliable source of transient 500 errors post-deploy.

**Fix:** `pool_pre_ping=True`

---

### H-08 — `_claim_event` Commits Before Processing (Webhook Retry = Silent Drop)

**File:** `backend/app/api/telnyx_webhooks.py` — `_claim_event()`

The dedup record is committed to the database before the webhook is processed. If the processing code raises an exception, the event is marked as "seen" and will be silently dropped on every Telnyx retry. The webhook is neither processed nor queued for retry — it is permanently lost.

**Fix:** Move the `_claim_event` commit to after successful processing, or use a two-phase approach: mark as "in-progress" on claim, mark as "done" on success, and allow retries for "in-progress" entries older than a timeout.

---

### H-09 — Webhook Replay Window Is 2 Hours (Should Be ~65 Minutes)

**File:** `backend/app/api/telnyx_webhooks.py` — `_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 7200`

The Ed25519 signature check on JSON webhooks (SMS, recording events) has a 2-hour replay window. Telnyx's full retry schedule completes within 65 minutes. A captured signed webhook can be replayed for up to 2 hours after capture. The `_claim_event` dedup table provides a partial second line of defense but is bypassed when `event_id` is empty.

**Fix:** `_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 3900` (65 minutes)

---

### H-10 — Missing Pagination on Calls List, Contacts List, and Conversations List

**Files:**  
- `backend/app/api/calls.py` — `GET /api/calls` (limit=500 hardcoded, no offset)  
- `backend/app/api/contacts.py` — `GET /api/contacts` (no pagination)  
- `backend/app/api/messages.py` — `GET /api/messages/conversations` (no pagination)

All three return unbounded result sets to the frontend. For heavy users, the calls list alone could return thousands of rows. No cursor or offset parameter exists on the calls or conversations endpoints.

**Fix:** Add `limit: int = Query(50, le=200)` and `offset: int = Query(0, ge=0)` to all three. Return `{"items": [...], "total": int, "offset": int, "limit": int}`.

---

### H-11 — Analytics Silently Truncates at 5,000 Rows

**File:** `backend/app/api/analytics.py` — `_fetch_call_rows()`

`_fetch_call_rows` fetches at most 5,000 call rows with no warning. For any time window with more than 5,000 calls, all computed metrics (call volumes, durations, missed rates) are silently underestimated. The frontend has no indication the data is incomplete.

**Fix:** Return a `truncated: bool` field in the analytics response, or move time-bucketing to SQL (`DATE_TRUNC` + `GROUP BY`) so row counts never hit this limit.

---

### H-12 — Soft-Deleted Users Appear in Admin List and Block Email Reuse

**File:** `backend/app/api/admin.py` — `list_users()`

`list_users` does not filter `deleted_at IS NULL`. Soft-deleted users appear in the admin panel. Their emails remain in the `users` table with `deleted_at` set, so creating a new user with the same email raises a 409 Conflict.

**Fix:** Add `.filter(User.deleted_at.is_(None))` to `list_users`. Implement email reuse for soft-deleted accounts (check `deleted_at IS NOT NULL` in the 409 guard and allow re-registration).

---

### H-13 — Missing Unique Constraint on Contact Phone Number Per Owner

**File:** `backend/app/models/__init__.py` — `Contact` model

No `UNIQUE(owner_id, phone_number)` constraint on the `contacts` table. Each user can create multiple contacts with the same phone number, and `_resolve_contact()` in the calls/messages webhook handlers will return an arbitrary one (`.first()`), potentially mis-labeling calls.

**Fix:** Add a migration:
```python
op.create_unique_constraint("uq_contact_owner_phone", "contacts", ["owner_id", "phone_number"])
```

---

### H-14 — Number Assignment Race Condition Without Row Locking

**File:** `backend/app/api/admin.py` — `assign_number()`

Two concurrent admin requests assigning the same `PhoneNumber` to different users can both pass the `assigned_to_user_id` check and both commit. The last writer wins, leaving the DB in an inconsistent state.

**Fix:** Use `SELECT ... FOR UPDATE` when fetching the `PhoneNumber` row:
```python
tn = db.query(PhoneNumber).filter(...).with_for_update().first()
```

---

### H-15 — Admin `User.phone_number` Fallback Enables Call Hijacking

**File:** `backend/app/api/telnyx_webhooks.py` — `_resolve_user_by_to_number()`

The routing function falls back to `User.phone_number` if no `PhoneNumber` row matches. A rogue admin can set `user.phone_number` to match an unassigned number, silently routing inbound calls and SMS for that number to a chosen user without creating a `PhoneNumber` assignment record. This is invisible in the admin phone numbers tab.

**Fix:** Remove the `User.phone_number` fallback from call/SMS routing. All routing must go through the `PhoneNumber` table exclusively.

---

### H-16 — `answeredCallIdRef` Can Block Second Inbound Call

**File:** `frontend/src/context/TelnyxContext.jsx`

`answeredCallIdRef` is set when the user accepts an inbound call, to prevent duplicate ringing events. It is cleared in the terminal-state handler. But `clearCallState()` (called from `hangup()`) does not clear it. If a call ends via `hangup()` and a second inbound call arrives before the SDK fires the terminal state event (a timing window that exists), the incoming call modal never appears.

**Fix:** Add `answeredCallIdRef.current = null` inside `clearCallState()`.

---

### H-17 — `callTimeoutRef` Not Cleared on User-Initiated Hangup

**File:** `frontend/src/context/TelnyxContext.jsx` — `hangup()`

A 45-second "no answer" timeout is set when an outbound call is placed. The timeout is cleared when the call goes active, and in `_forceCleanup`. But in `hangup()` the timeout is never cleared. If the user hangs up an unanswered call, the timeout fires 45 seconds later, triggering a "Call timed out" toast and a second cleanup pass on already-null state.

**Fix:** Add `clearTimeout(callTimeoutRef.current); callTimeoutRef.current = null;` at the top of `hangup()`.

---

### H-18 — base64url Not Normalized Before `atob()` in Token Refresh

**File:** `frontend/src/context/TelnyxContext.jsx` — `scheduleRefresh()`

`atob(token.split('.')[1])` fails for base64url-encoded JWT payloads (which use `-` and `_` instead of `+` and `/` and omit `=` padding). The catch block falls back to a 23-hour refresh delay. Telnyx voice tokens expire in approximately 3 hours. After token expiry, WebRTC calls will fail silently for ~20 hours until the user reloads the page.

**Fix:**
```js
const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
const decoded = JSON.parse(atob(padded));
```

---

### H-19 — Setup Page Password Hint Says "6 Characters" (Backend Requires 12)

**File:** `frontend/src/pages/SetupPage.jsx`

The setup page placeholder reads "At least 6 characters" but the backend enforces a 12-character minimum (uppercase + lowercase + digit + special character). Users creating the first admin account with 6–11 character passwords get a confusing server-side error.

**Fix:** Import `MIN_PASSWORD_LENGTH = 12` and update the placeholder. Apply the same client-side validation as `SettingsPage.jsx`'s `ChangePasswordSection`.

---

### H-20 — No UNIQUE Constraint on `webhook_events.event_id`

**File:** `backend/alembic/versions/2026_05_08_add_security_foundations.py`

The `WebhookEvent` table has an index on `event_id` but no `UNIQUE` constraint. Two concurrent webhook deliveries with the same `event_id` can both pass the `SELECT` check (before either has committed an `INSERT`) due to a TOCTOU race, defeating the deduplication guarantee.

**Fix:**
```python
op.create_unique_constraint("uq_webhook_event_id", "webhook_events", ["event_id"])
```

---

### H-21 — `WebhookEvent` Table Grows Without Bound

**File:** `backend/app/models/__init__.py` — `WebhookEvent`; `backend/app/api/telnyx_webhooks.py`

The `WebhookEvent` dedup table is only written to, never pruned. Every processed webhook adds a row permanently. At high volume this table will grow to millions of rows, degrading index scans and backup sizes.

**Fix:** Add a scheduled cleanup job that deletes rows older than 7 days:
```sql
DELETE FROM webhook_events WHERE processed_at < NOW() - INTERVAL '7 days';
```

---

### H-22 — Missing Indexes on High-Traffic Query Columns

**File:** `backend/app/models/__init__.py`

The following queries run on every page load with no supporting index:

| Table | Column(s) | Used by |
|-------|-----------|---------|
| `calls` | `(owner_id, created_at DESC)` | Inbox page, analytics |
| `messages` | `(from_number, to_number)` | Thread loading |
| `messages` | `(owner_id, created_at DESC)` | Conversations list |
| `audit_logs` | `(created_at DESC)` | Audit log queries |
| `contacts` | `(owner_id, phone_number)` | Contact resolution in webhooks |

**Fix:** Add a migration with composite indexes for each of the above.

---

### H-23 — Analytics Endpoint Has No Rate Limit on Expensive Aggregation

**File:** `backend/app/api/analytics.py`

`GET /api/analytics` runs 8–10 SQL queries and iterates up to 5,000 rows in Python on every request. No rate limit. A browser tab refreshing every few seconds or a polling loop generates significant sustained DB load.

**Fix:** `@limiter.limit("30/minute")` on the analytics endpoint.

---

### H-24 — Admin Number Search/Sync Has No Rate Limit (Telnyx API Exhaustion)

**File:** `backend/app/api/admin.py` — `search_numbers()`, `sync_numbers()`

Both endpoints make outbound Telnyx API calls with no rate limiting. A compromised admin account can exhaust Telnyx API quota, breaking voice token generation for all users.

**Fix:** `@limiter.limit("10/minute")` on both endpoints.

---

### H-25 — `list_owned_numbers` Fetches Only First 250 Numbers (Silent Truncation)

**File:** `backend/app/services/telnyx_service.py` — `list_owned_numbers()`

`page[size]=250` is the only page fetched. Accounts with more than 250 numbers silently receive an incomplete sync. Calls and SMS to un-synced numbers are unroutable.

**Fix:** Implement pagination loop checking `response["meta"].get("next_page_token")`.

---

### H-26 — `handle_call_status` and `handle_post_dial` Have a Lost-Update Race

**File:** `backend/app/api/telnyx_webhooks.py`

Both handlers update `Call.status` with a read-then-write pattern and no `SELECT ... FOR UPDATE`. Two concurrent deliveries can both read a non-terminal status, both pass the terminal guard, and the last commit wins. A `completed` call with a recording can be overwritten to `missed`.

**Fix:** Use `with_for_update()` on the `Call` query in both handlers.

---

### H-27 — Admin Cannot Assign Numbers to Other Admins

**File:** `frontend/src/pages/AdminPage.jsx` — `NumbersTab`

The assignment `<select>` filters to `users.filter(u => u.role === 'user')`, excluding admins. Admins can only self-assign numbers via Settings. This creates an operational gap where the super-admin cannot manage number assignments for other admins.

**Fix:** Remove the `u.role === 'user'` filter, or document the self-assignment requirement clearly.

---

### H-28 — No Loading Guard on `handleToggleActive` (Double-Fire Race)

**File:** `frontend/src/pages/AdminPage.jsx`

`handleToggleActive` fires an API call but sets no loading/busy state. Rapid double-clicks send two conflicting `is_active` toggle requests; the server processes them in arrival order, potentially reversing the intended state.

**Fix:** Track a `togglingUserId` state and disable the toggle for the affected row during the API call.

---

### H-29 — Delete Confirmation Describes Permanent Deletion (Soft-Delete Implementation)

**File:** `frontend/src/pages/AdminPage.jsx`

The delete confirmation dialog reads: "This will permanently remove their account and all associated data." The backend is a soft-delete (`deleted_at` timestamp). Admins are misled into thinking the action is irreversible.

**Fix:** "This will deactivate the user's account. Their call history and data will be retained and can be reviewed in audit logs."

---

### H-30 — Single Manual DB Backup; No Automated Backups

**File:** `backups/` directory

One backup file from 2026-04-30. No automated backup schedule. Any data loss event since April 30 is unrecoverable. Railway's managed Postgres does not enable automated backups by default on the hobby tier.

**Fix:** Enable Railway's Automated Backups add-on. Set daily backups with 7-day retention. Remove the dump file from the repository (see C-03).

---

### H-31 — `X-Auth-Hint: verify-email` Header Enables User Enumeration

**File:** `backend/app/api/auth.py` — `login()`

The `X-Auth-Hint: verify-email` header is set only when the password is correct but email is not verified. An attacker who enumerates email addresses can confirm which ones have valid passwords by checking for this header, turning a standard 401 response into a credential oracle.

**Fix:** Remove the `X-Auth-Hint` header entirely. Instead, add a resend-verification link on the login page that fires a `POST /api/auth/resend-verification` endpoint with a 204 response (same as forgot-password — always succeeds regardless of address existence).

---

## 5. Medium Findings

### M-01 — `MessageCreate.body` Has No `max_length`

**File:** `backend/app/schemas/__init__.py`

No upper bound on SMS body. A user can POST a megabyte-long string, generating hundreds of Telnyx SMS segments, DB bloat, and large API responses.

**Fix:** `max_length=1600` (one full Telnyx SMS message).

---

### M-02 — `UserAdminUpdate.phone_number` Has No E.164 Validation

**File:** `backend/app/schemas/__init__.py`

Admin-set `phone_number` has no format validation. An arbitrary string stored here participates in call routing (via the `User.phone_number` fallback).

**Fix:** Add E.164 validator using the `phonenumbers` library:
```python
@field_validator("phone_number")
@classmethod
def validate_e164(cls, v):
    if v is None: return v
    try:
        parsed = phonenumbers.parse(v)
        if not phonenumbers.is_valid_number(parsed):
            raise ValueError
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
    except Exception:
        raise ValueError("Phone number must be a valid E.164 number")
```

---

### M-03 — `_normalize_phone` Does Not Handle International Numbers Correctly

**File:** `backend/app/api/messages.py` — `_normalize_phone()`

The normalization function handles US numbers (10 digits → `+1…`) and 11-digit US numbers starting with 1. European numbers typed as `07700900123` (11 digits, leading 0) become `+07700900123` (invalid E.164). The normalization is also not applied in `handle_incoming_sms`, creating thread-grouping mismatches between outbound and inbound messages for international numbers.

**Fix:** Use the `phonenumbers` library with region inference and apply normalization consistently in both the API layer and webhook handler.

---

### M-04 — No Pagination on Audit Logs

**File:** `backend/app/api/admin.py` — `GET /api/admin/audit-logs`

The audit log endpoint applies a `limit=100` cap with no offset or cursor parameter and no total count returned. Audit history beyond the first 100 entries is inaccessible via the API.

**Fix:** Add `offset: int = Query(0)` and return `{"items": [...], "total": int}`.

---

### M-05 — No Audit Log UI in Admin Panel

**File:** `frontend/src/pages/AdminPage.jsx`

The admin panel has "Users" and "Phone Numbers" tabs only. There is no tab for audit logs despite the backend having an endpoint. Admins cannot review security-relevant events from the UI.

**Fix:** Add an "Audit Logs" tab with pagination and filter by user/date range.

---

### M-06 — Connection Pool Too Small for Multi-Worker Deployment

**File:** `backend/app/database.py`

`pool_size=5, max_overflow=10` (15 max connections per process). With `--workers 4`, that is 60 connections total. Railway's hobby Postgres tier defaults to 25 maximum connections. Adding workers without adjusting pool sizes will immediately exhaust the connection limit.

**Fix:** `pool_size=2, max_overflow=3` per worker (20 connections total for 4 workers), or add PgBouncer.

---

### M-07 — No Graceful Shutdown Drain on SIGTERM

**File:** `backend/Dockerfile`

In-flight requests (including 15-second Telnyx API calls) are terminated mid-flight on container stop. `call_record_start` calls could be sent to Telnyx while the DB commit that stores the recording never completes.

**Fix:** Add `--timeout-graceful-shutdown 30` to the uvicorn start command.

---

### M-08 — `call.recording.saved` Without `recording_id` Silently Falls Back to Expired URL

**File:** `backend/app/api/telnyx_webhooks.py` line 1021; `backend/app/api/calls.py` — `/recording-url`

When a recording event arrives without a `recording_id`, the per-call recording refresh endpoint falls back to `call.recording_url` (the 10-minute pre-signed S3 URL from the original webhook). This URL expires within minutes. Recordings without a `recording_id` silently serve 403 responses to the frontend.

**Fix:** Log a warning when `call.recording.saved` arrives without `recording_id`. Investigate whether TeXML recordings always omit it and handle accordingly.

---

### M-09 — Call Status Written Verbatim From Telnyx (No Allowlist)

**File:** `backend/app/api/telnyx_webhooks.py` — `handle_call_status()`

Any string Telnyx sends as `CallStatus` is written directly to `Call.status`. Future Telnyx API changes that introduce new status strings (e.g. `"spam-flagged"`) will leave calls in states the frontend tabs cannot display, making them invisible.

**Fix:** Define `STATUS_ALLOWED = {"initiated", "ringing", "in-progress", "completed", "missed", "busy", "no-answer", "failed", "canceled"}` and ignore/log values outside this set.

---

### M-10 — Message Status Written Without Allowlist or Length Bound

**File:** `backend/app/api/telnyx_webhooks.py` — `handle_sms_status_event()`

Message status is written raw from `to_list[0].get("status")` with no allowlist or max-length check. A status string longer than 32 characters will cause a DB truncation error.

**Fix:** Allowlist valid Telnyx message statuses. Truncate to 32 chars as a safety guard.

---

### M-11 — `_resolve_user_by_to_number` Returns Arbitrary User If Multiple Share a Number

**File:** `backend/app/api/telnyx_webhooks.py`

If two users have the same `User.phone_number` (no DB unique constraint), the fallback routing uses `.first()` and returns an arbitrary user. All calls/SMS for that number go to one user.

**Fix:** Add `UNIQUE` constraint on `users.phone_number` (nullable unique). Or remove the fallback entirely (see H-15).

---

### M-12 — `pg_advisory_xact_lock` Uses Single-Argument Form (Shared Namespace)

**File:** `backend/app/api/calls.py` — `get_voice_token()`

The single-argument form shares the global lock namespace with any other advisory lock in the system. Use the two-argument form with a fixed namespace constant to avoid accidental collisions:
```python
db.execute(text("SELECT pg_advisory_xact_lock(42, :uid)"), {"uid": current_user.id})
```

---

### M-13 — Missing Real-Time Push; All Updates Require Polling

**File:** Frontend polling in `Sidebar.jsx`, `MessagesPage.jsx`

No WebSocket, SSE, or push notification mechanism exists. With 10 concurrent users polling every 5–15 seconds, the server handles 40–120 polling requests per minute just for badge counts and conversation updates. This scales poorly and adds unnecessary latency for inbound message/call notifications.

**Fix:** Add an SSE endpoint (`GET /api/events/stream`) that holds long-lived connections and pushes event notifications when webhooks are processed. FastAPI supports this natively with `StreamingResponse`.

---

### M-14 — No CI/CD Pipeline

**File:** Repository root

No `.github/workflows/` or other CI configuration. All deployments are direct git pushes to Railway with no automated testing, linting, or type checking gate.

**Fix:** Add a minimal GitHub Actions workflow: syntax check, `ruff check`, and a basic smoke test suite.

---

### M-15 — Sentry Environment Hardcoded to "production"

**File:** `backend/app/main.py`

`sentry_sdk.init(environment="production")` is hardcoded. Any staging/QA deployment sharing the same `SENTRY_DSN` will pollute production error tracking.

**Fix:** `environment=settings.environment` with `ENVIRONMENT=production` in Railway env vars.

---

### M-16 — Inbox Active Tab Not Persisted Across Navigation

**File:** `frontend/src/pages/InboxPage.jsx`

The selected tab (unread/all/missed/voicemails/recordings/starred) resets to "unread" on every mount. Navigating to Contacts and back loses the user's filter context.

**Fix:** Sync tab to a URL search param (`?tab=starred`) using `useSearchParams`.

---

### M-17 — `window.confirm()` / `alert()` Used Throughout Frontend

**Files:** `frontend/src/pages/ContactsPage.jsx`, `frontend/src/pages/InboxPage.jsx`

Multiple pages use native `window.confirm()` for delete confirmations and `alert()` for error display. These block the thread, cannot be styled, and are inconsistent with the rest of the app (which uses custom modals and inline errors).

**Fix:** Replace all `confirm()` with the existing custom `Modal` component (see `AdminPage.jsx`). Replace all `alert()` with inline error state or toast notifications.

---

### M-18 — Optimistic Message Deduplication Matches on Body Text Only

**File:** `frontend/src/pages/MessagesPage.jsx`

The optimistic message poll deduplication checks `m.body === opt.body && m.direction === opt.direction`. Two messages with the same text sent in quick succession will result in the second being wrongly "confirmed" and removed from the optimistic list — leaving a backend duplicate that the UI suppresses.

**Fix:** Include a client-generated `clientId` sent with the message and echoed back by the server, then match on `clientId` for deduplication.

---

### M-19 — Custom Date Range Sends Partial Dates to Analytics API

**File:** `frontend/src/pages/DashboardPage.jsx`

`dateRangeInvalid` only checks if start > end; it does not block submission when only one of the two date fields is filled. API calls with `start=''` or `end=''` produce unexpected analytics results.

**Fix:**
```js
const dateRangeInvalid = range === 'custom' && (
  !debouncedStart || !debouncedEnd ||
  debouncedStart > debouncedEnd
);
```

---

### M-20 — No "Mark as Unread" in Messages

**File:** `frontend/src/pages/MessagesPage.jsx`

Opening a thread automatically marks all messages read. There is no way for a user to flag a message to return to later.

**Fix:** Add a `PATCH /api/messages/thread/{phone}/mark-unread` endpoint and a corresponding UI button.

---

### M-21 — Sentry Trace Sample Rate Too Low for Low-Traffic App

**File:** `backend/app/main.py`

`traces_sample_rate=0.1` means only 10% of transactions are traced. For a low-traffic app, a 1% failure rate appears in Sentry only ~0.1% of the time — effectively invisible.

**Fix:** `traces_sample_rate=1.0` for production at current traffic levels.

---

### M-22 — Non-JSON Logging Incompatible with Log Aggregation

**File:** `backend/app/main.py`

`logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s %(message)s")` produces unstructured text. Railway's log UI cannot filter by field (e.g., `user_id`, `status_code`, `request_id`).

**Fix:** Use `python-json-logger` to emit structured JSON logs.

---

### M-23 — Request ID Not Propagated to Service-Layer Logs

**File:** `backend/app/main.py` — `RequestLoggingMiddleware`

`X-Request-ID` is generated per request but not stored in a `contextvars.ContextVar`. Service-layer log entries (`telnyx_service.py`, `email.py`) cannot be correlated with the originating HTTP request.

**Fix:** Set `_request_id_ctx.set(request_id)` in the middleware and add a `RequestIdFilter` to all loggers.

---

### M-24 — `INITIAL_SETUP_TOKEN` Not Cleared After First Admin Setup

**File:** `backend/app/config.py`, Railway environment

The setup endpoint is correctly gated by "no users exist," but `INITIAL_SETUP_TOKEN` remains set indefinitely in Railway env vars. A future migration that inadvertently truncates the users table would re-expose the setup endpoint with a valid token.

**Fix:** Document and enforce: unset `INITIAL_SETUP_TOKEN` in Railway after the first admin account is confirmed.

---

### M-25 — `INITIAL_SETUP_TOKEN` Not Set → 503 Instead of 410

**File:** `backend/app/api/auth.py` — `setup()`

When `settings.initial_setup_token` is falsy, the endpoint returns 503 "Initial setup not enabled" even when no users exist. A fresh deployment with no `INITIAL_SETUP_TOKEN` set returns an error instead of guiding the operator to set the token.

**Fix:** Improve the error message or document in the deployment checklist that `INITIAL_SETUP_TOKEN` must be set before first use.

---

### M-26 — Email Sending Is Synchronous (Can Stall Request Handlers)

**File:** `backend/app/services/email.py`

`resend.Emails.send()` is called synchronously within request handlers. If Resend's API is slow or unavailable, the calling request stalls for an unbounded duration (no timeout configured on the Resend client).

**Fix:** Use FastAPI `BackgroundTasks` to send emails after the response is returned.

---

### M-27 — Duplicate Polling Intervals for Unread Count (Sidebar + InboxPage)

**File:** `frontend/src/components/Sidebar.jsx`, `frontend/src/pages/InboxPage.jsx`

The Sidebar polls unread count every 15 seconds. InboxPage fetches calls on tab change. These are uncoordinated. When Inbox is open, there are two independent polling loops querying the server.

**Fix:** Lift the unread count into a shared context (or `AuthContext`) so all consumers share one interval.

---

### M-28 — CSP `unsafe-inline` for Styles on Backend Responses

**File:** `backend/app/main.py` — `SecurityHeadersMiddleware`

`style-src 'self' 'unsafe-inline'` weakens XSS protection on any page served by the backend.

**Fix:** Remove `'unsafe-inline'` from `style-src` and use a nonce-based approach if inline styles are required.

---

### M-29 — Frontend CSP Missing from Vercel Headers

**File:** `frontend/vercel.json`

HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, and Permissions-Policy are all set — but no `Content-Security-Policy` header. The SPA loads external WebRTC SDK code and makes credentialed API calls, making CSP valuable for XSS defense-in-depth.

**Fix:**
```json
{ "key": "Content-Security-Policy", "value": "default-src 'self'; connect-src 'self' https://back.alphabridgeconsulting.ai wss://*.telnyx.com https://*.telnyx.com; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: https://api.telnyx.com; frame-ancestors 'none'" }
```

---

### M-30 — `audit.py` Opens a New DB Session Per Call (Pool Exhaustion Risk)

**File:** `backend/app/services/audit.py` — `log_audit()`

Each audit log entry opens a new `SessionLocal()`, uses it, and closes it. Under high traffic (e.g., every API call logs an audit entry), this creates a separate pool checkout per request alongside the main request session, potentially doubling pool consumption and starving legitimate requests.

**Fix:** Accept an optional `db: Session` parameter. Pass the request's existing session when available; fall back to a fresh session only for out-of-request audit entries.

---

### M-31 — `lru_cache` on `get_settings()` Prevents Runtime Secret Rotation

**File:** `backend/app/config.py`

`@lru_cache` caches the settings object for the lifetime of the process. Rotating `SECRET_KEY` or `TELNYX_API_KEY` via Railway env var update requires a container restart to take effect, but there is no operational documentation of this requirement.

**Fix:** Document in the runbook that secret rotation requires `railway redeploy`.

---

### M-32 — `_from_number` Is Non-Deterministic With Multiple SMS Numbers

**File:** `backend/app/api/messages.py` — `_from_number()`

When a user has multiple SMS-capable numbers, `_from_number()` returns the first one alphabetically. If a conversation was started from a different number, replies use a different sender number, confusing the recipient.

**Fix:** Store `from_number` on the first outbound message in a thread and always use that number for subsequent replies in the same thread.

---

### M-33 — Department Filter in Analytics Does Not Exclude Inactive Users

**File:** `backend/app/api/analytics.py`

When filtering analytics by department, inactive (deactivated) users are included in the result set. Soft-deleted users whose `deleted_at` is set are also included if not explicitly filtered.

**Fix:** Add `.filter(User.is_active == True, User.deleted_at.is_(None))` to the user resolution query in analytics.

---

### M-34 — Admin `user_id` Filter Has No Existence/Active Check

**File:** `backend/app/api/analytics.py`

The admin analytics endpoint accepts a `user_id` query param but does not verify that the user exists and is active. Passing a deleted or nonexistent user ID returns empty data silently rather than a 404.

**Fix:** Validate `user_id` exists and `is_active=True` before running analytics queries.

---

### M-35 — `get_thread` Auto-Marks Messages Read on Every GET

**File:** `backend/app/api/messages.py` — `get_thread()`

Every thread fetch automatically marks all inbound messages as read with no opt-out. There is no separate explicit mark-read endpoint. If the frontend polls for thread updates, every poll silently marks messages read.

**Fix:** Add `?mark_read=true` parameter; default to `false`. Mark read only when explicitly requested (e.g., when the user focuses the thread view).

---

### M-36 — `pool_recycle = 300` with `pool_pre_ping = False` Is an Unsafe Combination

**File:** `backend/app/database.py`

`pool_recycle=300` recycles connections every 5 minutes, but without `pool_pre_ping=True`, a connection that Postgres closed (e.g., due to `idle_in_transaction_session_timeout`) before the 5-minute mark will still be served to the next request, resulting in an `OperationalError`. (This duplicates H-07 but emphasizes the interaction.)

**Fix:** `pool_pre_ping=True` (see H-07).

---

### M-37 — No Rollback Procedure Documented

**File:** Repository

There is no documentation for rolling back a Railway deployment combined with an Alembic downgrade. A rollback without a database downgrade leaves the old code against a new schema.

**Fix:** Add to README: rollback requires (1) `railway rollback` in dashboard, (2) `alembic downgrade -1` via Railway CLI shell.

---

### M-38 — Health Endpoint Leaks Telnyx Configuration State

**File:** `backend/app/main.py` — `GET /api/health`

The health endpoint returns `{"status": "ok", "telnyx_configured": true/false}`. This reveals to unauthenticated callers whether Telnyx credentials are configured, which is operational intelligence useful to attackers probing the deployment.

**Fix:** Return only `{"status": "ok"}` from the public health endpoint. Move configuration diagnostics to an admin-authenticated endpoint.

---

## 6. Low / Informational Findings

### L-01 — JWT Algorithm and Expiry Not Configurable via Environment

`settings.algorithm = "HS256"` and `access_token_expire_minutes = 1440` are hardcoded. Make both configurable via env vars to support faster token expiry during security incidents without a code change.

---

### L-02 — `ResetPasswordPage` Password Hint Says "6 Characters" (Should Be 12)

Same mismatch as H-19 but on the reset page. Update placeholder to match the backend requirement.

---

### L-03 — Shared `passwordVisible` State Reveals All Password Fields Simultaneously

`AnimatedForm` uses a single `passwordVisible` boolean. On multi-field forms (reset password: new + confirm), toggling "show" reveals both fields. Use a per-field map keyed by field ID.

---

### L-04 — `useTelnyx as useTwilio` Alias in Multiple Files

`SettingsPage.jsx`, `InboxPage.jsx`, `MessagesPage.jsx`, `ContactsPage.jsx`, `Sidebar.jsx`, `ActiveCallPanel.jsx`, `Dialer.jsx`, `IncomingCallModal.jsx` all import `useTelnyx as useTwilio`. This is a Twilio migration artifact. Remove the alias to reduce confusion for future maintainers.

---

### L-05 — `FormField` Label Missing `htmlFor` (Accessibility)

`AdminPage.jsx`'s `FormField` component renders a `<label>` without `htmlFor`. Clicking the label text does not focus the associated input. Add `htmlFor` matching the input's `id`.

---

### L-06 — No Focus Trap in Modal / Floating Components (Accessibility)

`IncomingCallModal.jsx`, `Dialer.jsx`, and `ActiveCallPanel.jsx` are fixed-position overlays with no focus trap. Tab key exits to the underlying page. Keyboard-only users cannot reliably interact with call controls. Use `focus-trap-react` or a custom `useFocusTrap` hook.

---

### L-07 — `IncomingCallModal` Missing ARIA Dialog Role

No `role="dialog"`, `aria-modal="true"`, or `aria-live="assertive"` on the incoming call modal. Screen reader users will not be alerted to incoming calls.

**Fix:**
```jsx
<div role="dialog" aria-modal="true" aria-labelledby="incoming-call-title" aria-live="assertive">
  <span id="incoming-call-title" className="sr-only">Incoming call from {from}</span>
```

---

### L-08 — `/scheduled` Route Shown in Nav Without "Coming Soon" Indication

Both `USER_NAV` and `ADMIN_NAV` include `/scheduled` which renders a `ComingSoon` stub. There is no badge, tooltip, or visual indicator. Add a "Soon" chip or remove it from the nav.

---

### L-09 — InboxPage Empty State Message Is Generic for All Tabs

"No {tab} calls — When you make or receive calls, they'll show up here." is shown for all tabs including Starred and Voicemails, which have different empty-state semantics.

**Fix:** Add tab-specific messages: "Star a call to find it here quickly." / "No voicemails received yet." etc.

---

### L-10 — Skeleton Cards Use Hardcoded Light-Mode Colors

`DashboardPage.jsx`'s `SkeletonCard` and `SkeletonChart` use `bg-white border-zinc-200`. In dark mode these appear as white rectangles. Replace with theme-aware CSS variables.

---

### L-11 — Thread Message Count Includes Unsent Optimistic Messages

`MessagesPage.jsx` line 337: `{messages.length} messages` includes optimistic entries with `status: 'sending'`. The count increments immediately on send and may decrease if the send fails.

**Fix:** `messages.filter(m => m.status !== 'sending').length`

---

### L-12 — `DepartmentEditor` Cannot Clear Department (Falsy Dirty Check)

`const dirty = value && value !== (user?.department || '')` — the leading `value &&` prevents saving an empty string to clear the department. Remove the `value &&` guard and add a "No department" option to the select.

---

### L-13 — `RedirectToLoginOrSetup` Treats Network Errors as "Go to Login"

`App.jsx`'s `.catch(() => setTarget('/login'))` catches all errors including genuine network failures. Backend outages silently redirect to the login page with no "Cannot connect to server" message.

**Fix:** Detect `err.code === 'ERR_NETWORK'` and render a distinct error state.

---

### L-14 — Area Code Search Accepts Partial Input (No Validation)

`AdminPage.jsx` `NumbersTab` area code search does not disable the Search button until exactly 3 digits are entered. Partial input generates server errors.

**Fix:** Disable Search button unless `searchArea.length === 3`.

---

### L-15 — Dialer `Escape` Key Closes Dialer When Pressed Inside Input

The global `keydown` listener fires `onClose()` on Escape with no guard for the input being focused. Pressing Escape to dismiss browser autocomplete also closes the entire dialer, losing the typed number.

**Fix:** Add `e.target.tagName === 'INPUT'` guard for Escape handling.

---

### L-16 — `BRAND` Constant Defined After Use in `DashboardPage.jsx`

`const BRAND = '#1454F6'` is defined at line 606 but referenced by components defined before it. While functionally safe (module is fully evaluated before rendering), move it to the top of the file as a convention.

---

### L-17 — `frontend/dist/` Build Artifacts May Be Committed

`frontend/dist/` may contain committed build artifacts. Vercel deploys from source, not `dist/`. Add `frontend/dist/` to `.gitignore`.

---

### L-18 — No `UNIQUE` Constraint on `users.phone_number`

`User.phone_number` participates in call routing fallback (H-15) but has no unique constraint. Multiple users can hold the same phone number string, causing non-deterministic routing. Add `UNIQUE` constraint or remove the field from routing entirely.

---

### L-19 — Verification Token Hashed Without HMAC Salt

**File:** `backend/app/services/verification.py`

`issue_verification_token` stores a plain SHA-256 hash of the raw token (no HMAC salt). While preimage resistance makes this acceptable for a random `secrets.token_urlsafe(32)` token, using HMAC would provide an additional layer of protection against length-extension attacks and misuse.

**Fix:** Use `hmac.new(settings.secret_key.encode(), raw_token.encode(), 'sha256').hexdigest()` for both store and compare.

---

### L-20 — `SENTRY_DSN` Present Exposes Sentry Project to Key Leakage

The Sentry DSN is a semi-secret: it can be used to submit events to your project. Ensure it is set as a Railway secret variable, not committed to any config file.

---

### L-21 — Recording Webhook URL Breaks on Backend URL Rotation

**File:** `backend/app/services/telnyx_service.py` — `call_record_start()`

The `webhook_url` in `record_start` is derived from `settings.public_backend_url` at call time. If the backend URL changes between recording start and delivery (Railway redeploy), the recording event is lost.

**Fix:** Configure the recording webhook at the Telnyx Application level (not per-call) so it uses a stable URL.

---

### L-22 — Telnyx Token Refresh Falls Back to 23-Hour Delay for Opaque Tokens

**File:** `frontend/src/context/TelnyxContext.jsx`

The 23-hour fallback (when JWT parse fails) far exceeds Telnyx's 3-hour token TTL. Hard-code the fallback to 2 hours 50 minutes.

---

### L-23 — v2 Auto-Bridge Misconfiguration Fails Silently (No Startup Detection)

**File:** `backend/app/api/telnyx_webhooks.py` — `_v2_handle_initiated()`

If the Telnyx Credential Connection is in Programmable Voice mode rather than auto-bridge mode, outbound calls in v2 mode fail silently after a 30-second SIP timeout with no indication of misconfiguration.

**Fix:** Add startup validation that logs a clear warning if the Telnyx connection type does not match the expected auto-bridge configuration.

---

### L-24 — `canceled` Call Status Indistinguishable from `missed` in UI

When a caller hangs up before the browser answers, `call.status = "missed"` with `voicemail_url = NULL`. This is correct but indistinguishable from "rang out, no voicemail." Consider adding a `canceled` status for abandoned calls.

---

### L-25 — No Caching for Voice Tokens or Analytics

Every `GET /api/calls/token` hits Telnyx; every `GET /api/analytics` runs 8+ queries. Add in-process TTL caching (1-hour for voice tokens, 60 seconds for analytics).

---

### L-26 — `pool_pre_ping=False` (Duplicated Reference — see H-07)

This is fully addressed under H-07.

---

### L-27 — Sentry 10% Sampling Too Low

Addressed under M-21.

---

### L-28 — No `CHECK` Constraints on Status/Direction/Role Columns

**File:** `backend/app/models/__init__.py`

`Call.status`, `Call.direction`, `Message.direction`, `User.role` are `VARCHAR` columns with no `CHECK` constraints. Invalid values can be written directly via SQL without validation.

**Fix:** Add DB-level `CHECK` constraints matching the application's allowed value sets.

---

### L-29 — `email.py` HTML Template Uses `str.format()` (Injection Risk)

**File:** `backend/app/services/email.py`

The HTML email template uses `str.format(name=..., url=...)`. If `settings.app_name` or any injected value contains `{...}` braces, the format call will raise or silently inject unintended content.

**Fix:** Use template variables with explicit escaping, or use `string.Template` with `$`-prefixed substitution.

---

### L-30 — `lru_cache` on Settings Prevents Test Isolation

**File:** `backend/app/config.py`

`@lru_cache` on `get_settings()` means unit tests that override env vars must call `get_settings.cache_clear()` to see changes. This is a common source of hard-to-debug test failures.

---

### L-31 — No Error Boundary Around Individual Routes

**File:** `frontend/src/App.jsx`

The single `ErrorBoundary` wraps the entire application. A rendering error in one page (e.g., `DashboardPage`) takes down all routes. Wrap each `<Route>` element in its own `ErrorBoundary`.

---

### L-32 — Contact Duplicate Phone Numbers Per User

**File:** `backend/app/api/contacts.py` — `create_contact()`

No duplicate phone number check per owner. A user can create multiple contacts with identical phone numbers. `_resolve_contact()` returns the first match arbitrarily.

**Fix:** Check for existing contact before insert; return 409 if duplicate.

---

### L-33 — Admin Can See All Users' Contacts (`_resolve_contact`)

**File:** `backend/app/api/telnyx_webhooks.py` — `_resolve_contact()`

When `current_user.role == 'admin'`, the contact lookup searches all users' contacts (`owner_id` filter removed). Admins see contact names from other tenants' address books in their own inbox.

**Fix:** Always scope contact resolution to the authenticated user's ID only.

---

### L-34 — No `max_length` on Contact Notes Field

**File:** `backend/app/schemas/__init__.py` — `ContactCreate`

The `notes` field has no length limit. Large notes inflate DB storage and API response sizes.

**Fix:** `max_length=2000` on the notes field.

---

### L-35 — Missing `X-XSS-Protection` Header in Vercel Configuration

**File:** `frontend/vercel.json`

`X-XSS-Protection: 1; mode=block` is a legacy header but still respected by some older browsers.

**Fix:** Add `{ "key": "X-XSS-Protection", "value": "1; mode=block" }` to the headers array.

---

## 8. Remediation Roadmap

### Sprint 1 — Critical Security & Data Exposure (Week 1)

These must be resolved before the application handles any real users.

| # | Finding | Effort |
|---|---------|--------|
| 1 | **C-03** Remove DB backup dump from git history + add `backups/` to `.gitignore` | 1 hour |
| 2 | **C-04** Mask phone numbers in all log statements; move diagnostic logs to DEBUG | 2 hours |
| 3 | **C-01** Add IP allowlist + HMAC query param to all TeXML webhook endpoints | 1 day |
| 4 | **C-02** Add `@limiter.limit("60/hour")` to SMS send endpoint | 30 min |
| 5 | **H-31** Remove `X-Auth-Hint` header from login endpoint | 30 min |
| 6 | **C-05 + H-04 + H-23 + H-24** Migrate rate limiter to Redis; add limits to voice token, analytics, number sync | 1 day |
| 7 | **H-06** Remove localhost from default `cors_origins` | 15 min |
| 8 | **H-07 + M-36** Set `pool_pre_ping=True` | 5 min |

---

### Sprint 2 — Stability & Deployment Correctness (Week 2)

| # | Finding | Effort |
|---|---------|--------|
| 1 | **H-01** Add `--workers 4` to start command immediately; plan async migration | 1 hour |
| 2 | **H-02** Move `alembic upgrade head` to Railway pre-deploy command | 30 min |
| 3 | **H-03** Set `healthcheckTimeout = 30` | 5 min |
| 4 | **H-08** Fix `_claim_event` to commit after processing, not before | 2 hours |
| 5 | **H-09** Set `_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 3900` | 5 min |
| 6 | **C-08** Fix `unassign_number` to clear `User.phone_number` | 1 hour |
| 7 | **H-15** Remove `User.phone_number` from call routing fallback | 2 hours |
| 8 | **H-26** Add `with_for_update()` to call status handlers | 1 hour |
| 9 | **H-30** Enable Railway automated backups | 15 min |
| 10 | **M-07** Add `--timeout-graceful-shutdown 30` to uvicorn | 5 min |

---

### Sprint 3 — Data Integrity & Missing Validations (Week 3)

| # | Finding | Effort |
|---|---------|--------|
| 1 | **H-13 + H-20 + L-18 + L-26** Add missing `UNIQUE` and `CHECK` constraints via Alembic migration | 1 day |
| 2 | **H-22** Add composite indexes on all high-traffic columns | 2 hours |
| 3 | **H-21** Add `WebhookEvent` pruning job (delete rows older than 7 days) | 2 hours |
| 4 | **H-10** Add pagination to calls, contacts, and conversations endpoints | 1 day |
| 5 | **M-01 + M-02** Add `max_length=1600` to message body; add E.164 validation to phone fields | 2 hours |
| 6 | **H-11** Move analytics time-bucketing to SQL; add `truncated` flag | 1 day |
| 7 | **H-12** Filter soft-deleted users from `list_users`; fix email reuse for soft-deletes | 2 hours |
| 8 | **H-14** Add `with_for_update()` to number assignment | 30 min |

---

### Sprint 4 — Frontend Fixes (Week 4)

| # | Finding | Effort |
|---|---------|--------|
| 1 | **C-06 + C-07** Fix mic leak on `newCall()` throw; fix 401 interceptor for public flows | 3 hours |
| 2 | **H-16 + H-17 + H-18** Fix `answeredCallIdRef`, `callTimeoutRef`, base64url normalization | 2 hours |
| 3 | **H-19 + L-02** Fix password hints on setup and reset pages | 30 min |
| 4 | **H-27 + H-28 + H-29** Fix admin assignment filter; add loading guard; fix delete copy | 2 hours |
| 5 | **M-03** Use `phonenumbers` library for consistent E.164 normalization everywhere | 3 hours |
| 6 | **M-16 + M-27** Persist inbox tab in URL; deduplicate polling intervals | 2 hours |
| 7 | **M-17** Replace all `confirm()` / `alert()` calls with custom modals / toasts | 2 hours |
| 8 | **L-06 + L-07** Add focus traps and ARIA roles to modal components | 2 hours |

---

### Sprint 5 — Observability, Performance & Polish (Week 5+)

| # | Finding | Effort |
|---|---------|--------|
| 1 | **O-01/C-04** Structured JSON logging with request ID propagation | 1 day |
| 2 | **M-26** Move email sending to `BackgroundTasks` | 2 hours |
| 3 | **H-25** Implement pagination loop in `list_owned_numbers` | 2 hours |
| 4 | **M-29** Add `Content-Security-Policy` to `vercel.json` | 1 hour |
| 5 | **M-14** Set up GitHub Actions CI workflow | 1 day |
| 6 | **M-05 + M-04** Add Audit Logs tab to admin panel with pagination | 1 day |
| 7 | **M-13** Add SSE push endpoint for real-time SMS/call notifications | 2 days |
| 8 | **H-01 (proper)** Migrate `telnyx_service.py` to `httpx.AsyncClient` | 3 days |
| 9 | **L-04** Remove all `useTelnyx as useTwilio` aliases | 1 hour |
| 10 | **L-05 + L-29** Add `htmlFor` to form labels; add per-route error boundaries | 2 hours |
