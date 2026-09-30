import { Hono } from 'hono';
import type { Deps } from './app.ts';
import { isCoordinate, type AppEnv } from './auth.ts';
import type { Db } from './db.ts';
import { resolvePlaceLink, type ParsedPlace } from './google-maps.ts';
import type { LatLng, Nominatim } from './nominatim.ts';
import { searchPlaces } from './photon.ts';
import { groupCentre } from './place-lookup.ts';
import { ALL_PLACES, setExists } from './sets.ts';

export type Place = {
  id: number;
  key: string;
  name: string;
  lat: number | null;
  lng: number | null;
  suburb: string | null;
  note: string;
};

const PLACE_COLUMNS = 'id, key, name, lat, lng, suburb, note';

export const findPlaceByKey = (db: Db, key: string) =>
  db.prepare(`SELECT ${PLACE_COLUMNS} FROM places WHERE key = ?`).get(key) as Place | undefined;

export const getPlace = (db: Db, id: number) => db.prepare(`SELECT ${PLACE_COLUMNS} FROM places WHERE id = ?`).get(id) as Place | undefined;

export async function insertPlace(
  db: Db,
  nominatim: Nominatim,
  now: number,
  place: { key: string; name: string; lat: number | null; lng: number | null; note?: string },
): Promise<Place> {
  const suburb = place.lat === null || place.lng === null ? null : await nominatim.suburb({ lat: place.lat, lng: place.lng }).catch(() => null);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO places (key, name, lat, lng, suburb, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(place.key, place.name, place.lat, place.lng, suburb, place.note?.trim() ?? '', now);
  return getPlace(db, Number(lastInsertRowid))!;
}

/** A search result the client chose, if it's well formed. */
function searchResult({ key, name, lat, lng }: Record<string, unknown>): ParsedPlace | null {
  if (typeof key !== 'string' || !/^osm:[NWR]\d+$/.test(key)) return null;
  if (typeof name !== 'string' || !name.trim() || !isCoordinate(lat, 90) || !isCoordinate(lng, 180)) return null;
  return { key, name: name.trim(), lat, lng };
}

const NOT_A_PLACE_LINK =
  "That isn't a Google Maps place link. In Google Maps, open the restaurant, tap Share and copy the link.";
const CANT_LOCATE = "That link doesn't say where the place is. Open the restaurant in Google Maps and copy its link again, or search for it by name.";

export function placesRoutes({ db, fetch, now }: Deps, nominatim: Nominatim) {
  const api = new Hono<AppEnv>();

  /** Where a link's place is: its coordinates, or the address after its name in `q`. Never looked up from the name alone. */
  const locate = async ({ lat, lng, query }: ParsedPlace): Promise<LatLng | null> => {
    if (lat !== undefined && lng !== undefined) return { lat, lng };
    return query?.includes(',') ? nominatim.search(query).catch(() => null) : null;
  };

  /** Every place, each with the ids of the named sets it's in. */
  api.get('/', (c) => {
    const places = db.prepare(`SELECT ${PLACE_COLUMNS} FROM places ORDER BY name COLLATE NOCASE`).all() as Place[];
    const setIds = new Map<number, number[]>();
    for (const { place_id, set_id } of db.prepare('SELECT place_id, set_id FROM set_places ORDER BY set_id').all() as { place_id: number; set_id: number }[]) {
      setIds.set(place_id, [...(setIds.get(place_id) ?? []), set_id]);
    }
    return c.json(places.map((p) => ({ ...p, setIds: setIds.get(p.id) ?? [] })));
  });

  /** Food and drink places matching `q`, favouring the area the group's places are in, or else the searcher's home. */
  api.get('/search', async (c) => {
    const q = c.req.query('q')?.trim();
    if (!q) return c.json([]);
    const { home_lat, home_lng } = c.var.person;
    const home = home_lat === null || home_lng === null ? undefined : { lat: home_lat, lng: home_lng };
    try {
      return c.json(await searchPlaces(fetch, q, groupCentre(db) ?? home));
    } catch {
      return c.json({ error: 'Place search is unavailable right now.' }, 502);
    }
  });

  /** The name and location of the place a Google Maps link points to, to show before adding it. */
  api.get('/link', async (c) => {
    const parsed = await resolvePlaceLink(c.req.query('url') ?? '', fetch).catch(() => null);
    if (!parsed) return c.json({ error: NOT_A_PLACE_LINK }, 400);
    const located = parsed.name ? await locate(parsed) : null;
    return located ? c.json({ name: parsed.name, ...located }) : c.json({ error: CANT_LOCATE }, 400);
  });

  /**
   * Adds a place, into the named sets in `setIds` too ("All places" needs no asking): either a chosen search result
   * `{key, name, lat, lng}`, or `{url}`, a Google Maps link.
   */
  api.post('/', async (c) => {
    const body = await c.req.json();
    const { note, setIds = [] } = body;
    const sets = (Array.isArray(setIds) ? setIds : []).filter((id) => id !== ALL_PLACES).map(Number);
    if (!sets.every((id) => Number.isInteger(id) && setExists(db, id))) return c.json({ error: 'No such set.' }, 404);
    const addToSets = (placeId: number) => sets.forEach((setId) => db.prepare('INSERT OR IGNORE INTO set_places (set_id, place_id) VALUES (?, ?)').run(setId, placeId));

    const parsed = 'key' in body ? searchResult(body) : typeof body.url === 'string' ? await resolvePlaceLink(body.url, fetch).catch(() => null) : null;
    if (!parsed) return c.json({ error: 'key' in body ? 'Choose a place from the search results.' : NOT_A_PLACE_LINK }, 400);

    const existing = findPlaceByKey(db, parsed.key);
    if (existing) {
      addToSets(existing.id);
      return c.json({ place: existing, existing: true, message: `${existing.name} is already in the list.` });
    }

    const located = parsed.name ? await locate(parsed) : null;
    if (!parsed.name || !located) return c.json({ error: CANT_LOCATE }, 400);

    const place = await insertPlace(db, nominatim, now(), { key: parsed.key, name: parsed.name, ...located, note });
    addToSets(place.id);
    return c.json({ place }, 201);
  });

  api.patch('/:id{[0-9]+}', async (c) => {
    const { note } = await c.req.json();
    if (typeof note !== 'string') return c.json({ error: 'Send a note.' }, 400);
    const { changes } = db.prepare('UPDATE places SET note = ? WHERE id = ?').run(note.trim(), Number(c.req.param('id')));
    return changes ? c.json(getPlace(db, Number(c.req.param('id')))) : c.json({ error: 'No such place.' }, 404);
  });

  api.delete('/:id{[0-9]+}', (c) => {
    const { changes } = db.prepare('DELETE FROM places WHERE id = ?').run(Number(c.req.param('id')));
    return changes ? c.json({ ok: true }) : c.json({ error: 'No such place.' }, 404);
  });

  return api;
}
