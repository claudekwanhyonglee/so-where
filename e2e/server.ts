// The real app, wired to a throwaway database and fake external services, for Playwright.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '../server/app.ts';
import { openDb } from '../server/db.ts';
import { fakeFetch, fakeNominatim } from '../server/test-helpers.ts';
import { INVITE } from './helpers.ts';

const db = openDb(join(mkdtempSync(join(tmpdir(), 'so-where-e2e-')), 'e2e.db'));

const externals = fakeFetch(fakeNominatim({ '1 Lygon St, Carlton': { lat: -37.7983, lng: 144.9669 } }));

const app = createApp({
  db,
  config: { webRoot: 'dist/web', inviteCode: INVITE, pinPepper: 'e2e-pepper', geocodeIntervalMs: 0 },
  fetch: externals,
  now: Date.now,
});

serve({ fetch: app.fetch, port: Number(process.env.PORT) });
