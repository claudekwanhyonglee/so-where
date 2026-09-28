// The ranking engine: pure functions, no I/O.
//
// A rating is a score (mu) plus an uncertainty (rd); low rd means high confidence.
//
// History: each person has a long-term rating per place, updated pick by pick with Glicko-1.
//
// Session: tonight's ratings are the most likely scores given all of tonight's picks at once (a Bradley–Terry
// fit), with each place's history score as the starting belief, held only loosely (rd reset to 350). With no
// picks yet, a session rating is the history score at low confidence; each pick then moves it a lot. Fitting all
// picks together (rather than updating pick by pick) keeps the order consistent: if A beat B and B beat C, A
// stays above C. Recent picks count a little more (see recencyWeights), but certainty counts every pick in full.

export type Rating = { mu: number; rd: number };

export type Candidate = {
  id: number;
  /** This session's rating. */
  rating: Rating;
  /** How many times this person has compared the place, across all sessions. */
  comparisons: number;
  /** Marked "Absolutely not" by this person in this session. */
  vetoed?: boolean;
};

/** One answer: scoreA is 1 if A won, 0 if B won, 0.5 for "too close to call". */
export type Pick = { a: number; b: number; scoreA: 1 | 0 | 0.5 };

/** The previous pick, which shapes the next pair. */
export type LastPick = { pair: [number, number]; winner?: number; upset?: boolean };

export const DEFAULT_RATING: Rating = { mu: 1500, rd: 350 };
export const SESSION_START_RD = 350;
const SESSION_MIN_RD = 60;
const HISTORY_MIN_RD = 50; // history keeps learning, however many picks it has seen

const MIN_COMPARISONS = 3; // before a place may be deprioritised
const THOMPSON_WINDOW = 7; // how far down tonight's plausible ranking pairs are drawn from (top 5 + a margin)
const EXPLORE = 0.12; // share of pairs spent on whatever the engine is least sure about

const Q = Math.LN10 / 400; // Elo scale: a 400-point gap means 10:1 odds

// ---------------------------------------------------------------------------------------------
// History (Glicko-1)

const g = (rd: number) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
const expectedScore = (player: Rating, opponent: Rating) => 1 / (1 + 10 ** ((-g(opponent.rd) * (player.mu - opponent.mu)) / 400));

function glicko(player: Rating, opponent: Rating, score: number): Rating {
  const gj = g(opponent.rd);
  const e = expectedScore(player, opponent);
  const precision = 1 / player.rd ** 2 + Q * Q * gj * gj * e * (1 - e);
  return { mu: player.mu + (Q / precision) * gj * (score - e), rd: Math.max(HISTORY_MIN_RD, Math.sqrt(1 / precision)) };
}

/** The chance this person picks A over B, allowing for how unsure both ratings are. */
const winChance = (a: Rating, b: Rating) => 1 / (1 + 10 ** ((-g(Math.hypot(a.rd, b.rd)) * (a.mu - b.mu)) / 400));

export const updateHistory =([a, b]: [Rating, Rating], scoreA: Pick['scoreA']): [Rating, Rating] => [glicko(a, b, scoreA), glicko(b, a, 1 - scoreA)];

// ---------------------------------------------------------------------------------------------
// Session

/**
 * Tonight's ratings for each place, given its history score (`priors`) and tonight's picks.
 * Picks involving places not in `priors` (e.g. removed from the set) are ignored.
 */
export function estimateSession(priors: Map<number, number>, picks: Pick[]): Map<number, Rating> {
  const games = new Map<number, { opponent: number; score: number; weight: number }[]>([...priors.keys()].map((id) => [id, []]));
  const weights = recencyWeights(picks);
  picks.forEach(({ a, b, scoreA }, i) => {
    if (!priors.has(a) || !priors.has(b)) return;
    games.get(a)!.push({ opponent: b, score: scoreA, weight: weights[i] });
    games.get(b)!.push({ opponent: a, score: 1 - scoreA, weight: weights[i] });
  });

  // Maximise the posterior one place at a time (Newton steps); it's concave, so this converges quickly.
  const priorPrecision = 1 / SESSION_START_RD ** 2;
  const mu = new Map(priors);
  const beats = (id: number, opponent: number) => 1 / (1 + Math.exp(-Q * (mu.get(id)! - mu.get(opponent)!)));
  for (let sweep = 0; sweep < 25; sweep++) {
    for (const [id, list] of games) {
      let slope = -(mu.get(id)! - priors.get(id)!) * priorPrecision;
      let info = priorPrecision;
      for (const { opponent, score, weight } of list) {
        const p = beats(id, opponent);
        slope += weight * Q * (score - p);
        info += weight * Q * Q * p * (1 - p);
      }
      mu.set(id, mu.get(id)! + slope / info);
    }
  }

  // Certainty counts every pick in full, so older picks don't make a place look less explored.
  const rd = (id: number) => {
    const info = games.get(id)!.reduce((sum, { opponent }) => {
      const p = beats(id, opponent);
      return sum + Q * Q * p * (1 - p);
    }, priorPrecision);
    return Math.max(SESSION_MIN_RD, 1 / Math.sqrt(info));
  };
  return new Map([...mu].map(([id, m]) => [id, { mu: m, rd: rd(id) }]));
}

