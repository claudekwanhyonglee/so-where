import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import type { Deps } from './app.ts';
import type { AppEnv } from './auth.ts';
import type { Db } from './db.ts';
import { leaderboard } from './leaderboard.ts';
import { getPlace } from './places.ts';
import { choosePair, DEFAULT_RATING, estimateSession, isUpset, updateHistory, type Candidate, type LastPick, type Pick, type Rating } from './ranking.ts';
import { ALL_PLACES, parseSetId, setExists, setName, setPlaceIds, type SetId } from './sets.ts';

export type Session = { id: string; set_id: number | null; created_by: number; created_at: number };

export const getSession = (db: Db, id: string) => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
const sessionSet = (s: Session): SetId => s.set_id ?? ALL_PLACES;

export const sessionMembers = (db: Db, sessionId: string) =>
  db
    .prepare('SELECT p.id, p.name FROM session_members m JOIN people p ON p.id = m.person_id WHERE m.session_id = ? ORDER BY m.joined_at, p.id')
    .all(sessionId) as { id: number; name: string }[];

function join(db: Db, sessionId: string, personId: number, now: number) {
  db.prepare('INSERT OR IGNORE INTO session_members (session_id, person_id, joined_at) VALUES (?, ?, ?)').run(sessionId, personId, now);
}

