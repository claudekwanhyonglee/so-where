# so-where

"Where should we eat?" "You decide." — so-where settles it. Everyone ranks your shared restaurant list with quick
this-or-that picks on their own phone or laptop, and a live leaderboard shows each person's ranking and a combined one.

Self-hosted, one group per instance, no accounts, no paid services.

## Run it

You need Docker.

```sh
cp .env.example .env   # then edit .env
docker compose up -d
```

Open http://localhost:3000. The SQLite database lives in the `so-where-data` Docker volume and is migrated
automatically on start. `GET /health` returns 200 when the app is up.

Share `http://<your-host>:3000/?invite=<INVITE_CODE>` with your group. Each person picks a name and a 4-digit PIN,
and can then sign in on any other device by choosing their name.

## Configuration

All settings are environment variables, read from `.env`. See `.env.example` for the full list. The app won't start
without `INVITE_CODE` and `PIN_PEPPER`.

## About the PINs

The PIN is a **light lock** to keep friends out of each other's rankings, not real security. It's rate limited
(5 wrong tries lock that name for 15 minutes) and stored as a scrypt hash mixed with `PIN_PEPPER`, so the database on
its own is useless. But whoever has both the database and `.env` could recover a 4-digit PIN. Don't reuse a bank or
phone PIN.

Forgot your PIN? Change it from any device you're still signed in on, or ask the server owner to run:

```sh
docker compose exec so-where reset-pin <name>
```

It prints a new PIN and lifts any lockout.

## Development

Node 24 or newer (the server runs TypeScript directly).

```sh
npm install
npx playwright install chromium   # once, for the browser tests
npm start                          # API + built frontend on :3000 (run `npm run build` first)
npm run dev                        # Vite dev server with hot reload, proxying /api to :3000
```

## Tests

```sh
npm test            # unit + API tests (Vitest)
npm run test:e2e    # builds the frontend, then runs the browser tests (Playwright)
npm run typecheck
```

Tests never call real external services; they are faked.