const SAME_PAIR_HALF_LIFE = 5; // later answers on the same pair
const SESSION_HALF_LIFE_SHARE = 2; // the half-life is twice the picks so far, so the oldest pick keeps ~70% of its weight
const MIN_SESSION_HALF_LIFE = 5;

const pairKey = ({ a, b }: Pick) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * How much each pick counts. Recent picks count a little more than old ones, over a window that grows with the
 * session, so evidence builds up rather than being forgotten. A pick counts much less once the same pair has
 * been answered again, so the latest answer on a disputed pair wins.
 */
function recencyWeights(picks: Pick[]) {
  const n = picks.length;
  const halfLife = Math.max(MIN_SESSION_HALF_LIFE, SESSION_HALF_LIFE_SHARE * n);
  const laterOnPair = new Map<string, number>();
  const weights: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const later = laterOnPair.get(pairKey(picks[i])) ?? 0;
    weights[i] = 0.5 ** ((n - 1 - i) / halfLife + later / SAME_PAIR_HALF_LIFE);
    laterOnPair.set(pairKey(picks[i]), later + 1);
  }
  return weights;
}

/** A reversal the person should be asked about again. */
export type Reask = { pair: [number, number]; picksSince: number };

const REASK_WITHIN = 5; // pairs
const SURPRISING = 0.25; // the model gave the new answer less than this chance

/**
 * The most recent reversal worth asking about again: the answer on a pair flipped, the model thought the new
 * answer unlikely, and the pair hasn't been answered since. A flip on a close call isn't asked again (it's
 * usually noise, and asking again just gets another coin-flip).
 */
export function pendingReask(priors: Map<number, number>, picks: Pick[]): Reask | undefined {
  const winner = ({ a, b, scoreA }: Pick) => (scoreA === 1 ? a : scoreA === 0 ? b : undefined);
  for (let r = picks.length - 1; r >= Math.max(0, picks.length - REASK_WITHIN); r--) {
    const pick = picks[r];
    const key = pairKey(pick);
    if (picks.slice(r + 1).some((p) => pairKey(p) === key)) continue;
    const previous = picks.slice(0, r).findLast((p) => pairKey(p) === key);
    const [now, before] = [winner(pick), previous && winner(previous)];
    if (now === undefined || before === undefined || now === before) continue;

    const ratings = estimateSession(priors, picks.slice(0, r));
    const [w, l] = [ratings.get(now), ratings.get(before)];
    if (w && l && winChance(w, l) < SURPRISING) return { pair: [pick.a, pick.b], picksSince: picks.length - 1 - r };
  }
  return undefined;
}

/** An upset: the winner was rated below the loser going in. */
export const isUpset = (winner: Rating, loser: Rating) => winner.mu < loser.mu;

/** Best first; "Absolutely not" places last. */
export const rankSession = <T extends Candidate>(candidates: T[]): T[] =>
  [...candidates].sort((a, b) => Number(!!a.vetoed) - Number(!!b.vetoed) || b.rating.mu - a.rating.mu);

// ---------------------------------------------------------------------------------------------
// Pair selection

export function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const normal = (rng: () => number) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const pickRandom = <T>(items: T[], rng: () => number) => items[Math.floor(rng() * items.length)];

function pickWeighted<T>(items: T[], weight: (item: T) => number, rng: () => number) {
  const weights = items.map(weight);
  let r = rng() * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
  return items[items.length - 1];
}

/** How unsure we are which of two places this person prefers: highest when it's a coin flip. */
function closeness(a: Rating, b: Rating) {
  const p = winChance(a, b);
  return p * (1 - p);
}

const samePair = (x: [number, number], y?: [number, number]) => !!y && ((x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]));

