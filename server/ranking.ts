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
// stays above C.

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

export const updateHistory = ([a, b]: [Rating, Rating], scoreA: Pick['scoreA']): [Rating, Rating] => [glicko(a, b, scoreA), glicko(b, a, 1 - scoreA)];

// ---------------------------------------------------------------------------------------------
// Session

/**
 * Tonight's ratings for each place, given its history score (`priors`) and tonight's picks.
 * Picks involving places not in `priors` (e.g. removed from the set) are ignored.
 */
export function estimateSession(priors: Map<number, number>, picks: Pick[]): Map<number, Rating> {
  const games = new Map<number, { opponent: number; score: number }[]>([...priors.keys()].map((id) => [id, []]));
  for (const { a, b, scoreA } of picks) {
    if (!priors.has(a) || !priors.has(b)) continue;
    games.get(a)!.push({ opponent: b, score: scoreA });
    games.get(b)!.push({ opponent: a, score: 1 - scoreA });
  }

  // Maximise the posterior one place at a time (Newton steps); it's concave, so this converges quickly.
  const priorPrecision = 1 / SESSION_START_RD ** 2;
  const mu = new Map(priors);
  const precision = new Map<number, number>();
  for (let sweep = 0; sweep < 25; sweep++) {
    for (const [id, list] of games) {
      let slope = -(mu.get(id)! - priors.get(id)!) * priorPrecision;
      let info = priorPrecision;
      for (const { opponent, score } of list) {
        const p = 1 / (1 + Math.exp(-Q * (mu.get(id)! - mu.get(opponent)!)));
        slope += Q * (score - p);
        info += Q * Q * p * (1 - p);
      }
      mu.set(id, mu.get(id)! + slope / info);
      precision.set(id, info);
    }
  }
  return new Map([...mu].map(([id, m]) => [id, { mu: m, rd: Math.max(SESSION_MIN_RD, 1 / Math.sqrt(precision.get(id) ?? priorPrecision)) }]));
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
  const p = 1 / (1 + 10 ** ((-g(Math.hypot(a.rd, b.rd)) * (a.mu - b.mu)) / 400));
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
 * 5. Otherwise, draw a plausible score for every place from its rating (Thompson sampling) and compare the
 *    closest-call neighbours near the top of that draw: that settles who's in the top 5, and their order.
 */
export function choosePair(candidates: Candidate[], rng: () => number, last?: LastPick): [number, number] | null {
  const pool = candidates.filter((c) => !c.vetoed);
  if (pool.length < 2) return null;

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

  const drawn = byDraw(pool);
  const neighbours = drawn
    .slice(0, Math.min(THOMPSON_WINDOW - 1, drawn.length - 1))
    .map((c, i): [Candidate, Candidate] => [c, drawn[i + 1]])
    .filter(([a, b]) => !samePair([a.id, b.id], last?.pair));
  if (neighbours.length === 0) return [drawn[0].id, drawn[1].id];
  const [a, b] = neighbours.reduce((best, pair) => (closeness(pair[0].rating, pair[1].rating) > closeness(best[0].rating, best[1].rating) ? pair : best));
  return [a.id, b.id];
}
