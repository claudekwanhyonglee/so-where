export type Place = {
  id: number;
  key: string;
  name: string;
  lat: number | null;
  lng: number | null;
  suburb: string | null;
  note: string;
};

/** Card colours with the ink that reads on them. Things get one by id, so a place is always the same colour. */
const SWATCH = [
  { bg: '#e8432c', fg: '#fff4ec' },
  { bg: '#ffc93c', fg: '#2a1712' },
  { bg: '#1f8a70', fg: '#fff4ec' },
  { bg: '#6a3d6e', fg: '#fff4ec' },
  { bg: '#ff8a5b', fg: '#2a1712' },
  { bg: '#2f5d9e', fg: '#fff4ec' },
];

export const swatch = (id: number) => SWATCH[Math.abs(id) % SWATCH.length];

/** Picking needs a pair. */
export const MIN_PLACES_TO_PICK = 2;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Today", "Yesterday" or "N days ago", by calendar day. */
export function relativeDay(then: number, now = Date.now()) {
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(now) - startOfDay(then)) / 86_400_000); // rounding absorbs DST's 23/25-hour days
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
}

/** Google's own page for places added from a Google Maps link (keyed by cid); a search for the name there for the rest. */
export function googleMapsUrl({ key, name, lat, lng }: Pick<Place, 'key' | 'name' | 'lat' | 'lng'>) {
  if (/^\d+$/.test(key)) return `https://maps.google.com/?cid=${key}`;
  const query = lat === null || lng === null ? name : `${name} ${lat},${lng}`;
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query })}`;
}

export type TransitAnswer = { minutes: number } | { minutes: null; reason: 'no-home' | 'no-location' | 'no-trip' | 'unavailable' };

/** What a card shows for getting there: the time, a Directions link when there's no time, or nothing (still loading, or no home set). */
export const transitPill = (answer: TransitAnswer | null) => (!answer ? null : answer.minutes !== null ? 'time' : answer.reason === 'no-home' ? null : 'directions');

export const transitDirectionsUrl =(place: Pick<Place, 'lat' | 'lng' | 'name'>) => {
  const destination = place.lat !== null && place.lng !== null ? `${place.lat},${place.lng}` : encodeURIComponent(place.name);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=transit`;
};
