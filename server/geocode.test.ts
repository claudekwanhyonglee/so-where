import { describe, expect, it } from 'vitest';
import { fakeFetch, fakeNominatim, fakePhoton, signedInDevice, testApp, type PhotonPlace } from './test-helpers.ts';

const PRETEND_ST: PhotonPlace = {
  lat: -37.7991,
  lng: 144.9671,
  properties: { housenumber: '1', street: 'Pretend Street', district: 'Carlton', city: 'Melbourne', state: 'Victoria', country: 'Australia', countrycode: 'AU' },
};
const manyPlaces = (n: number): PhotonPlace[] =>
  Array.from({ length: n }, (_, i) => ({ lat: -37.8 - i / 100, lng: 145, properties: { housenumber: String(i + 2), street: 'Pretend Street', city: 'Melbourne' } }));

async function setup(photon: Parameters<typeof fakeFetch>[number]) {
  const ctx = testApp({ fetch: fakeFetch(fakeNominatim({ '1 Pretend St, Carlton': { lat: -37.8, lng: 144.97 } }), photon) });
  const alex = await signedInDevice(ctx.app, 'Alex');
  return { ...ctx, alex };
}

describe('#32 AC1: GET /api/geocode suggests addresses from Photon', () => {
  it('returns {label, lat, lng} suggestions, sending the app User-Agent', async () => {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const { alex } = await setup(fakePhoton([PRETEND_ST], { calls }));
    const res = await alex.get('/api/geocode?q=1%20Pretend');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ label: '1 Pretend Street, Carlton, Melbourne, Victoria, Australia', lat: -37.7991, lng: 144.9671 }]);
    const [{ url, init }] = calls;
    expect(url.searchParams.get('q')).toBe('1 Pretend');
    expect(new Headers(init?.headers).get('user-agent')).toMatch(/so-where/);
  });

  it('returns at most 5', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton(manyPlaces(8), { calls }));
    expect(await (await alex.get('/api/geocode?q=pretend')).json()).toHaveLength(5);
    expect(calls[0].url.searchParams.get('limit')).toBe('5');
  });

  it('an empty q returns an empty list without calling Photon', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([PRETEND_ST], { calls }));
    for (const q of ['', '%20%20']) expect(await (await alex.get(`/api/geocode?q=${q}`)).json()).toEqual([]);
    expect(await (await alex.get('/api/geocode')).json()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('needs a signed-in person', async () => {
    const { app } = testApp({ fetch: fakeFetch(fakePhoton([PRETEND_ST])) });
    const res = await app.request('/api/geocode?q=pretend', { headers: { cookie: 'sw_invite=test-invite' } });
    expect(res.status).toBe(401);
  });
});

describe('#32 AC3: PUT /api/me/home with a chosen suggestion', () => {
  it('stores {address, lat, lng} as given, without looking the address up again', async () => {
    const { alex } = await setup(fakePhoton([]));
    const chosen = { address: 'Somewhere Nominatim Does Not Know', lat: -37.7991, lng: 144.9671, country: 'AU' };
    expect((await alex.put('/api/me/home', chosen)).status).toBe(200);
    expect((await (await alex.get('/api/me')).json()).home).toEqual(chosen);
  });

  it.each([
    ['missing lat', { lng: 144.9 }],
    ['missing lng', { lat: -37.8 }],
    ['non-numeric lat', { lat: '-37.8', lng: 144.9 }],
    ['null lng', { lat: -37.8, lng: null }],
    ['lat above 90', { lat: 90.5, lng: 144.9 }],
    ['lat below -90', { lat: -91, lng: 144.9 }],
    ['lng above 180', { lat: -37.8, lng: 180.1 }],
    ['lng below -180', { lat: -37.8, lng: -200 }],
  ])('%s is a 400 and nothing is saved', async (_, coords) => {
    const { alex } = await setup(fakePhoton([]));
    await alex.put('/api/me/home', { address: 'Before', lat: -37.8, lng: 144.9, country: 'AU' });
    const res = await alex.put('/api/me/home', { address: 'After', country: 'AU', ...coords });
    expect(res.status).toBe(400);
    expect((await (await alex.get('/api/me')).json()).home).toEqual({ address: 'Before', lat: -37.8, lng: 144.9, country: 'AU' });
  });

  it('NaN and Infinity (which JSON turns into null) are rejected too', async () => {
    const { alex } = await setup(fakePhoton([]));
    expect((await alex.put('/api/me/home', { address: 'X', lat: NaN, lng: Infinity, country: 'AU' })).status).toBe(400);
    expect((await (await alex.get('/api/me')).json()).home).toBeNull();
  });

  it('the boundaries themselves are fine', async () => {
    const { alex } = await setup(fakePhoton([]));
    expect((await alex.put('/api/me/home', { address: 'Edge', lat: -90, lng: 180, country: 'AU' })).status).toBe(200);
  });
});

