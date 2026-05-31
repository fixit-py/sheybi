# Backend (Flask API)

Auth has been intentionally removed for now. This backend currently exposes only:

added auth.p and all api routes are guided with auth.py

current Flask storage: markets: dict[str, Market] = {}
 we would have to checge this to use instantdb 

So eventually you’ll replace it to: markets[market_id] = Market(...)
create market in InstantDB
fetch market from InstantDB
persist trades there

## Install
```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r sheybi/backend/requirements.txt
```

## Run
`python3 -m backend.app`

## SQLite
By default the backend stores data in `sheybi/backend/app.sqlite3`.

Override with:
- `SHEYBI_SQLITE_PATH=/absolute/or/relative/path.sqlite3`

## Auth env
The Flask API expects a Clerk session JWT in `Authorization: Bearer <token>`.

Set at least one of:
- `CLERK_ISSUER` (recommended): used to build the JWKS URL at `/.well-known/jwks.json`
- `CLERK_JWKS_URL`: override if your issuer doesn't expose JWKS at the well-known path

Optional:
- `CLERK_AUDIENCE`: if you use an audience template for your backend tokens

## Dev auth (bypass Clerk)
For local testing only, you can bypass Clerk verification:
- set `DEV_AUTH=1`
- send `X-Dev-User-Id: dev_alice` (and optionally `X-Dev-User-Name: Alice`)

Never enable this in production.

### Load test
To simulate 100–1000 users quickly without the UI:
- start the backend with `DEV_AUTH=1` and `ADMIN_USER_IDS=dev_admin`
- run `python3 sheybi/load_test_market.py --users 1000 --ops-per-user 10 --threads 100`


oi installed cors flask cause i was getiting cros browswer issue 
installed pip install python-dotenv

basiclly i think i am done with adding auth, rub npm run dev for the froneend, and also run phyton app.py for the backend and we are golden then. so continue from stone xoxo
