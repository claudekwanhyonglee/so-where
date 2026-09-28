import { describe, expect, it } from 'vitest';
import { device, fakeFetch, fakeNominatim, INVITE, signedInDevice, testApp } from './test-helpers.ts';

const placeLink = (hex: string, name: string) =>
  `https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@-37.8,144.96,17z/data=!4m6!3m5!1s0x1:0x${hex}!8m2!3d-37.8!4d144.96`;

type CardPlace = { id: number; name: string; suburb: string | null; note: string; key: string };

async function setup() {
  const ctx = testApp({ fetch: fakeFetch(fakeNominatim({}, 'Fitzroy')) });
  const alex = await signedInDevice(ctx.app, 'Alex');
  const jo = await signedInDevice(ctx.app, 'Jo');
  const ids: number[] = [];
  for (const [i, name] of ['Invented A', 'Invented B', 'Invented C', 'Invented D', 'Invented E'].entries()) {
    const res = await alex.post('/api/places', { url: placeLink(`a${i}`, name), note: i === 0 ? 'Great noodles' : '' });
    ids.push((await res.json()).place.id);
  }
  const setId = (await (await alex.post('/api/sets', { name: 'Date night' })).json()).id;
  for (const id of ids.slice(0, 3)) await alex.put(`/api/sets/${setId}/places/${id}`);
  return { ...ctx, alex, jo, ids, setId };
}

async function start(d: ReturnType<typeof device>, setId: number | 'all') {
  const res = await d.post('/api/sessions', { setId });
  expect(res.status).toBe(201);
  return (await res.json()).id as string;
}

const nextPair = async (d: ReturnType<typeof device>, id: string) => (await (await d.get(`/api/sessions/${id}/pair`)).json()).pair as CardPlace[] | null;

describe('#8 AC1: start a session and share it', () => {
  it('anyone can start a session for a set and gets a share link carrying the invite', async () => {
    const { alex, setId } = await setup();
    const id = await start(alex, setId);
    const session = await (await alex.get(`/api/sessions/${id}`)).json();
    expect(session).toMatchObject({ id, setName: 'Date night' });
    expect(session.sharePath).toBe(`/s/${id}?invite=${INVITE}`);
  });

  it('opening the link joins the session', async () => {
    const { app, alex, setId } = await setup();
    const id = await start(alex, setId);

    const sam = device(app, { invited: false });
    expect((await sam.get(`/s/${id}?invite=${INVITE}`)).status).toBe(302); // the invite is remembered
    expect((await sam.post('/api/people', { name: 'Sam', pin: '1357' })).status).toBe(201);
    expect((await sam.post(`/api/sessions/${id}/join`)).status).toBe(200);

    const session = await (await alex.get(`/api/sessions/${id}`)).json();
    expect(session.members.map((m: { name: string }) => m.name).sort()).toEqual(['Alex', 'Sam']);
  });

  it('can be started for "All places"', async () => {
    const { alex } = await setup();
    const id = await start(alex, 'all');
    expect((await (await alex.get(`/api/sessions/${id}`)).json()).setName).toBe('All places');
  });

  it('an unknown session or set is a 404', async () => {
    const { alex } = await setup();
    expect((await alex.get('/api/sessions/nope')).status).toBe(404);
    expect((await alex.post('/api/sessions', { setId: 999 })).status).toBe(404);
  });
});

describe('#8 AC2: only the set\'s places appear in pairs', () => {
  it('never offers a place outside the set', async () => {
    const { alex, ids, setId } = await setup();
    const id = await start(alex, setId);
    const inSet = new Set(ids.slice(0, 3));
    for (let i = 0; i < 30; i++) {
      const pair = (await nextPair(alex, id))!;
      expect(pair.every((p) => inSet.has(p.id))).toBe(true);
      await alex.post(`/api/sessions/${id}/picks`, { a: pair[0].id, b: pair[1].id, winner: pair[0].id });
    }
  });

  it('rejects a pick involving a place outside the set', async () => {
    const { alex, ids, setId } = await setup();
    const id = await start(alex, setId);
    expect((await alex.post(`/api/sessions/${id}/picks`, { a: ids[0], b: ids[4], winner: ids[0] })).status).toBe(400);
  });
});

