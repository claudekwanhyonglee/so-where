// Locates imported places in the background, one Nominatim call at a time, so a big import doesn't hold the
// upload open for minutes. Pending work lives in the database, so it resumes after a restart.
import type { Db } from './db.ts';
import type { BoundingBox, LatLng, Nominatim } from './nominatim.ts';

const SEARCH_RADIUS_DEG = 0.5; // roughly 50 km around the group's places

type Pending = { id: number; lat: number | null; lng: number | null; lookup_query: string | null };

/** The middle of the group's already-located places, if any are. */
export function groupCentre(db: Db): LatLng | undefined {
  const { lat, lng } = db
    .prepare('SELECT avg(lat) AS lat, avg(lng) AS lng FROM places WHERE lat IS NOT NULL AND lookup_pending = 0')
    .get() as { lat: number | null; lng: number | null };
  return lat === null || lng === null ? undefined : { lat, lng };
}

/** The area the group's already-located places are in: name searches only accept results near it. */
function groupArea(db: Db): BoundingBox | undefined {
  const centre = groupCentre(db);
  if (!centre) return undefined;
  const { lat, lng } = centre;
  return { west: lng - SEARCH_RADIUS_DEG, east: lng + SEARCH_RADIUS_DEG, north: lat + SEARCH_RADIUS_DEG, south: lat - SEARCH_RADIUS_DEG };
}

export function createPlaceLookup(db: Db, nominatim: Nominatim) {
  let running: Promise<void> | null = null;

  const nextPending = () => db.prepare('SELECT id, lat, lng, lookup_query FROM places WHERE lookup_pending = 1 ORDER BY id LIMIT 1').get() as Pending | undefined;

  async function locate(place: Pending) {
    let location: LatLng | null = place.lat !== null && place.lng !== null ? { lat: place.lat, lng: place.lng } : null;
    if (!location && place.lookup_query) location = await nominatim.search(place.lookup_query, groupArea(db)).catch(() => null);
    const suburb = location ? await nominatim.suburb(location).catch(() => null) : null;
    db.prepare('UPDATE places SET lat = ?, lng = ?, suburb = ?, lookup_pending = 0 WHERE id = ?').run(location?.lat ?? null, location?.lng ?? null, suburb, place.id);
  }

  async function work() {
    for (let place = nextPending(); place; place = nextPending()) await locate(place);
  }

  function start(): Promise<void> {
    running ??= work().finally(() => {
      running = null;
      if (nextPending()) void start();
    });
    return running;
  }

  return {
    start,
    /** Resolves once nothing is left to look up. */
    idle: async () => {
      while (running) await running;
    },
  };
}

export type PlaceLookup = ReturnType<typeof createPlaceLookup>;
