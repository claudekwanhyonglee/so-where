import { Hono } from 'hono';
import type { Deps } from './app.ts';
import type { AppEnv } from './auth.ts';
import type { Db } from './db.ts';
import { getSession, sessionMembers } from './sessions.ts';
import { ALL_PLACES, setName } from './sets.ts';

const LIVE_WINDOW_MS = 12 * 3_600_000;

type Member = { id: number; name: string };
const othersIn = (db: Db, sessionId: string, personId: number): Member[] => sessionMembers(db, sessionId).filter((m) => m.id !== personId);

/** Whether the group already had 2 or more places when this person's account was made. */
function joinedAGroupWithPlaces(db: Db, createdAt: number) {
  return (db.prepare('SELECT count(*) FROM places WHERE created_at < ?').pluck().get(createdAt) as number) >= 2;
}

/** The most recent session from the last 12 hours with someone else in it, if any. */
function liveSession(db: Db, personId: number, now: number) {
  const id = db
    .prepare(
      `SELECT s.id FROM sessions s
       WHERE s.created_at >= ? AND EXISTS (SELECT 1 FROM session_members m WHERE m.session_id = s.id AND m.person_id != ?)
       ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1`,
    )
    .pluck()
    .get(now - LIVE_WINDOW_MS, personId) as string | undefined;
  const session = id === undefined ? undefined : getSession(db, id);
  if (!session) return null;
  return { id: session.id, setName: setName(db, session.set_id ?? ALL_PLACES), members: othersIn(db, session.id, personId) };
}

/** Who else is in the first session this person joined, when it's one somebody else started. */
function joinedWith(db: Db, personId: number) {
  const first = db
    .prepare(
      `SELECT s.id, s.created_by FROM session_members m JOIN sessions s ON s.id = m.session_id
       WHERE m.person_id = ? ORDER BY m.joined_at, s.rowid LIMIT 1`,
    )
    .get(personId) as { id: string; created_by: number } | undefined;
  return first && first.created_by !== personId ? othersIn(db, first.id, personId) : null;
}

/** The getting-started guide: what this person has done so far. Every step's state is worked out from these on the client. */
export function guideRoutes({ db, now }: Deps) {
  const api = new Hono<AppEnv>();

  api.get('/', (c) => {
    const { id } = c.var.person;
    const person = db.prepare('SELECT home_address, home_skipped, guide_closed, created_at FROM people WHERE id = ?').get(id) as {
      home_address: string | null;
      home_skipped: number;
      guide_closed: number;
      created_at: number;
    };
    const joining = joinedAGroupWithPlaces(db, person.created_at);
    return c.json({
      closed: !!person.guide_closed,
      home: person.home_address,
      homeSkipped: !!person.home_skipped,
      placeCount: db.prepare('SELECT count(*) FROM places').pluck().get() as number,
      inSession: !!db.prepare('SELECT 1 FROM session_members WHERE person_id = ?').get(id),
      joining,
      live: joining ? liveSession(db, id, now()) : null,
      joinedWith: joinedWith(db, id),
    });
  });

  api.post('/close', (c) => {
    db.prepare('UPDATE people SET guide_closed = 1 WHERE id = ?').run(c.var.person.id);
    return c.json({ ok: true });
  });

  return api;
}
