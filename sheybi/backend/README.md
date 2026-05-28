# Backend (Flask API)

Auth has been intentionally removed for now. This backend currently exposes only:

- `GET /health`

## Market API (in-memory)
- `POST /api/markets` `{ start, close }` (ISO8601; e.g. `2026-05-28T12:00:00Z`)
- `GET /api/markets`
- `GET /api/markets/<id>`
- `POST /api/markets/<id>/buy` `{ user, side: YES|NO, amount, t? }`
- `POST /api/markets/<id>/sell` `{ user, side: YES|NO, shares, t? }`
- `POST /api/markets/<id>/resolve` `{ outcome: YES|NO }`

## Install
`pip install -r backend/requirements.txt`

## Run
`python -m backend.app`
