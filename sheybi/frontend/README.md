# Frontend

Next.js app with Clerk authentication and InstantDB session sync.

## Required env

Create `frontend/.env.local` with:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
NEXT_PUBLIC_INSTANT_APP_ID=...
NEXT_PUBLIC_INSTANT_CLERK_CLIENT_NAME=sheybi
```

The Flask backend also needs:

```bash
INSTANT_APP_ID=...
INSTANT_ADMIN_TOKEN=...
```

## Run

```bash
npm install
npm run dev
```

## Auth flow

- `/sign-in` and `/sign-up` use Clerk hosted components.
- After sign-in, users are redirected to `/user`.
- When a Clerk session exists, the app syncs that identity into InstantDB with `db.auth.signInWithIdToken()`.

## Database note

The frontend is now set up to use InstantDB for realtime data access, and the Flask backend writes market and profile data directly into InstantDB.
