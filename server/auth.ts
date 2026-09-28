import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Hono } from 'hono';
import type { Deps } from './app.ts';
import type { Nominatim } from './nominatim.ts';
import { hashPin, isValidPin, verifyPin } from './pin.ts';

export type Person = { id: number; name: string; home_address: string | null; home_lat: number | null; home_lng: number | null };
export type AppEnv = { Variables: { person: Person } };

const INVITE_COOKIE = 'sw_invite';
const SESSION_COOKIE = 'sw_session';
const MAX_WRONG_PINS = 5;
const LOCK_MS = 15 * 60_000;
const COOKIE_MAX_AGE = 400 * 24 * 3600; // the longest browsers allow

// Not `Secure`: hosting and HTTPS are up to whoever runs the instance, and Secure cookies break plain-HTTP LAN use.
const cookieOptions = { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: COOKIE_MAX_AGE } as const;

const sameSecret = (a: string, b: string) => {
  const [x, y] = [createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest()];
  return timingSafeEqual(x, y);
};

const noAccess = (c: Context) =>
  c.req.path.startsWith('/api/')
    ? c.json({ error: 'No access. Ask for the invite link.' }, 403)
    : c.html(
        '<!doctype html><meta name="viewport" content="width=device-width"><title>So Where?</title>' +
          '<body style="font-family:system-ui;padding:2rem"><h1>No access</h1><p>Ask whoever runs this for the invite link.</p>',
        403,
      );

/** Everything behind this needs the invite code: from a share link's `?invite=`, then remembered in a cookie. */
export function inviteGate(inviteCode: string): MiddlewareHandler {
  return async (c, next) => {
    const offered = c.req.query('invite');
    if (offered !== undefined) {
      if (!sameSecret(offered, inviteCode)) return noAccess(c);
      setCookie(c, INVITE_COOKIE, inviteCode, cookieOptions);
      const url = new URL(c.req.url);
      url.searchParams.delete('invite');
      return c.redirect(url.pathname + url.search, 302);
    }
    const remembered = getCookie(c, INVITE_COOKIE);
    if (!remembered || !sameSecret(remembered, inviteCode)) return noAccess(c);
    await next();
  };
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export function currentPerson(db: Deps['db'], c: Context): Person | undefined {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return undefined;
  return db
    .prepare(
      `SELECT p.id, p.name, p.home_address, p.home_lat, p.home_lng
       FROM device_sessions s JOIN people p ON p.id = s.person_id WHERE s.token_hash = ?`,
    )
    .get(tokenHash(token)) as Person | undefined;
}

export const requirePerson =
  (db: Deps['db']): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const person = currentPerson(db, c);
    if (!person) return c.json({ error: 'Sign in first.' }, 401);
    c.set('person', person);
    await next();
  };

export function authRoutes({ db, config, now }: Deps, nominatim: Nominatim) {
  const api = new Hono<AppEnv>();

  function signInDevice(c: Context, personId: number) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO device_sessions (token_hash, person_id, created_at) VALUES (?, ?, ?)').run(tokenHash(token), personId, now());
    setCookie(c, SESSION_COOKIE, token, cookieOptions);
  }

  api.get('/people', (c) => c.json(db.prepare('SELECT id, name FROM people ORDER BY name').all()));

  api.post('/people', async (c) => {
    const { name, pin } = await c.req.json();
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > 40) return c.json({ error: 'Pick a name (up to 40 characters).' }, 400);
    if (!isValidPin(pin)) return c.json({ error: 'The PIN must be exactly 4 digits.' }, 400);
    if (db.prepare('SELECT 1 FROM people WHERE name = ?').get(trimmed)) {
      return c.json({ error: `"${trimmed}" is taken. If that's you, sign in instead.` }, 409);
    }
    const { lastInsertRowid } = db.prepare('INSERT INTO people (name, pin_hash) VALUES (?, ?)').run(trimmed, await hashPin(pin, config.pinPepper));
    signInDevice(c, Number(lastInsertRowid));
    return c.json({ id: Number(lastInsertRowid), name: trimmed }, 201);
  });

  api.post('/signin', async (c) => {
    const { name, pin } = await c.req.json();
    const person = db.prepare('SELECT id, pin_hash, failed_pins, locked_until FROM people WHERE name = ?').get(String(name ?? '').trim()) as
      | { id: number; pin_hash: string; failed_pins: number; locked_until: number }
      | undefined;
    if (!person) return c.json({ error: 'No one by that name.' }, 401);
    if (person.locked_until > now()) {
      const minutes = Math.ceil((person.locked_until - now()) / 60_000);
      return c.json({ error: `Too many wrong PINs. Try again in ${minutes} min.` }, 429);
    }
    if (!isValidPin(pin) || !(await verifyPin(pin, person.pin_hash, config.pinPepper))) {
      const failed = person.failed_pins + 1;
      const lock = failed >= MAX_WRONG_PINS;
      db.prepare('UPDATE people SET failed_pins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock ? now() + LOCK_MS : 0, person.id);
      return c.json({ error: 'Wrong PIN.' }, 401);
    }
    db.prepare('UPDATE people SET failed_pins = 0 WHERE id = ?').run(person.id);
    signInDevice(c, person.id);
    return c.json({ ok: true });
  });

  api.post('/signout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) db.prepare('DELETE FROM device_sessions WHERE token_hash = ?').run(tokenHash(token));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  const me = new Hono<AppEnv>();
  me.use(requirePerson(db));

  me.get('/', (c) => {
    const { id, name, home_address, home_lat, home_lng } = c.var.person;
    const home = home_address === null ? null : { address: home_address, lat: home_lat, lng: home_lng };
    return c.json({ id, name, home });
  });

  me.put('/pin', async (c) => {
    const { pin } = await c.req.json();
    if (!isValidPin(pin)) return c.json({ error: 'The PIN must be exactly 4 digits.' }, 400);
    db.prepare('UPDATE people SET pin_hash = ?, failed_pins = 0, locked_until = 0 WHERE id = ?').run(await hashPin(pin, config.pinPepper), c.var.person.id);
    return c.json({ ok: true });
  });

  me.put('/home', async (c) => {
    const address = String((await c.req.json()).address ?? '').trim();
    if (!address) return c.json({ error: 'Enter an address.' }, 400);
    let found;
    try {
      found = await nominatim.search(address);
    } catch {
      return c.json({ error: "Couldn't reach the address lookup. Try again in a moment." }, 502);
    }
    if (!found) return c.json({ error: "Couldn't find that address. Try adding the suburb." }, 422);
    db.prepare('UPDATE people SET home_address = ?, home_lat = ?, home_lng = ? WHERE id = ?').run(address, found.lat, found.lng, c.var.person.id);
    return c.json({ address, ...found });
  });

  api.route('/me', me);
  return api;
}
