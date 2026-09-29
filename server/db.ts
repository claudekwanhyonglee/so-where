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

  // Sessions. A NULL set_id means "All places". session_priors snapshots each person's history score for a place
  // the first time they meet it in the session, so tonight's picks (which also update history) aren't counted twice.
  `CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     set_id INTEGER REFERENCES sets(id) ON DELETE CASCADE,
     created_by INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE session_members (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     joined_at INTEGER NOT NULL,
     PRIMARY KEY (session_id, person_id)
   );
   CREATE TABLE session_priors (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
     mu REAL NOT NULL,
     PRIMARY KEY (session_id, person_id, place_id)
   );
   CREATE TABLE picks (
     id INTEGER PRIMARY KEY,
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     a INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
     b INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
     score_a REAL NOT NULL,
     upset INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX picks_by_person ON picks (session_id, person_id, id);
   CREATE TABLE vetoes (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
     PRIMARY KEY (session_id, person_id, place_id)
   );
   CREATE TABLE history (
     person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
     mu REAL NOT NULL,
     rd REAL NOT NULL,
     comparisons INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (person_id, place_id)
   );`,

  // Public transport time per person and place for a session, from where home was when it was looked up.
  // minutes is NULL when Transitous found no trip.
  `CREATE TABLE transit_times (
     session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
     person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
     place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
     from_lat REAL NOT NULL,
     from_lng REAL NOT NULL,
     minutes INTEGER,
     PRIMARY KEY (session_id, person_id, place_id)
   );`,

  // First run: when each person joined (0 for people from before this), whether they skipped setting a home,
  // and whether they closed the getting-started guide. Everyone already here has it closed.
  `ALTER TABLE people ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE people ADD COLUMN home_skipped INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE people ADD COLUMN guide_closed INTEGER NOT NULL DEFAULT 0;
   UPDATE people SET guide_closed = 1;`,
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