describe('#8 AC3: picking', () => {
  it('shows two places with name, suburb, note and Google Maps key; a pick is recorded and the next pair comes back', async () => {
    const { alex, db, setId } = await setup();
    const id = await start(alex, setId);
    const pair = (await nextPair(alex, id))!;
    expect(pair).toHaveLength(2);
    for (const p of pair) expect(p).toMatchObject({ name: expect.any(String), suburb: 'Fitzroy', note: expect.any(String), key: expect.any(String) });
    expect(pair.some((p) => p.note === 'Great noodles') || pair.every((p) => p.note === '')).toBe(true);

    const res = await alex.post(`/api/sessions/${id}/picks`, { a: pair[0].id, b: pair[1].id, winner: pair[0].id });
    expect(res.status).toBe(200);
    expect((await res.json()).pair).toHaveLength(2);

    const history = db.prepare('SELECT place_id, mu, comparisons FROM history ORDER BY mu DESC').all() as { place_id: number; mu: number; comparisons: number }[];
    expect(history.map((h) => h.place_id)).toEqual([pair[0].id, pair[1].id]);
    expect(history.every((h) => h.comparisons === 1)).toBe(true);
    expect(db.prepare('SELECT count(*) FROM picks').pluck().get()).toBe(1);
  });

  it("each person's picks are their own", async () => {
    const { alex, jo, db, setId } = await setup();
    const id = await start(alex, setId);
    await jo.post(`/api/sessions/${id}/join`);
    const pair = (await nextPair(jo, id))!;
    await jo.post(`/api/sessions/${id}/picks`, { a: pair[0].id, b: pair[1].id, winner: pair[1].id });
    const owners = db.prepare('SELECT DISTINCT p.name FROM history h JOIN people p ON p.id = h.person_id').pluck().all();
    expect(owners).toEqual(['Jo']);
  });
});

describe('#8 AC4: too close to call', () => {
  it('records a tie and shows the next pair', async () => {
    const { alex, db, setId } = await setup();
    const id = await start(alex, setId);
    const [a, b] = (await nextPair(alex, id))!;
    const res = await alex.post(`/api/sessions/${id}/picks`, { a: a.id, b: b.id, winner: null });
    expect(res.status).toBe(200);
    expect((await res.json()).pair).toHaveLength(2);
    expect(db.prepare('SELECT score_a FROM picks').pluck().get()).toBe(0.5);
    const mus = db.prepare('SELECT mu FROM history').pluck().all() as number[];
    expect(mus).toEqual([1500, 1500]); // equal places stay equal after a tie
  });
});

describe('#8 AC5: "Absolutely not"', () => {
  it("removes the place from that person's pairs for this session only; others still get it; history untouched", async () => {
    const { alex, jo, db, ids, setId } = await setup();
    const id = await start(alex, setId);
    await jo.post(`/api/sessions/${id}/join`);
    const vetoed = ids[0];

    expect((await alex.post(`/api/sessions/${id}/vetoes`, { placeId: vetoed })).status).toBe(200);
    for (let i = 0; i < 20; i++) {
      const pair = (await nextPair(alex, id))!;
      expect(pair.map((p) => p.id)).not.toContain(vetoed);
      await alex.post(`/api/sessions/${id}/picks`, { a: pair[0].id, b: pair[1].id, winner: pair[0].id });
    }
    expect((await alex.post(`/api/sessions/${id}/picks`, { a: vetoed, b: ids[1], winner: vetoed })).status).toBe(400);

    let joSawIt = false;
    for (let i = 0; i < 10 && !joSawIt; i++) {
      const pair = (await nextPair(jo, id))!;
      joSawIt = pair.some((p) => p.id === vetoed);
      await jo.post(`/api/sessions/${id}/picks`, { a: pair[0].id, b: pair[1].id, winner: pair[0].id });
    }
    expect(joSawIt).toBe(true);

    const alexId = db.prepare("SELECT id FROM people WHERE name = 'Alex'").pluck().get();
    expect(db.prepare('SELECT count(*) FROM history WHERE person_id = ? AND place_id = ?').pluck().get(alexId, vetoed)).toBe(0);

    const next = await start(alex, setId);
    let seenAgain = false;
    for (let i = 0; i < 10 && !seenAgain; i++) {
      const pair = (await nextPair(alex, next))!;
      seenAgain = pair.some((p) => p.id === vetoed);
      await alex.post(`/api/sessions/${next}/picks`, { a: pair[0].id, b: pair[1].id, winner: pair[0].id });
    }
    expect(seenAgain).toBe(true); // a new session doesn't carry the mark
  });

  it('can be undone, and with fewer than two places left there is no pair', async () => {
    const { alex, ids, setId } = await setup();
    const id = await start(alex, setId);
    await alex.post(`/api/sessions/${id}/vetoes`, { placeId: ids[0] });
    await alex.post(`/api/sessions/${id}/vetoes`, { placeId: ids[1] });
    expect(await nextPair(alex, id)).toBeNull();
    expect((await alex.del(`/api/sessions/${id}/vetoes/${ids[1]}`)).status).toBe(200);
    expect(await nextPair(alex, id)).toHaveLength(2);
  });
});

