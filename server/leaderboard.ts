import type { Db } from './db.ts';
import { getPlace } from './places.ts';
import { groupRanking, inBottomThird, rankSession } from './ranking.ts';
import { personState, sessionMembers, type Session } from './sessions.ts';

/**
 * Everyone's ranking for the session, plus a combined one by the fair rule (see groupRanking).
 * A place someone marked "Absolutely not" goes below every place nobody ruled out.
 */
export function leaderboard(db: Db, session: Session) {
  const people = sessionMembers(db, session.id).map((member) => {
    const { candidates, pickCount } = personState(db, session, member.id);
    return { ...member, picks: pickCount, candidates, ranked: rankSession(candidates) };
  });
  const group = groupRanking(people.map((p) => p.candidates));
  const names = new Map([...group.keys()].map((id) => [id, getPlace(db, id)!]));

  const combined = [...group.keys()].map((placeId) => {
    const positions: Record<number, number> = {};
    const bottomThirdFor: number[] = [];
    const vetoedBy: number[] = [];
    for (const p of people) {
      const position = p.ranked.findIndex((c) => c.id === placeId) + 1;
      positions[p.id] = position;
      if (p.ranked[position - 1].vetoed) vetoedBy.push(p.id);
      else if (inBottomThird(position, p.ranked.filter((c) => !c.vetoed).length)) bottomThirdFor.push(p.id);
    }
    const { name, suburb } = names.get(placeId)!;
    return { placeId, name, suburb, positions, bottomThirdFor, vetoedBy };
  });

  return {
    people: people.map(({ id, name, picks, ranked }) => ({
      id,
      name,
      picks,
      ranking: ranked.map((c) => ({ placeId: c.id, name: names.get(c.id)!.name, vetoed: !!c.vetoed })),
    })),
    combined,
  };
}
