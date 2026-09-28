import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from './takeout.ts';
import { fakeFetch, fakeNominatim, signedInDevice, testApp } from './test-helpers.ts';

// Invented fixtures, shaped like Google Takeout exports. No real data.
const fixture = (name: string) => ({ name, content: readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8') });
const LIST = fixture('Date night.csv');
const STARRED = fixture('Saved Places.json');

// Where the fake Nominatim finds places searched by name (CSV rows have no coordinates).
const KNOWN = {
  'Invented Dumpling House': { lat: -37.811, lng: 144.967 },
  'Pretend Ramen Bar': { lat: -37.812, lng: 144.968 },
  'Fictional Pho, 5 Nowhere St, Richmond VIC 3121': { lat: -37.82, lng: 145.0 },
};

type Place = { id: number; key: string; name: string; note: string; lat: number | null; lng: number | null; suburb: string | null };

async function setup() {
  const searches: URL[] = [];
  const nominatim = fakeNominatim(KNOWN, 'Carlton');
  const ctx = testApp({ fetch: fakeFetch((url, init) => (url.pathname === '/search' && searches.push(url), nominatim(url, init))) });
  const me = await signedInDevice(ctx.app);
  const places = async () => (await (await me.get('/api/places')).json()) as Place[];
  const byName = async (name: string) => (await places()).find((p) => p.name === name)!;
  return { ...ctx, me, places, byName, searches };
}

describe('CSV parsing', () => {
  it('handles quotes, escaped quotes, commas, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""",z\r\n')).toEqual([['a', 'b'], ['x, "y"', 'z']]);
  });
});

describe('#5 AC1: importing a saved-list CSV', () => {
  it('adds its places with their notes', async () => {
    const { me, app, places, byName } = await setup();
    expect((await me.upload('/api/import', [LIST])).status).toBe(200);
    expect((await places()).map((p) => p.name).sort()).toEqual(['Invented Dumpling House', 'Pretend Ramen Bar', 'Totally Fake Bistro']);
    expect((await byName('Invented Dumpling House')).note).toBe('Ask for the "secret" menu, really');
    expect((await byName('Pretend Ramen Bar')).note).toBe('Late night option');

    await app.idle();
    expect(await byName('Pretend Ramen Bar')).toMatchObject({ lat: -37.812, lng: 144.968, suburb: 'Carlton' });
    expect(await byName('Totally Fake Bistro')).toMatchObject({ lat: null, suburb: null }); // no Nominatim match
  });
});

describe('#5 AC2: importing Saved Places.json', () => {
  it('adds its places with their coordinates, then suburbs', async () => {
    const { me, app, places, byName } = await setup();
    const res = await me.upload('/api/import', [STARRED]);
    expect(res.status).toBe(200);
    expect((await places()).map((p) => p.name).sort()).toEqual(['Fictional Pho', 'Imaginary Taqueria', 'Invented Dumpling House']);
    expect(await byName('Imaginary Taqueria')).toMatchObject({ key: '2222222222222222222', lat: -37.8, lng: 144.98 });

    await app.idle();
    expect((await byName('Imaginary Taqueria')).suburb).toBe('Carlton');
    expect(await byName('Fictional Pho')).toMatchObject({ lat: -37.82, lng: 145.0 }); // [0,0] means unknown: located by name + address
  });

  it('skips entries that are not places (dropped pins)', async () => {
    const { me } = await setup();
    const report = await (await me.upload('/api/import', [STARRED])).json();
    expect(report.skipped).toBe(1);
  });
});

describe('#5 AC3: re-importing merges by normalised place ID', () => {
  it('matches the 0x…:0x… form in a CSV with the ?cid= form in the JSON', async () => {
    const { me } = await setup();
    await me.upload('/api/import', [STARRED]);
    const report = await (await me.upload('/api/import', [LIST])).json();
    expect(report).toMatchObject({ added: 2, existing: 1 });
  });

  it('adds only new places and leaves existing ones untouched', async () => {
    const { me, places, byName } = await setup();
    await me.upload('/api/import', [LIST]);
    const dumpling = await byName('Invented Dumpling House');
    await me.patch(`/api/places/${dumpling.id}`, { note: 'Edited in the app' });

    const report = await (await me.upload('/api/import', [LIST, STARRED])).json();
    expect(report).toMatchObject({ added: 2, existing: 4 });
    expect(await places()).toHaveLength(5);
    const after = await byName('Invented Dumpling House');
    expect(after.id).toBe(dumpling.id);
    expect(after.note).toBe('Edited in the app');
  });
});

describe('#5 AC4: import report', () => {
  it('reports how many places were added and how many were already there', async () => {
    const { me } = await setup();
    expect(await (await me.upload('/api/import', [LIST])).json()).toMatchObject({ added: 3, existing: 0 });
    expect(await (await me.upload('/api/import', [LIST])).json()).toMatchObject({ added: 0, existing: 3 });
  });

  it('rejects files it does not understand', async () => {
    const { me } = await setup();
    const res = await me.upload('/api/import', [{ name: 'photo.png', content: 'nope' }]);
    expect(res.status).toBe(400);
    const badJson = await me.upload('/api/import', [{ name: 'Saved Places.json', content: '{oops' }]);
    expect(badJson.status).toBe(400);
  });
});

describe('#19 AC10: the import report names the sets it filled', () => {
  it('gives the id and name of the set made for each list, and none for Saved Places.json', async () => {
    const { me } = await setup();
    const report = await (await me.upload('/api/import', [LIST, STARRED])).json();
    const sets = await (await me.get('/api/sets')).json();
    const dateNight = sets.find((s: { name: string }) => s.name === 'Date night');
    expect(report.sets).toEqual([{ id: dateNight.id, name: 'Date night' }]);
  });
});

describe('#5 AC5: each list CSV is recorded as a set named after the list', () => {
  it('creates the set once and updates it on re-import', async () => {
    const { me, db } = await setup();
    await me.upload('/api/import', [LIST]);
    const extra = { name: LIST.name, content: `${LIST.content}Made Up Grill,,https://maps.google.com/?cid=6666666666666666666,,\n` };
    await me.upload('/api/import', [extra]);

    const sets = db.prepare('SELECT id, name FROM sets').all() as { id: number; name: string }[];
    expect(sets.map((s) => s.name)).toEqual(['Date night']);
    const members = db
      .prepare('SELECT p.name FROM set_places sp JOIN places p ON p.id = sp.place_id WHERE sp.set_id = ? ORDER BY p.name')
      .pluck()
      .all(sets[0].id);
    expect(members).toEqual(['Invented Dumpling House', 'Made Up Grill', 'Pretend Ramen Bar', 'Totally Fake Bistro']);
  });
});

describe('Nominatim guesses for CSV rows stay near the group', () => {
  it('bounds the name search to the area of places already located', async () => {
    const { me, app, searches } = await setup();
    await me.upload('/api/import', [STARRED]);
    await app.idle();
    searches.length = 0;
    await me.upload('/api/import', [LIST]);
    await app.idle();
    const ramen = searches.find((u) => u.searchParams.get('q') === 'Pretend Ramen Bar')!;
    expect(ramen.searchParams.get('bounded')).toBe('1');
    const [west, north, east, south] = ramen.searchParams.get('viewbox')!.split(',').map(Number);
    expect(west).toBeLessThan(144.98);
    expect(east).toBeGreaterThan(144.98);
    expect(south).toBeLessThan(-37.8);
    expect(north).toBeGreaterThan(-37.8);
  });
});
