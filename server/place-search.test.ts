import { describe, expect, it } from 'vitest';
import { fakeFetch, fakeNominatim, fakePhoton, signedInDevice, testApp, type PhotonPlace } from './test-helpers.ts';

// Invented places only.
const DUMPLING_HOUSE: PhotonPlace = {
  lat: -37.8001,
  lng: 144.9671,
  properties: { osm_type: 'N', osm_id: '1001', osm_key: 'amenity', osm_value: 'restaurant', name: 'Pretend Dumpling House', housenumber: '12', street: 'Invented Street', district: 'Carlton', city: 'Melbourne' },
};
const NOT_FOOD: PhotonPlace[] = [
  { lat: -37.8, lng: 144.96, properties: { osm_type: 'W', osm_id: '2001', osm_key: 'highway', osm_value: 'residential', name: 'Pretend Dumpling Lane', district: 'Carlton' } },
  { lat: -37.8, lng: 144.96, properties: { osm_type: 'R', osm_id: '2002', osm_key: 'place', osm_value: 'suburb', name: 'Pretend Dumpling Heights' } },
  { lat: -37.8, lng: 144.96, properties: { osm_type: 'N', osm_id: '2003', osm_key: 'building', osm_value: 'house', name: 'Pretend Dumpling Cottage' } },
];
const cafes = (n: number): PhotonPlace[] =>
  Array.from({ length: n }, (_, i) => ({ lat: -37.8, lng: 144.96 + i / 1000, properties: { osm_type: 'N', osm_id: String(3000 + i), osm_key: 'amenity', osm_value: 'cafe', name: `Pretend Cafe ${i}` } }));

const placeLink = (hex: string, name: string, lat: number, lng: number) =>
  `https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@${lat},${lng},17z/data=!4m6!3m5!1s0x1:0x${hex}!8m2!3d${lat}!4d${lng}`;

async function setup(photon: Parameters<typeof fakeFetch>[number]) {
  const ctx = testApp({ fetch: fakeFetch(fakeNominatim({}, 'Carlton'), photon) });
  const alex = await signedInDevice(ctx.app, 'Alex');
  return { ...ctx, alex };
}

describe('#43 AC1: searching food and drink places by name', () => {
  it('returns name, a short address line, coordinates and a stable key', async () => {
    const { alex } = await setup(fakePhoton([DUMPLING_HOUSE]));
    const res = await alex.get('/api/places/search?q=Pretend%20Dumpling');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ key: 'osm:N1001', name: 'Pretend Dumpling House', address: '12 Invented Street, Carlton', lat: -37.8001, lng: 144.9671 }]);
  });

  it('only returns food and drink places, not streets, suburbs or houses', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([DUMPLING_HOUSE, ...NOT_FOOD], { calls }));
    const results = await (await alex.get('/api/places/search?q=Pretend%20Dumpling')).json();
    expect(results.map((r: { name: string }) => r.name)).toEqual(['Pretend Dumpling House']);
    const tags = calls[0].url.searchParams.getAll('osm_tag');
    for (const tag of ['amenity:restaurant', 'amenity:cafe', 'amenity:bar', 'amenity:pub', 'amenity:fast_food']) expect(tags).toContain(tag);
  });

  it('returns at most 5', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton(cafes(8), { calls }));
    expect(await (await alex.get('/api/places/search?q=Pretend%20Cafe')).json()).toHaveLength(5);
    expect(calls[0].url.searchParams.get('limit')).toBe('5');
  });

  it('an empty query returns an empty list without calling Photon', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([DUMPLING_HOUSE], { calls }));
    expect(await (await alex.get('/api/places/search?q=%20')).json()).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("#43 AC2: biased toward the group's places", () => {
  it("passes the centre of the group's located places to Photon", async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([DUMPLING_HOUSE], { calls }));
    await alex.post('/api/places', { url: placeLink('a1', 'Invented One', -37.8, 144.96) });
    await alex.post('/api/places', { url: placeLink('a2', 'Invented Two', -37.82, 144.98) });
    await alex.get('/api/places/search?q=Pretend');
    expect(Number(calls[0].url.searchParams.get('lat'))).toBeCloseTo(-37.81, 5);
    expect(Number(calls[0].url.searchParams.get('lon'))).toBeCloseTo(144.97, 5);
  });

  it('sends no location when the group has no located places', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([DUMPLING_HOUSE], { calls }));
    await alex.get('/api/places/search?q=Pretend');
    expect(calls[0].url.searchParams.has('lat')).toBe(false);
    expect(calls[0].url.searchParams.has('lon')).toBe(false);
  });
});

