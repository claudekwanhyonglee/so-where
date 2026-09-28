import type { Db } from './db.ts';

export const USER_AGENT = 'so-where/0.1 (self-hosted restaurant ranker; https://github.com/claudekwanhyonglee/so-where)';

export type LatLng = { lat: number; lng: number };

/**
 * OpenStreetMap Nominatim, within its usage policy: an identifying User-Agent,
 * at most one request per `intervalMs`, and every answer cached in the database.
 */
export function createNominatim(db: Db, fetchFn: typeof fetch, intervalMs: number) {
  let queue = Promise.resolve();
  let lastCall = 0;

  const throttled = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(async () => {
      const wait = lastCall + intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      return task();
    });
    queue = run.then(() => undefined, () => undefined);
    return run;
  };

  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = db.prepare('SELECT result FROM geocode_cache WHERE key = ?').pluck().get(key) as string | undefined;
    if (hit !== undefined) return JSON.parse(hit);
    const result = await throttled(load);
    db.prepare('INSERT OR REPLACE INTO geocode_cache (key, result) VALUES (?, ?)').run(key, JSON.stringify(result));
    return result;
  }

  async function get(path: string, params: Record<string, string>) {
    const url = new URL(path, 'https://nominatim.openstreetmap.org');
    url.search = new URLSearchParams({ format: 'jsonv2', ...params }).toString();
    const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' } });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return res.json();
  }

  return {
    search: (address: string): Promise<LatLng | null> =>
      cached(`search:${address.trim().toLowerCase()}`, async () => {
        const [hit] = (await get('/search', { q: address, limit: '1' })) as { lat: string; lon: string }[];
        return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
      }),

    suburb: ({ lat, lng }: LatLng): Promise<string | null> =>
      cached(`suburb:${lat.toFixed(5)},${lng.toFixed(5)}`, async () => {
        const { address = {} } = (await get('/reverse', { lat: String(lat), lon: String(lng), zoom: '14' })) as {
          address?: Record<string, string>;
        };
        return address.suburb ?? address.neighbourhood ?? address.town ?? address.village ?? address.city_district ?? address.city ?? null;
      }),
  };
}

export type Nominatim = ReturnType<typeof createNominatim>;
