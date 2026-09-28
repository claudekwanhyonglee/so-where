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

export function parsePlaceUrl(raw: string): ParsedPlace | null {
  const url = toUrl(raw);
  if (!url || !isGoogleMaps(url)) return null;
  const key = placeKey(url.href);
  if (!key) return null;

  const query = url.searchParams.get('q') ?? undefined;
  const pathName = url.pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
  const name = pathName ? decodeName(pathName) : query?.split(',')[0].trim();

  const coords = url.href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ?? url.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const location = coords ? { lat: Number(coords[1]), lng: Number(coords[2]) } : {};

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
