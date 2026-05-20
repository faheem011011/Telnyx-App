# AlphaCall - Browser-based VoIP App

A professional, Dialpad/OpenPhone-style calling and messaging web app powered by **Telnyx**. Make and receive real phone calls entirely in your browser, send/receive SMS, manage contacts, and administer your team - all from one clean interface with light and dark themes.

## Tech stack

**Backend**
- Python 3.12+
- FastAPI
- SQLAlchemy 2.0 + PostgreSQL
- Pydantic 2
- Telnyx Python SDK 4.x
- JWT auth (python-jose) + bcrypt

**Frontend**
- React 19
- Vite 6
- Tailwind CSS 3.4
- Telnyx WebRTC SDK (`@telnyx/webrtc`) - browser softphone
- React Router 7
- Recharts
- Lucide icons

---

## Features

### For all users
- 📞 **Outbound calls** - dial any number from your browser via WebRTC
- 📲 **Inbound calls** - receive calls to your Telnyx number, ring in-browser, accept/decline
- 💬 **SMS** - send/receive text messages with threaded conversations
- 🎙️ **Voicemail** - missed calls capture voicemail with automatic transcription
- 👥 **Contacts** - full CRUD address book with favorites and blocking
- 🔎 **Search & filter** - search across calls, contacts, messages
- 🌓 **Light + Dark mode**

### Admin only
- 🛡️ **Role-based access** - Admin and User roles
- 📊 **Analytics dashboard** - KPI cards, call volume charts, per-department and per-user drill-down
- 📥 **Export CSV** - department-aggregated or per-user analytics
- 📱 **Phone number management** - purchase, assign, unassign, and release Telnyx numbers
- 👤 **User management** - create, edit, deactivate users; assign departments and roles

---

## Quick start

### Prerequisites

