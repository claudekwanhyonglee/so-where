import { beforeAll, describe, expect, it } from 'vitest';
import {
  choosePair,
  DEFAULT_RATING,
  estimateSession,
  groupRanking,
  sampleGroup,
  isUpset,
  pendingReask,
  rankSession,
  seededRandom,
  SESSION_START_RD,
  updateHistory,
  type Candidate,
  type LastPick,
  type Pick,
  type Rating,
  type Reask,
} from './ranking.ts';

// ---------------------------------------------------------------------------------------------
// A simulated person with a hidden true order, who always answers consistently with it.

type SimPlace = Candidate & { history: Rating };
type Chooser = (places: SimPlace[], rng: () => number, last?: LastPick) => [number, number] | null;

const randomPairing: Chooser = (places, rng) => {
  const i = Math.floor(rng() * places.length);
  let j = Math.floor(rng() * (places.length - 1));
  if (j >= i) j++;
  return [places[i].id, places[j].id];
};

/** `trueRank[id]` = the person's real preference tonight (0 = favourite). */
function simulateSession(opts: {
  trueRank: number[];
  history?: (id: number) => { rating: Rating; comparisons: number };
  chooser: Chooser;
  picks: number;
  seed: number;
  onPick?: (pickNo: number, places: SimPlace[], pair: [number, number]) => void;
}) {
  const rng = seededRandom(opts.seed);
  const places: SimPlace[] = opts.trueRank.map((_, id) => {
    const h = opts.history?.(id) ?? { rating: DEFAULT_RATING, comparisons: 0 };
    return { id, rating: { mu: h.rating.mu, rd: SESSION_START_RD }, history: h.rating, comparisons: h.comparisons };
  });
  const priors = new Map(places.map((p) => [p.id, p.history.mu]));
  const picks: Pick[] = [];
  let last: LastPick | undefined;
  for (let n = 1; n <= opts.picks; n++) {
    const pair = opts.chooser(places, rng, last)!;
    const [a, b] = pair.map((id) => places[id]);
    const aWins = opts.trueRank[a.id] < opts.trueRank[b.id];
    const [winner, loser] = aWins ? [a, b] : [b, a];
    last = { pair, winner: winner.id, upset: isUpset(winner.rating, loser.rating) };

    picks.push({ a: a.id, b: b.id, scoreA: aWins ? 1 : 0 });
    const session = estimateSession(priors, picks);
    for (const p of places) p.rating = session.get(p.id)!;
    [a.history, b.history] = updateHistory([a.history, b.history], aWins ? 1 : 0);
    a.comparisons++;
    b.comparisons++;
    opts.onPick?.(n, places, pair);
  }
  return places;
}

const top = (places: Candidate[], k: number) => rankSession(places).slice(0, k).map((p) => p.id);
const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

