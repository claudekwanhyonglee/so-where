import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { configFromEnv } from './config.ts';
import { openDb } from './db.ts';

const config = configFromEnv();
const db = openDb(config.databasePath);
const app = createApp({ db, config });

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`so-where listening on http://localhost:${port}`);
});
