# AlphaCall — Browser-based VoIP App

A professional, Dialpad/OpenPhone-style calling and messaging web app powered by Twilio. Make and receive real phone calls entirely in your browser, send/receive SMS, manage contacts, and administer your team — all from one clean interface with light and dark themes.

## Tech stack

**Backend**
- Python **3.14.4**
- FastAPI **0.136.0**
- SQLAlchemy 2.0.49 + SQLite
- Pydantic 2.13
- Twilio Python SDK 9.10.5
- JWT auth (python-jose) + bcrypt
- Google OAuth (google-auth)

**Frontend**
- React **19.2.5**
- Vite 6
- Tailwind CSS 3.4
- Twilio Voice JS SDK 2.14 (WebRTC)
- React Router 7
- Recharts
- Lucide icons

---

## Features

### For all users
- 📞 **Outbound calls** — dial any US number from your browser via WebRTC
- 📲 **Inbound calls** — receive calls to your Twilio number, ring in-browser, accept/decline
- 💬 **SMS** — send/receive text messages with threaded conversations
- 🎙️ **Voicemail** — missed calls capture voicemail with automatic transcription
- 🎧 **Call recording** — listen to recorded calls inline
- 👥 **Contacts** — full CRUD address book with favorites and blocking
- 🔎 **Search & filter** — search across calls, contacts, messages
- 🌓 **Light + Dark mode** — professional theming in both

### Admin only
- 🛡️ **Role-based access** — Admin and User roles, enforced on both frontend and backend
- 📊 **Analytics dashboard** — KPI cards, call volume charts, hourly/daily breakdowns, top area codes, per-department and per-user drill-down
- 📥 **Export CSV** — department-aggregated or per-user analytics export
- 🏢 **Department management** — Data Team, HR Team, BD Team, AI/ML Team, DevOps Team
- 📱 **Twilio number management** — purchase, assign, unassign, and release numbers from the admin panel
- 👤 **User management** — create, edit, deactivate users; assign departments and roles

### Authentication
- 🔐 **Email + password login** and signup
- 🔑 **Google OAuth** — one-click sign-in with Google

---

## Quick start

### Prerequisites

