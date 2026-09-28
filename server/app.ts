import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { authRoutes, inviteGate } from './auth.ts';
import type { Db } from './db.ts';
import { createNominatim } from './nominatim.ts';

export type Config = {
  webRoot: string;
  inviteCode: string;
  pinPepper: string;
  /** Minimum gap between Nominatim requests; its usage policy allows at most one per second. */
  geocodeIntervalMs: number;
};

export type Deps = {
  db: Db;
  config: Config;
  fetch: typeof fetch;
  now: () => number;
};

export function createApp(deps: Deps) {
  const { db, config } = deps;
  const nominatim = createNominatim(db, deps.fetch, config.geocodeIntervalMs);
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));
  app.use('*', inviteGate(config.inviteCode));

  app.route('/api', authRoutes(deps, nominatim));
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  app.use('/*', serveStatic({ root: config.webRoot }));
  app.get('*', serveStatic({ root: config.webRoot, path: 'index.html' }));

  return app;
}
