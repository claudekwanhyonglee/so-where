import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { Db } from './db.ts';

export type Config = {
  webRoot: string;
};

export type Deps = {
  db: Db;
  config: Config;
};

export function createApp({ config }: Deps) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.use('/*', serveStatic({ root: config.webRoot }));
  app.get('*', serveStatic({ root: config.webRoot, path: 'index.html' }));

  return app;
}
