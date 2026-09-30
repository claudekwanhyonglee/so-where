import allFlags from 'flag-icons/country.json' with { type: 'json' };

export type Country = { code: string; name: string };

const names = new Intl.DisplayNames(['en'], { type: 'region' });

/** Every ISO country (the same list the server accepts), named in English, A to Z. */
export const COUNTRIES: Country[] = allFlags
  .filter((c) => c.iso)
  .map((c) => ({ code: c.code.toUpperCase(), name: names.of(c.code.toUpperCase()) ?? c.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const countryByCode = (code: string | null | undefined) => COUNTRIES.find((c) => c.code === code);

/** "Côte d’Ivoire" → " cote d ivoire": no accents or punctuation, with a space before every word. */
const words = (text: string) => ' ' + text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Countries with a word in their name starting with what was typed ("aus": Australia, Austria), A to Z. */
export function matchCountries(typed: string): Country[] {
  const query = words(typed);
  return query.trim() ? COUNTRIES.filter((c) => words(c.name).includes(query)) : [];
}

/** Each flag's SVG as its own file, so only the flags on screen are downloaded. */
const flagUrls = import.meta.glob<string>('../node_modules/flag-icons/flags/4x3/*.svg', { eager: true, query: '?no-inline', import: 'default' });

export const flagUrl = (code: string) => flagUrls[`../node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`];
