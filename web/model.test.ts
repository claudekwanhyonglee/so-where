import { describe, expect, it } from 'vitest';
import { relativeDay, swatch } from './model.ts';

describe('#16 AC4: relative dates', () => {
  const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime();

  it('counts calendar days, not 24-hour spans', () => {
    expect(relativeDay(at(28, 9), at(28, 22))).toBe('Today');
    expect(relativeDay(at(27, 23), at(28, 1))).toBe('Yesterday');
    expect(relativeDay(at(27, 1), at(28, 23))).toBe('Yesterday');
    expect(relativeDay(at(21, 12), at(28, 12))).toBe('7 days ago');
  });
});

describe('#17 AC1: place colours', () => {
  it('are the same every time for the same place', () => {
    expect(swatch(7)).toEqual(swatch(7));
    expect(swatch(1)).not.toEqual(swatch(2));
  });
});