/** Snapshots the person's history score for any set place they haven't met yet in this session. */
function ensurePriors(db: Db, sessionId: string, personId: number, placeIds: number[]) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO session_priors (session_id, person_id, place_id, mu)
     VALUES (?, ?, ?, coalesce((SELECT mu FROM history WHERE person_id = ? AND place_id = ?), ?))`,
  );
  db.transaction(() => placeIds.forEach((placeId) => insert.run(sessionId, personId, placeId, personId, placeId, DEFAULT_RATING.mu)))();
}

type PickRow = { a: number; b: number; score_a: Pick['scoreA']; upset: number };

/** Everything the ranking engine needs to know about one person in one session. */
export function personState(db: Db, session: Session, personId: number) {
  const placeIds = setPlaceIds(db, sessionSet(session));
  ensurePriors(db, session.id, personId, placeIds);

  const inSet = new Set(placeIds);
  const priorRows = db.prepare('SELECT place_id, mu FROM session_priors WHERE session_id = ? AND person_id = ?').all(session.id, personId) as {
    place_id: number;
    mu: number;
  }[];
  const priors = new Map(priorRows.filter((r) => inSet.has(r.place_id)).map((r) => [r.place_id, r.mu]));

  const pickRows = db.prepare('SELECT a, b, score_a, upset FROM picks WHERE session_id = ? AND person_id = ? ORDER BY id').all(session.id, personId) as PickRow[];
  const ratings = estimateSession(
    priors,
    pickRows.map((r) => ({ a: r.a, b: r.b, scoreA: r.score_a })),
  );

  const comparisons = new Map(
    (db.prepare('SELECT place_id, comparisons FROM history WHERE person_id = ?').all(personId) as { place_id: number; comparisons: number }[]).map((r) => [
      r.place_id,
      r.comparisons,
    ]),
  );
  const vetoed = new Set(db.prepare('SELECT place_id FROM vetoes WHERE session_id = ? AND person_id = ?').pluck().all(session.id, personId) as number[]);

  const candidates: Candidate[] = placeIds.map((id) => ({ id, rating: ratings.get(id)!, comparisons: comparisons.get(id) ?? 0, vetoed: vetoed.has(id) }));

  const lastRow = pickRows.at(-1);
  const last: LastPick | undefined = lastRow && {
    pair: [lastRow.a, lastRow.b],
    winner: lastRow.score_a === 1 ? lastRow.a : lastRow.score_a === 0 ? lastRow.b : undefined,
    upset: !!lastRow.upset,
  };

  return { candidates, last, pickCount: pickRows.length };
}

const HISTORY_COLUMNS = 'mu, rd, comparisons';
function historyOf(db: Db, personId: number, placeId: number) {
  return (db.prepare(`SELECT ${HISTORY_COLUMNS} FROM history WHERE person_id = ? AND place_id = ?`).get(personId, placeId) as
    | (Rating & { comparisons: number })
    | undefined) ?? { ...DEFAULT_RATING, comparisons: 0 };
}

class PickError extends Error {}

/** Records one answer: a winner, or null for "too close to call". Updates the person's long-term history too. */
function recordPick(db: Db, session: Session, personId: number, pick: { a: number; b: number; winner: number | null }, now: number) {
  const { candidates } = personState(db, session, personId);
  const [a, b] = [pick.a, pick.b].map((id) => candidates.find((c) => c.id === id));
  if (!a || !b || a.id === b.id) throw new PickError('Those places aren\'t both in this session.');
  if (a.vetoed || b.vetoed) throw new PickError('You marked one of those "Absolutely not".');
  if (pick.winner !== null && pick.winner !== a.id && pick.winner !== b.id) throw new PickError('The winner must be one of the two places.');

  const scoreA: Pick['scoreA'] = pick.winner === null ? 0.5 : pick.winner === a.id ? 1 : 0;
  const upset = pick.winner === null ? false : pick.winner === a.id ? isUpset(a.rating, b.rating) : isUpset(b.rating, a.rating);

  const [historyA, historyB] = [historyOf(db, personId, a.id), historyOf(db, personId, b.id)];
  const [nextA, nextB] = updateHistory([historyA, historyB], scoreA);
  const saveHistory = db.prepare(
    `INSERT INTO history (person_id, place_id, mu, rd, comparisons) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (person_id, place_id) DO UPDATE SET mu = excluded.mu, rd = excluded.rd, comparisons = excluded.comparisons`,
  );
  db.transaction(() => {
    db.prepare('INSERT INTO picks (session_id, person_id, a, b, score_a, upset, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      session.id,
      personId,
      a.id,
      b.id,
      scoreA,
      upset ? 1 : 0,
      now,
    );
    saveHistory.run(personId, a.id, nextA.mu, nextA.rd, historyA.comparisons + 1);
    saveHistory.run(personId, b.id, nextB.mu, nextB.rd, historyB.comparisons + 1);
  })();
}

const cardPlace = (db: Db, id: number) => {
  const { name, suburb, note, key, lat, lng } = getPlace(db, id)!;
  return { id, name, suburb, note, key, lat, lng };
};

function nextPair(db: Db, session: Session, personId: number) {
  const { candidates, last, pickCount } = personState(db, session, personId);
  const pair = choosePair(candidates, Math.random, last);
  return { pair: pair && pair.map((id) => cardPlace(db, id)), picks: pickCount };
}

export function sessionsRoutes({ db, config, now }: Deps) {
  const api = new Hono<AppEnv>();

  /** Resolves :id to a session the current person has joined (opening a session joins it). */
  const withSession = (c: Context<AppEnv>) => {
    const session = getSession(db, c.req.param('id')!);
    if (session) join(db, session.id, c.var.person.id, now());
    return session;
  };
  const notFound = (c: Context) => c.json({ error: 'No such session.' }, 404);

  api.get('/', (c) =>
    c.json(
      db
        .prepare(
          `SELECT s.id, s.set_id AS setId, coalesce(st.name, 'All places') AS setName, s.created_at AS createdAt,
                  (SELECT count(*) FROM session_members m WHERE m.session_id = s.id) AS memberCount
           FROM sessions s LEFT JOIN sets st ON st.id = s.set_id
           ORDER BY s.created_at DESC LIMIT 20`,
        )
        .all(),
    ),
  );

  api.post('/', async (c) => {
    const setId = parseSetId(String((await c.req.json()).setId ?? ''));
    if (setId === null || !setExists(db, setId)) return c.json({ error: 'No such set.' }, 404);
    const id = randomBytes(9).toString('base64url');
    db.prepare('INSERT INTO sessions (id, set_id, created_by, created_at) VALUES (?, ?, ?, ?)').run(id, setId === ALL_PLACES ? null : setId, c.var.person.id, now());
    join(db, id, c.var.person.id, now());
    return c.json({ id }, 201);
  });

  api.get('/:id', (c) => {
    const session = withSession(c);
    if (!session) return notFound(c);
    return c.json({
      id: session.id,
      setId: sessionSet(session),
      setName: setName(db, sessionSet(session)),
      createdAt: session.created_at,
      members: sessionMembers(db, session.id),
      sharePath: `/s/${session.id}?invite=${encodeURIComponent(config.inviteCode)}`,
    });
  });

  api.post('/:id/join', (c) => (withSession(c) ? c.json({ ok: true }) : notFound(c)));

  api.get('/:id/pair', (c) => {
    const session = withSession(c);
    return session ? c.json(nextPair(db, session, c.var.person.id)) : notFound(c);
  });

  api.get('/:id/leaderboard', (c) => {
    const session = withSession(c);
    return session ? c.json(leaderboard(db, session)) : notFound(c);
  });

  api.post('/:id/picks', async (c) => {
    const session = withSession(c);
    if (!session) return notFound(c);
    const { a, b, winner } = await c.req.json();
    try {
      recordPick(db, session, c.var.person.id, { a: Number(a), b: Number(b), winner: winner === null ? null : Number(winner) }, now());
    } catch (err) {
      if (err instanceof PickError) return c.json({ error: err.message }, 400);
      throw err;
    }
    return c.json(nextPair(db, session, c.var.person.id));
  });

  api.post('/:id/vetoes', async (c) => {
    const session = withSession(c);
    if (!session) return notFound(c);
    const placeId = Number((await c.req.json()).placeId);
    if (!setPlaceIds(db, sessionSet(session)).includes(placeId)) return c.json({ error: "That place isn't in this session." }, 400);
    db.prepare('INSERT OR IGNORE INTO vetoes (session_id, person_id, place_id) VALUES (?, ?, ?)').run(session.id, c.var.person.id, placeId);
    return c.json(nextPair(db, session, c.var.person.id));
  });

  api.delete('/:id/vetoes/:placeId{[0-9]+}', (c) => {
    const session = withSession(c);
    if (!session) return notFound(c);
    db.prepare('DELETE FROM vetoes WHERE session_id = ? AND person_id = ? AND place_id = ?').run(session.id, c.var.person.id, Number(c.req.param('placeId')));
    return c.json(nextPair(db, session, c.var.person.id));
  });

  return api;
}