/** The pick number from which the engine's top 5 is (and stays) the true top 5; Infinity if it never settles. */
function picksToFindTop5(chooser: Chooser, seed: number, maxPicks = 300) {
  const shuffle = seededRandom(seed * 7919);
  const trueRank = Array.from({ length: 30 }, (_, i) => i).sort(() => shuffle() - 0.5);
  const trueTop5 = trueRank.map((rank, id) => ({ rank, id })).filter((p) => p.rank < 5).map((p) => p.id);
  let settledFrom = Infinity;
  simulateSession({
    trueRank,
    chooser,
    picks: maxPicks,
    seed,
    onPick: (pick, places) => {
      const right = sameSet(top(places, 5), trueTop5);
      if (right && settledFrom === Infinity) settledFrom = pick;
      if (!right) settledFrom = Infinity;
    },
  });
  return settledFrom;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

// ---------------------------------------------------------------------------------------------

describe('#7 AC1: scores, confidence, picks and ties', () => {
  // Place 1 starts below place 2.
  const priors = new Map([
    [1, 1500],
    [2, 1600],
    [3, 1300],
  ]);
  const start = estimateSession(priors, []);

  it('every place has a score and a confidence', () => {
    expect(start.get(1)).toEqual({ mu: 1500, rd: SESSION_START_RD });
  });

  it('a pick moves the winner up and the loser down, and both become more certain (session and history)', () => {
    const after = estimateSession(priors, [{ a: 1, b: 2, scoreA: 1 }]);
    expect(after.get(1)!.mu).toBeGreaterThan(1500);
    expect(after.get(2)!.mu).toBeLessThan(1600);
    expect(after.get(1)!.rd).toBeLessThan(SESSION_START_RD);
    expect(after.get(2)!.rd).toBeLessThan(SESSION_START_RD);

    const [a, b] = updateHistory([{ mu: 1500, rd: 200 }, { mu: 1600, rd: 200 }], 1);
    expect(a.mu).toBeGreaterThan(1500);
    expect(b.mu).toBeLessThan(1600);
    expect(a.rd).toBeLessThan(200);
  });

  it('a tie moves the two scores toward each other (session and history)', () => {
    const after = estimateSession(priors, [{ a: 1, b: 2, scoreA: 0.5 }]);
    expect(after.get(1)!.mu).toBeGreaterThan(1500);
    expect(after.get(2)!.mu).toBeLessThan(1600);
    expect(after.get(1)!.mu).toBeLessThan(after.get(2)!.mu); // toward, not past

    const [a, b] = updateHistory([{ mu: 1500, rd: 200 }, { mu: 1600, rd: 200 }], 0.5);
    expect(a.mu).toBeGreaterThan(1500);
    expect(b.mu).toBeLessThan(1600);
    expect(a.mu).toBeLessThan(b.mu);
  });

  it('beating a stronger place is worth more than beating a weaker one', () => {
    const vsStrong = estimateSession(priors, [{ a: 1, b: 2, scoreA: 1 }]).get(1)!.mu;
    const vsWeak = estimateSession(priors, [{ a: 1, b: 3, scoreA: 1 }]).get(1)!.mu;
    expect(vsStrong).toBeGreaterThan(vsWeak);
  });

  it('ignores picks for places no longer in the set', () => {
    const after = estimateSession(new Map([[1, 1500]]), [{ a: 1, b: 99, scoreA: 1 }]);
    expect(after.get(1)).toEqual({ mu: 1500, rd: SESSION_START_RD });
  });
});

describe('#7 AC2: nothing is deprioritised before it has 3 comparisons', () => {
  it('a place with fewer than 3 comparisons is always in the next pair, however low its score', () => {
    const settled: Candidate[] = Array.from({ length: 29 }, (_, i) => ({ id: i, rating: { mu: 1800 - i * 10, rd: 60 }, comparisons: 10 }));
    const newcomer: Candidate = { id: 99, rating: { mu: 1000, rd: 60 }, comparisons: 2 };
    for (const seed of SEEDS) {
      expect(choosePair([...settled, newcomer], seededRandom(seed))).toContain(99);
    }
  });

  it('in a fresh session, every pair includes an under-compared place until all have 3', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const trueRank = Array.from({ length: 30 }, (_, i) => i);
      let before: number[] = [];
      simulateSession({
        trueRank,
        chooser: (places, rng, last) => {
          before = places.map((p) => p.comparisons);
          return choosePair(places, rng, last);
        },
        picks: 60,
        seed,
        onPick: (_, __, pair) => {
          if (before.some((c) => c < 3)) expect(pair.some((id) => before[id] < 3)).toBe(true);
        },
      });
    }
  });
});

// The engine is randomised on purpose (it samples what to ask next), so the speed criteria are checked as rates
// over many reproducible runs rather than "every run" (agreed with the user).
const RUNS = Array.from({ length: 100 }, (_, i) => i + 1);
const share = (xs: boolean[]) => xs.filter(Boolean).length / xs.length;

