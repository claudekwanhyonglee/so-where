import { describe, expect, it } from 'vitest';
import { COUNTRIES, countryByCode, flagUrl, matchCountries } from './countries.ts';

const names = (typed: string) => matchCountries(typed).map((c) => c.name);

describe('#49 AC2: typing suggests matching countries, A to Z, and nothing until something is typed', () => {
  it('"aus" suggests Australia and Austria', () => expect(names('aus')).toEqual(['Australia', 'Austria']));
  it('ignores case and accents, and matches later words', () => {
    expect(names('AUS')).toEqual(['Australia', 'Austria']);
    expect(names('cote')).toContain('Côte d’Ivoire');
    expect(names('kingdom')).toEqual(['United Kingdom']);
  });
  it('nothing typed suggests nothing', () => {
    expect(names('')).toEqual([]);
    expect(names('  ')).toEqual([]);
  });
  it('suggestions come alphabetically', () => {
    const found = names('s');
    expect(found.length).toBeGreaterThan(5);
    expect(found).toEqual([...found].sort((a, b) => a.localeCompare(b)));
  });
});

describe('#49 AC3: every country has a flag image', () => {
  it('each listed country has an SVG flag', () => {
    expect(COUNTRIES.length).toBeGreaterThan(240);
    for (const { code } of COUNTRIES) expect(flagUrl(code), code).toMatch(/\.svg/);
  });
  it('codes are looked up to names', () => expect(countryByCode('AU')?.name).toBe('Australia'));
});
