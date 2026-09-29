import { Hono } from 'hono';
import type { Deps } from './app.ts';
import type { AppEnv } from './auth.ts';

/** The getting-started guide: what this person has done so far. Every step's state is worked out from these on the client. */
export function guideRoutes({ db }: Deps) {
  const api = new Hono<AppEnv>();

  api.get('/', (c) => {
    const { id } = c.var.person;
    const person = db.prepare('SELECT home_address, home_skipped, guide_closed FROM people WHERE id = ?').get(id) as {
      home_address: string | null;
      home_skipped: number;
      guide_closed: number;
    };
    return c.json({
      closed: !!person.guide_closed,
      home: person.home_address,
      homeSkipped: !!person.home_skipped,
      placeCount: db.prepare('SELECT count(*) FROM places').pluck().get() as number,
      inSession: !!db.prepare('SELECT 1 FROM session_members WHERE person_id = ?').get(id),
    });
  });

  api.post('/close', (c) => {
    db.prepare('UPDATE people SET guide_closed = 1 WHERE id = ?').run(c.var.person.id);
    return c.json({ ok: true });
  });

  return api;
}
