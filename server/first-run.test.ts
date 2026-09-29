import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate, migrations } from './db.ts';
import { device, fakeFetch, fakeNominatim, signedInDevice, testApp } from './test-helpers.ts';

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

/** Adds `n` places to the group through the API (the fake Nominatim knows nothing, so they're added by their link alone). */
async function addPlaces(d: Awaited<ReturnType<typeof signedInDevice>>, n: number) {
  for (let i = 0; i < n; i++) {
    const hex = (0x1000 + Math.floor(Math.random() * 1e9)).toString(16);
    const res = await d.post('/api/places', { url: `https://www.google.com/maps/place/Spot/@-37.8,144.96,17z/data=!4m2!3m1!1s0x1:0x${hex}!3d-37.8!4d144.96` });
    if (res.status !== 201 && res.status !== 200) throw new Error(`add place: ${res.status} ${await res.text()}`);
  }
}

const guide = async (d: Awaited<ReturnType<typeof signedInDevice>>) => (await d.get('/api/guide')).json();

describe('#38 AC1: the guide is open for new people and closed for everyone who already existed', () => {
  it('/me says whether the guide is closed', async () => {
    const { app } = testApp();
    const alex = await signedInDevice(app, 'Alex');
    expect((await me(alex)).guideClosed).toBe(false);
  });
});

describe('#38 AC4 + AC6: guide progress comes from the server', () => {
  it('reports home, the group\'s place count and whether the person is in a session', async () => {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const alex = await signedInDevice(app, 'Alex');
    expect(await guide(alex)).toMatchObject({ closed: false, home: null, homeSkipped: false, placeCount: 0, inSession: false });

    await alex.put('/api/me/home', { address: '1 Pretend St', lat: -37.8, lng: 144.96 });
    await addPlaces(alex, 2);
    await alex.post('/api/sessions', { setId: 'all' });
    expect(await guide(alex)).toMatchObject({ home: '1 Pretend St', homeSkipped: false, placeCount: 2, inSession: true });
  });

  it('counts places anyone in the group added, and sessions anyone started that this person joined', async () => {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const alex = await signedInDevice(app, 'Alex');
    const jo = await signedInDevice(app, 'Jo');
    await addPlaces(jo, 2);
    const { id } = await (await jo.post('/api/sessions', { setId: 'all' })).json();
    expect(await guide(alex)).toMatchObject({ placeCount: 2, inSession: false });
    await alex.get(`/api/sessions/${id}`);
    expect((await guide(alex)).inSession).toBe(true);
  });
});

describe('#38 AC5: starting (or joining) a session with home undecided marks home skipped; closing is for good', () => {
  it('starting a session without a home marks it skipped', async () => {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const alex = await signedInDevice(app, 'Alex');
    await addPlaces(alex, 2);
    await alex.post('/api/sessions', { setId: 'all' });
    expect((await me(alex)).homeSkipped).toBe(true);
  });

  it('opening someone else\'s session without a home marks it skipped too', async () => {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const alex = await signedInDevice(app, 'Alex');
    const jo = await signedInDevice(app, 'Jo');
    await addPlaces(jo, 2);
    const { id } = await (await jo.post('/api/sessions', { setId: 'all' })).json();
    await alex.get(`/api/sessions/${id}`);
    expect((await me(alex)).homeSkipped).toBe(true);
  });

  it('with a home set, starting a session leaves home done, not skipped', async () => {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const alex = await signedInDevice(app, 'Alex');
    await alex.put('/api/me/home', { address: '1 Pretend St', lat: -37.8, lng: 144.96 });
    await addPlaces(alex, 2);
    await alex.post('/api/sessions', { setId: 'all' });
    expect((await me(alex)).homeSkipped).toBe(false);
  });

  it('POST /api/guide/close closes it on every device', async () => {
    const { app } = testApp();
    const phone = await signedInDevice(app, 'Alex', '1234');
    expect((await phone.post('/api/guide/close')).status).toBe(200);
    const laptop = device(app);
    await laptop.post('/api/signin', { name: 'Alex', pin: '1234' });
    expect((await me(laptop)).guideClosed).toBe(true);
    expect((await guide(laptop)).closed).toBe(true);
  });
});

const HOUR = 3_600_000;

/** A test app whose clock the test moves on. */
function clockedApp() {
  const clock = { now: 1_800_000_000_000 };
  const t = testApp({ fetch: fakeFetch(fakeNominatim()), now: () => clock.now });
  return { ...t, clock, tick: (ms = 1000) => (clock.now += ms) };
}

