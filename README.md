# AlphaCall - Telnyx Browser Phone

A full-stack browser-based phone application built for Alphabridge Consulting. It provides WebRTC voice calls, SMS/MMS messaging, voicemail, call history, contacts, and an admin panel -- all powered by Telnyx.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
  - [1. Clone the repository](#1-clone-the-repository)
  - [2. Set up PostgreSQL](#2-set-up-postgresql)
  - [3. Set up the Backend](#3-set-up-the-backend)
  - [4. Set up the Frontend](#4-set-up-the-frontend)
  - [5. Run both services](#5-run-both-services)
  - [6. Create the first admin account](#6-create-the-first-admin-account)
- [Environment Variables Reference](#environment-variables-reference)
  - [Backend (.env)](#backend-env)
  - [Frontend (.env.local)](#frontend-envlocal)
- [Project Structure](#project-structure)
- [Key Features](#key-features)
- [Telnyx Portal Setup](#telnyx-portal-setup)
- [Database Migrations](#database-migrations)
- [Production Deployment](#production-deployment)
- [Testing Checklist](#testing-checklist)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
frontend/   React 19 + Vite + Tailwind CSS + Telnyx WebRTC SDK
backend/    FastAPI (Python 3.12) + PostgreSQL + SQLAlchemy + Alembic
```

| Service  | Local port | Production                  |
|----------|------------|-----------------------------|
| Frontend | 5173       | Vercel                      |
| Backend  | 8000       | Railway (Docker)            |
| Database | 5432       | Railway managed PostgreSQL  |

The frontend communicates with the backend through REST (`/api/*`). Real-time call events are pushed over SSE (Server-Sent Events). WebRTC media flows directly between the browser and Telnyx.

---

## Prerequisites

Install these tools before starting:

| Tool | Version | Download |
|------|---------|----------|
| Python | **3.12** (exact) | https://python.org |
| Node.js | 18+ | https://nodejs.org |
| PostgreSQL | 14+ | https://postgresql.org |
| Git | any | https://git-scm.com |
| ngrok | any | https://ngrok.com/download (needed for Telnyx webhooks locally) |

Verify installations:

```bash
python --version     # must be 3.12.x
node --version       # v18.x or v20.x
psql --version
```

---

## Local Development Setup

### 1. Clone the repository

```bash
git clone <repo-url>
cd "Telnyx App"
```

---

### 2. Set up PostgreSQL

Open the PostgreSQL prompt and create a database user and database:

```bash
psql -U postgres
```

```sql
CREATE USER alphacall WITH PASSWORD 'alphacall';
CREATE DATABASE alphacall OWNER alphacall;
\q
```

Test the connection:

```bash
psql "postgresql://alphacall:alphacall@localhost:5432/alphacall" -c "SELECT 1;"
```

You should see `1` returned. If your PostgreSQL runs on a different port (e.g. 5433), adjust accordingly.

---

### 3. Set up the Backend

```bash
cd backend
```

**Create and activate a virtual environment:**

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# macOS / Linux
python -m venv .venv
source .venv/bin/activate
```

Your prompt should now show `(.venv)` indicating the environment is active.

**Install Python dependencies:**

```bash
pip install -r requirements.txt
```

**Create the environment file:**

```bash
# Windows
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Open `backend/.env` and fill in every required value. See the [Environment Variables Reference](#backend-env) section for the full list and what each one means.

At minimum, these must be set before the server will start:
- `DATABASE_URL`
- `SECRET_KEY` (must be at least 32 characters - **the server refuses to start without this**)
- `INITIAL_SETUP_TOKEN` (needed to create the first admin)

**Run database migrations:**

```bash
alembic upgrade head
```

You should see output like:
```
INFO  [alembic.runtime.migration] Running upgrade  -> 99237b8f6456, initial_schema
INFO  [alembic.runtime.migration] Running upgrade 99237b8f6456 -> ...
```

**Start the backend server:**

```bash
uvicorn app.main:app --reload --port 8000
```

The API is now running at `http://localhost:8000`.
Verify it is healthy: `http://localhost:8000/api/health`

---

### 4. Set up the Frontend

Open a **new terminal window** (keep the backend running):

```bash
cd frontend
```

**Install Node.js dependencies:**

```bash
npm install
```

**Create the environment file:**

```bash
# Windows
copy .env.example .env.local

# macOS / Linux
cp .env.example .env.local
```

The default content is correct for local development:

```env
VITE_API_URL=http://localhost:8000
```

**Start the frontend dev server:**

```bash
npm run dev
```

The app is now available at `http://localhost:5173`.

---

### 5. Run both services

You need two terminal windows running at the same time:

| Terminal | Directory   | Command |
|----------|------------|---------|
| 1        | `backend/`  | `uvicorn app.main:app --reload --port 8000` |
| 2        | `frontend/` | `npm run dev` |

Open `http://localhost:5173` in your browser.

For Telnyx webhooks to reach your local machine, also run ngrok in a third terminal:

```bash
ngrok http 8000
```

Copy the `https://xxxx.ngrok-free.app` URL and set it as `PUBLIC_BACKEND_URL` in `backend/.env`, then restart the backend.

---

### 6. Create the first admin account

The setup page at `http://localhost:5173/setup` creates the first admin user. This page is permanently disabled once any admin exists.

**Requirements:**
- `INITIAL_SETUP_TOKEN` must be set in `backend/.env`
- The backend and frontend must both be running

**Steps:**
1. Open `http://localhost:5173/setup`
2. Enter your name, email address, and password
3. Click **Create Admin Account**
4. You will receive a verification email (requires Resend to be configured). Click the link to verify your email.
5. Log in at `http://localhost:5173`

> **If Resend is not configured locally**, the verification email will not be sent. You can manually mark the account as verified in the database:
> ```sql
> UPDATE users SET email_verified = true WHERE email = 'your@email.com';
> ```
> Email verification is enforced at login - you cannot log in without it.

---

## Environment Variables Reference

### Backend (.env)

Copy `backend/.env.example` to `backend/.env` and fill in the values below.

**Required - the server will not start or will have broken features without these:**

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string. Local: `postgresql://alphacall:alphacall@localhost:5432/alphacall` |
| `SECRET_KEY` | JWT signing key. Must be at least 32 random characters. Generate with: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `INITIAL_SETUP_TOKEN` | One-time token protecting the `/api/auth/setup` endpoint. Any random string works. Can be removed after the first admin is created. |
| `TELNYX_API_KEY` | V2 API key from Telnyx Portal (starts with `KEY_V2_`). Required for all Telnyx operations. |
| `TELNYX_PUBLIC_KEY` | Webhook public key from Telnyx Portal. Used to verify incoming webhook signatures. |
| `TELNYX_CONNECTION_ID` | SIP Credential Connection ID. Required for WebRTC calling. |
| `TELNYX_MESSAGING_PROFILE_ID` | Messaging Profile ID. Required for SMS. |
| `FRONTEND_URL` | Full URL of the frontend. Local: `http://localhost:5173`. Production: `https://your-domain.com` |
| `PUBLIC_BACKEND_URL` | Publicly accessible URL of the backend. Required for Telnyx webhooks. Local: use your ngrok URL, e.g. `https://xxxx.ngrok-free.app` |
| `RESEND_API_KEY` | API key from resend.com for sending transactional emails (email verification, password reset). |
| `RESEND_FROM_EMAIL` | Sender email address. Must be a verified domain on Resend. Example: `noreply@yourdomain.com` |

**Optional:**

| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated allowed frontend origins. Only change if running the frontend on a non-standard port. |
| `LOG_LEVEL` | `INFO` | Logging verbosity. Options: `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `SENTRY_DSN` | _(empty)_ | Sentry DSN for error tracking. Leave empty to disable. |

### Frontend (.env.local)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Base URL of the backend API. Local: `http://localhost:8000`. Production: `https://your-backend-domain.com` |

> **Never commit `.env` or `.env.local` to git.** Both files are in `.gitignore`.

---

## Project Structure

```
Telnyx App/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── admin.py             # User & phone number management (admin only)
│   │   │   ├── analytics.py         # KPI aggregations + CSV export
│   │   │   ├── auth.py              # Login, logout, setup, password reset, email verify
│   │   │   ├── calls.py             # Call history CRUD + voice token
│   │   │   ├── contacts.py          # Contacts CRUD
│   │   │   ├── events.py            # SSE real-time event stream
│   │   │   ├── messages.py          # SMS threads
│   │   │   └── telnyx_webhooks.py   # Telnyx webhook handlers (calls, SMS, voicemail)
│   │   ├── models/
│   │   │   └── __init__.py          # SQLAlchemy ORM models
│   │   ├── schemas/
│   │   │   └── __init__.py          # Pydantic request/response schemas
│   │   ├── services/
│   │   │   ├── audit.py             # Audit log helpers
│   │   │   ├── deps.py              # Auth dependencies (get_current_user, require_admin)
│   │   │   ├── email.py             # Resend email sending
│   │   │   ├── security.py          # JWT creation, bcrypt password hashing
│   │   │   ├── telnyx_service.py    # Telnyx API calls (numbers, tokens, recordings)
│   │   │   └── verification.py      # Email verification token helpers
│   │   ├── config.py                # Settings loaded from environment variables
│   │   ├── database.py              # SQLAlchemy engine and session
│   │   ├── events.py                # SSE event bus
│   │   ├── limiter.py               # Rate limiter (slowapi)
│   │   └── main.py                  # FastAPI app entry point and middleware
│   ├── alembic/
│   │   └── versions/                # Database migration files
│   ├── alembic.ini                  # Alembic configuration
│   ├── requirements.txt             # Python dependencies
│   ├── Dockerfile                   # Production Docker image (for Railway)
│   ├── railway.toml                 # Railway deployment config
│   ├── .env.example                 # Template - copy to .env and fill in
│   └── .python-version              # Python version pin (3.12)
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── ActiveCallPanel.jsx   # In-call UI overlay
    │   │   ├── Avatar.jsx
    │   │   ├── Dialer.jsx            # Numeric dial pad
    │   │   ├── IncomingCallModal.jsx # Accept/decline popup
    │   │   └── Sidebar.jsx          # Navigation and connection status
    │   ├── context/
    │   │   ├── AuthContext.jsx       # User session state
    │   │   ├── TelnyxContext.jsx     # Telnyx WebRTC SDK provider
    │   │   └── ThemeContext.jsx      # Light/dark mode
    │   ├── hooks/
    │   │   ├── useDepartments.js
    │   │   ├── useFocusTrap.js
    │   │   └── useSSE.js             # SSE event subscription
    │   ├── pages/
    │   │   ├── AdminPage.jsx
    │   │   ├── ContactsPage.jsx
    │   │   ├── DashboardPage.jsx
    │   │   ├── ForgotPasswordPage.jsx
    │   │   ├── InboxPage.jsx
    │   │   ├── LoginPage.jsx
    │   │   ├── MessagesPage.jsx
    │   │   ├── PrivacyPage.jsx
    │   │   ├── ResetPasswordPage.jsx
    │   │   ├── SettingsPage.jsx
    │   │   ├── SetupPage.jsx
    │   │   ├── TermsPage.jsx
    │   │   └── VerifyEmailPage.jsx
    │   ├── services/
    │   │   └── api.js                # Axios API client
    │   ├── utils/
    │   │   └── format.js
    │   ├── App.jsx                   # Router and top-level layout
    │   └── main.jsx                  # React entry point
    ├── public/                       # Static assets (logo, images)
    ├── vite.config.js                # Vite config (dev proxy to backend, allowed hosts)
    ├── tailwind.config.js
    ├── vercel.json                   # SPA rewrites + security headers for Vercel
    ├── package.json
    └── .env.example                  # Template - copy to .env.local and fill in
```

---

## Key Features

| Feature | Description |
|---------|-------------|
| WebRTC Calls | Browser-based voice calls via Telnyx WebRTC SDK - no plugin needed |
| Inbound Calls | Incoming call ring in the browser with accept/decline modal |
| SMS/MMS | Send and receive messages; threaded conversations per contact |
| Voicemail | Missed calls capture voicemail with transcription |
| Call Recording | Start/stop recording mid-call; play back from call history |
| Call History | Paginated inbox with filters for missed, outbound, voicemails |
| Contacts | Per-user address book with block/favourite support |
| Admin Panel | User management, phone number purchase/assign, departments, audit logs |
| Analytics | KPI dashboard, call volume charts, per-department and per-user drill-down, CSV export |
| Email Verification | Required before first login - sent via Resend |
| Password Reset | Email-based reset flow with 1-hour expiry tokens |
| Real-time Events | SSE stream pushes call status updates instantly to the browser |
| Rate Limiting | Per-IP throttling on auth endpoints to prevent brute-force |
| Audit Logs | Immutable log of every admin action with IP address |
| Light/Dark Mode | Toggle in Settings |

---

## Telnyx Portal Setup

You need a Telnyx account with the following configured before calls and SMS will work.

### Step 1 - Get your API Key

1. Log in to the [Telnyx Portal](https://portal.telnyx.com)
2. Go to **Auth > API Keys > Add API Key**
3. Copy the key (starts with `KEY_V2_`) into `TELNYX_API_KEY` in `backend/.env`

### Step 2 - Create a Credential Connection (for WebRTC)

1. Go to **Voice > SIP Connections > Add SIP Connection**
2. Choose **Credentials** as the connection type
3. Name it (e.g. `AlphaCall WebRTC`)
4. Copy the **Connection ID** into `TELNYX_CONNECTION_ID` in `backend/.env`

### Step 3 - Create a Messaging Profile (for SMS)

1. Go to **Messaging > Messaging Profiles > Add New Profile**
2. Name it (e.g. `AlphaCall SMS`)
3. Copy the **Profile ID** into `TELNYX_MESSAGING_PROFILE_ID` in `backend/.env`

### Step 4 - Purchase phone numbers

You can do this directly in the app's Admin Panel once your API key is configured, or from the Telnyx Portal under **Numbers > Buy Numbers**. Buy numbers with **Voice + SMS** capabilities.

Assign each number to your Messaging Profile (for SMS) and your Credential Connection (for calls).

### Step 5 - Set up ngrok for local webhooks

Telnyx needs a public HTTPS URL to deliver webhook events (incoming calls, incoming SMS, call status, recordings). Run ngrok locally:

```bash
ngrok http 8000
```

Copy the `https://xxxx.ngrok-free.app` URL. Set it in `backend/.env`:

```env
PUBLIC_BACKEND_URL=https://xxxx.ngrok-free.app
```

> The free ngrok tier gives a new URL each restart. Update `PUBLIC_BACKEND_URL` and the Telnyx Portal settings each time.

### Step 6 - Configure webhook URLs in Telnyx

Set the following webhook URLs in the Telnyx Portal, replacing `{PUBLIC_BACKEND_URL}` with your actual URL:

| Where to configure | Setting | URL |
|--------------------|---------|-----|
| Credential Connection | Voice Request URL | `{PUBLIC_BACKEND_URL}/api/telnyx/outbound-call` |
| Credential Connection | Status Callback URL | `{PUBLIC_BACKEND_URL}/api/telnyx/call-status` |
| Phone Number > Voice | Inbound call webhook | `{PUBLIC_BACKEND_URL}/api/telnyx/incoming-call` |
| Phone Number > Messaging | Inbound message webhook | `{PUBLIC_BACKEND_URL}/api/telnyx/incoming-sms` |
| Credential Connection | Recording event webhook | `{PUBLIC_BACKEND_URL}/api/telnyx/recording-event` |

All webhook methods are **POST**.

### Step 7 - Get the Webhook Public Key (for signature verification)

1. In the Telnyx Portal go to **Auth > API Keys**
2. Find the **Public Key** section (used for webhook verification)
3. Copy the key into `TELNYX_PUBLIC_KEY` in `backend/.env`

### Step 8 - Verify your backend/.env

Your completed `backend/.env` for local development should look like:

```env
# Telnyx
TELNYX_API_KEY=KEY_V2_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELNYX_PUBLIC_KEY=your_public_key_here
TELNYX_CONNECTION_ID=your_connection_id_here
TELNYX_MESSAGING_PROFILE_ID=your_messaging_profile_id_here

# App
SECRET_KEY=your_32_character_random_string_here
INITIAL_SETUP_TOKEN=another_random_string_for_first_run

# Database
DATABASE_URL=postgresql://alphacall:alphacall@localhost:5432/alphacall

# URLs
FRONTEND_URL=http://localhost:5173
PUBLIC_BACKEND_URL=https://xxxx.ngrok-free.app

# Email
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@yourdomain.com
```

---

## Database Migrations

All migrations live in `backend/alembic/versions/`. Run these from inside the `backend/` directory with the virtual environment activated.

**Apply all pending migrations** (run this on first setup and every time you pull new code):

```bash
alembic upgrade head
```

**Check current migration version:**

```bash
alembic current
```

**View pending migrations:**

```bash
alembic history --verbose
```

**Roll back one migration:**

```bash
alembic downgrade -1
```

**Create a new migration after changing a SQLAlchemy model:**

```bash
alembic revision --autogenerate -m "brief description of change"
alembic upgrade head
```

Always review the generated file in `alembic/versions/` before applying it to production.

---

## Production Deployment

### Backend - Railway

1. Connect your GitHub repository to Railway.
2. Set the root directory to `backend/` (or use the repo root if Railway detects the Dockerfile).
3. Set all environment variables from the [Backend .env reference](#backend-env) in the Railway dashboard. **Do not commit `.env` to git.**
4. Railway uses `backend/Dockerfile` which automatically runs `alembic upgrade head` then starts uvicorn.
5. The health check endpoint is `/api/health` (configured in `railway.toml`).

### Frontend - Vercel

1. Connect your GitHub repository to Vercel.
2. Set the **Root Directory** to `frontend/`.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add environment variable `VITE_API_URL` set to your production backend URL (e.g. `https://back.alphabridgeconsulting.ai`).
6. `vercel.json` handles SPA routing rewrites and security headers automatically.

---

## Testing Checklist

After setup, verify each feature works:

- [ ] Open `http://localhost:5173` - login page loads
- [ ] Log in with admin credentials - dashboard appears
- [ ] Sidebar shows **"Ready to dial"** with green dot (WebRTC connected)
- [ ] Click **Call**, dial a real phone number - outbound call connects
- [ ] Call your Telnyx number from a mobile phone - incoming call modal appears in browser
- [ ] Accept the incoming call - audio works both ways
- [ ] Hang up - call appears in **Inbox**
- [ ] Call your Telnyx number and don't answer - missed call captured, voicemail appears
- [ ] Go to **Messages** > **New Message**, send an SMS - message delivered
- [ ] Reply to your number from a mobile - inbound message appears in thread
- [ ] Create a contact, star it, call it from the contact card
- [ ] Admin: open **Admin Panel** - user list shows
- [ ] Admin: Search and purchase a Telnyx number from the Admin Panel
- [ ] Admin: Assign the number to a user
- [ ] Admin: **Analytics** tab shows KPI cards and charts
- [ ] Toggle **light/dark mode** in Settings

---

## Troubleshooting

### "SECRET_KEY is still the dev default" - server won't start

The backend refuses to start without a strong secret key. Generate one and add it to `backend/.env`:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

### Sidebar shows "Connecting..." and never becomes "Ready"

- Check that `TELNYX_API_KEY` and `TELNYX_CONNECTION_ID` are correctly set in `backend/.env`
- Restart the backend after editing `.env`
- Check the browser console for WebRTC errors

### Incoming calls never ring in the browser

- Verify ngrok is still running (free tier URLs expire)
- Update `PUBLIC_BACKEND_URL` in `backend/.env` with the new ngrok URL
- Update the webhook URLs in the Telnyx Portal to match
- Watch the backend logs - you should see `POST /api/telnyx/incoming-call` when a call arrives

### Can't log in - "Invalid email or password" even with correct credentials

Email verification is required before login. Check that your email is verified:

```sql
SELECT email, email_verified FROM users WHERE email = 'your@email.com';
```

If `email_verified` is `false`, either click the verification link in your email or run:

```sql
UPDATE users SET email_verified = true WHERE email = 'your@email.com';
```

### Setup page says "Setup already completed" but I have no admin

An admin account already exists in the database. Connect to the database and check:

```sql
SELECT email, role FROM users WHERE role = 'admin';
```

### CORS errors in the browser console

`CORS_ORIGINS` in `backend/.env` must include the exact origin of the frontend, including protocol and port. For local dev: `http://localhost:5173`.

### Database connection refused

Confirm PostgreSQL is running and credentials match:

```bash
psql "postgresql://alphacall:alphacall@localhost:5432/alphacall" -c "SELECT 1;"
```

If it fails, check that PostgreSQL is started and the user/database were created correctly (see [Set up PostgreSQL](#2-set-up-postgresql)).

### npm install fails with native module errors (Windows)

Install the Visual Studio C++ Build Tools, or skip native compilation:

```bash
npm install --ignore-scripts
```

### Frontend shows blank page after hard refresh in production

This is an SPA routing issue. Make sure `vercel.json` is committed and deployed. Locally, the Vite dev server handles this automatically.

### Voicemail or recording audio won't play

Telnyx recording URLs are signed and expire roughly 10 minutes after the recording is saved. The app fetches a fresh URL on demand. If playback fails, try clicking the play button again to request a new signed URL.
