import { spawnSync } from 'node:child_process';
import { createHash, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { configFromEnv } from './config.ts';
import { openDb } from './db.ts';
import { createNominatim } from './nominatim.ts';
import { hashPin, verifyPin } from './pin.ts';
import { resetPin } from './reset-pin.ts';
import { device, fakeFetch, fakeNominatim, INVITE, signedInDevice, testApp } from './test-helpers.ts';

describe('#3 AC1: no access without the invite code', () => {
  it('refuses pages and API calls without the invite', async () => {
    const { app } = testApp();
    const stranger = device(app, { invited: false });
    for (const path of ['/', '/some/page', '/api/me', '/api/people']) {
      const res = await stranger.get(path);
      expect(res.status, path).toBe(403);
      expect(await res.text()).toMatch(/no access/i);
    }
    expect((await stranger.post('/api/people', { name: 'X', pin: '1234' })).status).toBe(403);
  });

  it('refuses a wrong invite code', async () => {
    const { app } = testApp();
    const res = await device(app, { invited: false }).get('/?invite=guess');
    expect(res.status).toBe(403);
  });

  it('a share link carrying the invite lets the device in and remembers it', async () => {
    const { app } = testApp();
    const friend = device(app, { invited: false });
    const res = await friend.get(`/s/abc?invite=${INVITE}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/s/abc');
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    expect((await friend.get('/api/people')).status).toBe(200);
  });

  it('keeps /health open for container health checks', async () => {
    const { app } = testApp();
    expect((await device(app, { invited: false }).get('/health')).status).toBe(200);
  });

  it('refuses to start without INVITE_CODE', () => {
    expect(() => configFromEnv({ PIN_PEPPER: 'p' })).toThrow(/INVITE_CODE/);
  });
});

describe('#3 AC2: a new person picks a name and PIN and stays signed in', () => {
  it('creates the person and signs this device in', async () => {
    const { app } = testApp();
    const phone = device(app);
    expect((await phone.get('/api/me')).status).toBe(401);
    const res = await phone.post('/api/people', { name: 'Alex', pin: '1234' });
    expect(res.status).toBe(201);
    const me = await (await phone.get('/api/me')).json();
    expect(me.name).toBe('Alex');
  });

  it('rejects a PIN that is not exactly 4 digits, and a taken name', async () => {
    const { app } = testApp();
    for (const pin of ['123', '12345', 'abcd', '']) {
      expect((await device(app).post('/api/people', { name: 'Sam', pin })).status, pin).toBe(400);
    }
    expect((await device(app).post('/api/people', { name: '  ', pin: '1234' })).status).toBe(400);
    await signedInDevice(app, 'Alex');
    expect((await device(app).post('/api/people', { name: 'alex', pin: '9999' })).status).toBe(409);
  });

  it('lists existing names for choosing on another device', async () => {
    const { app } = testApp();
    await signedInDevice(app, 'Alex');
    await signedInDevice(app, 'Jo');
    const people = await (await device(app).get('/api/people')).json();
    expect(people.map((p: { name: string }) => p.name)).toEqual(['Alex', 'Jo']);
  });
});

describe('#3 AC3: signing in on another device', () => {
  it('the correct PIN signs the device in as the same person', async () => {
    const { app } = testApp();
    const phone = await signedInDevice(app, 'Alex', '1234');
    const laptop = device(app);
    expect((await laptop.post('/api/signin', { name: 'Alex', pin: '1234' })).status).toBe(200);
    const [a, b] = await Promise.all([phone.get('/api/me'), laptop.get('/api/me')].map(async (r) => (await r).json()));
    expect(b.id).toBe(a.id);
  });

  it('a wrong PIN is rejected', async () => {
    const { app } = testApp();
    await signedInDevice(app, 'Alex', '1234');
    const laptop = device(app);
    expect((await laptop.post('/api/signin', { name: 'Alex', pin: '4321' })).status).toBe(401);
    expect((await laptop.get('/api/me')).status).toBe(401);
  });
});

describe('#3 AC4: 5 wrong PINs lock the name for 15 minutes', () => {
  it('refuses even the correct PIN while locked, then allows it after 15 minutes', async () => {
    let clock = 1_000_000;
    const { app } = testApp({ now: () => clock });
    await signedInDevice(app, 'Alex', '1234');
    const attacker = device(app);
    for (let i = 0; i < 5; i++) {
      expect((await attacker.post('/api/signin', { name: 'Alex', pin: '0000' })).status).toBe(401);
    }
    const locked = await attacker.post('/api/signin', { name: 'Alex', pin: '1234' });
    expect(locked.status).toBe(429);

    clock += 14 * 60_000;
    expect((await attacker.post('/api/signin', { name: 'Alex', pin: '1234' })).status).toBe(429);
    clock += 60_000 + 1;
    expect((await attacker.post('/api/signin', { name: 'Alex', pin: '1234' })).status).toBe(200);
  });

  it('only locks that name', async () => {
    const { app } = testApp();
    await signedInDevice(app, 'Alex', '1234');
    await signedInDevice(app, 'Jo', '5678');
    const d = device(app);
    for (let i = 0; i < 5; i++) await d.post('/api/signin', { name: 'Alex', pin: '0000' });
    expect((await d.post('/api/signin', { name: 'Jo', pin: '5678' })).status).toBe(200);
  });
});

describe('#3 AC5: PINs are stored only as a peppered scrypt hash', () => {
  it('the database holds neither the PIN nor an unpeppered hash', async () => {
    const { app, db } = testApp();
    await signedInDevice(app, 'Alex', '4821');
    const row = db.prepare('SELECT * FROM people').get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain('4821');
    const [salt, hash] = String(row.pin_hash).split(':');
    const unpeppered = scryptSync('4821', Buffer.from(salt, 'hex'), 32).toString('hex');
    expect(hash).not.toBe(unpeppered);
  });

  it('a stored hash cannot be verified without the right pepper', async () => {
    const stored = await hashPin('4821', 'server-secret');
    expect(await verifyPin('4821', stored, 'server-secret')).toBe(true);
    expect(await verifyPin('4821', stored, 'other-secret')).toBe(false);
    expect(await verifyPin('4822', stored, 'server-secret')).toBe(false);
  });

  it('the app refuses to start without PIN_PEPPER', () => {
    expect(() => configFromEnv({ INVITE_CODE: 'x' })).toThrow(/PIN_PEPPER/);
    const run = spawnSync(process.execPath, ['server/index.ts'], {
      env: { PATH: process.env.PATH, INVITE_CODE: 'x', DATABASE_PATH: ':memory:' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/PIN_PEPPER/);
  });
});

describe('#3 AC6: device sessions', () => {
  it('uses a random HttpOnly cookie token, stored only hashed', async () => {
    const { app, db } = testApp();
    const phone = device(app);
    const res = await phone.post('/api/people', { name: 'Alex', pin: '1234' });
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sw_session='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    const token = phone.jar.get('sw_session')!;
    expect(token.length).toBeGreaterThanOrEqual(32);
    const stored = db.prepare('SELECT token_hash FROM device_sessions').pluck().all();
    expect(stored).toEqual([createHash('sha256').update(token).digest('hex')]);
  });

  it('signing out invalidates the token server-side', async () => {
    const { app } = testApp();
    const phone = await signedInDevice(app);
    const token = phone.jar.get('sw_session')!;
    expect((await phone.post('/api/signout')).status).toBe(200);
    expect((await phone.get('/api/me')).status).toBe(401);
    const replay = device(app);
    replay.jar.set('sw_session', token);
    expect((await replay.get('/api/me')).status).toBe(401);
  });
});

describe('#3 AC7: changing and resetting a PIN', () => {
  it('a signed-in person can change their PIN', async () => {
    const { app } = testApp();
    const phone = await signedInDevice(app, 'Alex', '1234');
    expect((await phone.put('/api/me/pin', { pin: '12' })).status).toBe(400);
    expect((await phone.put('/api/me/pin', { pin: '8642' })).status).toBe(200);
    expect((await device(app).post('/api/signin', { name: 'Alex', pin: '1234' })).status).toBe(401);
    expect((await device(app).post('/api/signin', { name: 'Alex', pin: '8642' })).status).toBe(200);
  });

  it('reset-pin sets a new PIN for a locked-out person and lifts the lock', async () => {
    const { app, db, config } = testApp();
    await signedInDevice(app, 'Alex', '1234');
    for (let i = 0; i < 5; i++) await device(app).post('/api/signin', { name: 'Alex', pin: '0000' });

    const newPin = await resetPin(db, 'alex', config.pinPepper);
    expect(newPin).toMatch(/^\d{4}$/);
    expect((await device(app).post('/api/signin', { name: 'Alex', pin: newPin })).status).toBe(200);
  });

  it('reset-pin fails clearly for an unknown name', async () => {
    const { db, config } = testApp();
    await expect(resetPin(db, 'Nobody', config.pinPepper)).rejects.toThrow(/No person called "Nobody"/);
  });
});

describe('#3 AC8: home address', () => {
  it('saves the chosen address, and it can be changed', async () => {
    const { app } = testApp();
    const phone = await signedInDevice(app);

    expect((await phone.put('/api/me/home', { address: '1 Pretend St, Carlton', lat: -37.8, lng: 144.97 })).status).toBe(200);
    expect((await (await phone.get('/api/me')).json()).home).toEqual({ address: '1 Pretend St, Carlton', lat: -37.8, lng: 144.97 });

    expect((await phone.put('/api/me/home', { address: '5 Madeup Rd, Windsor', lat: -37.85, lng: 144.99 })).status).toBe(200);
    expect((await (await phone.get('/api/me')).json()).home).toEqual({ address: '5 Madeup Rd, Windsor', lat: -37.85, lng: 144.99 });
  });

  it('calls Nominatim with an identifying User-Agent and caches results', async () => {
    const calls: { url: string; ua: string | null }[] = [];
    const fake = fakeNominatim({ '1 Pretend St, Carlton': { lat: -37.8, lng: 144.97 } });
    const nominatim = createNominatim(
      openDb(':memory:'),
      fakeFetch((url, init) => {
        calls.push({ url: url.href, ua: new Headers(init?.headers).get('user-agent') });
        return fake(url, init);
      }),
      0,
    );
    expect(await nominatim.search('1 Pretend St, Carlton')).toEqual({ lat: -37.8, lng: 144.97 });
    expect(await nominatim.search('1 Pretend St, Carlton')).toEqual({ lat: -37.8, lng: 144.97 });
    expect(calls).toHaveLength(1);
    expect(calls[0].ua).toMatch(/so-where/);
  });
});