describe('#39 AC1 + AC2: someone joining a group that already had 2 places', () => {
  it('is joining when the group had 2 or more places before their account was made', async () => {
    const { app, tick } = clockedApp();
    const alex = await signedInDevice(app, 'Alex');
    await addPlaces(alex, 2);
    tick();
    const jo = await signedInDevice(app, 'Jo');
    expect((await guide(jo)).joining).toBe(true);
  });

  it('is not joining when the group had fewer, even once it has more (they may be the one adding them)', async () => {
    const { app, tick } = clockedApp();
    const alex = await signedInDevice(app, 'Alex');
    await addPlaces(alex, 1);
    tick();
    const jo = await signedInDevice(app, 'Jo');
    tick();
    await addPlaces(jo, 2);
    expect((await guide(jo)).joining).toBe(false);
    expect((await guide(alex)).joining).toBe(false);
  });

  it('places added in the same instant as the account do not count as already there', async () => {
    const { app } = clockedApp();
    const alex = await signedInDevice(app, 'Alex');
    await addPlaces(alex, 2);
    const jo = await signedInDevice(app, 'Jo'); // same clock reading
    expect((await guide(jo)).joining).toBe(false);
  });
});

describe('#39 AC3 + AC4: the session that is going', () => {
  async function groupWithPlaces() {
    const t = clockedApp();
    const alex = await signedInDevice(t.app, 'Alex');
    await addPlaces(alex, 2);
    t.tick();
    return { ...t, alex };
  }
  const startSession = async (d: Awaited<ReturnType<typeof signedInDevice>>) => (await (await d.post('/api/sessions', { setId: 'all' })).json()).id as string;

  it('is the most recent session from the last 12 hours with someone else in it, with its set and who is in it', async () => {
    const { app, tick, alex } = await groupWithPlaces();
    const sam = await signedInDevice(app, 'Sam');
    await startSession(alex);
    tick();
    const latest = await startSession(alex);
    tick();
    await sam.get(`/api/sessions/${latest}`);
    tick();
    const jo = await signedInDevice(app, 'Jo');
    expect((await guide(jo)).live).toEqual({ id: latest, setName: 'All places', members: [{ id: expect.any(Number), name: 'Alex' }, { id: expect.any(Number), name: 'Sam' }] });
  });

  it('is none when the only sessions are older than 12 hours', async () => {
    const { app, tick, alex } = await groupWithPlaces();
    await startSession(alex);
    tick(12 * HOUR + 1);
    const jo = await signedInDevice(app, 'Jo');
    expect((await guide(jo)).live).toBeNull();
  });

  it("skips a session with only this person in it, and says none when there's nothing else", async () => {
    const { app, tick, alex } = await groupWithPlaces();
    tick();
    const jo = await signedInDevice(app, 'Jo');
    expect((await guide(jo)).live).toBeNull();
    await startSession(jo);
    expect((await guide(jo)).live).toBeNull();
    const alexs = await startSession(alex);
    expect((await guide(jo)).live).toMatchObject({ id: alexs });
  });

  it('is only offered to someone joining a group (a new group has no one else picking)', async () => {
    const { app, tick } = clockedApp();
    const alex = await signedInDevice(app, 'Alex');
    const jo = await signedInDevice(app, 'Jo');
    tick();
    await addPlaces(alex, 2);
    await startSession(alex);
    expect(await guide(jo)).toMatchObject({ joining: false, live: null });
  });
});

describe('#39 AC5: after joining, who they are picking with', () => {
  it('names the others in the first session they joined', async () => {
    const { app, tick } = clockedApp();
    const alex = await signedInDevice(app, 'Alex');
    await addPlaces(alex, 2);
    const id = (await (await alex.post('/api/sessions', { setId: 'all' })).json()).id;
    tick();
    const jo = await signedInDevice(app, 'Jo');
    expect((await guide(jo)).joinedWith).toBeNull();
    await jo.get(`/api/sessions/${id}`);
    expect((await guide(jo)).joinedWith).toEqual([{ id: expect.any(Number), name: 'Alex' }]);
  });

  it('is none when their first session was one they started', async () => {
    const { app } = clockedApp();
    const alex = await signedInDevice(app, 'Alex');
    await addPlaces(alex, 2);
    await alex.post('/api/sessions', { setId: 'all' });
    expect((await guide(alex)).joinedWith).toBeNull();
  });
});
