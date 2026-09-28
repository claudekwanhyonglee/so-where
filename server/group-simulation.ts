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
  type GroupSamples,
  type Pick,
} from './ranking.ts';

/** Everything a pair chooser may look at when picking the next pair for person `me`; `group()` samples once per round. */
export type GroupChooserInput = { me: number; people: Candidate[][]; group: () => GroupSamples; picks: Pick[][]; priors: Map<number, number>; rng: () => number };
export type GroupChooser = (input: GroupChooserInput) => [number, number] | null;

const lastPick = (picks: Pick[]) => {
  const last = picks.at(-1);
  return last && { pair: [last.a, last.b] as [number, number] };
};

/** Today's per-person pair choice. */
export const perPersonChooser: GroupChooser = ({ me, people, picks, priors, rng }) => choosePair(people[me], rng, lastPick(picks[me]), pendingReask(priors, picks[me]));

/** Pair choice that looks at the whole group (#26). */
export const groupChooser: GroupChooser = ({ me, people, group, picks, priors, rng }) =>
  choosePair(people[me], rng, lastPick(picks[me]), pendingReask(priors, picks[me]), { group: group(), me });

export type Check ={ round: number; top: number; prettySure: boolean };

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
  for (let round = 0; ; round++) {
    // The state after `round` rounds, sampled at most once: shared by the check and the next round's questions.
    const people = taste.map((_, p) => candidatesOf(p));
    let samples: GroupSamples | undefined;
    const group = () => (samples ??= sampleGroup(people));

    if (round >= firstCheck && (round - firstCheck) % checkEvery === 0) {
      const [top] = groupRanking(group()).keys();
      checks.push({ round, top, prettySure: isPrettySure(confidenceIn(top, group()), picks.map((p) => p.length)) });
    }
    if (round === rounds) return { planted, checks };

    for (let me = 0; me < size; me++) {
      const pair = chooser({ me, people, group, picks, priors, rng });
      if (!pair) continue;
      const [a, b] = pair;
      const prefersA = taste[me][a] > taste[me][b] !== rng() < strayTaps;
      picks[me].push({ a, b, scoreA: prefersA ? 1 : 0 });
      comparisons[me][a]++;
      comparisons[me][b]++;
    }
  }
}
