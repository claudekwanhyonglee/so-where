import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeFetch, fakeNominatim, signedInDevice, testApp } from './test-helpers.ts';

const placeLink = (hex: string, name: string) =>
  `https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@-37.8,144.96,17z/data=!4m6!3m5!1s0x1:0x${hex}!8m2!3d-37.8!4d144.96`;

type SetSummary = { id: number | 'all'; name: string; builtIn: boolean; placeCount: number };

async function setup() {
  const ctx = testApp({ fetch: fakeFetch(fakeNominatim()) });
  const alex = await signedInDevice(ctx.app, 'Alex');
  const jo = await signedInDevice(ctx.app, 'Jo');
  const add = async (hex: string, name: string) => (await (await alex.post('/api/places', { url: placeLink(hex, name) })).json()).place.id as number;
  const [a, b, c] = [await add('a1', 'Invented A'), await add('b2', 'Invented B'), await add('c3', 'Invented C')];
  const sets = async () => (await (await jo.get('/api/sets')).json()) as SetSummary[];
  const members = async (id: number | 'all') => ((await (await jo.get(`/api/sets/${id}`)).json()).placeIds as number[]).sort();
  return { ...ctx, alex, jo, a, b, c, sets, members };
}

describe('#6 AC1: anyone can manage sets', () => {
  it('create, rename, add and remove places, delete', async () => {
    const { alex, jo, a, b, sets, members } = await setup();

    const created = await alex.post('/api/sets', { name: 'Date night' });
    expect(created.status).toBe(201);
    const { id } = await created.json();

    expect((await jo.patch(`/api/sets/${id}`, { name: 'Fancy dinner' })).status).toBe(200);
    expect((await sets()).find((s) => s.id === id)?.name).toBe('Fancy dinner');

    expect((await jo.put(`/api/sets/${id}/places/${a}`)).status).toBe(200);
    expect((await alex.put(`/api/sets/${id}/places/${b}`)).status).toBe(200);
    expect((await alex.put(`/api/sets/${id}/places/${b}`)).status).toBe(200); // idempotent
    expect(await members(id)).toEqual([a, b].sort());

    expect((await jo.del(`/api/sets/${id}/places/${a}`)).status).toBe(200);
    expect(await members(id)).toEqual([b]);

    expect((await alex.del(`/api/sets/${id}`)).status).toBe(200);
    expect((await sets()).some((s) => s.id === id)).toBe(false);
  });

  it('rejects blank names, unknown sets and unknown places', async () => {
    const { alex } = await setup();
    expect((await alex.post('/api/sets', { name: '  ' })).status).toBe(400);
    expect((await alex.patch('/api/sets/999', { name: 'X' })).status).toBe(404);
    const { id } = await (await alex.post('/api/sets', { name: 'S' })).json();
    expect((await alex.put(`/api/sets/${id}/places/999`)).status).toBe(404);
  });
});

describe('#6 AC2: places in several sets; deleting a set keeps its places', () => {
  it('works', async () => {
    const { alex, a, members } = await setup();
    const s1 = (await (await alex.post('/api/sets', { name: 'One' })).json()).id;
    const s2 = (await (await alex.post('/api/sets', { name: 'Two' })).json()).id;
    await alex.put(`/api/sets/${s1}/places/${a}`);
    await alex.put(`/api/sets/${s2}/places/${a}`);
    expect(await members(s1)).toEqual([a]);
    expect(await members(s2)).toEqual([a]);

    await alex.del(`/api/sets/${s1}`);
    expect(await members(s2)).toEqual([a]);
    expect((await (await alex.get('/api/places')).json()).some((p: { id: number }) => p.id === a)).toBe(true);
  });
});

describe('#6 AC3: the "All places" set', () => {
  it('always exists, comes first, and contains every place — including new ones', async () => {
    const { alex, a, b, c, sets, members } = await setup();
    const [first] = await sets();
    expect(first).toMatchObject({ id: 'all', name: 'All places', builtIn: true, placeCount: 3 });
    expect(await members('all')).toEqual([a, b, c].sort());

    const d = (await (await alex.post('/api/places', { url: placeLink('d4', 'Invented D') })).json()).place.id;
    expect(await members('all')).toContain(d);
  });

  it("can't be renamed, deleted, or have places added or removed", async () => {
    const { alex, a } = await setup();
    expect((await alex.patch('/api/sets/all', { name: 'Mine' })).status).toBe(403);
    expect((await alex.del('/api/sets/all')).status).toBe(403);
    expect((await alex.put(`/api/sets/all/places/${a}`)).status).toBe(403);
    expect((await alex.del(`/api/sets/all/places/${a}`)).status).toBe(403);
  });
});

describe('#6 AC4: Takeout lists appear as sets', () => {
  it('an imported list CSV shows up as a set with its places', async () => {
    const { alex, sets, members } = await setup();
    const content = readFileSync(new URL('./fixtures/Date night.csv', import.meta.url), 'utf8');
    await alex.upload('/api/import', [{ name: 'Date night.csv', content }]);
    const dateNight = (await sets()).find((s) => s.name === 'Date night')!;
    expect(dateNight).toMatchObject({ builtIn: false, placeCount: 3 });
    expect(await members(dateNight.id)).toHaveLength(3);
  });
});