describe('#7 AC3: finds the top 5 fast', () => {
  // "Found" means the engine's top 5 is the true top 5 from that pick on, for the rest of a 300-pick run.
  let engine: number[] = [];
  let random: number[] = [];
  beforeAll(() => {
    engine = RUNS.map((seed) => picksToFindTop5(choosePair, seed));
    random = SEEDS.map((seed) => picksToFindTop5(randomPairing, seed));
  }, 120_000);

  it("the true top 5 are the engine's top 5 within 120 picks (in at least 95% of runs)", () => {
    expect(share(engine.map((n) => n <= 120))).toBeGreaterThanOrEqual(0.95);
  });

  it('on average in fewer picks than random pairing', () => {
    const capped = (xs: number[]) => mean(xs.map((n) => Math.min(n, 300)));
    expect(capped(engine)).toBeLessThan(capped(random));
  });
}, 120_000);

describe('#7 AC4: places the engine is unsure about keep coming back', () => {
  it('an uncertain low-scored place keeps being picked; an equally low but settled one is deprioritised', () => {
    const settled: Candidate[] = Array.from({ length: 28 }, (_, i) => ({ id: i, rating: { mu: 1800 - i * 20, rd: 60 }, comparisons: 12 }));
    const unsure: Candidate = { id: 100, rating: { mu: 1200, rd: 300 }, comparisons: 3 };
    const sure: Candidate = { id: 101, rating: { mu: 1200, rd: 60 }, comparisons: 12 };
    const PICKS = 200;
    const shares = SEEDS.slice(0, 10).map((seed) => {
      const rng = seededRandom(seed);
      const count = { unsure: 0, sureOnItsOwn: 0 };
      for (let i = 0; i < PICKS; i++) {
        const pair = choosePair([...settled, unsure, sure], rng)!;
        if (pair.includes(100)) count.unsure++;
        else if (pair.includes(101)) count.sureOnItsOwn++; // chosen for itself, not as the unsure place's opponent
      }
      return { unsure: count.unsure / PICKS, sure: count.sureOnItsOwn / PICKS };
    });
    const fairShare = 2 / 30;
    expect(mean(shares.map((s) => s.unsure))).toBeGreaterThanOrEqual(0.1);
    expect(mean(shares.map((s) => s.unsure))).toBeGreaterThan(fairShare);
    expect(mean(shares.map((s) => s.sure))).toBeLessThan(0.02);
  });
});

describe('#7 AC5: sessions start from history with low confidence, and update history', () => {
  const history: Rating = { mu: 1650, rd: 70 }; // well established

  it('a session starts at the history score with confidence reset to low', () => {
    const start = estimateSession(new Map([[1, history.mu]]), []);
    expect(start.get(1)).toEqual({ mu: 1650, rd: SESSION_START_RD });
    expect(SESSION_START_RD).toBeGreaterThan(history.rd * 4);
  });

  it('early session picks move the session score a lot more than the history, but both move', () => {
    const priors = new Map([
      [1, 1650],
      [2, 1650],
    ]);
    const sessionMove = estimateSession(priors, [{ a: 1, b: 2, scoreA: 1 }]).get(1)!.mu - 1650;
    const historyMove = updateHistory([history, { mu: 1650, rd: 70 }], 1)[0].mu - 1650;
    expect(historyMove).toBeGreaterThan(0);
    expect(sessionMove).toBeGreaterThan(historyMove * 3);
  });
});

describe('#7 AC6: "Absolutely not"', () => {
  it('is never offered again and ranks last, without touching ratings', () => {
    const places: Candidate[] = Array.from({ length: 10 }, (_, i) => ({ id: i, rating: { mu: 1500 + i * 30, rd: 150 }, comparisons: 5 }));
    places[9].vetoed = true; // the person's current favourite
    const before = structuredClone(places);
    const rng = seededRandom(7);
    for (let i = 0; i < 300; i++) expect(choosePair(places, rng)).not.toContain(9);
    expect(rankSession(places).at(-1)!.id).toBe(9);
    expect(places).toEqual(before);
  });

  it('with fewer than two places left, there is no pair', () => {
    const places: Candidate[] = [
      { id: 1, rating: DEFAULT_RATING, comparisons: 0 },
      { id: 2, rating: DEFAULT_RATING, comparisons: 0, vetoed: true },
    ];
    expect(choosePair(places, seededRandom(1))).toBeNull();
  });
});

