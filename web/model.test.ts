import { describe, expect, it } from 'vitest';
import { googleMapsUrl, relativeDay, swatch } from './model.ts';

describe('#43 AC3: "Open in Google Maps" for every place', () => {
  it('links a place from a Google Maps link by its cid', () => {
    expect(googleMapsUrl({ key: '1234567890', name: 'Pretend Diner', lat: -37.8, lng: 144.96 })).toBe('https://maps.google.com/?cid=1234567890');
  });

  it('links a place added by search (no cid) by its name near its location', () => {
    const url = new URL(googleMapsUrl({ key: 'osm:N9001', name: 'Pretend Trattoria', lat: -37.7985, lng: 144.967 }));
    expect(url.href).not.toContain('cid=');
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe('Pretend Trattoria -37.7985,144.967');
  });
});

describe('#16 AC4: relative dates', () => {
  const at = (day: number, hour: number) => new Date(2026, 8, day, hour).getTime();

  it('counts calendar days, not 24-hour spans', () => {
    expect(relativeDay(at(28, 9), at(28, 22))).toBe('Today');
    expect(relativeDay(at(27, 23), at(28, 1))).toBe('Yesterday');
    expect(relativeDay(at(27, 1), at(28, 23))).toBe('Yesterday');
    expect(relativeDay(at(21, 12), at(28, 12))).toBe('7 days ago');
  });
});

describe('#53: gold is only for the top pick', () => {
  const ids = Array.from({ length: 200 }, (_, i) => i - 20);
  it('#53 AC1: no id gets gold (#ffc93c) as its background', () => {
    for (const id of ids) expect(swatch(id).bg.toLowerCase(), `id ${id}`).not.toBe('#ffc93c');
  });
  it('#53 AC2: the same id always gets the same colour', () => {
    for (const id of ids) expect(swatch(id)).toEqual(swatch(id));
  });
});

describe('#17 AC1: place colours', () => {
  it('are the same every time for the same place', () => {
    expect(swatch(7)).toEqual(swatch(7));
    expect(swatch(1)).not.toEqual(swatch(2));
  });
});
