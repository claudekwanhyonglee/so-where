import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate, migrations } from './db.ts';
import { device, signedInDevice, testApp } from './test-helpers.ts';

const me = async (d: Awaited<ReturnType<typeof signedInDevice>>) => (await d.get('/api/me')).json();

describe('#37 + epic: first-run columns on people', () => {
  it('records when a person was created, and starts with home not skipped', async () => {
    const { app, db } = testApp({ now: () => 1_700_000_000_000 });
    await signedInDevice(app, 'Alex');
    expect(db.prepare('SELECT created_at, home_skipped, guide_closed FROM people').get()).toEqual({ created_at: 1_700_000_000_000, home_skipped: 0, guide_closed: 0 });
  });

  it('closes the guide for everyone who already exists when the migration runs', () => {
    const db = new Database(':memory:');
    migrate(db, migrations.slice(0, -1));
    db.prepare("INSERT INTO people (name, pin_hash) VALUES ('Old timer', 'x')").run();
    migrate(db);
    expect(db.prepare('SELECT created_at, home_skipped, guide_closed FROM people').get()).toEqual({ created_at: 0, home_skipped: 0, guide_closed: 1 });
  });
});

describe('#37 AC3: skipping home at sign-up is recorded', () => {
  it('POST /api/me/skip-home marks home skipped, and /me says so', async () => {
    const { app } = testApp();
    const alex = await signedInDevice(app, 'Alex');
    expect((await me(alex)).homeSkipped).toBe(false);
    expect((await alex.post('/api/me/skip-home')).status).toBe(200);
    expect(await me(alex)).toMatchObject({ home: null, homeSkipped: true });
  });

  it('needs a signed-in person', async () => {
    const { app } = testApp();
    expect((await device(app).post('/api/me/skip-home')).status).toBe(401);
  });
});