describe('#16 AC4: recent sessions', () => {
  it("list each session's current #1 from the combined ranking, and its members", async () => {
    const { alex, jo, ids, setId } = await setup();
    const id = await start(alex, setId);
    await jo.post(`/api/sessions/${id}/join`);
    // Both prefer the third place over the others.
    for (const d of [alex, jo]) {
      for (const other of [ids[0], ids[1]]) await d.post(`/api/sessions/${id}/picks`, { a: ids[2], b: other, winner: ids[2] });
    }

    const [recent] = await (await alex.get('/api/sessions')).json();
    expect(recent).toMatchObject({ id, setName: 'Date night', topPick: 'Invented C', memberCount: 2 });
    expect(recent.members.map((m: { name: string }) => m.name)).toEqual(['Alex', 'Jo']);
  });

  it('never name a place someone ruled out as the top pick', async () => {
    const { alex, ids, setId } = await setup();
    const id = await start(alex, setId);
    await alex.post(`/api/sessions/${id}/picks`, { a: ids[2], b: ids[0], winner: ids[2] });
    await alex.post(`/api/sessions/${id}/vetoes`, { placeId: ids[2] });
    const [recent] = await (await alex.get('/api/sessions')).json();
    expect(recent.topPick).toMatch(/^Invented [AB]$/);
  });

  it('have no top pick when the set is empty', async () => {
    const { alex } = await setup();
    const emptySet = (await (await alex.post('/api/sets', { name: 'Empty' })).json()).id;
    await start(alex, emptySet);
    const [recent] = await (await alex.get('/api/sessions')).json();
    expect(recent.topPick).toBeNull();
  });
});

describe('#26 AC5: fast enough', () => {
  it('chooses a pair in under 200 ms for 8 people × 40 places', async () => {
    const ctx = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const people = [];
    for (let i = 0; i < 8; i++) people.push(await signedInDevice(ctx.app, `Person ${i}`));
    const ids: number[] = [];
    for (let i = 0; i < 40; i++) ids.push((await (await people[0].post('/api/places', { url: placeLink(`d${i}`, `Invented ${i}`) })).json()).place.id);
    const id = await start(people[0], 'all');
    for (const [n, person] of people.entries()) {
      await person.post(`/api/sessions/${id}/join`);
      for (let i = 0; i < 20; i++) await person.post(`/api/sessions/${id}/picks`, { a: ids[(i + n) % 40], b: ids[(i * 7 + 3) % 40], winner: ids[(i + n) % 40] });
    }
    await nextPair(people[0], id); // warm up

    const started = performance.now();
    const pair = await nextPair(people[0], id);
    expect(performance.now() - started).toBeLessThan(200);
    expect(pair).toHaveLength(2);
  }, 60_000);
});

describe('#23 AC3: a surprising reversal comes back within 5 pairs', () => {
  it('is offered again through the API', async () => {
    const { alex, ids, setId } = await setup();
    const id = await start(alex, setId);
    const [a, b, c] = ids;
    const pick = async (x: number, y: number, winner: number) => (await (await alex.post(`/api/sessions/${id}/picks`, { a: x, b: y, winner })).json()).pair as CardPlace[];
    for (const [x, y] of [[a, b], [a, c], [a, b], [c, b], [a, b]]) await pick(x, y, x);

    let pair = await pick(b, a, b); // the reversal
    const shown: number[][] = [];
    for (let i = 0; i < 5; i++) {
      const [x, y] = pair.map((p) => p.id);
      shown.push([x, y].sort());
      pair = await pick(x, y, [a, c, b].find((p) => p === x || p === y)!);
    }
    expect(shown).toContainEqual([a, b].sort());
  });
});