describe('#7 AC7: tonight\'s craving beats history', () => {
  it('a place ranked #20 of 30 by history, preferred over everything tonight, reaches #1 within 30 picks (in at least 90% of runs)', () => {
    const CRAVING = 19; // history rank #20
    // History: places ordered by id, well established.
    const history = (id: number) => ({ rating: { mu: 1800 - id * 20, rd: 70 }, comparisons: 15 });
    // Tonight: the craving first, everything else as history says.
    const trueRank = Array.from({ length: 30 }, (_, id) => (id === CRAVING ? -1 : id));

    const reached = RUNS.map((seed) => {
      let atTop = false;
      simulateSession({
        trueRank,
        history,
        chooser: choosePair,
        picks: 30,
        seed,
        onPick: (_, places) => {
          atTop ||= top(places, 1)[0] === CRAVING;
        },
      });
      return atTop;
    });
    expect(share(reached)).toBeGreaterThanOrEqual(0.9);
  });
}, 60_000);

// ---------------------------------------------------------------------------------------------
// #23: recent picks count more; surprising reversals get asked again

describe('#23 AC1: a later answer on a pair beats an earlier one', () => {
  it('X>Y then Y>X (no other picks involving them) ranks Y above X', () => {
    const priors = new Map([1, 2, 3, 4].map((id) => [id, 1500]));
    const after = estimateSession(priors, [
      { a: 1, b: 2, scoreA: 1 },
      { a: 3, b: 4, scoreA: 1 },
      { a: 1, b: 2, scoreA: 0 },
    ]);
    expect(after.get(2)!.mu).toBeGreaterThan(after.get(1)!.mu);
  });
});

describe('#23 AC2: one late answer does not undo many earlier ones', () => {
  it('X>Y five times, then Y>X straight after, keeps X above Y', () => {
    const priors = new Map([1, 2].map((id) => [id, 1500]));
    const picks: Pick[] = [...Array.from({ length: 5 }, (): Pick => ({ a: 1, b: 2, scoreA: 1 })), { a: 1, b: 2, scoreA: 0 }];
    const after = estimateSession(priors, picks);
    expect(after.get(1)!.mu).toBeGreaterThan(after.get(2)!.mu);
  });
});

