import { describe, expect, it } from 'vitest';
import { fakeFetch, fakeNominatim, fakeTransitous, signedInDevice, testApp } from './test-helpers.ts';

const HOME = '1 Pretend St, Carlton';
const NEW_HOME = '5 Madeup Rd, Windsor';
const placeLink = (hex: string, name: string, lat: number, lng: number) =>
  `https://www.google.com/maps/place/${name.replaceAll(' ', '+')}/@${lat},${lng},17z/data=!4m6!3m5!1s0x1:0x${hex}!8m2!3d${lat}!4d${lng}`;

async function setup(transitous: ReturnType<typeof fakeTransitous>, now = () => Date.UTC(2026, 8, 28, 8, 0)) {
  const ctx = testApp({ fetch: fakeFetch(fakeNominatim({ [HOME]: { lat: -37.79, lng: 144.97 }, [NEW_HOME]: { lat: -37.85, lng: 144.99 } }), transitous), now });
  const alex = await signedInDevice(ctx.app, 'Alex');
  const place = (await (await alex.post('/api/places', { url: placeLink('c1', 'Invented Noodles', -37.8103, 144.9632) })).json()).place;
  await alex.post('/api/places', { url: placeLink('c2', 'Invented Dumplings', -37.82, 144.97) });
  const sessionId = (await (await alex.post('/api/sessions', { setId: 'all' })).json()).id as string;
  const transit = async (who = alex, sid = sessionId) => (await who.get(`/api/sessions/${sid}/transit?place=${place.id}`)).json();
  return { ...ctx, alex, place, sessionId, transit };
}

describe('#10 AC1: transit time from home, leaving now', () => {
  it("shows the viewer's fastest public transport time from their home", async () => {
    const calls: URL[] = [];
    const { alex, transit } = await setup(fakeTransitous([2280, 1900, 2500], { calls }));
    await alex.put('/api/me/home', { address: HOME });

    expect(await transit()).toEqual({ minutes: 32 }); // 1900 s, rounded
    const [url] = calls;
    expect(url.pathname).toBe('/api/v5/plan');
    expect(url.searchParams.get('fromPlace')).toBe('-37.79,144.97');
    expect(url.searchParams.get('toPlace')).toBe('-37.8103,144.9632');
    expect(url.searchParams.get('time')).toBe('2026-09-28T08:00:00.000Z');
    expect(url.searchParams.get('arriveBy')).toBe('false');
  });

  it('sends an identifying User-Agent', async () => {
    let userAgent: string | null = null;
    const ctx = await setup(((url: URL, init?: RequestInit) => {
      if (url.hostname !== 'api.transitous.org') return;
      userAgent = new Headers(init?.headers).get('user-agent');
      return Response.json({ itineraries: [{ duration: 600 }] });
    }) as ReturnType<typeof fakeTransitous>);
    await ctx.alex.put('/api/me/home', { address: HOME });
    await ctx.transit();
    expect(userAgent).toMatch(/so-where/);
  });
});

describe('#10 AC2: falls back to directions', () => {
  it('without a home address: no time, and Transitous is not called', async () => {
    const calls: URL[] = [];
    const { transit } = await setup(fakeTransitous([600], { calls }));
    expect(await transit()).toEqual({ minutes: null, reason: 'no-home' });
    expect(calls).toHaveLength(0);
  });

  it('when no trip is found', async () => {
    const { alex, transit } = await setup(fakeTransitous([]));
    await alex.put('/api/me/home', { address: HOME });
    expect(await transit()).toEqual({ minutes: null, reason: 'no-trip' });
  });

  it('when Transitous fails, and it tries again next time', async () => {
    const calls: URL[] = [];
    const { alex, transit } = await setup(fakeTransitous([600], { status: 503, calls }));
    await alex.put('/api/me/home', { address: HOME });
    expect(await transit()).toEqual({ minutes: null, reason: 'unavailable' });
    await transit();
    expect(calls).toHaveLength(2);
  });
});

describe('#10 AC3: cached per person and place for the session', () => {
  it('reuses the answer within the session, but not across people, sessions or a new home', async () => {
    const calls: URL[] = [];
    const { app, alex, transit, sessionId } = await setup(fakeTransitous([900], { calls }));
    await alex.put('/api/me/home', { address: HOME });

    await transit();
    await transit();
    expect(calls).toHaveLength(1);

    const jo = await signedInDevice(app, 'Jo');
    await jo.put('/api/me/home', { address: HOME });
    await jo.post(`/api/sessions/${sessionId}/join`);
    await transit(jo);
    expect(calls).toHaveLength(2);

    const tomorrow = (await (await alex.post('/api/sessions', { setId: 'all' })).json()).id;
    await transit(alex, tomorrow);
    expect(calls).toHaveLength(3);

    await alex.put('/api/me/home', { address: NEW_HOME });
    await transit();
    expect(calls).toHaveLength(4);
    expect(calls[3].searchParams.get('fromPlace')).toBe('-37.85,144.99');
  });

  it('a cached "no trip" is reused too', async () => {
    const calls: URL[] = [];
    const { alex, transit } = await setup(fakeTransitous([], { calls }));
    await alex.put('/api/me/home', { address: HOME });
    await transit();
    await transit();
    expect(calls).toHaveLength(1);
  });
});
