import { describe, expect, it } from 'vitest';
import { medal, ordinal, rankChanges, rankSnapshot } from './medals.ts';

describe('#55 AC1: chips read "<name> <ordinal>"', () => {
  it.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [101, '101st'],
    [111, '111th'],
  ])('%i is %s', (n, text) => expect(ordinal(n)).toBe(text));
});

describe('#55 AC2: medal colours', () => {
  it('1st gold, 2nd silver, 3rd bronze, the rest grey', () => {
    expect([1, 2, 3, 4, 9].map(medal)).toEqual(['gold', 'silver', 'bronze', 'grey', 'grey']);
  });
});

describe("#55 AC6: which chips' ranks changed between polls", () => {
  const rows = (ranks: Record<number, Record<number, number>>) => Object.entries(ranks).map(([placeId, positions]) => ({ placeId: Number(placeId), positions }));

  it('better or worse, per place and person', () => {
    const before = rankSnapshot(rows({ 10: { 1: 1, 2: 2 }, 11: { 1: 2, 2: 1 } }));
    const after = rows({ 10: { 1: 2, 2: 2 }, 11: { 1: 1, 2: 1 } });
    expect(rankChanges(before, after)).toEqual(new Map([['10:1', 'worse'], ['11:1', 'better']]));
  });

  it('nothing on the first poll, and nothing for new places or people', () => {
    expect(rankChanges(null, rows({ 10: { 1: 1 } })).size).toBe(0);
    expect(rankChanges(rankSnapshot(rows({ 10: { 1: 1 } })), rows({ 10: { 1: 1, 2: 1 }, 11: { 1: 2 } })).size).toBe(0);
  });
});
