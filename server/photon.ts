import { Hono } from 'hono';
import type { Deps } from './app.ts';
import { countryCode, type AppEnv } from './auth.ts';
import { USER_AGENT, type LatLng } from './nominatim.ts';

const MAX_SUGGESTIONS = 5;

export type Suggestion = { label: string; lat: number; lng: number };
export type PlaceResult = { key: string; name: string; address: string; lat: number; lng: number };
type Properties = Record<string, string | number | undefined>;
type Feature = { geometry: { coordinates: [number, number] }; properties: Properties };

const parts = (...values: (string | number | undefined)[]) => values.filter((v): v is string | number => v !== undefined && v !== '').map(String);

/** "1 Pretend Street, Carlton, Melbourne, Victoria, Australia": Photon returns the parts, not a display name. */
function label(p: Properties) {
  const street = parts(p.housenumber, p.street).join(' ');
  return [...new Set(parts(p.name, street, p.district ?? p.locality, p.city, p.state, p.country))].join(', ');
}

/** "12 Invented Street, Carlton": where a place is, without its name. */
function addressLine(p: Properties) {
  return parts(parts(p.housenumber, p.street).join(' '), p.district ?? p.locality ?? p.city).join(', ');
}

const at = (f: Feature) => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });

/** Photon (photon.komoot.io), which, unlike Nominatim, allows search-as-you-type. Throws if Photon can't be reached. */
async function photon(fetchFn: typeof fetch, q: string, extra: [string, string][] = []): Promise<Feature[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.search = new URLSearchParams([['q', q], ['limit', String(MAX_SUGGESTIONS)], ['lang', 'en'], ...extra]).toString();
  const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const { features = [] } = (await res.json()) as { features?: Feature[] };
  return features.slice(0, MAX_SUGGESTIONS);
}

const FOOD_AND_DRINK = ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court', 'ice_cream', 'biergarten'].map((v): [string, string] => ['osm_tag', `amenity:${v}`]);

/** Food and drink places matching `q`, favouring ones near `near`. Keyed by OSM type and id, e.g. "osm:N123". */
export async function searchPlaces(fetchFn: typeof fetch, q: string, near?: LatLng): Promise<PlaceResult[]> {
  const bias: [string, string][] = near ? [['lat', String(near.lat)], ['lon', String(near.lng)]] : [];
  return (await photon(fetchFn, q, [...FOOD_AND_DRINK, ...bias]))
    .filter((f) => f.properties.name)
    .map((f) => ({ key: `osm:${f.properties.osm_type}${f.properties.osm_id}`, name: String(f.properties.name), address: addressLine(f.properties), ...at(f) }));
}

export function geocodeRoutes({ fetch }: Deps) {
  const api = new Hono<AppEnv>();
  /** Addresses matching `q`, in `country` (a two-letter code) if given. */
  api.get('/', async (c) => {
    const q = c.req.query('q')?.trim();
    if (!q) return c.json([]);
    const country = countryCode(c.req.query('country'));
    const inCountry: [string, string][] = country ? [['countrycode', country]] : [];
    try {
      return c.json((await photon(fetch, q, inCountry)).map((f): Suggestion => ({ label: label(f.properties), ...at(f) })));
    } catch {
      return c.json({ error: 'Address suggestions are unavailable right now.' }, 502);
    }
  });
  return api;
}
