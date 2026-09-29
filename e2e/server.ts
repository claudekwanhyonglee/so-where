// The real app, wired to a throwaway database and fake external services, for Playwright.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '../server/app.ts';
import { openDb } from '../server/db.ts';
import { fakeFetch, fakeNominatim, fakePhoton, fakeTransitous } from '../server/test-helpers.ts';
import { INVITE } from './helpers.ts';

const db = openDb(join(mkdtempSync(join(tmpdir(), 'so-where-e2e-')), 'e2e.db'));

const externals = fakeFetch(
  fakeNominatim({ '1 Pretend St, Carlton': { lat: -37.79, lng: 144.97 } }),
  (url) => (url.hostname === 'photon.komoot.io' && url.searchParams.get('q')?.includes('Unreachable') ? new Response('down', { status: 503 }) : undefined),
  fakePhoton([
    {
      lat: -37.7991,
      lng: 144.9671,
      properties: { housenumber: '1', street: 'Pretend Street', district: 'Carlton', city: 'Melbourne', state: 'Victoria', country: 'Australia' },
    },
    { lat: -37.85, lng: 144.99, properties: { housenumber: '5', street: 'Pretend Road', district: 'Windsor', city: 'Melbourne', state: 'Victoria', country: 'Australia' } },
  ]),
  fakeTransitous([1500]), // every trip: 25 minutes
);

const app = createApp({
  db,
  config: { webRoot: 'dist/web', inviteCode: INVITE, pinPepper: 'e2e-pepper', geocodeIntervalMs: 0, maxSessions: 1000 }, // high: parallel tests each start sessions
  fetch: externals,
  now: Date.now,
});

serve({ fetch: app.fetch, port: Number(process.env.PORT) });
