# so-where

"Where should we eat?" "You decide." — so-where settles it. Everyone ranks your shared restaurant list with quick
this-or-that picks on their own phone or laptop, and a live leaderboard shows each person's ranking and a combined one.

Self-hosted, one group per instance, no accounts, no paid services, no API keys.

- Add restaurants by pasting a Google Maps link, or import your saved lists from Google Takeout.
- Group them into sets ("Date night"), start a session, share the link, and pick.
- Each card shows your public transport time from home (via [Transitous](https://transitous.org)).

## Run it

You need Docker. Put these two files in a folder:

`docker-compose.yml`

```yaml
services:
  so-where:
    image: ghcr.io/claudekwanhyonglee/so-where:latest
    env_file: .env
    ports:
      - "3000:3000" # change the left number to use another port
    volumes:
      - so-where-data:/data
    restart: unless-stopped

volumes:
  so-where-data:
```

`.env`

```sh
# Share links carry this (?invite=...). Without it, nothing is accessible.
INVITE_CODE=pick-something-long-and-random
# Mixed into every stored PIN hash. Generate with: openssl rand -hex 32. Keep it safe; don't change it.
PIN_PEPPER=paste-the-output-of-openssl-rand-hex-32
```

Then:

```sh
docker compose up -d
```

Open `http://localhost:3000/?invite=<INVITE_CODE>` and share that link with your group. Each person picks a name and
a 4-digit PIN, and can then sign in on any other device by choosing their name.

The SQLite database lives in the `so-where-data` volume and is migrated automatically on start. `GET /health` returns
200 when the app is up. To update: `docker compose pull && docker compose up -d`.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example) for the full list. The app won't start
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
cp .env.example .env              # and fill it in
npm run build && npm start        # API + built frontend on :3000
npm run dev                       # Vite dev server with hot reload, proxying /api to :3000
```

`docker compose up --build` with the repo's own `docker-compose.yml` builds the image from source.

## Tests

```sh
npm test            # unit + API tests (Vitest)
npm run test:e2e    # builds the frontend, then runs the browser tests (Playwright)
npm run typecheck
```

Tests never call real external services; they are faked. CI runs all three on every push and pull request, and
pushing a `v*` tag publishes the image to `ghcr.io`.
