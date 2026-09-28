import { beforeAll, describe, expect, it } from 'vitest';
import { groupChooser, perPersonChooser, simulateGroup, type GroupChooser } from './group-simulation.ts';

// Groups of 3 with shared-but-individual tastes and 10% stray taps, 12 places, up to 40 picks each.
const SIZE = 3;
const ROUNDS = 40;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** When the flame first showed (if ever), and whether it was on the planted fair winner. */
function firstFlame(chooser: GroupChooser, seed: number) {
  const { planted, checks } = simulateGroup({ seed, size: SIZE, places: 12, rounds: ROUNDS, chooser });
  const flame = checks.find((c) => c.prettySure);
  return flame && { round: flame.round, right: flame.top === planted };
}

/** Everyone's picks until the flame first shows on the planted fair winner; all 40 rounds' worth if it never does. */
const picksToRightFlame = (flame: ReturnType<typeof firstFlame>) => (flame?.right ? flame.round : ROUNDS) * SIZE;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

let groupAware: ReturnType<typeof firstFlame>[] = [];
let today: ReturnType<typeof firstFlame>[] = [];
beforeAll(() => {
  groupAware = seeds(200).map((seed) => firstFlame(groupChooser, seed));
  today = seeds(100).map((seed) => firstFlame(perPersonChooser, seed));
}, 300_000);

describe('#25 AC5: "Pretty sure" is calibrated', () => {
  // Agreed with the user: the flame means "80% sure the top pick is as good as the best (a near-tie counts)".
  // Measured when chosen: shows for ~98% of groups (with #26's questions), right ~81% of the time.
  it('when the flame first appears, the planted fair winner is the top pick at least 75% of the time', () => {
    const shown = groupAware.filter((f) => f !== undefined);
    expect(shown.filter((f) => f.right).length / shown.length).toBeGreaterThanOrEqual(0.75);
  });

  it('and it does appear for most groups', () => {
    expect(groupAware.filter((f) => f !== undefined).length / groupAware.length).toBeGreaterThanOrEqual(0.9);
  });
});

describe('#26 AC3: group-aware questions reach a right flame sooner', () => {
  // Measured: ~78 total picks against ~86 with today's pair choice.
  it("in fewer total picks on average than today's pair choice", () => {
    expect(mean(groupAware.slice(0, today.length).map(picksToRightFlame))).toBeLessThan(mean(today.map(picksToRightFlame)));
  });
});