describe("#47: with no group places, search leans towards the searcher's home", () => {
  const HOME = { address: '1 Pretend St, Carlton', lat: -33.87, lng: 151.21, country: 'AU' };
  const biasOf = (url: URL) => [url.searchParams.get('lat'), url.searchParams.get('lon')];

  it('#47 AC1: no located places and a home: biased to the home', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([DUMPLING_HOUSE], { calls }));
    await alex.put('/api/me/home', HOME);
    await alex.get('/api/places/search?q=Pretend');
    expect(biasOf(calls[0].url)).toEqual(['-33.87', '151.21']);
  });

  it("#47 AC2: located places win over the searcher's home", async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([DUMPLING_HOUSE], { calls }));
    await alex.put('/api/me/home', HOME);
    await alex.post('/api/places', { url: placeLink('a1', 'Invented One', -37.8, 144.96) });
    await alex.get('/api/places/search?q=Pretend');
    expect(biasOf(calls[0].url)).toEqual(['-37.8', '144.96']);
  });

  it('#47 AC3: no located places and no home: no bias', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([DUMPLING_HOUSE], { calls }));
    await alex.post('/api/me/skip-home');
    await alex.get('/api/places/search?q=Pretend');
    expect(biasOf(calls[0].url)).toEqual([null, null]);
  });
});

const CHOSEN = { key: 'osm:N1001', name: 'Pretend Dumpling House', lat: -37.8001, lng: 144.9671 };

describe('#43 AC3: adding a chosen search result', () => {
  it('creates the place with its name, coordinates and suburb, in the chosen sets', async () => {
    const { alex } = await setup(fakePhoton([]));
    const { id: setId } = await (await alex.post('/api/sets', { name: 'Dumplings' })).json();
    const res = await alex.post('/api/places', { ...CHOSEN, note: 'Pork buns', setIds: [setId] });
    expect(res.status).toBe(201);
    expect((await res.json()).place).toMatchObject({ ...CHOSEN, suburb: 'Carlton', note: 'Pork buns' });
    const [listed] = await (await alex.get('/api/places')).json();
    expect(listed).toMatchObject({ key: 'osm:N1001', setIds: [setId] });
  });

  it.each([
    ['a key that is not an OSM key', { ...CHOSEN, key: '12345' }],
    ['no name', { ...CHOSEN, name: ' ' }],
    ['missing coordinates', { key: CHOSEN.key, name: CHOSEN.name }],
    ['out-of-range coordinates', { ...CHOSEN, lat: 91 }],
  ])('%s is a 400 and adds nothing', async (_, body) => {
    const { alex } = await setup(fakePhoton([]));
    expect((await alex.post('/api/places', body)).status).toBe(400);
    expect(await (await alex.get('/api/places')).json()).toEqual([]);
  });
});

describe('#43 AC4: no duplicates from search', () => {
  it('adding the same result again returns the existing place', async () => {
    const { alex } = await setup(fakePhoton([]));
    const first = (await (await alex.post('/api/places', CHOSEN)).json()).place;
    const again = await alex.post('/api/places', CHOSEN);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ existing: true, place: { id: first.id } });
    expect(await (await alex.get('/api/places')).json()).toHaveLength(1);
  });
});

describe('#43 AC5: when search fails', () => {
  it('an error status from Photon is an error status, not an empty list', async () => {
    const { alex } = await setup(fakePhoton([DUMPLING_HOUSE], { status: 503 }));
    const res = await alex.get('/api/places/search?q=Pretend');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unavailable/i);
  });

  it('a network failure is an error status too', async () => {
    const { alex } = await setup(() => undefined);
    expect((await alex.get('/api/places/search?q=Pretend')).status).toBe(502);
  });
});
