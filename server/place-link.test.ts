import { describe, expect, it } from 'vitest';
import { fakeFetch, fakeNominatim, signedInDevice, testApp } from './test-helpers.ts';

// Invented places only.
const FULL_LINK = 'https://www.google.com/maps/place/Pretend+Noodle+Bar/@-37.8102,144.9631,17z/data=!4m6!3m5!1s0x1:0xabc123!8m2!3d-37.8103!4d144.9632';
const WITH_ADDRESS = 'https://maps.google.com/?q=Pretend+Pie+Shop,+1+Invented+St,+Melbourne+VIC+3000&ftid=0x1:0xdef456';
const NAME_ONLY = 'https://maps.google.com/?q=Pretend+Pie+Shop&ftid=0x1:0xdef457';
const NO_LOCATION = 'https://maps.google.com/?cid=123456789';

async function setup() {
  const nominatimCalls: URL[] = [];
  const nominatim = fakeNominatim({ 'Pretend Pie Shop, 1 Invented St, Melbourne VIC 3000': { lat: -37.81, lng: 144.96 }, 'Pretend Pie Shop': { lat: 51.5, lng: -0.1 } });
  const ctx = testApp({ fetch: fakeFetch((url, init) => (url.pathname === '/search' && void nominatimCalls.push(url), nominatim(url, init))) });
  const alex = await signedInDevice(ctx.app, 'Alex');
  const preview = (url: string) => alex.get(`/api/places/link?url=${encodeURIComponent(url)}`);
  return { ...ctx, alex, preview, nominatimCalls };
}

describe('#44 AC2: previewing the place a Google Maps link points to, before adding it', () => {
  it('gives its name and location without adding it', async () => {
    const { alex, preview } = await setup();
    const res = await preview(FULL_LINK);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Pretend Noodle Bar', lat: -37.8103, lng: 144.9632 });
    expect(await (await alex.get('/api/places')).json()).toEqual([]);
  });

  it('locates a link that carries a full address rather than coordinates', async () => {
    const { preview } = await setup();
    expect(await (await preview(WITH_ADDRESS)).json()).toEqual({ name: 'Pretend Pie Shop', lat: -37.81, lng: 144.96 });
  });

  it('says what is wrong with something that is not a place link', async () => {
    const { preview } = await setup();
    const res = await preview('https://example.com/nope');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn.t a google maps place link/i);
  });
});

describe("#44 AC4: a link that can't be pinned to a location can't be added", () => {
  it.each([
    ['no location at all', NO_LOCATION],
    ['only a name, no address', NAME_ONLY],
  ])('%s: the preview and adding both refuse, and nothing is looked up by name', async (_, link) => {
    const { alex, preview, nominatimCalls } = await setup();
    const res = await preview(link);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/doesn.t say where/i);
    expect((await alex.post('/api/places', { url: link })).status).toBe(400);
    expect(await (await alex.get('/api/places')).json()).toEqual([]);
    expect(nominatimCalls).toHaveLength(0);
  });
});
