import { Hono, type Context } from 'hono';
import type { Deps } from './app.ts';
import type { AppEnv } from './auth.ts';
import type { Db } from './db.ts';

export const ALL_PLACES = 'all';
export type SetId = number | typeof ALL_PLACES;

/** The places in a set. "All places" isn't stored: it's every place, always. */
export function setPlaceIds(db: Db, setId: SetId): number[] {
  return setId === ALL_PLACES
    ? (db.prepare('SELECT id FROM places ORDER BY id').pluck().all() as number[])
    : (db.prepare('SELECT place_id FROM set_places WHERE set_id = ? ORDER BY place_id').pluck().all(setId) as number[]);
}

export const parseSetId = (raw: string): SetId | null => (raw === ALL_PLACES ? ALL_PLACES : /^\d+$/.test(raw) ? Number(raw) : null);

export const setExists = (db: Db, id: SetId) => id === ALL_PLACES || !!db.prepare('SELECT 1 FROM sets WHERE id = ?').get(id);

export const setName = (db: Db, id: SetId) =>
  id === ALL_PLACES ? 'All places' : (db.prepare('SELECT name FROM sets WHERE id = ?').pluck().get(id) as string | undefined);

const cleanName = (name: unknown) => (typeof name === 'string' ? name.trim().slice(0, 60) : '');

export function setsRoutes({ db, now }: Deps) {
  const api = new Hono<AppEnv>();

  api.get('/', (c) => {
    const all = { id: ALL_PLACES, name: 'All places', builtIn: true, placeCount: db.prepare('SELECT count(*) FROM places').pluck().get() };
    const custom = db
      .prepare(
        `SELECT s.id, s.name, 0 AS builtIn, count(sp.place_id) AS placeCount
         FROM sets s LEFT JOIN set_places sp ON sp.set_id = s.id
         GROUP BY s.id ORDER BY s.name COLLATE NOCASE`,
      )
      .all()
      .map((s) => ({ ...(s as object), builtIn: false }));
    return c.json([all, ...custom]);
  });

  api.post('/', async (c) => {
    const name = cleanName((await c.req.json()).name);
    if (!name) return c.json({ error: 'Give the set a name.' }, 400);
    const { lastInsertRowid } = db.prepare('INSERT INTO sets (name, created_at) VALUES (?, ?)').run(name, now());
    return c.json({ id: Number(lastInsertRowid), name }, 201);
  });

  /** Resolves :id to an editable set, or answers with why not. */
  const editableSet = (c: Context<AppEnv>) => {
    const id = parseSetId(c.req.param('id')!);
    if (id === ALL_PLACES) return { response: c.json({ error: '"All places" always contains every place and can\'t be changed.' }, 403) };
    if (id === null || !setExists(db, id)) return { response: c.json({ error: 'No such set.' }, 404) };
    return { id };
  };

  api.get('/:id', (c) => {
    const id = parseSetId(c.req.param('id'));
    if (id === null || !setExists(db, id)) return c.json({ error: 'No such set.' }, 404);
    return c.json({ id, name: setName(db, id), builtIn: id === ALL_PLACES, placeIds: setPlaceIds(db, id) });
  });

  api.patch('/:id', async (c) => {
    const { id, response } = editableSet(c);
    if (response) return response;
    const name = cleanName((await c.req.json()).name);
    if (!name) return c.json({ error: 'Give the set a name.' }, 400);
    db.prepare('UPDATE sets SET name = ? WHERE id = ?').run(name, id);
    return c.json({ id, name });
  });

  api.delete('/:id', (c) => {
    const { id, response } = editableSet(c);
    if (response) return response;
    db.prepare('DELETE FROM sets WHERE id = ?').run(id);
    return c.json({ ok: true });
  });

  api.put('/:id/places/:placeId{[0-9]+}', (c) => {
    const { id, response } = editableSet(c);
    if (response) return response;
    const placeId = Number(c.req.param('placeId'));
    if (!db.prepare('SELECT 1 FROM places WHERE id = ?').get(placeId)) return c.json({ error: 'No such place.' }, 404);
    db.prepare('INSERT OR IGNORE INTO set_places (set_id, place_id) VALUES (?, ?)').run(id, placeId);
    return c.json({ ok: true });
  });

  api.delete('/:id/places/:placeId{[0-9]+}', (c) => {
    const { id, response } = editableSet(c);
    if (response) return response;
    db.prepare('DELETE FROM set_places WHERE set_id = ? AND place_id = ?').run(id, Number(c.req.param('placeId')));
    return c.json({ ok: true });
  });

  return api;
}
