import { describe, expect, it } from 'vitest';
import { parsePlaceUrl, placeKey } from './google-maps.ts';
import { device, fakeFetch, fakeNominatim, signedInDevice, testApp } from './test-helpers.ts';

// The example link from the epic.
const GAI_WONG =
  'https://www.google.com/maps/place/Gai+Wong/@-37.8008832,144.956052,3a,75y,90t/data=!3m8!1e2!3m6!1sAF1QipN!2e10!4m7!3m6!1s0x6ad65d885c2976af:0xb47376b6036f6f23!8m2!3d-37.8008832!4d144.956052!10e5!16s%2Fg%2F11j65xsb0l?entry=ttu';
const GAI_WONG_KEY = BigInt('0xb47376b6036f6f23').toString();

// Invented places from here on.
const NOODLE_BAR =
  'https://www.google.com/maps/place/Pretend+Noodle+Bar/@-37.8102,144.9631,17z/data=!3m1!4b1!4m6!3m5!1s0x6ad642b0aaaa0001:0x1a2b3c4d5e6f7081!8m2!3d-37.8103!4d144.9632!16s?entry=ttu';
const SHORT_LINK = 'https://maps.app.goo.gl/InventedShare123';

function shortLinkRedirect(to: string) {
  return (url: URL) => (url.href === SHORT_LINK ? new Response(null, { status: 302, headers: { location: to } }) : undefined);
}

describe('#4 AC1: parsing a full Google Maps place link', () => {
  it('reads name, coordinates (!3d/!4d) and the normalised place ID', () => {
    expect(parsePlaceUrl(GAI_WONG)).toEqual({ key: GAI_WONG_KEY, name: 'Gai Wong', lat: -37.8008832, lng: 144.956052 });
  });

  it('prefers !3d/!4d (the place) over @lat,lng (the viewport)', () => {
    expect(parsePlaceUrl(NOODLE_BAR)).toMatchObject({ name: 'Pretend Noodle Bar', lat: -37.8103, lng: 144.9632 });
  });

  it('falls back to @lat,lng', () => {
    const url = 'https://www.google.com/maps/place/Made+Up+Cafe/@-37.81,144.96,17z/data=!4m2!3m1!1s0x0:0x2a';
    expect(parsePlaceUrl(url)).toEqual({ key: '42', name: 'Made Up Cafe', lat: -37.81, lng: 144.96 });
  });

  it('normalises the 0x…:0x… form and ?cid= to the same key', () => {
    expect(placeKey('https://maps.google.com/?cid=13002867073262513955')).toBe(GAI_WONG_KEY);
    expect(placeKey(GAI_WONG)).toBe('13002867073262513955');
  });

  it('decodes names with punctuation and non-ASCII', () => {
    const url = 'https://www.google.com/maps/place/Caf%C3%A9+%26+Bar+%2743%27/@-37.8,144.9,17z/data=!4m2!3m1!1s0x1:0x2b';
    expect(parsePlaceUrl(url)?.name).toBe("Café & Bar '43'");
  });

  it('adds the place via the API', async () => {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const me = await signedInDevice(app);
    const res = await me.post('/api/places', { url: GAI_WONG });
    expect(res.status).toBe(201);
    expect((await res.json()).place).toMatchObject({ key: GAI_WONG_KEY, name: 'Gai Wong', lat: -37.8008832, lng: 144.956052 });
  });
});

describe('#4 AC2: short share links', () => {
  it('resolves maps.app.goo.gl server-side to the same place as the full link', async () => {
    const { app } = testApp({ fetch: fakeFetch(shortLinkRedirect(GAI_WONG), fakeNominatim()) });
    const me = await signedInDevice(app);
    const res = await me.post('/api/places', { url: SHORT_LINK });
    expect(res.status).toBe(201);
    expect((await res.json()).place).toMatchObject({ key: GAI_WONG_KEY, name: 'Gai Wong', lat: -37.8008832, lng: 144.956052 });
  });

  it('handles the ?q=…&ftid=… form some share links resolve to, locating it by address', async () => {
    const resolved = 'https://maps.google.com/?q=Pretend+Noodle+Bar,+1+Invented+St,+Melbourne+VIC+3000&ftid=0x6ad642b0aaaa0001:0x1a2b3c4d5e6f7081&entry=gps';
    const nominatim = fakeNominatim({ 'Pretend Noodle Bar, 1 Invented St, Melbourne VIC 3000': { lat: -37.81, lng: 144.96 } });
    const { app } = testApp({ fetch: fakeFetch(shortLinkRedirect(resolved), nominatim) });
    const me = await signedInDevice(app);
    const res = await me.post('/api/places', { url: SHORT_LINK });
    expect(res.status).toBe(201);
    expect((await res.json()).place).toMatchObject({ key: BigInt('0x1a2b3c4d5e6f7081').toString(), name: 'Pretend Noodle Bar', lat: -37.81 });
  });

  it('refuses to follow a short link that redirects away from Google', async () => {
    const { app } = testApp({ fetch: fakeFetch(shortLinkRedirect('http://169.254.169.254/latest/meta-data')) });
    const me = await signedInDevice(app);
    expect((await me.post('/api/places', { url: SHORT_LINK })).status).toBe(400);
  });
});

