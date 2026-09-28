<h1 align="center">So Where?</h1>

<p align="center">Rank your restaurant list together, one this-or-that pick at a time.</p>

"Where should we eat?" "You decide." Open it on your own phone, tap whichever of two places you'd rather go to, and a live leaderboard shows everyone's ranking and a combined one. You make the final call; it just makes the call easy.

## Run it

It's self-hosted: one small Docker container for your group, with no accounts, no paid services and no API keys. Put these two files in a folder:

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

Then run `docker compose up -d`, open `http://localhost:3000/?invite=<INVITE_CODE>` and share that link with your group. To update: `docker compose pull && docker compose up -d`.

Your data lives in the `so-where-data` volume. [`.env.example`](.env.example) lists every setting.

## About this project

So Where? is a personal project built almost entirely by AI agents. I decided on the design, feel, and features, and the agents wrote the tests and code with full autonomy over the technical decisions. So treat it as you would any hobby project, not audited software.

## Picking

- **This or that.** Two places side by side (stacked on a phone). Tap the one you'd rather, or *Too close to call*.
- **Smart pairs.** It hunts for your top 5 rather than ordering the whole list, while still giving every place a fair look, so a good one can't get stuck at the bottom unseen.
- **Cravings count.** Your rankings carry over between sessions, but each new session starts loose, so tonight's mood moves things fast.
- **Absolutely not.** Rule a place out for tonight. It gets a stamp everyone can see, and it's back next time.
- **Live leaderboard.** Everyone's ranking, plus a combined one that flags places in someone's bottom third.
- **Getting there.** Each card shows your public transport time from home, leaving now (via [Transitous](https://transitous.org)), and opens in Google Maps.

## Places

- **Paste a link.** Share a place from Google Maps and paste the link, short or full.
- **Import from Google Takeout.** Upload your saved lists (CSVs) and starred places (`Saved Places.json`). Each list becomes a set, and re-importing only adds what's new.
- **Sets.** Group places into sets like *Date night*. *All places* always has everything.

## Names and PINs

Everyone picks a name and a 4-digit PIN, then signs in on any other device by choosing their name. The PIN is a light lock to keep friends out of each other's rankings, not real security: whoever has both the database and `.env` could recover it. Don't reuse a bank or phone PIN.

Forgot it? Change it from a device you're still signed in on, or have the server owner run `docker compose exec so-where reset-pin <name>`.

## Development

Needs Node.js 24.

```sh
npm ci
npx playwright install chromium   # once, for the browser tests
cp .env.example .env              # and fill it in
npm run build && npm start        # the app on :3000
npm run dev                       # hot reload, proxying /api to :3000
npm test                          # unit + API tests (Vitest)
npm run test:e2e                  # browser tests (Playwright)
```

Tests never call real external services. `docker compose up --build` with the repo's own `docker-compose.yml` builds the image from source, and pushing a `v*` tag publishes it to ghcr.io.

## License

[MIT](LICENSE)
