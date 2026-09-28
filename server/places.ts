import { Hono } from 'hono';
import type { Deps } from './app.ts';
import type { AppEnv } from './auth.ts';
import type { Db } from './db.ts';
import { resolvePlaceLink } from './google-maps.ts';
import type { Nominatim } from './nominatim.ts';
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

const NOT_A_PLACE_LINK =
  "That isn't a Google Maps place link. In Google Maps, open the restaurant, tap Share and copy the link.";

export function placesRoutes({ db, fetch, now }: Deps, nominatim: Nominatim) {
  const api = new Hono<AppEnv>();

  /** Every place, each with the ids of the named sets it's in. */
  api.get('/', (c) => {
    const places = db.prepare(`SELECT ${PLACE_COLUMNS} FROM places ORDER BY name COLLATE NOCASE`).all() as Place[];
    const setIds = new Map<number, number[]>();
    for (const { place_id, set_id } of db.prepare('SELECT place_id, set_id FROM set_places ORDER BY set_id').all() as { place_id: number; set_id: number }[]) {
      setIds.set(place_id, [...(setIds.get(place_id) ?? []), set_id]);
    }
    return c.json(places.map((p) => ({ ...p, setIds: setIds.get(p.id) ?? [] })));
  });

  /** Adds a place from its link, into the named sets in `setIds` too ("All places" needs no asking). */
  api.post('/', async (c) => {
    const { url, note, setIds = [] } = await c.req.json();
    const sets = (Array.isArray(setIds) ? setIds : []).filter((id) => id !== ALL_PLACES).map(Number);
    if (!sets.every((id) => Number.isInteger(id) && setExists(db, id))) return c.json({ error: 'No such set.' }, 404);
    const addToSets = (placeId: number) => sets.forEach((setId) => db.prepare('INSERT OR IGNORE INTO set_places (set_id, place_id) VALUES (?, ?)').run(setId, placeId));

    const parsed = typeof url === 'string' ? await resolvePlaceLink(url, fetch).catch(() => null) : null;
    if (!parsed) return c.json({ error: NOT_A_PLACE_LINK }, 400);

    const existing = findPlaceByKey(db, parsed.key);
    if (existing) {
      addToSets(existing.id);
      return c.json({ place: existing, existing: true, message: `${existing.name} is already in the list.` });
    }

    const located = parsed.lat !== undefined ? parsed : parsed.query ? await nominatim.search(parsed.query).catch(() => null) : null;
    if (!parsed.name || !located) {
      return c.json({ error: "That link doesn't say where the place is. Open the restaurant in Google Maps and copy its link again." }, 400);
    }

    const place = await insertPlace(db, nominatim, now(), { key: parsed.key, name: parsed.name, lat: located.lat!, lng: located.lng!, note });
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
