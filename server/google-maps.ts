// Google Maps links, parsed locally. No Google APIs and no scraping: the only request ever made to Google
// is following a short share link's redirect, and only while it stays on a short-link host.
import { USER_AGENT } from './nominatim.ts';

export type ParsedPlace = { key: string; name?: string; lat?: number; lng?: number; query?: string };

const GOOGLE_HOST = /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;
const MAX_REDIRECTS = 5;

const toUrl = (raw: string) => {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
};

const isGoogleMaps = (url: URL) =>
  GOOGLE_HOST.test(url.hostname) && (url.pathname.startsWith('/maps') || url.hostname.startsWith('maps.'));

const isShortLink = (url: URL) =>
  url.protocol === 'https:' && (url.hostname === 'maps.app.goo.gl' || (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/')));

/**
 * One key per place across every link form: the decimal "cid". Full links carry Google's feature ID
 * `0x<a>:0x<b>`, and `?cid=` links carry <b> in decimal.
 */
export function placeKey(raw: string): string | null {
  const featureId = raw.match(/0x[0-9a-f]+(?::|%3A)0x([0-9a-f]+)/i);
  if (featureId) return BigInt(`0x${featureId[1]}`).toString();
  const cid = toUrl(raw)?.searchParams.get('cid');
  return cid && /^\d+$/.test(cid) ? BigInt(cid).toString() : null;
}

const decodeName = (segment: string) => decodeURIComponent(segment.replaceAll('+', ' ')).trim();

type DataToken = { field: number; type: string; value: string; children: DataToken[] };

/**
 * The `data=` path segment: `!<field><type><value>` tokens, where an `m` token's value is how many of the
 * tokens after it are nested inside it. Null if it isn't well formed.
 */
function parseData(data: string): DataToken[] | null {
  const flat = data.split('!').slice(1).map((t) => t.match(/^(\d+)([a-z])(.*)$/));
  if (flat.some((t) => !t)) return null;
  let i = 0;
  const tokensUntil = (end: number): DataToken[] => {
    const tokens: DataToken[] = [];
    while (i < end) {
      const [, field, type, value] = flat[i++]!;
      const nestedEnd = i + Number(value);
      tokens.push({ field: Number(field), type, value, children: type === 'm' ? tokensUntil(nestedEnd) : [] });
      if (type === 'm' && i !== nestedEnd) throw new Error('bad nesting');
    }
    return tokens;
  };
  try {
    const tokens = tokensUntil(flat.length);
    return i === flat.length ? tokens : null;
  } catch {
    return null;
  }
}

const child = (tokens: DataToken[] | undefined, field: number, type: string) => tokens?.find((t) => t.field === field && t.type === type);

/**
 * The place a link is about, from `data=`: the `!3m` block directly under the top-level `!4m`. Links copied
 * while browsing also carry other IDs before it (the map context, places looked at before), so the first
 * ID in the link isn't necessarily this place's.
 */
function placeFromData(pathname: string): { key: string; lat?: number; lng?: number } | null {
  const data = pathname.match(/\/data=([^/]+)/)?.[1];
  const place = child(child(data ? (parseData(data) ?? undefined) : undefined, 4, 'm')?.children, 3, 'm')?.children;
  const featureId = child(place, 1, 's')?.value;
  const key = featureId ? placeKey(featureId) : null;
  if (!key) return null;
  const at = child(place, 8, 'm')?.children;
  const [lat, lng] = [child(at, 3, 'd')?.value, child(at, 4, 'd')?.value].map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { key, lat, lng } : { key };
}

export function parsePlaceUrl(raw: string): ParsedPlace | null {
  const url = toUrl(raw);
  if (!url || !isGoogleMaps(url)) return null;
  const own = placeFromData(url.pathname);
  const key = own?.key ?? placeKey(url.href);
  if (!key) return null;

  const query = url.searchParams.get('q') ?? undefined;
  const pathName = url.pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
  const name = pathName ? decodeName(pathName) : query?.split(',')[0].trim();

  const coords = url.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ?? url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const location = own?.lat !== undefined ? { lat: own.lat, lng: own.lng } : coords ? { lat: Number(coords[1]), lng: Number(coords[2]) } : {};

  return { key, ...(name ? { name } : {}), ...location, ...(query ? { query } : {}) };
}

/** Parses a full link, or follows a short share link's redirects (staying on Google) and parses where it lands. */
export async function resolvePlaceLink(raw: string, fetchFn: typeof fetch): Promise<ParsedPlace | null> {
  let url = toUrl(raw);
  for (let hop = 0; url && isShortLink(url); hop++) {
    if (hop === MAX_REDIRECTS) return null;
    const res = await fetchFn(url, { redirect: 'manual', headers: { 'user-agent': USER_AGENT } });
    const location = res.headers.get('location');
    url = location ? toUrl(new URL(location, url).href) : null;
  }
  return url ? parsePlaceUrl(url.href) : null;
}

export const mapsUrlForKey = (key: string) => `https://maps.google.com/?cid=${key}`;
