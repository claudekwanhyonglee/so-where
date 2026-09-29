import { describe, expect, it } from 'vitest';
import { guideSteps, isFinished, routeCount, type GuideState } from './guide-steps.ts';

const fresh: GuideState = { closed: false, home: null, homeSkipped: false, placeCount: 0, inSession: false };
const statuses = (g: GuideState) => guideSteps(g).map((s) => `${s.id}:${s.status}`);

describe('#38 AC3: each step is done, current, skipped or coming up', () => {
  it('a brand-new person is on home, with places and picking coming up', () => {
    expect(statuses(fresh)).toEqual(['home:current', 'places:upcoming', 'pick:upcoming']);
    expect(routeCount(guideSteps(fresh))).toBe('0 of 3 done');
  });

  it('skipping home moves on to places, and the count says so', () => {
    const g = { ...fresh, homeSkipped: true };
    expect(statuses(g)).toEqual(['home:skipped', 'places:current', 'pick:upcoming']);
    expect(routeCount(guideSteps(g))).toBe('0 of 3 done · 1 skipped');
  });

  it('one place is not enough; two are', () => {
    expect(statuses({ ...fresh, home: 'Here', placeCount: 1 })).toEqual(['home:done', 'places:current', 'pick:upcoming']);
    expect(statuses({ ...fresh, home: 'Here', placeCount: 2 })).toEqual(['home:done', 'places:done', 'pick:current']);
  });

  it('a step done out of order is done, and the first undecided step is current', () => {
    const g = { ...fresh, placeCount: 3 };
    expect(statuses(g)).toEqual(['home:current', 'places:done', 'pick:upcoming']);
    expect(routeCount(guideSteps(g))).toBe('1 of 3 done');
  });

  it('a saved home counts as done even if it was skipped before', () => {
    expect(guideSteps({ ...fresh, home: 'Here', homeSkipped: true })[0].status).toBe('done');
  });
});

describe('#38 AC5: finished once every step is done or skipped', () => {
  it('starting picking with home skipped finishes it', () => {
    const g = { ...fresh, homeSkipped: true, placeCount: 2, inSession: true };
    expect(isFinished(guideSteps(g))).toBe(true);
    expect(routeCount(guideSteps(g))).toBe('2 of 3 done · 1 skipped');
  });

  it('not while any step is undecided', () => {
    expect(isFinished(guideSteps({ ...fresh, placeCount: 2, inSession: true }))).toBe(false);
  });
});
