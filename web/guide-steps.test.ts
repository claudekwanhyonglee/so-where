import { describe, expect, it } from 'vitest';
import { guideSteps, isFinished, namesList, routeCount, type GuideState } from './guide-steps.ts';

const fresh: GuideState = { closed: false, home: null, homeSkipped: false, placeCount: 0, inSession: false, joining: false, live: null, joinedWith: null };
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

describe('#39 AC1: someone joining a group with places has no Places step', () => {
  const joining = { ...fresh, joining: true, placeCount: 5 };

  it('two steps: home, then picking', () => {
    expect(statuses(joining)).toEqual(['home:current', 'pick:upcoming']);
    expect(routeCount(guideSteps(joining))).toBe('0 of 2 done');
  });

  it('finishes after joining, with home skipped', () => {
    const g = { ...joining, homeSkipped: true, inSession: true };
    expect(isFinished(guideSteps(g))).toBe(true);
    expect(routeCount(guideSteps(g))).toBe('1 of 2 done · 1 skipped');
  });
});

describe('#39 AC3: names joined for reading', () => {
  it('reads "Alex", "Alex and Jo", "Alex, Jo and Sam"', () => {
    expect(namesList([{ name: 'Alex' }])).toBe('Alex');
    expect(namesList([{ name: 'Alex' }, { name: 'Jo' }])).toBe('Alex and Jo');
    expect(namesList([{ name: 'Alex' }, { name: 'Jo' }, { name: 'Sam' }])).toBe('Alex, Jo and Sam');
  });
});
