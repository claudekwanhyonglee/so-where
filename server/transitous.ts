// Transitous (transitous.org): a free, keyless public transport router (MOTIS).
import type { LatLng } from './nominatim.ts';
import { USER_AGENT } from './nominatim.ts';

type Plan = { itineraries?: { duration: number }[]; direct?: { duration: number }[] };

const point = ({ lat, lng }: LatLng) => `${lat},${lng}`;

/** Fastest door-to-door time in minutes, leaving at `leaveAt`; null if there's no trip. Throws if Transitous fails. */
export async function transitMinutes(fetchFn: typeof fetch, from: LatLng, to: LatLng, leaveAt: Date): Promise<number | null> {
  const url = new URL('https://api.transitous.org/api/v5/plan');
  url.search = new URLSearchParams({ fromPlace: point(from), toPlace: point(to), time: leaveAt.toISOString(), arriveBy: 'false' }).toString();
  const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Transitous ${res.status}`);
  const plan = (await res.json()) as Plan;
  const durations = [...(plan.itineraries ?? []), ...(plan.direct ?? [])].map((i) => i.duration).filter((d) => d > 0);
  return durations.length ? Math.round(Math.min(...durations) / 60) : null;
}
