import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

// Append-only: each entry runs once, in order, tracked by PRAGMA user_version.
export const migrations: string[] = [];

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
