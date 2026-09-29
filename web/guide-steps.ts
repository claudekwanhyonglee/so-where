import { MIN_PLACES_TO_PICK } from './model.ts';

/** What the server knows about this person's getting started (GET /api/guide). */
export type GuideState = { closed: boolean; home: string | null; homeSkipped: boolean; placeCount: number; inSession: boolean };

export type StepId = 'home' | 'places' | 'pick';
export type StepStatus = 'done' | 'skipped' | 'current' | 'upcoming';
export type GuideStep = { id: StepId; status: StepStatus };

/** Each step in order, with where the person is: done or skipped as soon as that's true, the first undecided one current. */
export function guideSteps(g: GuideState): GuideStep[] {
  const decided: Record<StepId, StepStatus | null> = {
    home: g.home !== null ? 'done' : g.homeSkipped ? 'skipped' : null,
    places: g.placeCount >= MIN_PLACES_TO_PICK ? 'done' : null,
    pick: g.inSession ? 'done' : null,
  };
  let currentFound = false;
  return (['home', 'places', 'pick'] as const).map((id) => {
    const status = decided[id] ?? (currentFound ? 'upcoming' : 'current');
    if (status === 'current') currentFound = true;
    return { id, status };
  });
}

export const isPassed = (s: GuideStep) => s.status === 'done' || s.status === 'skipped';
export const isFinished = (steps: GuideStep[]) => steps.every(isPassed);

/** "1 of 3 done · 1 skipped" */
export function routeCount(steps: GuideStep[]) {
  const done = steps.filter((s) => s.status === 'done').length;
  const skipped = steps.filter((s) => s.status === 'skipped').length;
  return `${done} of ${steps.length} done${skipped ? ` · ${skipped} skipped` : ''}`;
}
