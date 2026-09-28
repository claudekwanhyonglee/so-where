// The real app, wired to a throwaway database, for Playwright.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '../server/app.ts';
import { openDb } from '../server/db.ts';

const db = openDb(join(mkdtempSync(join(tmpdir(), 'so-where-e2e-')), 'e2e.db'));
const app = createApp({ db, config: { webRoot: 'dist/web' } });

serve({ fetch: app.fetch, port: Number(process.env.PORT) });
