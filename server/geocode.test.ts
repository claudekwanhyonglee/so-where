import { describe, expect, it } from 'vitest';
import { fakeFetch, fakeNominatim, fakePhoton, signedInDevice, testApp, type PhotonPlace } from './test-helpers.ts';

const PRETEND_ST: PhotonPlace = {
  lat: -37.7991,
  lng: 144.9671,
  properties: { housenumber: '1', street: 'Pretend Street', district: 'Carlton', city: 'Melbourne', state: 'Victoria', country: 'Australia' },
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
    const chosen = { address: 'Somewhere Nominatim Does Not Know', lat: -37.7991, lng: 144.9671 };
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
    await alex.put('/api/me/home', { address: 'Before', lat: -37.8, lng: 144.9 });
    const res = await alex.put('/api/me/home', { address: 'After', ...coords });
    expect(res.status).toBe(400);
    expect((await (await alex.get('/api/me')).json()).home).toEqual({ address: 'Before', lat: -37.8, lng: 144.9 });
  });

  it('NaN and Infinity (which JSON turns into null) are rejected too', async () => {
    const { alex } = await setup(fakePhoton([]));
    expect((await alex.put('/api/me/home', { address: 'X', lat: NaN, lng: Infinity })).status).toBe(400);
    expect((await (await alex.get('/api/me')).json()).home).toBeNull();
  });

  it('the boundaries themselves are fine', async () => {
    const { alex } = await setup(fakePhoton([]));
    expect((await alex.put('/api/me/home', { address: 'Edge', lat: -90, lng: 180 })).status).toBe(200);
  });

  it('the address-only form still looks the address up', async () => {
    const { alex } = await setup(fakePhoton([]));
    expect((await alex.put('/api/me/home', { address: '1 Pretend St, Carlton' })).status).toBe(200);
    expect((await (await alex.get('/api/me')).json()).home).toEqual({ address: '1 Pretend St, Carlton', lat: -37.8, lng: 144.97 });
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
    await alex.put('/api/me/home', { address: '1 Pretend St, Carlton' });
    expect((await alex.get('/api/geocode?q=pretend')).status).toBe(502);
    expect((await (await alex.get('/api/me')).json()).home).toEqual({ address: '1 Pretend St, Carlton', lat: -37.8, lng: 144.97 });
  });
});
