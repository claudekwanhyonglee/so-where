import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { authRoutes, inviteGate, requirePerson, type AppEnv } from './auth.ts';
import type { Db } from './db.ts';
import { createNominatim } from './nominatim.ts';
import { guideRoutes } from './guide.ts';
import { geocodeRoutes } from './photon.ts';
import { createPlaceLookup } from './place-lookup.ts';
import { placesRoutes } from './places.ts';
import { sessionsRoutes } from './sessions.ts';
import { setsRoutes } from './sets.ts';
import { importRoutes } from './takeout.ts';

export type Config = {
  webRoot: string;
  inviteCode: string;
  pinPepper: string;
  /** Minimum gap between Nominatim requests; its usage policy allows at most one per second. */
  geocodeIntervalMs: number;
  /** How many sessions are kept; creating one beyond this deletes the oldest. */
  maxSessions: number;
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
  const placeLookup = createPlaceLookup(db, nominatim);
  const app = new Hono<AppEnv>();

  app.get('/health', (c) => c.json({ ok: true }));
  app.use('*', inviteGate(config.inviteCode));

  app.route('/api', authRoutes(deps));
  app.use('/api/*', requirePerson(db));
  app.route('/api/places', placesRoutes(deps, nominatim));
  app.route('/api/import', importRoutes(deps, placeLookup));
  app.route('/api/sets', setsRoutes(deps));
  app.route('/api/sessions', sessionsRoutes(deps));
  app.route('/api/geocode', geocodeRoutes(deps));
  app.route('/api/guide', guideRoutes(deps));
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  app.use('/*', serveStatic({ root: config.webRoot }));
  app.get('*', serveStatic({ root: config.webRoot, path: 'index.html' }));

  void placeLookup.start(); // resume lookups left over from before a restart

  /** Resolves once background work (locating imported places) has finished. */
  const idle = () => placeLookup.idle();
  return Object.assign(app, { idle });
}