describe('#42 AC4: PUT /api/me/home needs valid lat/lng; free text is never looked up', () => {
  it.each([
    ['address only', { address: '1 Pretend St, Carlton', country: 'AU' }],
    ['address with invalid coordinates', { address: '1 Pretend St, Carlton', lat: 'x', lng: 144.97, country: 'AU' }],
  ])('%s is a 400, nothing is saved, and Nominatim is not asked', async (_, body) => {
    const calls: URL[] = [];
    const ctx = testApp({ fetch: fakeFetch((url) => void calls.push(url), fakeNominatim({ '1 Pretend St, Carlton': { lat: -37.8, lng: 144.97 } })) });
    const alex = await signedInDevice(ctx.app, 'Alex');
    expect((await alex.put('/api/me/home', body)).status).toBe(400);
    expect((await (await alex.get('/api/me')).json()).home).toBeNull();
    expect(calls.filter((u) => u.hostname === 'nominatim.openstreetmap.org')).toHaveLength(0);
  });
});

describe("#32 AC4: Photon can't be reached", () => {
  it('an error status from Photon is a 502', async () => {
    const { alex } = await setup(fakePhoton([PRETEND_ST], { status: 503 }));
    const res = await alex.get('/api/geocode?q=pretend');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/unavailable/i);
  });

  it('a network failure is a 502, and the saved home is unchanged', async () => {
    const { alex } = await setup(() => undefined); // nothing answers: fakeFetch throws, like a network error
    await alex.put('/api/me/home', { address: '1 Pretend St, Carlton', lat: -37.8, lng: 144.97, country: 'AU' });
    expect((await alex.get('/api/geocode?q=pretend')).status).toBe(502);
    expect((await (await alex.get('/api/me')).json()).home).toEqual({ address: '1 Pretend St, Carlton', lat: -37.8, lng: 144.97, country: 'AU' });
  });
});

describe("#50: address suggestions lean towards the group's places", () => {
  const placeLink = (hex: string, lat: number, lng: number) => `https://www.google.com/maps/place/Invented/@${lat},${lng},17z/data=!4m6!3m5!1s0x1:0x${hex}!8m2!3d${lat}!4d${lng}`;

  it('#50 AC1: with located places, suggestions are biased to their centre as well as filtered by country', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([PRETEND_ST], { calls }));
    await alex.post('/api/places', { url: placeLink('a1', -37.8, 144.96) });
    await alex.post('/api/places', { url: placeLink('a2', -37.82, 144.98) });
    await alex.get('/api/geocode?q=1%20Pretend&country=AU');
    expect(Number(calls[0].url.searchParams.get('lat'))).toBeCloseTo(-37.81, 5);
    expect(Number(calls[0].url.searchParams.get('lon'))).toBeCloseTo(144.97, 5);
    expect(calls[0].url.searchParams.get('countrycode')).toBe('AU');
  });

  it('#50 AC2: with no located places, no bias', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([PRETEND_ST], { calls }));
    await alex.get('/api/geocode?q=1%20Pretend&country=AU');
    expect(calls[0].url.searchParams.has('lat')).toBe(false);
    expect(calls[0].url.searchParams.has('lon')).toBe(false);
  });
});

describe('#48: address suggestions filtered by country, and a home remembers its country', () => {
  const VIENNA_ST: PhotonPlace = {
    lat: 48.2,
    lng: 16.37,
    properties: { housenumber: '1', street: 'Pretend Strasse', city: 'Wien', country: 'Austria', countrycode: 'AT' },
  };

  it('#48 AC1: ?country=AU is passed to Photon and only Australian addresses come back', async () => {
    const calls: { url: URL }[] = [];
    const { alex } = await setup(fakePhoton([PRETEND_ST, VIENNA_ST], { calls }));
    const suggestions = await (await alex.get('/api/geocode?q=1%20Pretend&country=AU')).json();
    expect(calls[0].url.searchParams.get('countrycode')).toBe('AU');
    expect(suggestions.map((s: { label: string }) => s.label)).toEqual(['1 Pretend Street, Carlton, Melbourne, Victoria, Australia']);
  });

  it('#48 AC2: saving a home stores its country, and /api/me includes it', async () => {
    const { alex } = await setup(fakePhoton([]));
    expect((await alex.put('/api/me/home', { address: 'Somewhere', lat: -37.8, lng: 144.9, country: 'au' })).status).toBe(200);
    expect((await (await alex.get('/api/me')).json()).home).toEqual({ address: 'Somewhere', lat: -37.8, lng: 144.9, country: 'AU' });
  });

  it.each([
    ['no country', {}],
    ['an empty country', { country: '' }],
    ['a three-letter code', { country: 'AUS' }],
    ['a made-up code', { country: 'ZZ' }],
    ['a number', { country: 12 }],
  ])('#48 AC3: %s is a 400 saying to pick a country, and nothing is saved', async (_, extra) => {
    const { alex } = await setup(fakePhoton([]));
    const res = await alex.put('/api/me/home', { address: 'Somewhere', lat: -37.8, lng: 144.9, ...extra });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/pick a country/i);
    expect((await (await alex.get('/api/me')).json()).home).toBeNull();
  });
});
