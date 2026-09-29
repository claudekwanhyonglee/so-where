import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { configFromEnv } from './config.ts';
import { fakeFetch, fakeNominatim, fakeTransitous, signedInDevice, testApp } from './test-helpers.ts';

const HOME = '1 Pretend St, Carlton';
const placeLink = (hex: string, name: string) =>
  `https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@-37.8,144.96,17z/data=!4m6!3m5!1s0x1:0x${hex}!8m2!3d-37.8!4d144.96`;

async function setup(maxSessions?: number) {
  let clock = Date.UTC(2026, 8, 29, 8, 0);
  const ctx = testApp({
    fetch: fakeFetch(fakeNominatim({ [HOME]: { lat: -37.79, lng: 144.97 } }), fakeTransitous([600])),
    now: () => (clock += 1000),
    config: maxSessions ? { maxSessions } : {},
  });
  const alex = await signedInDevice(ctx.app, 'Alex');
  const jo = await signedInDevice(ctx.app, 'Jo');
  await alex.put('/api/me/home', { address: HOME });
  const places: number[] = [];
  for (const [i, name] of ['Invented A', 'Invented B', 'Invented C'].entries()) {
    places.push((await (await alex.post('/api/places', { url: placeLink(`b${i}`, name) })).json()).place.id);
  }
  const start = async () => (await (await alex.post('/api/sessions', { setId: 'all' })).json()).id as string;
  return { ...ctx, alex, jo, places, start };
}

const SESSION_TABLES = ['session_members', 'session_priors', 'picks', 'vetoes', 'transit_times'];

describe('#29 AC1: creating a session beyond MAX_SESSIONS deletes the oldest', () => {
  it('with MAX_SESSIONS=3, the 4th session removes the oldest and all its rows', async () => {
    const { db, alex, jo, places, start } = await setup(3);
    const oldest = await start();
    await jo.post(`/api/sessions/${oldest}/join`);
    const [pair] = [(await (await alex.get(`/api/sessions/${oldest}/pair`)).json()).pair];
    await alex.post(`/api/sessions/${oldest}/picks`, { a: pair[0].id, b: pair[1].id, winner: pair[0].id });
    await alex.post(`/api/sessions/${oldest}/vetoes`, { placeId: places[2] });
    await alex.get(`/api/sessions/${oldest}/transit?place=${places[0]}`);
    const rowsOf = (table: string, id: string) => db.prepare(`SELECT count(*) FROM ${table} WHERE session_id = ?`).pluck().get(id);
    for (const table of SESSION_TABLES) expect(rowsOf(table, oldest), table).toBeGreaterThan(0);

    const kept = [await start(), await start()];
    expect((await alex.get(`/api/sessions/${oldest}/pair`)).status).toBe(200); // 3 sessions: still within the limit
    kept.push(await start());

    const remaining = db.prepare('SELECT id FROM sessions').pluck().all();
    expect(remaining.sort()).toEqual([...kept].sort());
    for (const table of SESSION_TABLES) expect(rowsOf(table, oldest), table).toBe(0);
  });
});

describe('#29 AC2: GET /api/sessions returns at most MAX_SESSIONS, newest first', () => {
  it('lists every session up to the limit, newest first', async () => {
    const { alex, start } = await setup(3);
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push(await start());
    const listed = (await (await alex.get('/api/sessions')).json()).map((s: { id: string }) => s.id);
    expect(listed).toEqual(ids.slice(-3).reverse());
  });

  it('the default limit (20) applies to the list too', async () => {
    const { alex, start } = await setup();
    for (let i = 0; i < 22; i++) await start();
    expect(await (await alex.get('/api/sessions')).json()).toHaveLength(20);
  });
});

describe('#29 AC3: MAX_SESSIONS setting', () => {
  const base = { INVITE_CODE: 'x', PIN_PEPPER: 'p' };

  it('defaults to 20 when unset or blank', () => {
    expect(configFromEnv(base).maxSessions).toBe(20);
    expect(configFromEnv({ ...base, MAX_SESSIONS: '' }).maxSessions).toBe(20);
  });

  it('accepts a whole number of at least 1', () => {
    expect(configFromEnv({ ...base, MAX_SESSIONS: '5' }).maxSessions).toBe(5);
    expect(configFromEnv({ ...base, MAX_SESSIONS: '1' }).maxSessions).toBe(1);
  });

  it.each(['0', '-3', '2.5', 'ten', '1e3', '0x10'])('refuses to start with MAX_SESSIONS=%j, naming the setting', (value) => {
    expect(() => configFromEnv({ ...base, MAX_SESSIONS: value })).toThrow(/MAX_SESSIONS/);
  });
});

describe('#29 AC4: .env.example documents MAX_SESSIONS', () => {
  it('lists it in the optional section with its default and a one-line explanation', () => {
    const example = readFileSync('.env.example', 'utf8');
    const optional = example.slice(example.indexOf('# Optional'));
    const lines = optional.split('\n');
    const at = lines.findIndex((l) => /^# MAX_SESSIONS=20$/.test(l));
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toMatch(/^# \S.*session/i);
  });
});
