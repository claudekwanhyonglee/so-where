import type { Person } from './auth.ts';
import type { Db } from './db.ts';
import type { Place } from './places.ts';
import type { Session } from './sessions.ts';
import { transitMinutes } from './transitous.ts';

export type TransitAnswer = { minutes: number } | { minutes: null; reason: 'no-home' | 'no-location' | 'no-trip' | 'unavailable' };

const answer = (minutes: number | null): TransitAnswer => (minutes === null ? { minutes: null, reason: 'no-trip' } : { minutes });

/** The person's public transport time from home to the place, looked up once per session (and home). */
export async function transitTime(deps: { db: Db; fetch: typeof fetch; now: () => number }, session: Session, person: Person, place: Place): Promise<TransitAnswer> {
  const { db } = deps;
  if (person.home_lat === null || person.home_lng === null) return { minutes: null, reason: 'no-home' };
  if (place.lat === null || place.lng === null) return { minutes: null, reason: 'no-location' };
  const home = { lat: person.home_lat, lng: person.home_lng };

  const cached = db
    .prepare('SELECT minutes, from_lat, from_lng FROM transit_times WHERE session_id = ? AND person_id = ? AND place_id = ?')
    .get(session.id, person.id, place.id) as { minutes: number | null; from_lat: number; from_lng: number } | undefined;
  if (cached && cached.from_lat === home.lat && cached.from_lng === home.lng) return answer(cached.minutes);

  let minutes: number | null;
  try {
    minutes = await transitMinutes(deps.fetch, home, { lat: place.lat, lng: place.lng }, new Date(deps.now()));
  } catch {
    return { minutes: null, reason: 'unavailable' }; // not cached: try again next time
  }
  db.prepare(
    `INSERT INTO transit_times (session_id, person_id, place_id, from_lat, from_lng, minutes) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (session_id, person_id, place_id) DO UPDATE SET from_lat = excluded.from_lat, from_lng = excluded.from_lng, minutes = excluded.minutes`,
  ).run(session.id, person.id, place.id, home.lat, home.lng, minutes);
  return answer(minutes);
}