- **Python 3.14.4+** ([download](https://www.python.org/downloads/))
- **Node.js 20+** and npm
- **ngrok** (for local Twilio webhooks) — [download](https://ngrok.com/download)
- A **Twilio account** — [sign up free](https://www.twilio.com/try-twilio)

### 1. Clone and install

```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then fill in your credentials

# Frontend (in a new terminal)
cd ../frontend
npm install
cp .env.example .env.local      # then fill in values
```

### 2. Configure credentials

Fill in `backend/.env` with your Twilio and app settings (see [Twilio setup](#twilio-setup-walkthrough) below).

Optionally add your Google Client ID to `frontend/.env.local` and `backend/.env` to enable Google login.

### 3. Run the app

```bash
# Terminal 1 — backend
cd backend
source venv/bin/activate
uvicorn app.main:app --reload

# Terminal 2 — frontend
cd frontend
npm run dev

# Terminal 3 — ngrok (so Twilio can reach your backend)
ngrok http 8000
```

Open [http://localhost:5173](http://localhost:5173) and log in with the default admin credentials from `backend/.env` (default: `admin@example.com` / `changeme123`).

---

## Database migrations (Alembic)

Schema changes are managed with Alembic. Run all commands from the `backend/` directory with the virtualenv active.

```bash
# Apply all pending migrations to the database (normal first-run)
alembic upgrade head

# After modifying a SQLAlchemy model, generate a new migration automatically
alembic revision --autogenerate -m "describe your change"

# Then apply it
alembic upgrade head

# Roll back one migration
alembic downgrade -1

# Check current migration state
alembic current

# Show full migration history
alembic history --verbose
```

> **First run on an existing database**: if `voip_app.db` already has tables (e.g. created by a previous version), stamp it before upgrading:
> ```bash
> alembic stamp head
> ```

---

## Twilio setup walkthrough

### Step 1 — Buy a Twilio phone number

1. Log in to the [Twilio Console](https://www.twilio.com/console)
2. Go to **Phone Numbers → Manage → Buy a number**
3. Pick a **US number** with **Voice + SMS** capabilities
4. Copy the number (e.g., `+15551234567`) — paste it into `.env` as `TWILIO_PHONE_NUMBER`

### Step 2 — Get Account credentials

From the [Console home](https://www.twilio.com/console):

- **Account SID** → `TWILIO_ACCOUNT_SID`
- **Auth Token** → `TWILIO_AUTH_TOKEN`

### Step 3 — Create an API Key (for the Voice JS SDK)

1. Go to **Account → API keys & tokens → Create API key**
2. Friendly name: `AlphaCall`, Type: **Standard**
3. Copy **SID** (starts with `SK…`) → `TWILIO_API_KEY_SID`
4. Copy **Secret** → `TWILIO_API_KEY_SECRET` ⚠️ (shown only once!)

### Step 4 — Start ngrok

```bash
ngrok http 8000
```

Copy the `https://abc123.ngrok-free.app` URL → paste into `backend/.env` as `PUBLIC_BACKEND_URL`.

> ⚠️ The ngrok URL changes every restart on the free tier. Update it in `.env` and the Twilio Console each time.

### Step 5 — Create a TwiML App

1. Go to **Voice → TwiML → TwiML Apps → Create new TwiML App**
2. Friendly name: `AlphaCall`
3. **Voice Configuration**:
   - Request URL: `https://abc123.ngrok-free.app/api/twilio/outbound-call` — **POST**
   - Status Callback URL: `https://abc123.ngrok-free.app/api/twilio/call-status` — **POST**
4. Copy the **TwiML App SID** (starts with `AP…`) → `TWILIO_TWIML_APP_SID`

### Step 6 — Configure your phone number's webhooks

1. Go to **Phone Numbers → Manage → Active numbers → [your number]**
2. **Voice**: A call comes in → `https://abc123.ngrok-free.app/api/twilio/incoming-call` — **POST**
3. **Voice**: Status changes → `https://abc123.ngrok-free.app/api/twilio/call-status` — **POST**
4. **Messaging**: A message comes in → `https://abc123.ngrok-free.app/api/twilio/incoming-sms` — **POST**

### Step 7 — Verify your `backend/.env`

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SECRET=your_api_key_secret
TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+15551234567

SECRET_KEY=some-long-random-string
DATABASE_URL=sqlite:///./voip_app.db
FRONTEND_URL=http://localhost:5173
PUBLIC_BACKEND_URL=https://abc123.ngrok-free.app

DEFAULT_USER_EMAIL=admin@example.com
DEFAULT_USER_PASSWORD=changeme123
DEFAULT_USER_NAME=Admin User

# Optional — leave blank to disable Google login
GOOGLE_CLIENT_ID=
```

---

## Testing checklist

- [ ] Login works with default admin credentials
- [ ] Sidebar shows "Ready to dial" (green dot)
- [ ] Click **Call**, dial a number — outbound call connects
- [ ] Call your Twilio number from a cell phone — incoming modal appears, Accept works
- [ ] Hang up → call appears in **Inbox** (Unread tab by default)
- [ ] Missed call captures voicemail with transcription under **Voicemails** tab
- [ ] Send SMS from **Messages → New**, reply appears in thread
- [ ] Create a contact, star it, call it from the contact card
- [ ] Admin: Analytics dashboard shows KPI cards and charts
- [ ] Admin: Filter analytics by department → by user
- [ ] Admin: Export CSV — department rows when no filter, user rows when dept selected
- [ ] Admin: Create a new user with a department in Admin Panel
- [ ] Admin: Purchase / assign a Twilio number to a user
- [ ] Toggle light and dark mode

---

## Project structure

```
AlphaCall/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── admin.py          # User & number management (admin only)
│   │   │   ├── analytics.py      # KPI aggregations + per-user CSV export
│   │   │   ├── auth.py           # Login, signup, Google OAuth
│   │   │   ├── calls.py          # Call history CRUD
│   │   │   ├── contacts.py       # Contacts CRUD
│   │   │   ├── messages.py       # SMS threads
│   │   │   └── twilio_webhooks.py
│   │   ├── models/               # SQLAlchemy models (User, Call, Message, Contact, TwilioNumber)
│   │   ├── schemas/              # Pydantic schemas
│   │   ├── services/
│   │   │   ├── deps.py           # Auth dependencies (get_current_user, require_admin)
│   │   │   ├── security.py       # JWT + bcrypt
│   │   │   └── twilio_service.py # Twilio number search/purchase/release
│   │   ├── config.py
│   │   ├── database.py
│   │   └── main.py
│   ├── .env.example
│   └── requirements.txt
│
└── frontend/
    ├── public/
    │   └── logo.png              # App logo (AlphaCall)
    ├── src/
    │   ├── components/
    │   │   ├── ActiveCallPanel.jsx
    │   │   ├── Avatar.jsx
    │   │   ├── Dialer.jsx
    │   │   ├── IncomingCallModal.jsx
    │   │   └── Sidebar.jsx
    │   ├── context/
    │   │   ├── AuthContext.jsx
    │   │   ├── ThemeContext.jsx
    │   │   └── TwilioContext.jsx
    │   ├── pages/
    │   │   ├── AdminPage.jsx     # User management + number inventory
    │   │   ├── ContactsPage.jsx
    │   │   ├── DashboardPage.jsx # Analytics with dept/user filters + CSV export
    │   │   ├── InboxPage.jsx
    │   │   ├── LoginPage.jsx     # Email/password + Google OAuth + role selector
    │   │   ├── MessagesPage.jsx
    │   │   └── SettingsPage.jsx
    │   ├── services/
    │   │   └── api.js            # Axios client (authApi, callsApi, analyticsApi, adminApi…)
    │   ├── styles/
    │   │   └── index.css
    │   ├── utils/
    │   │   └── format.js
    │   ├── App.jsx               # UserLayout + AdminLayout (separate route trees)
    │   └── main.jsx
    ├── .env.example
    ├── package.json
    ├── tailwind.config.js
    └── vite.config.js
```

---

## Common issues

**"Connecting…" never becomes "Ready to dial"**
Missing or wrong Twilio credentials in `backend/.env`. Double-check all 5 Twilio values and restart the backend.

**Incoming calls never reach the browser**
- Verify **Phone Number → Voice → "A call comes in"** webhook points to your current ngrok URL
- Check ngrok is still running
- Watch FastAPI logs — you should see a POST to `/api/twilio/incoming-call`

**"Application error. Please check your application logs."**
Twilio couldn't reach the TwiML App's Request URL. Update it in the Twilio Console to your current ngrok URL.

**CORS errors in browser console**
Make sure `FRONTEND_URL` in `backend/.env` matches where the frontend is running (default `http://localhost:5173`).

**Voicemail audio won't play**
The recording may still be processing — wait 30 seconds and refresh.

**Google login not showing**
Make sure `VITE_GOOGLE_CLIENT_ID` is set in `frontend/.env.local` and `GOOGLE_CLIENT_ID` is set in `backend/.env`, then restart both servers.

---

## Production notes

- Replace SQLite with Postgres (`DATABASE_URL=postgresql://...`)
- Use a real domain with HTTPS for `PUBLIC_BACKEND_URL` (no ngrok needed)
- Set a strong random `SECRET_KEY`: `openssl rand -hex 32`
- Change the default admin password immediately after first login
- Add rate-limiting to the API endpoints
- Serve the frontend build via a CDN or reverse proxy

---

## License

MIT — feel free to use and modify.
