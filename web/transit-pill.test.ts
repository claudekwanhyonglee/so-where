import { describe, expect, it } from 'vitest';
import { transitDirectionsUrl, transitPill } from './model.ts';

describe('#52 AC1 + AC2: directions by public transport from home to the place', () => {
  const place = { name: 'Pretend Trattoria', suburb: 'Carlton', lat: -37.8, lng: 144.96 };
  const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

  it("goes from the home address to the place's name and suburb", () => {
    const url = transitDirectionsUrl(place, '1 Pretend Street, Carlton, Melbourne');
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?/);
    expect(params(url)).toEqual({ api: '1', origin: '1 Pretend Street, Carlton, Melbourne', destination: 'Pretend Trattoria, Carlton', travelmode: 'transit' });
  });

  it('without a home, Google Maps starts from wherever the person is', () => {
    expect(params(transitDirectionsUrl(place))).toEqual({ api: '1', destination: 'Pretend Trattoria, Carlton', travelmode: 'transit' });
  });

  it('a place with no suburb is found by its coordinates, or else its name', () => {
    expect(params(transitDirectionsUrl({ ...place, suburb: null })).destination).toBe('-37.8,144.96');
    expect(params(transitDirectionsUrl({ ...place, suburb: null, lat: null, lng: null })).destination).toBe('Pretend Trattoria');
  });
});

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