describe('#23 AC3: a surprising reversal is asked again within 5 pairs', () => {
  // Agreed with the user: only reversals the model found surprising are re-asked. Most reversals are coin-flips on
  // close pairs, where asking again just gets another coin-flip; fading already lets the latest answer win there.
  const priors = new Map([0, 1, 2, 3, 4, 5].map((id) => [id, 1500]));
  const settledXoverY: Pick[] = [
    { a: 0, b: 1, scoreA: 1 },
    { a: 0, b: 2, scoreA: 1 },
    { a: 0, b: 1, scoreA: 1 },
    { a: 2, b: 1, scoreA: 1 },
    { a: 0, b: 3, scoreA: 1 },
    { a: 3, b: 1, scoreA: 1 },
    { a: 0, b: 1, scoreA: 1 },
  ];
  const reversal: Pick = { a: 1, b: 0, scoreA: 1 };
  const samePairAs = (pair: [number, number] | null | undefined, x: number, y: number) => !!pair && [x, y].every((id) => pair.includes(id));

  it('reversing a settled preference is flagged for a re-ask', () => {
    const reask = pendingReask(priors, [...settledXoverY, reversal]);
    expect(samePairAs(reask?.pair, 0, 1)).toBe(true);
    expect(reask?.picksSince).toBe(0);
  });

  it('flipping a close call is not', () => {
    expect(
      pendingReask(priors, [
        { a: 0, b: 1, scoreA: 1 },
        { a: 0, b: 1, scoreA: 0 },
      ]),
    ).toBeUndefined();
  });

  it('once answered again, it is settled', () => {
    expect(pendingReask(priors, [...settledXoverY, reversal, { a: 0, b: 1, scoreA: 1 }])).toBeUndefined();
  });

  it('the pair comes back within the next 5 pairs, even while other rules want those slots', () => {
    const trueRank = [0, 5, 1, 2, 3, 4]; // trueRank[id]; the reversal was a stray tap
    for (const seed of SEEDS) {
      const rng = seededRandom(seed);
      const picks = [...settledXoverY, reversal];
      let asked = false;
      for (let shown = 0; shown < 5 && !asked; shown++) {
        const ratings = estimateSession(priors, picks);
        // Nothing compared 3 times yet, so the "under-compared" rule wants every slot.
        const candidates: Candidate[] = [...priors.keys()].map((id) => ({ id, rating: ratings.get(id)!, comparisons: 0 }));
        const last = picks.at(-1)!;
        const pair = choosePair(candidates, rng, { pair: [last.a, last.b] }, pendingReask(priors, picks))!;
        asked = samePairAs(pair, 0, 1);
        picks.push({ a: pair[0], b: pair[1], scoreA: trueRank[pair[0]] < trueRank[pair[1]] ? 1 : 0 });
      }
      expect(asked).toBe(true);
    }
  });

  it('is not shown if one of the two is vetoed', () => {
    const reask: Reask = { pair: [0, 1], picksSince: 4 };
    const candidates: Candidate[] = [0, 1, 2, 3].map((id) => ({ id, rating: DEFAULT_RATING, comparisons: 5, vetoed: id === 1 }));
    for (const seed of SEEDS) expect(choosePair(candidates, seededRandom(seed), undefined, reask)).not.toContain(1);
  });
});

// ---------------------------------------------------------------------------------------------
// #24: fair group ranking

/** A person whose settled scores are given in place-id order. */
const settledPerson = (scores: number[], vetoed: number[] = []): Candidate[] =>
  scores.map((mu, id) => ({ id, rating: { mu, rd: 60 }, comparisons: 10, vetoed: vetoed.includes(id) }));
const groupOrder = (people: Candidate[][]) => [...groupRanking(sampleGroup(people))].map(([id]) => id);

describe('#24 AC1: each person counts equally', () => {
  it('a place ranked #2 and #1 beats one ranked #1 and #3, even when one person spreads their scores far wider', () => {
    const [X, Y] = [0, 1];
    const wide = settledPerson([2600, 1600, 1500, 1400, 1300, 1200]); // X #1 by a mile, Y #2
    const narrow = settledPerson([1500, 1800, 1650, 1350, 1200, 1050]); // Y #1, X #3
    expect((2600 + 1500) / 2).toBeGreaterThan((1600 + 1800) / 2); // averaging scores would pick X
    expect(groupOrder([wide, narrow])[0]).toBe(Y);
    expect(groupOrder([wide, narrow])[1]).toBe(X);
  });
});

describe('#24 AC2: no one hates it', () => {
  it("with settled picks, a place in anyone's bottom third ranks below every place in nobody's", () => {
    for (const seed of SEEDS) {
      const rng = seededRandom(seed);
      const shuffled = () => Array.from({ length: 9 }, (_, i) => 1000 + i * 150).sort(() => rng() - 0.5);
      const people = Array.from({ length: 3 }, () => settledPerson(shuffled()));
      const bottomThird = (id: number) =>
        people.some((p) => {
          const position = rankSession(p).findIndex((c) => c.id === id) + 1;
          return position > 9 - 3;
        });
      const order = groupOrder(people);
      const lastLiked = Math.max(...order.map((id, i) => (bottomThird(id) ? -1 : i)));
      const firstHated = order.findIndex(bottomThird);
      if (firstHated >= 0 && lastLiked >= 0) expect(firstHated).toBeGreaterThan(lastLiked);
    }
  });
});