describe('#4 AC3: suburb and note', () => {
  it('looks the suburb up from the coordinates and keeps an optional note', async () => {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim({}, 'Melbourne')) });
    const me = await signedInDevice(app);
    const res = await me.post('/api/places', { url: GAI_WONG, note: 'Get the chicken rice' });
    expect((await res.json()).place).toMatchObject({ suburb: 'Melbourne', note: 'Get the chicken rice' });
  });

  it('still adds the place if the suburb lookup fails', async () => {
    const down = () => new Response('busy', { status: 503 });
    const { app } = testApp({ fetch: fakeFetch(down) });
    const me = await signedInDevice(app);
    const res = await me.post('/api/places', { url: GAI_WONG });
    expect(res.status).toBe(201);
    expect((await res.json()).place.suburb).toBeNull();
  });
});

describe('#4 AC4: no duplicates', () => {
  it('pasting a place already in the list says so and adds nothing', async () => {
    const { app } = testApp({ fetch: fakeFetch(shortLinkRedirect(GAI_WONG), fakeNominatim()) });
    const me = await signedInDevice(app);
    await me.post('/api/places', { url: GAI_WONG });
    const again = await me.post('/api/places', { url: SHORT_LINK });
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.existing).toBe(true);
    expect(body.message).toMatch(/already/i);
    expect(await (await me.get('/api/places')).json()).toHaveLength(1);
  });
});

describe('#19 AC3: adding a place into sets', () => {
  async function withSets() {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const me = await signedInDevice(app);
    const [dates, cheap] = await Promise.all(['Date night', 'Cheap eats'].map(async (name) => (await (await me.post('/api/sets', { name })).json()).id as number));
    const setsOf = async (name: string) => ((await (await me.get('/api/places')).json()) as { name: string; setIds: number[] }[]).find((p) => p.name === name)!.setIds;
    return { me, dates, cheap, setsOf };
  }

  it('puts the new place in every set given, and lists each place with its sets', async () => {
    const { me, dates, cheap, setsOf } = await withSets();
    expect((await me.post('/api/places', { url: NOODLE_BAR, setIds: [dates, 'all'] })).status).toBe(201);
    await me.post('/api/places', { url: GAI_WONG });
    expect(await setsOf('Pretend Noodle Bar')).toEqual([dates]);
    expect(await setsOf('Gai Wong')).toEqual([]);
    expect((await (await me.get(`/api/sets/${dates}`)).json()).placeIds).toHaveLength(1);
    expect((await (await me.get(`/api/sets/${cheap}`)).json()).placeIds).toHaveLength(0);
  });

  it('adds a place that is already there to the sets given', async () => {
    const { me, dates, cheap, setsOf } = await withSets();
    await me.post('/api/places', { url: NOODLE_BAR, setIds: [dates] });
    const again = await me.post('/api/places', { url: NOODLE_BAR, setIds: [cheap] });
    expect((await again.json()).existing).toBe(true);
    expect((await setsOf('Pretend Noodle Bar')).sort()).toEqual([dates, cheap].sort());
  });

  it('refuses an unknown set, adding nothing', async () => {
    const { me } = await withSets();
    expect((await me.post('/api/places', { url: NOODLE_BAR, setIds: [999] })).status).toBe(404);
    expect(await (await me.get('/api/places')).json()).toHaveLength(0);
  });
});

describe('#4 AC5: the shared places list', () => {
  it('lists all places, and anyone can edit a note or delete a place', async () => {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const alex = await signedInDevice(app, 'Alex');
    const jo = await signedInDevice(app, 'Jo');
    await alex.post('/api/places', { url: GAI_WONG });
    await alex.post('/api/places', { url: NOODLE_BAR });

    const list = await (await jo.get('/api/places')).json();
    expect(list.map((p: { name: string }) => p.name).sort()).toEqual(['Gai Wong', 'Pretend Noodle Bar']);

    const gai = list.find((p: { name: string }) => p.name === 'Gai Wong');
    expect((await jo.patch(`/api/places/${gai.id}`, { note: 'Cash only?' })).status).toBe(200);
    expect((await (await alex.get('/api/places')).json()).find((p: { id: number }) => p.id === gai.id).note).toBe('Cash only?');

    expect((await jo.del(`/api/places/${gai.id}`)).status).toBe(200);
    expect(await (await alex.get('/api/places')).json()).toHaveLength(1);
    expect((await jo.del(`/api/places/${gai.id}`)).status).toBe(404);
  });

  it('requires signing in', async () => {
    const { app } = testApp();
    expect((await device(app).get('/api/places')).status).toBe(401);
  });
});

describe('#4 AC6: links that are not Google Maps place links', () => {
  it.each([
    'not a url at all',
    'https://example.com/maps/place/Foo/@1,2,3z',
    'https://www.google.com/search?q=pizza',
    'https://www.google.com/maps/dir/?api=1&destination=-37.8,144.9',
    'https://www.google.com/maps/@-37.8,144.9,15z',
  ])('%s is rejected with a clear error and adds nothing', async (url) => {
    const { app } = testApp({ fetch: fakeFetch(fakeNominatim()) });
    const me = await signedInDevice(app);
    const res = await me.post('/api/places', { url });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/google maps place link/i);
    expect(await (await me.get('/api/places')).json()).toHaveLength(0);
  });
});
