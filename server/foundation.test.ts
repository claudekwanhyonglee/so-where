import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate, migrations, openDb } from './db.ts';
import { testApp } from './test-helpers.ts';

const tempDbPath = () => join(mkdtempSync(join(tmpdir(), 'so-where-')), 'nested', 'app.db');

describe('#2 AC1: health check', () => {
  it('GET /health returns 200', async () => {
    const { app } = testApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});

describe('#2 AC2: database created and migrated on start', () => {
  it('creates the database file (and its folder) and applies every migration', () => {
    const path = tempDbPath();
    const db = openDb(path);
    expect(existsSync(path)).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
    db.close();
  });

  it('keeps data across restarts and does not re-run applied migrations', () => {
    const path = tempDbPath();
    const first = openDb(path);
    first.exec('CREATE TABLE IF NOT EXISTS survives (v TEXT)');
    first.prepare('INSERT INTO survives VALUES (?)').run('still here');
    const version = first.pragma('user_version', { simple: true });
    first.close();

    const second = openDb(path);
    expect(second.pragma('user_version', { simple: true })).toBe(version);
    expect(second.prepare('SELECT v FROM survives').pluck().get()).toBe('still here');
    second.close();
  });

  it('applies only pending migrations, in order', () => {
    const db = new Database(':memory:');
    migrate(db, ['CREATE TABLE a (x)']);
    migrate(db, ['CREATE TABLE a (x)', 'CREATE TABLE b (x)']);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();
    expect(tables).toEqual(['a', 'b']);
  });
});
