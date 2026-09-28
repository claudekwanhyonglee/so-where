import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

// Append-only: each entry runs once, in order, tracked by PRAGMA user_version.
export const migrations: string[] = [
  `CREATE TABLE people (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL UNIQUE COLLATE NOCASE,
     pin_hash TEXT NOT NULL,
     failed_pins INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER NOT NULL DEFAULT 0,
     home_address TEXT,
     home_lat REAL,
     home_lng REAL
   );
   CREATE TABLE device_sessions (
     token_hash TEXT PRIMARY KEY,
     person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE geocode_cache (key TEXT PRIMARY KEY, result TEXT NOT NULL);`,

  `CREATE TABLE places (
     id INTEGER PRIMARY KEY,
     key TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     lat REAL,
     lng REAL,
     suburb TEXT,
     note TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   );`,

  // Imported places are located (coordinates, suburb) in the background: lookup_query is what to search for
  // when coordinates are missing, and lookup_pending marks places not yet looked up.
  `ALTER TABLE places ADD COLUMN lookup_pending INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE places ADD COLUMN lookup_query TEXT;
   CREATE TABLE sets (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     takeout_list TEXT UNIQUE,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE set_places (
     set_id INTEGER NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
     place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
     PRIMARY KEY (set_id, place_id)
   );`,
];

export function migrate(db: Db, steps: string[] = migrations) {
  const applied = db.pragma('user_version', { simple: true }) as number;
  const runPending = db.transaction(() => {
    steps.slice(applied).forEach((sql) => db.exec(sql));
    db.pragma(`user_version = ${steps.length}`);
  });
  if (applied < steps.length) runPending();
}

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
