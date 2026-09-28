// Simulated groups with planted tastes, for checking the group engine end to end (tests only).

import {
  choosePair,
  confidenceIn,
  estimateSession,
  groupRanking,
  isPrettySure,
  pendingReask,
  sampleGroup,
  seededRandom,
  type Candidate,
  type Pick,
} from './ranking.ts';

/** Everything a pair chooser may look at when picking the next pair for person `me`. */
export type GroupChooserInput = { me: number; people: Candidate[][]; picks: Pick[][]; priors: Map<number, number>; rng: () => number };
export type GroupChooser = (input: GroupChooserInput) => [number, number] | null;

/** Today's per-person pair choice. */
export const perPersonChooser: GroupChooser = ({ me, people, picks, priors, rng }) => {
  const last = picks[me].at(-1);
  return choosePair(people[me], rng, last && { pair: [last.a, last.b] }, pendingReask(priors, picks[me]));
};

export type Check = { round: number; top: number; prettySure: boolean };

const normal = (rng: () => number) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

/**
 * A group whose members share some taste (a common appeal per place) plus their own, answering every question
 * by their taste except for a share of stray taps. Each round, everyone answers one question; from round
 * `firstCheck` on, every `checkEvery` rounds, records the top pick and whether the engine is "pretty sure" of it.
 */
export function simulateGroup(opts: {
  seed: number;
  size: number;
  places: number;
  rounds: number;
  chooser: GroupChooser;
  strayTaps?: number;
  firstCheck?: number;
  checkEvery?: number;
}) {
  const { seed, size, places, rounds, chooser, strayTaps = 0.1, firstCheck = 8, checkEvery = 2 } = opts;
  const rng = seededRandom(seed);
  const appeal = Array.from({ length: places }, () => normal(rng));
  const taste = Array.from({ length: size }, () => appeal.map((a) => a + 0.7 * normal(rng)));

  const planted = [...groupRanking(sampleGroup(taste.map((t) => t.map((u, id): Candidate => ({ id, rating: { mu: u, rd: 0 }, comparisons: 0 })))))][0][0];

  const priors = new Map(appeal.map((_, id) => [id, 1500]));
  const picks: Pick[][] = taste.map(() => []);
  const comparisons = taste.map(() => appeal.map(() => 0));
  const candidatesOf = (p: number): Candidate[] => {
    const ratings = estimateSession(priors, picks[p]);
    return appeal.map((_, id) => ({ id, rating: ratings.get(id)!, comparisons: comparisons[p][id] }));
  };

  const checks: Check[] = [];
  for (let round = 1; round <= rounds; round++) {
    const people = taste.map((_, p) => candidatesOf(p));
    for (let me = 0; me < size; me++) {
      const pair = chooser({ me, people, picks, priors, rng });
      if (!pair) continue;
      const [a, b] = pair;
      const prefersA = taste[me][a] > taste[me][b] !== rng() < strayTaps;
      picks[me].push({ a, b, scoreA: prefersA ? 1 : 0 });
      comparisons[me][a]++;
      comparisons[me][b]++;
    }
    if (round >= firstCheck && (round - firstCheck) % checkEvery === 0) {
      const group = sampleGroup(taste.map((_, p) => candidatesOf(p)));
      const [top] = groupRanking(group).keys();
      checks.push({ round, top, prettySure: isPrettySure(confidenceIn(top, group), picks.map((p) => p.length)) });
    }
  }
  return { planted, checks };
}
