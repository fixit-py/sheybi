# Sheybi

Minimal prediction-market prototype:

- `sheybi/backend`: Flask API that now persists into InstantDB
- `sheybi/frontend`: Next.js UI with Clerk auth and InstantDB session sync
- `sheybi/market.py`: market engine

## Prereqs

- Python 3.12+ (tested here with 3.14)
- Node.js 20+ and npm

## Backend setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r sheybi/backend/requirements.txt
python3 -m backend.app
```

### Backend env vars

- `INSTANT_APP_ID`
- `INSTANT_ADMIN_TOKEN`
- `CLERK_ISSUER` or `CLERK_JWKS_URL`
- `CLERK_AUDIENCE` optional
- `DEV_AUTH=1` optional for local testing only

## Frontend setup

```bash
cd sheybi/frontend
npm install
npm run dev
```

### Frontend env vars

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_INSTANT_APP_ID`
- `NEXT_PUBLIC_INSTANT_CLERK_CLIENT_NAME` optional, defaults to `sheybi`
