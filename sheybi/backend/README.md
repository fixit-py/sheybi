# Backend

Flask API that now persists app data in InstantDB instead of SQLite.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r sheybi/backend/requirements.txt
```

## Run

```bash
python3 -m backend.app
```

## Required env

Set these in `backend/.env` or your shell:

- `INSTANT_APP_ID`
- `INSTANT_ADMIN_TOKEN`

## Auth env

The Flask API expects a Clerk session JWT in `Authorization: Bearer <token>`.

Set at least one of:

- `CLERK_ISSUER` or
- `CLERK_JWKS_URL`

Optional:

- `CLERK_AUDIENCE`

## Dev auth

For local testing only, you can bypass Clerk verification:

- `DEV_AUTH` set to a truthy value
- `X-Dev-User-Id: dev_alice`
- `X-Dev-User-Name: Alice` optional

Never enable dev auth in production.

Dev auth is disabled by default and must be enabled explicitly with a truthy `DEV_AUTH` value.

## Simulation

You can run a synthetic market test that creates a `tester` market, generates synthetic users, and writes a JSONL log:

```bash
python3 -m backend.simulate_market --trades 300 --users 1000 --log-file backend/logs/tester_simulation.jsonl
```

Batch runs with a single merged CSV audit:

```bash
python3 -m backend.simulate_market --runs 5 --seed-start 100 --trades-min 100 --trades-max 1000 --mode adversarial --csv backend/logs/tester_audit.csv
```

The merged audit CSV includes one row per summary, trade, and resolution event. It contains:

- summary rows for each run
- trade rows with ask/bid/executed price, fee, wallet, and reserve movement
- resolution rows with gross resolve price, net resolve price, payout, and user P/L

The simulator logs:

- every accepted trade
- every rejected trade
- market risk/cap snapshots after each trade
- scenario summaries for each possible winning option
- a final platform/user P/L summary
- batch summaries across seeds when `--runs` is greater than 1

The simulator expects the same Instant env vars as the backend:

- `INSTANT_APP_ID`
- `INSTANT_ADMIN_TOKEN`
