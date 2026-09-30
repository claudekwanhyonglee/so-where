// Ranks on the together board: how they read, their medal colour, and which changed since the last poll.

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ordinal(n: number) {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export type Medal = 'gold' | 'silver' | 'bronze' | 'grey';
export const medal = (rank: number): Medal => (['gold', 'silver', 'bronze'] as const)[rank - 1] ?? 'grey';

type Ranked = { placeId: number; positions: Record<string, number> };
type Snapshot = Map<string, number>;

/** Each person's rank for each place, keyed "placeId:personId". */
export const rankSnapshot = (rows: Ranked[]): Snapshot => new Map(rows.flatMap((r) => Object.entries(r.positions).map(([person, rank]) => [`${r.placeId}:${person}`, rank])));

/** The chips whose rank got better or worse since `before` (none on the first poll). */
export function rankChanges(before: Snapshot | null, rows: Ranked[]): Map<string, 'better' | 'worse'> {
  const changes = new Map<string, 'better' | 'worse'>();
  if (!before) return changes;
  for (const [key, rank] of rankSnapshot(rows)) {
    const was = before.get(key);
    if (was !== undefined && was !== rank) changes.set(key, rank < was ? 'better' : 'worse');
  }
  return changes;
}
