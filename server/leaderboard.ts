import type { Db } from './db.ts';
import { getPlace } from './places.ts';
import { rankSession } from './ranking.ts';
import { personState, sessionMembers, type Session } from './sessions.ts';

const inBottomThird = (position: number, count: number) => position > count - Math.floor(count / 3);

/**
 * Everyone's ranking for the session, plus a combined one by average score.
 * A place someone marked "Absolutely not" counts as their lowest score, and goes below every place nobody ruled out.
 */
export function leaderboard(db: Db, session: Session) {
  const people = sessionMembers(db, session.id).map((member) => {
    const { candidates, pickCount } = personState(db, session, member.id);
    const ranked = rankSession(candidates);
    const kept = candidates.filter((c) => !c.vetoed);
    const lowest = Math.min(...(kept.length ? kept : candidates).map((c) => c.rating.mu));
    const score = new Map(candidates.map((c) => [c.id, c.vetoed ? lowest : c.rating.mu]));
    return { ...member, picks: pickCount, ranked, score };
  });

  const placeIds = people[0]?.ranked.map((c) => c.id) ?? [];
  const names = new Map(placeIds.map((id) => [id, getPlace(db, id)!]));

  const combined = placeIds
    .map((placeId) => {
      const positions: Record<number, number> = {};
      const bottomThirdFor: number[] = [];
      const vetoedBy: number[] = [];
      for (const p of people) {
        const position = p.ranked.findIndex((c) => c.id === placeId) + 1;
        positions[p.id] = position;
        if (inBottomThird(position, p.ranked.length)) bottomThirdFor.push(p.id);
        if (p.ranked[position - 1].vetoed) vetoedBy.push(p.id);
      }
      const average = people.reduce((sum, p) => sum + p.score.get(placeId)!, 0) / people.length;
      const { name, suburb } = names.get(placeId)!;
      return { placeId, name, suburb, average: Math.round(average), positions, bottomThirdFor, vetoedBy };
    })
    .sort((a, b) => Number(a.vetoedBy.length > 0) - Number(b.vetoedBy.length > 0) || b.average - a.average);

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