describe('#24 AC3: vetoes', () => {
  it('vetoed places come last', () => {
    const order = groupOrder([settledPerson([1900, 1500, 1400], [0]), settledPerson([1900, 1500, 1400])]);
    expect(order.at(-1)).toBe(0);
  });

  it('if every place is vetoed by someone, the top pick has the fewest vetoes', () => {
    // Place 3 is everyone's favourite but has two vetoes; places 0–2 have one each.
    const people = [settledPerson([1500, 1400, 1300, 2000], [0, 3]), settledPerson([1500, 1400, 1300, 2000], [1, 3]), settledPerson([1500, 1400, 1300, 2000], [2])];
    const ranking = groupRanking(sampleGroup(people));
    const [top] = ranking.values();
    expect(top.vetoes).toBe(1);
    expect(groupOrder(people).at(-1)).toBe(3);
  });
});

describe('#24 AC4: no jitter', () => {
  it('the same ratings always give the same order and chances', () => {
    const rng = seededRandom(3);
    const people = Array.from({ length: 4 }, () => Array.from({ length: 12 }, (_, id): Candidate => ({ id, rating: { mu: 1500 + rng() * 50, rd: 300 }, comparisons: 1 })));
    expect([...groupRanking(sampleGroup(people))]).toEqual([...groupRanking(sampleGroup(people))]);
  });
});

