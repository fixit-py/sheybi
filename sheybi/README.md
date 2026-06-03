# Sheybi

Minimal prediction-market prototype:

- `sheybi/backend`: Flask API + SQLite persistence
- `sheybi/frontend`: Next.js UI
- `sheybi/market.py`: market engine

## Prereqs

- Python 3.12+ (tested here with 3.14)
- Node.js 20+ and npm

## Backend setup (Flask + SQLite)

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r sheybi/backend/requirements.txt
python3 -m backend.app
<<<<<<< HEAD
```c
=======
```
>>>>>>> 3613ac8137b3fb5500fa2928c6336a8c6dea6e7e

By default the backend uses SQLite at `sheybi/backend/app.sqlite3`.

### Backend env vars

The backend reads `sheybi/backend/.env` (via `python-dotenv`) and also respects exported env vars.

- `SHEYBI_SQLITE_PATH` (optional): override SQLite path

#### Dev auth (fast local testing, bypass Clerk)

The backend currently defaults to dev auth when starting `backend.app`:

- `DEV_AUTH=1`
- `ADMIN_USER_IDS=dev_admin`

In dev auth mode, requests can authenticate via headers instead of Clerk JWTs:

- `X-Dev-User-Id: dev_alice`
- `X-Dev-User-Name: Alice` (optional, used for orderbook display names)

Never enable dev auth in production.

#### Clerk auth (if you turn dev auth off)

If you disable dev auth, the backend expects `Authorization: Bearer <Clerk JWT>` and needs:

- `CLERK_ISSUER` (recommended), e.g. `https://<your-instance>.clerk.accounts.dev`
- `CLERK_JWKS_URL` (optional override, otherwise derived from issuer)
- `CLERK_AUDIENCE` (optional)

## Frontend setup (Next.js)

```bash
cd sheybi/frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:3000` by default and proxies API calls to the backend at `http://localhost:5000` via Next rewrites (`/api/flask/*`).

### Frontend env vars

Create `sheybi/frontend/.env.local` as needed.

- `BACKEND_URL` (optional): defaults to `http://localhost:5000`
- `ADMIN_USER_IDS` (optional): comma-separated allowlist for `/admin` routing in the UI

If you want Clerk sign-in/up in the UI, also set:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

## Load testing (100–1000 users quickly)

1) Start backend: `python3 -m backend.app`
2) Run:

```bash
python3 sheybi/load_test_market.py --users 1000 --ops-per-user 10 --threads 100 --duration-min 10
```

Then open the UI and the newest market should auto-appear and auto-update.

