import { describe, expect, it } from 'vitest';
import { transitPill } from './model.ts';

describe('#33 AC5: which transit pill a card shows', () => {
  it('a time when there is one', () => {
    expect(transitPill({ minutes: 25 })).toBe('time');
  });

  it('nothing at all without a home', () => {
    expect(transitPill({ minutes: null, reason: 'no-home' })).toBeNull();
  });

  it.each(['no-trip', 'unavailable', 'no-location'] as const)('the Directions link for %s', (reason) => {
    expect(transitPill({ minutes: null, reason })).toBe('directions');
  });

  it('nothing while still loading', () => {
    expect(transitPill(null)).toBeNull();
  });
});