describe('#24 AC6: fast enough', () => {
  it('ranks 8 people × 40 places in under 200 ms', () => {
    const rng = seededRandom(5);
    const people = Array.from({ length: 8 }, () => Array.from({ length: 40 }, (_, id): Candidate => ({ id, rating: { mu: 1300 + rng() * 400, rd: 60 + rng() * 290 }, comparisons: 3 })));
    groupRanking(sampleGroup(people)); // warm up
    const start = performance.now();
    groupRanking(sampleGroup(people));
    expect(performance.now() - start).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------------------------
// #26: questions that matter to the group

/** A person's candidates from [mu, rd] per place id. */
const personWith = (ratings: [number, number][]): Candidate[] => ratings.map(([mu, rd], id) => ({ id, rating: { mu, rd }, comparisons: 10 }));
const isPair = (pair: [number, number] | null, x: number, y: number) => !!pair && [x, y].every((id) => pair.includes(id));

describe('#26 AC1: each person gets the question that most changes the group\'s top pick', () => {
  it("asks about the pair that decides the group's pick, not this person's own close call", () => {
    // Me: my own top two (2, 3) are a close, uncertain call; I'm unsure about 0 vs 1 further down.
    const me = personWith([[1600, 250], [1600, 250], [1900, 60], [1880, 200], [1400, 60], [1300, 60], [1200, 60], [1100, 60]]);
    // The other person loves 0 and 1 about equally, and has 2 and 3 in their bottom third: those can't win.
    const other = personWith([[1900, 60], [1880, 60], [1000, 60], [900, 60], [1700, 60], [1600, 60], [1500, 60], [1400, 60]]);
    const group = sampleGroup([me, other]);

    const asked = SEEDS.map((seed) => choosePair(me, seededRandom(seed), undefined, undefined, { group, me: 0 }));
    expect(share(asked.map((pair) => isPair(pair, 0, 1)))).toBeGreaterThanOrEqual(0.8);
  });
});

describe('#26 AC2: a pair this person has settled is not asked while another would tell the group more', () => {
  it('skips my settled 0 vs 1, even though it decides the group pick for someone else', () => {
    const me = personWith([[1800, 60], [1400, 60], [1700, 250], [1650, 250], [1300, 60], [1200, 60]]);
    const other = personWith([[1800, 250], [1800, 250], [1500, 60], [1450, 60], [1000, 60], [900, 60]]);
    const group = sampleGroup([me, other]);
    const asked = SEEDS.map((seed) => choosePair(me, seededRandom(seed), undefined, undefined, { group, me: 0 }));
    expect(share(asked.map((pair) => isPair(pair, 0, 1)))).toBeLessThan(0.1);
  });
});

describe('#26 AC4: alone in a session', () => {
  it('questions are exactly as before, so the #7 simulations (top 5 within 120 picks) still describe it', () => {
    const me = personWith([[1600, 250], [1600, 250], [1900, 60], [1880, 200], [1400, 60], [1300, 60], [1200, 60], [1100, 60]]);
    const group = sampleGroup([me]);
    for (const seed of SEEDS) expect(choosePair(me, seededRandom(seed), undefined, undefined, { group, me: 0 })).toEqual(choosePair(me, seededRandom(seed)));
  });
});

describe('#23: a real change of mind', () => {
  // The #7 simulations have fixed tastes, so they only show what recency costs. Here a person with 10% stray taps
  // changes their mind at pick 40: their true #10 becomes their favourite. Measured when the design was chosen:
  // the new favourite reached #1 within 15 picks in 20% of runs, and never (within 60) in 24 of 60; with no
  // fading, 12% and 37 of 60.
  const CHANGE = 40;
  function picksToNewFavourite(seed: number) {
    const rng = seededRandom(seed);
    const shuffle = seededRandom(seed * 7919);
    const trueRank = Array.from({ length: 30 }, (_, i) => i).sort(() => shuffle() - 0.5);
    const craving = trueRank.indexOf(9);
    const priors = new Map(trueRank.map((_, id) => [id, 1500]));
    const comparisons = trueRank.map(() => 0);
    const picks: Pick[] = [];
    for (let n = 1; n <= CHANGE + 60; n++) {
      const ratings = estimateSession(priors, picks);
      const candidates: Candidate[] = trueRank.map((_, id) => ({ id, rating: ratings.get(id)!, comparisons: comparisons[id] }));
      if (n > CHANGE && rankSession(candidates)[0].id === craving) return n - CHANGE;
      const last = picks.at(-1);
      const [a, b] = choosePair(candidates, rng, last && { pair: [last.a, last.b] }, pendingReask(priors, picks))!;
      const rank = (id: number) => (n > CHANGE && id === craving ? -1 : trueRank[id]);
      const prefersA = rank(a) < rank(b) !== rng() < 0.1;
      picks.push({ a, b, scoreA: prefersA ? 1 : 0 });
      comparisons[a]++;
      comparisons[b]++;
    }
    return Infinity;
  }

  it('the new favourite rises to #1 about as often as when the design was chosen', () => {
    const results = Array.from({ length: 60 }, (_, i) => picksToNewFavourite(i + 1));
    expect(results.filter((n) => n <= 15).length / 60).toBeGreaterThanOrEqual(0.15);
    expect(results.filter((n) => n === Infinity).length).toBeLessThanOrEqual(30);
  });
}, 60_000);

describe('#23 AC4: older picks do not lower certainty', () => {
  it("a place's rd does not grow as unrelated picks pile up after its own", () => {
    const priors = new Map([0, 1, 2, 3, 4, 5].map((id) => [id, 1500]));
    const own: Pick[] = [
      { a: 0, b: 1, scoreA: 1 },
      { a: 0, b: 2, scoreA: 1 },
      { a: 1, b: 2, scoreA: 1 },
    ];
    const unrelated: Pick[] = Array.from({ length: 20 }, (_, i): Pick => ({ a: 3 + (i % 3), b: 3 + ((i + 1) % 3), scoreA: 1 }));
    const before = estimateSession(priors, own).get(0)!.rd;
    const after = estimateSession(priors, [...own, ...unrelated]).get(0)!.rd;
    expect(after).toBeLessThanOrEqual(before * 1.02);
  });
});
