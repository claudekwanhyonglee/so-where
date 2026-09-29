import { Hono } from 'hono';
import type { Deps } from './app.ts';
import type { AppEnv } from './auth.ts';
import { USER_AGENT } from './nominatim.ts';

const MAX_SUGGESTIONS = 5;

export type Suggestion = { label: string; lat: number; lng: number };
type Feature = { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> };

/** "1 Pretend Street, Carlton, Melbourne, Victoria, Australia": Photon returns the parts, not a display name. */
function label(p: Feature['properties']) {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const parts = [p.name, street, p.district ?? p.locality, p.city, p.state, p.country].filter((part): part is string => !!part);
  return [...new Set(parts)].join(', ');
}

/**
 * Address suggestions from Photon (photon.komoot.io), which, unlike Nominatim, allows search-as-you-type.
 * Throws if Photon can't be reached.
 */
async function suggest(fetchFn: typeof fetch, q: string): Promise<Suggestion[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams({ q, limit: String(MAX_SUGGESTIONS), lang: 'en' }).toString();
  const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const { features = [] } = (await res.json()) as { features?: Feature[] };
  return features.slice(0, MAX_SUGGESTIONS).map((f) => ({ label: label(f.properties), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
}

export function geocodeRoutes({ fetch }: Deps) {
  const api = new Hono<AppEnv>();
  api.get('/', async (c) => {
    const q = c.req.query('q')?.trim();
    if (!q) return c.json([]);
    try {
      return c.json(await suggest(fetch, q));
    } catch {
      return c.json({ error: 'Address suggestions are unavailable right now.' }, 502);
    }
  });
  return api;
}
