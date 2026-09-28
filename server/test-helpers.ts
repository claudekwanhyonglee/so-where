import { createApp, type Config } from './app.ts';
import { openDb } from './db.ts';

export function testApp(overrides: Partial<Config> = {}) {
  const db = openDb(':memory:');
  const config: Config = { webRoot: 'dist/web', ...overrides };
  const app = createApp({ db, config });
  return { app, db, config };
}