- **Python 3.12+**
- **Node.js 20+** and npm
- **ngrok** (for local Telnyx webhooks) - [download](https://ngrok.com/download)
- A **Telnyx account** - [sign up](https://telnyx.com)

### 1. Clone and install

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env            # then fill in your credentials

# Frontend
cd ../frontend
npm install
cp .env.example .env.local
```

### 2. Configure credentials

Fill in `backend/.env` with your Telnyx credentials (see [Telnyx setup](#telnyx-setup-walkthrough) below).

### 3. Run the app

```bash
# Terminal 1 - backend
cd backend
uvicorn app.main:app --reload

# Terminal 2 - frontend
cd frontend
npm run dev

# Terminal 3 - ngrok (so Telnyx can reach your backend)
ngrok http 8000
```

Open [http://localhost:5173](http://localhost:5173).

---

## Database migrations (Alembic)

```bash
# Apply all pending migrations (first run)
alembic upgrade head

# After modifying a SQLAlchemy model
alembic revision --autogenerate -m "describe your change"
alembic upgrade head

# Roll back one migration
alembic downgrade -1
```

---

## Telnyx setup walkthrough

### Step 1 - Get your API Key

1. Log in to the [Telnyx Portal](https://portal.telnyx.com)
2. Go to **Auth → API Keys → Add API Key**
3. Copy the key (starts with `KEY_V2_…`) → paste into `.env` as `TELNYX_API_KEY`

### Step 2 - Get a phone number

1. Go to **Numbers → Buy Numbers**
2. Search for a US number with **Voice + SMS**
3. Purchase it and copy the number (e.g. `+15551234567`) → `TELNYX_PHONE_NUMBER`

### Step 3 - Create a Messaging Profile

1. Go to **Messaging → Messaging Profiles → Add New Profile**
2. Copy the **Profile ID** → `TELNYX_MESSAGING_PROFILE_ID`
3. Assign your number to this profile

### Step 4 - Start ngrok

```bash
ngrok http 8000
```

Copy the `https://abc123.ngrok-free.app` URL → paste into `backend/.env` as `PUBLIC_BACKEND_URL`.

> The ngrok URL changes every restart on the free tier. Update it in `.env` and the Telnyx Portal each time.

### Step 5 - Create a TeXML Application (for call control)

1. Go to **Voice → TeXML → Create TeXML App**
2. Name: `AlphaCall`
3. **Voice**:
   - Request URL: `https://abc123.ngrok-free.app/api/telnyx/outbound-call` - **POST**
   - Status Callback URL: `https://abc123.ngrok-free.app/api/telnyx/call-status` - **POST**
4. Copy the **Connection ID** → `TELNYX_CONNECTION_ID`

### Step 6 - Configure your phone number's webhooks

1. Go to **Numbers → My Numbers → [your number] → Edit**
2. **Inbound calls** webhook: `https://abc123.ngrok-free.app/api/telnyx/incoming-call` - **POST**
3. **Inbound SMS** webhook: `https://abc123.ngrok-free.app/api/telnyx/incoming-sms` - **POST**
4. Assign the number to your TeXML connection

### Step 7 - Webhook Public Key (for signature verification)

1. Go to **Account → API Keys → Webhook Keys**
2. Copy the **Public Key** → `TELNYX_PUBLIC_KEY`

### Step 8 - Verify your `backend/.env`

```env
TELNYX_API_KEY=KEY_V2_...
TELNYX_PUBLIC_KEY=...
TELNYX_PHONE_NUMBER=+15551234567
TELNYX_CONNECTION_ID=...
TELNYX_MESSAGING_PROFILE_ID=...

SECRET_KEY=some-long-random-string
DATABASE_URL=postgresql://alphacall:alphacall@localhost:5433/alphacall
FRONTEND_URL=http://localhost:5173
PUBLIC_BACKEND_URL=https://abc123.ngrok-free.app
```

---

## Testing checklist

- [ ] Login works
- [ ] Sidebar shows "Ready to dial" (green dot)
- [ ] Click **Call**, dial a number - outbound call connects
- [ ] Call your Telnyx number from a cell phone - incoming modal appears, Accept works
- [ ] Hang up → call appears in **Inbox**
- [ ] Missed call captures voicemail under **Voicemails** tab
- [ ] Send SMS from **Messages → New**, reply appears in thread
- [ ] Create a contact, star it, call it from the contact card
- [ ] Admin: Analytics dashboard shows KPI cards and charts
- [ ] Admin: Purchase / assign a Telnyx number to a user
- [ ] Toggle light and dark mode

---

## Project structure

```
AlphaCall/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── admin.py             # User & number management (admin only)
│   │   │   ├── analytics.py         # KPI aggregations + CSV export
│   │   │   ├── auth.py              # Login, signup
│   │   │   ├── calls.py             # Call history CRUD + voice token
│   │   │   ├── contacts.py          # Contacts CRUD
│   │   │   ├── messages.py          # SMS threads
│   │   │   └── telnyx_webhooks.py   # Telnyx TeXML webhook handlers
│   │   ├── models/                  # SQLAlchemy models (User, Call, Message, Contact, PhoneNumber)
│   │   ├── schemas/                 # Pydantic schemas
│   │   ├── services/
│   │   │   ├── deps.py              # Auth dependencies
│   │   │   ├── security.py          # JWT + bcrypt
│   │   │   └── telnyx_service.py    # Telnyx number search/purchase/release/token
│   │   ├── config.py
│   │   ├── database.py
│   │   └── main.py
│   ├── .env.example
│   └── requirements.txt
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── ActiveCallPanel.jsx
    │   │   ├── Dialer.jsx
    │   │   ├── IncomingCallModal.jsx
    │   │   └── Sidebar.jsx
    │   ├── context/
    │   │   ├── AuthContext.jsx
    │   │   ├── ThemeContext.jsx
    │   │   └── TelnyxContext.jsx     # Telnyx WebRTC SDK provider
    │   ├── pages/
    │   │   ├── AdminPage.jsx
    │   │   ├── ContactsPage.jsx
    │   │   ├── DashboardPage.jsx
    │   │   ├── InboxPage.jsx
    │   │   ├── LoginPage.jsx
    │   │   ├── MessagesPage.jsx
    │   │   └── SettingsPage.jsx
    │   ├── services/
    │   │   └── api.js
    │   ├── App.jsx
    │   └── main.jsx
    ├── .env.example
    ├── package.json
    └── vite.config.js
```

---

## Common issues

**"Connecting…" never becomes "Ready to dial"**
Missing or wrong `TELNYX_API_KEY` or `TELNYX_CONNECTION_ID` in `backend/.env`. Restart the backend after editing.

**Incoming calls never reach the browser**
- Verify your Telnyx number's inbound webhook points to your current ngrok URL
- Check ngrok is still running
- Watch FastAPI logs - you should see a POST to `/api/telnyx/incoming-call`

**CORS errors in browser console**
Make sure `FRONTEND_URL` in `backend/.env` matches where the frontend is running (default `http://localhost:5173`).

**Voicemail audio won't play**
The recording may still be processing - wait 30 seconds and refresh.

---

## Production notes

- Use a real domain with HTTPS for `PUBLIC_BACKEND_URL`
- Set a strong random `SECRET_KEY`: `openssl rand -hex 32`
- Set `DATABASE_URL` to your production PostgreSQL connection string
- Add your production frontend URL to CORS origins in `backend/app/main.py`

---

## License

MIT
