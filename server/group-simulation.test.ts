import { beforeAll, describe, expect, it } from 'vitest';
import { perPersonChooser, simulateGroup } from './group-simulation.ts';

const GROUPS = Array.from({ length: 200 }, (_, i) => i + 1);

describe('#25 AC5: "Pretty sure" is calibrated', () => {
  // Groups of 3 with shared-but-individual tastes and 10% stray taps, up to 40 picks each.
  // Agreed with the user: the flame means "80% sure the top pick is as good as the best (a near-tie counts)".
  // Measured when chosen: shows for ~94% of groups, right ~81% of the time.
  let shown: { right: boolean }[] = [];
  beforeAll(() => {
    shown = GROUPS.flatMap((seed) => {
      const { planted, checks } = simulateGroup({ seed, size: 3, places: 12, rounds: 40, chooser: perPersonChooser });
      const flame = checks.find((c) => c.prettySure);
      return flame ? [{ right: flame.top === planted }] : [];
    });
  }, 180_000);

  it('when the flame first appears, the planted fair winner is the top pick at least 75% of the time', () => {
    expect(shown.filter((f) => f.right).length / shown.length).toBeGreaterThanOrEqual(0.75);
  });

  it('and it does appear for most groups', () => {
    expect(shown.length / GROUPS.length).toBeGreaterThanOrEqual(0.85);
  });
});
