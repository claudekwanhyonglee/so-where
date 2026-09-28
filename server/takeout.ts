// Google Takeout imports: saved-list CSVs ("Saved") and starred places, Saved Places.json ("Maps (your places)").
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Deps } from './app.ts';
import type { AppEnv } from './auth.ts';
import type { Db } from './db.ts';
import { parsePlaceUrl, placeKey } from './google-maps.ts';
import type { PlaceLookup } from './place-lookup.ts';
import { findPlaceByKey } from './places.ts';
import { setName } from './sets.ts';

type ImportRow = { key: string; name: string; note: string; lat: number | null; lng: number | null; lookupQuery: string };
type Parsed = { rows: ImportRow[]; skipped: number };
export type ImportReport = { added: number; existing: number; skipped: number; lists: string[]; sets: { id: number; name: string }[] };

class ImportError extends Error {}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') field += src[++i];
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      rows.push([...row, field]);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

function parseListCsv(text: string): Parsed {
  const [header = [], ...lines] = parseCsv(text).filter((r) => r.some((f) => f.trim()));
  const column = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const [title, note, url] = [column('title'), column('note'), column('url')];
  if (title < 0 || url < 0) throw new ImportError("That CSV isn't a Google Takeout saved list (it needs Title and URL columns).");

  const result: Parsed = { rows: [], skipped: 0 };
  for (const line of lines) {
    const name = line[title]?.trim();
    const key = placeKey(line[url] ?? '');
    if (!name || !key) {
      result.skipped++;
      continue;
    }
    const parsed = parsePlaceUrl(line[url]);
    result.rows.push({ key, name, note: line[note]?.trim() ?? '', lat: parsed?.lat ?? null, lng: parsed?.lng ?? null, lookupQuery: name });
  }
  return result;
}

type Feature = {
  geometry?: { coordinates?: unknown[] };
  properties?: Record<string, unknown> & { location?: Record<string, unknown>; Location?: Record<string, unknown> };
};

function parseSavedPlaces(text: string): Parsed {
  let features: Feature[];
  try {
    features = JSON.parse(text).features;
  } catch {
    features = [];
  }
  if (!Array.isArray(features) || features.length === 0) throw new ImportError("That JSON isn't a Google Takeout Saved Places file.");

  const result: Parsed = { rows: [], skipped: 0 };
  for (const { geometry, properties: props = {} } of features) {
    const location = props.location ?? props.Location ?? {};
    const name = String(location.name ?? location['Business Name'] ?? props.Title ?? '').trim();
    const address = String(location.address ?? location.Address ?? '').trim();
    const key = placeKey(String(props.google_maps_url ?? props['Google Maps URL'] ?? ''));
    if (!name || !key) {
      result.skipped++;
      continue;
    }
    const [lng, lat] = geometry?.coordinates ?? [];
    const located = typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0);
    result.rows.push({
      key,
      name,
      note: '',
      lat: located ? lat : null,
      lng: located ? lng : null,
      lookupQuery: address ? `${name}, ${address}` : name,
    });
  }
  return result;
}

const listName = (fileName: string) => fileName.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '').trim();

function parseFile(file: { name: string; text: string }): Parsed & { list?: string } {
  if (/\.csv$/i.test(file.name)) return { ...parseListCsv(file.text), list: listName(file.name) };
  if (/\.json$/i.test(file.name)) return parseSavedPlaces(file.text);
  throw new ImportError(`${file.name}: choose the .csv list files or Saved Places.json from your Takeout export.`);
}

export function importTakeout(db: Db, now: number, files: { name: string; text: string }[]): ImportReport {
  const parsed = files.map(parseFile);
  const report: ImportReport = { added: 0, existing: 0, skipped: 0, lists: [], sets: [] };

  const insertPlace = db.prepare(
    'INSERT INTO places (key, name, lat, lng, note, created_at, lookup_pending, lookup_query) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
  );
  const upsertSet = db.prepare(
    'INSERT INTO sets (name, takeout_list, created_at) VALUES (?, ?, ?) ON CONFLICT (takeout_list) DO UPDATE SET takeout_list = excluded.takeout_list RETURNING id',
  );
  const addToSet = db.prepare('INSERT OR IGNORE INTO set_places (set_id, place_id) VALUES (?, ?)');

  db.transaction(() => {
    for (const { rows, skipped, list } of parsed) {
      report.skipped += skipped;
      const setId = list ? (upsertSet.get(list, list, now) as { id: number }).id : undefined;
      if (list) report.lists.push(list);
      if (setId !== undefined && !report.sets.some((s) => s.id === setId)) report.sets.push({ id: setId, name: setName(db, setId)! });
      for (const row of rows) {
        const existing = findPlaceByKey(db, row.key);
        const placeId = existing ? existing.id : Number(insertPlace.run(row.key, row.name, row.lat, row.lng, row.note, now, row.lookupQuery).lastInsertRowid);
        if (existing) report.existing++;
        else report.added++;
        if (setId !== undefined) addToSet.run(setId, placeId);
      }
    }
  })();
  return report;
}

export function importRoutes({ db, now }: Deps, lookup: PlaceLookup) {
  const api = new Hono<AppEnv>();
  api.post('/', bodyLimit({ maxSize: 20 * 1024 * 1024, onError: (c) => c.json({ error: 'Those files are too big (20 MB max).' }, 413) }), async (c) => {
    const body = await c.req.parseBody({ all: true });
    const uploads = [body.files].flat().filter((f): f is File => f instanceof File);
    if (uploads.length === 0) return c.json({ error: 'Choose at least one file.' }, 400);
    try {
      const files = await Promise.all(uploads.map(async (f) => ({ name: f.name, text: await f.text() })));
      const report = importTakeout(db, now(), files);
      void lookup.start();
      return c.json(report);
    } catch (err) {
      if (err instanceof ImportError) return c.json({ error: err.message }, 400);
      throw err;
    }
  });
  return api;
}
