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
`pip install -r backend/requirements.txt`

## Run
`python -m backend.app`


oi installed cors flask cause i was getiting cros browswer issue 
installed pip install python-dotenv

basiclly i think i am done with adding auth, rub npm run dev for the froneend, and also run phyton app.py for the backend and we are golden then. so continue from stone xoxo