/**
 * The next pair to show this person, or null if fewer than two places are left. In order:
 *
 * 1. Fairness: a place compared fewer than 3 times (ever) is always in the pair.
 * 2. Challenge: after an upset, the winner takes on the current #1, so a surprise favourite rises fast.
 * 3. A fresh look: places not yet seen tonight are shown, each against a strong place, since cravings change.
 * 4. Some pairs go to whatever the engine is least sure about, however low its score.
 * 5. A surprising reversal is asked again, so a third answer settles a stray tap versus a real change of mind.
 *    It takes precedence over everything once it's been waiting 4 pairs, so it's always back within 5.
 * 6. Otherwise, draw a plausible score for every place from its rating (Thompson sampling) and compare the
 *    closest-call neighbours near the top of that draw: that settles who's in the top 5, and their order.
 */
export function choosePair(candidates: Candidate[], rng: () => number, last?: LastPick, reask?: Reask): [number, number] | null {
  const pool = candidates.filter((c) => !c.vetoed);
  if (pool.length < 2) return null;

  const reaskable = reask && reask.pair.every((id) => pool.some((c) => c.id === id)) ? reask : undefined;
  if (reaskable && reaskable.picksSince >= REASK_WITHIN - 1) return reaskable.pair;

  const draw = new Map(pool.map((c) => [c.id, c.rating.mu + c.rating.rd * normal(rng)]));
  const byDraw = (among: Candidate[]) => [...among].sort((a, b) => draw.get(b.id)! - draw.get(a.id)!);
  const notLastPair = (first: Candidate) => (c: Candidate) => c.id !== first.id && !samePair([first.id, c.id], last?.pair);
  const closestDrawTo = (first: Candidate, among: Candidate[]) => {
    const options = among.filter(notLastPair(first));
    const opponents = options.length ? options : pool.filter((c) => c.id !== first.id);
    const distance = (c: Candidate) => Math.abs(draw.get(c.id)! - draw.get(first.id)!);
    return opponents.reduce((best, c) => (distance(c) < distance(best) ? c : best));
  };

  const underCompared = pool.filter((c) => c.comparisons < MIN_COMPARISONS);
  if (underCompared.length > 0) {
    const fewest = Math.min(...underCompared.map((c) => c.comparisons));
    const first = pickRandom(underCompared.filter((c) => c.comparisons === fewest), rng);
    return [first.id, closestDrawTo(first, underCompared.length > 1 ? underCompared : pool).id];
  }

  const byScore = rankSession(pool);
  const winnerRank = byScore.findIndex((c) => c.id === last?.winner);
  if (last?.upset && winnerRank > 0) {
    const target = byScore.slice(0, winnerRank).find(notLastPair(byScore[winnerRank]));
    if (target) return [byScore[winnerRank].id, target.id];
  }

  const unseenTonight = pool.filter((c) => c.rating.rd >= SESSION_START_RD); // no picks yet leaves rd untouched
  if (unseenTonight.length > 0) {
    const first = pickRandom(unseenTonight, rng);
    return [first.id, byDraw(pool.filter((c) => c.id !== first.id))[0].id];
  }

  if (rng() < EXPLORE) {
    const first = pickWeighted(pool, (c) => (c.rating.rd - SESSION_MIN_RD) ** 2 + 1, rng);
    return [first.id, closestDrawTo(first, pool).id];
  }

  if (reaskable && reaskable.picksSince >= 1) return reaskable.pair;

  const drawn = byDraw(pool);
  const neighbours = drawn
    .slice(0, Math.min(THOMPSON_WINDOW - 1, drawn.length - 1))
    .map((c, i): [Candidate, Candidate] => [c, drawn[i + 1]])
    .filter(([a, b]) => !samePair([a.id, b.id], last?.pair));
  if (neighbours.length === 0) return [drawn[0].id, drawn[1].id];
  const [a, b] = neighbours.reduce((best, pair) => (closeness(pair[0].rating, pair[1].rating) > closeness(best[0].rating, best[1].rating) ? pair : best));
  return [a.id, b.id];
}

// ---------------------------------------------------------------------------------------------
// Group: "fair, no one hates it" (Masthoff's average without misery, on ranks)

export const inBottomThird = (position: number, count: number) => position > count - Math.floor(count / 3);

const GROUP_SAMPLES = 1000;
const GROUP_SEED = 22; // fixed, so the same answers always give the same result

/**
 * One plausible version of the evening, indexed by place position (as in GroupSamples.placeIds): each person's
 * drawn score for every place, and the fair-rule score that gives each place.
 */
export type GroupSample = { draws: Float64Array[]; scores: Float64Array };

/** Many plausible versions of the evening. Only contenders (the places with the fewest vetoes, normally none) can be best. */
export type GroupSamples = { placeIds: number[]; vetoes: Map<number, number>; contenders: number[]; samples: GroupSample[] };

