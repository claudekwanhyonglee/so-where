import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { configFromEnv } from './config.ts';
import { openDb } from './db.ts';

let config;
try {
  config = configFromEnv();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const db = openDb(config.databasePath);
const app = createApp({ db, config, fetch, now: Date.now });

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`so-where listening on http://localhost:${port}`);
});
