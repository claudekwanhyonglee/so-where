import { createApp, type Config, type Deps } from './app.ts';
import { openDb } from './db.ts';

export const INVITE = 'test-invite';

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response> | undefined;

/** A fetch that only answers the routes given, and fails loudly on anything else, so tests never reach the network. */
export function fakeFetch(...routes: Route[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    for (const route of routes) {
      const res = await route(url, init);
      if (res) return res;
    }
    throw new Error(`Unexpected external request in test: ${url}`);
  }) as typeof fetch;
}

export const json = (body: unknown) => Response.json(body);

/** Fake Nominatim: `places` maps a searched address to its coordinates. */
export function fakeNominatim(places: Record<string, { lat: number; lng: number }> = {}, suburb = 'Carlton'): Route {
  return (url) => {
    if (url.hostname !== 'nominatim.openstreetmap.org') return;
    if (url.pathname === '/search') {
      const hit = places[url.searchParams.get('q') ?? ''];
      return json(hit ? [{ lat: String(hit.lat), lon: String(hit.lng), display_name: url.searchParams.get('q') }] : []);
    }
    if (url.pathname === '/reverse') return json({ address: { suburb } });
  };
}

/** Fake Transitous: answers every trip with itineraries of the given durations (seconds), or with `status` if set. */
export function fakeTransitous(durations: number[], opts: { status?: number; calls?: URL[] } = {}): Route {
  return (url) => {
    if (url.hostname !== 'api.transitous.org') return;
    opts.calls?.push(url);
    if (opts.status) return new Response('unavailable', { status: opts.status });
    return json({ itineraries: durations.map((duration) => ({ duration, legs: [] })), direct: [] });
  };
}

export type PhotonPlace = { lat: number; lng: number; properties: Record<string, string> };

/**
 * Fake Photon: answers with every place whose properties contain the query (ignoring `limit`, so callers must cap)
 * and, if `osm_tag` filters are given, whose `osm_key:osm_value` is one of them, and, if `countrycode` is given, in that
 * country, as GeoJSON features, or with `status` if set.
 */
export function fakePhoton(places: PhotonPlace[], opts: { status?: number; calls?: { url: URL; init?: RequestInit }[] } = {}): Route {
  return (url, init) => {
    if (url.hostname !== 'photon.komoot.io') return;
    opts.calls?.push({ url, init });
    if (opts.status) return new Response('unavailable', { status: opts.status });
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const tags = url.searchParams.getAll('osm_tag');
    const country = url.searchParams.get('countrycode')?.toUpperCase();
    const hits = places.filter(
      (p) =>
        Object.values(p.properties).join(' ').toLowerCase().includes(q) &&
        (!tags.length || tags.includes(`${p.properties.osm_key}:${p.properties.osm_value}`)) &&
        (!country || p.properties.countrycode?.toUpperCase() === country),
    );
    return json({
      type: 'FeatureCollection',
      features: hits.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: p.properties })),
    });
  };
}

export function testApp(opts: { fetch?: typeof fetch; now?: () => number; config?: Partial<Config> } = {}) {
  const db = openDb(':memory:');
  const config: Config = {
    webRoot: 'dist/web',
    inviteCode: INVITE,
    pinPepper: 'test-pepper',
    geocodeIntervalMs: 0,
    maxSessions: 20,
    ...opts.config,
  };
  const deps: Deps = { db, config, fetch: opts.fetch ?? fakeFetch(), now: opts.now ?? Date.now };
  return { app: createApp(deps), ...deps };
}

type App = ReturnType<typeof createApp>;

/** A cookie-keeping client, standing in for one device's browser. Starts with the invite cookie unless told not to. */
export function device(app: App, { invited = true } = {}) {
  const jar = new Map<string, string>(invited ? [['sw_invite', INVITE]] : []);

  async function request(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {
      cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
    };
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
    const payload = body === undefined ? undefined : isForm ? body : JSON.stringify(body);
    const res = await app.request(path, { method, headers, body: payload });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const [name, value] = pair.split('=');
      const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim()));
      if (expired) jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }
    return res;
  }

  return {
    jar,
    get: (path: string) => request('GET', path),
    post: (path: string, body?: unknown) => request('POST', path, body ?? {}),
    put: (path: string, body?: unknown) => request('PUT', path, body ?? {}),
    patch: (path: string, body?: unknown) => request('PATCH', path, body ?? {}),
    del: (path: string) => request('DELETE', path),
    upload: (path: string, files: { name: string; content: string }[]) => {
      const form = new FormData();
      for (const f of files) form.append('files', new File([f.content], f.name));
      return request('POST', path, form);
    },
  };
}

/** A new person, signed in on a fresh device. */
export async function signedInDevice(app: App, name = 'Alex', pin = '1234') {
  const d = device(app);
  const res = await d.post('/api/people', { name, pin });
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  return d;
}
