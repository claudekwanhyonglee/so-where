import { MIN_PLACES_TO_PICK } from './model.ts';

export type Member = { id: number; name: string };

/**
 * What the server knows about this person's getting started (GET /api/guide). `joining`: the group already had places
 * when they signed up. `live`: the session their friends are in (only for someone joining). `joinedWith`: who was in the
 * first session they joined, if someone else started it.
 */
export type GuideState = {
  closed: boolean;
  home: string | null;
  homeSkipped: boolean;
  placeCount: number;
  inSession: boolean;
  joining: boolean;
  live: { id: string; setName: string; members: Member[] } | null;
  joinedWith: Member[] | null;
};

export type StepId = 'home' | 'places' | 'pick';
export type StepStatus = 'done' | 'skipped' | 'current' | 'upcoming';
export type GuideStep = { id: StepId; status: StepStatus };

/**
 * Each step in order, with where the person is: done or skipped as soon as that's true, the first undecided one current.
 * Someone joining a group that already has places has no Places step.
 */
export function guideSteps(g: GuideState): GuideStep[] {
  const decided: Record<StepId, StepStatus | null> = {
    home: g.home !== null ? 'done' : g.homeSkipped ? 'skipped' : null,
    places: g.placeCount >= MIN_PLACES_TO_PICK ? 'done' : null,
    pick: g.inSession ? 'done' : null,
  };
  let currentFound = false;
  const ids: StepId[] = g.joining ? ['home', 'pick'] : ['home', 'places', 'pick'];
  return ids.map((id) => {
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

/** "Alex", "Alex and Jo", "Alex, Jo and Sam" */
export function namesList(people: { name: string }[]) {
  const names = people.map((p) => p.name);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