/** Draws everyone's scores from their ratings many times, and scores each place by the fair rule in each draw. */
export function sampleGroup(people: Candidate[][]): GroupSamples {
  const placeIds = people[0]?.map((c) => c.id) ?? [];
  const position = new Map(placeIds.map((id, i) => [id, i]));
  const byPosition = people.map((person) => [...person].sort((a, b) => position.get(a.id)! - position.get(b.id)!));
  const vetoCounts = placeIds.map((_, i) => byPosition.filter((p) => p[i].vetoed).length);
  const fewestVetoes = Math.min(...vetoCounts);
  const rng = seededRandom(GROUP_SEED);
  return {
    placeIds,
    vetoes: new Map(placeIds.map((id, i) => [id, vetoCounts[i]])),
    contenders: placeIds.filter((_, i) => vetoCounts[i] === fewestVetoes),
    samples: placeIds.length === 0 ? [] : Array.from({ length: GROUP_SAMPLES }, () => fairSample(byPosition, rng)),
  };
}

/** The contender (by position) with the highest fair-rule score in one sample. */
const bestPosition = ({ scores }: GroupSample, contenders: number[]) => contenders.reduce((top, i) => (scores[i] > scores[top] ? i : top));

const NEAR_BEST = 0.1; // fair-rule points: a tenth of the way from someone's last place to their first
const PRETTY_SURE = 0.8;
const PRETTY_SURE_MIN_PICKS = 8; // each

/**
 * How sure we are that a place (normally the top pick) is a right choice: the share of samples in which it's
 * as good as the best contender, give or take a near-tie. Asking for "exactly the best" instead stalls whenever
 * two places are nearly tied for the group, however many picks people make.
 */
export function confidenceIn(placeId: number, { placeIds, contenders, samples }: GroupSamples) {
  const me = placeIds.indexOf(placeId);
  const rivals = contenders.map((id) => placeIds.indexOf(id)).filter((i) => i !== me);
  const right = ({ scores }: GroupSample) => rivals.every((i) => scores[i] <= scores[me] + NEAR_BEST);
  return samples.length ? samples.filter(right).length / samples.length : 0;
}

/** "Pretty sure": confident in the top pick, and everyone has had their say. */
export const isPrettySure = (confidence: number, picksEach: number[]) => confidence >= PRETTY_SURE && picksEach.every((n) => n >= PRETTY_SURE_MIN_PICKS);

/** score: the place's average fair-rule score (its expected value); chance: how likely it is the group's best. */
export type GroupStanding = { chance: number; score: number; vetoes: number };

/**
 * The group's ranking, best first. Ordered by vetoes (fewest first), then average score: the best evening on
 * average, so a place someone probably dislikes pays for that in proportion. Ranking by chance of being best
 * instead would favour divisive, uncertain places. The chance breaks ties.
 */
export function groupRanking({ placeIds, vetoes, contenders, samples }: GroupSamples): Map<number, GroupStanding> {
  const contenderPositions = contenders.map((id) => placeIds.indexOf(id));
  const wins = placeIds.map(() => 0);
  const totals = placeIds.map(() => 0);
  for (const sample of samples) {
    wins[bestPosition(sample, contenderPositions)]++;
    placeIds.forEach((_, i) => (totals[i] += sample.scores[i]));
  }
  const standings = placeIds.map((id, i): [number, GroupStanding] => [id, { chance: wins[i] / samples.length, score: totals[i] / samples.length, vetoes: vetoes.get(id)! }]);
  return new Map(standings.sort(([, a], [, b]) => a.vetoes - b.vetoes || b.score - a.score || b.chance - a.chance));
}

/**
 * One draw of the fair rule: each person's rank among the places they haven't vetoed becomes a percentile
 * (1 for their top place, 0 for their last); a place scores the average percentile, minus 1 for each person
 * who has it in their bottom third. A veto counts as last and bottom third; that only decides anything when
 * every place is vetoed by someone.
 */
function fairSample(people: Candidate[][], rng: () => number): GroupSample {
  const scores = new Float64Array(people[0].length);
  const draws = people.map((person) => {
    const drawn = Float64Array.from(person, (c) => c.rating.mu + c.rating.rd * normal(rng));
    const kept = person.flatMap((c, i) => (c.vetoed ? [] : [i])).sort((a, b) => drawn[b] - drawn[a]);
    kept.forEach((i, rank) => {
      const percentile = kept.length > 1 ? (kept.length - 1 - rank) / (kept.length - 1) : 1;
      scores[i] += percentile / people.length - (inBottomThird(rank + 1, kept.length) ? 1 : 0);
    });
    person.forEach((c, i) => c.vetoed && (scores[i] -= 1));
    return drawn;
  });
  return { draws, scores };
}
