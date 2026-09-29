// Search-as-you-type and a map to confirm the result: shared by the home address and add-a-place forms.
import { MapPin } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from './api.ts';
import { plural } from './model.ts';

export type Point = { label: string; lat: number; lng: number };

const LOOKUP_DELAY_MS = 300;

export type Lookup<T> = { status: 'idle' } | { status: 'searching' } | { status: 'found'; value: T } | { status: 'failed'; error: string };

/**
 * The answer from `path`, asked once typing pauses; no path means idle. It's "searching" from the moment the path
 * changes until the answer for exactly that path arrives; answers for older paths are dropped.
 */
export function useLookup<T>(path: string | null): Lookup<T> {
  const [answer, setAnswer] = useState<{ path: string; value?: T; error?: string } | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const timer = setTimeout(
      () =>
        api<T>(path).then(
          (value) => alive && setAnswer({ path, value }),
          (err) => alive && setAnswer({ path, error: errorMessage(err) }),
        ),
      LOOKUP_DELAY_MS,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [path]);
  if (!path) return { status: 'idle' };
  if (answer?.path !== path) return { status: 'searching' };
  return answer.error === undefined ? { status: 'found', value: answer.value as T } : { status: 'failed', error: answer.error };
}

/** The "Searching…" row, then the suggestions (or "No matching …") to choose from. */
export function SuggestionList<T>({
  lookup,
  noun,
  keyOf,
  render,
  onChoose,
}: {
  lookup: Extract<Lookup<T[]>, { status: 'searching' | 'found' }>;
  noun: string;
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  onChoose: (item: T) => void;
}) {
  return (
    <ul aria-label="Suggestions" className="flex flex-col divide-y divide-divider overflow-hidden rounded-[18px] bg-white ring-1 ring-edge">
      {lookup.status === 'searching' ? (
        <li className="flex items-center gap-2.5 px-3.5 py-2.5 font-semibold text-muted">
          <Spinner />
          Searching {noun}…
        </li>
      ) : lookup.value.length === 0 ? (
        <li className="px-3.5 py-2.5 text-muted">No matching {noun}</li>
      ) : (
        lookup.value.map((item) => (
          <li key={keyOf(item)}>
            <button type="button" onClick={() => onChoose(item)} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-[#fffaf6]">
              <MapPin size={16} className="flex-none text-muted" aria-hidden="true" />
              {render(item)}
            </button>
          </li>
        ))
      )}
    </ul>
  );
}

export const Spinner = () => <span data-testid="spinner" aria-hidden="true" className="size-4 flex-none animate-spin rounded-full border-2 border-soft border-t-tomato" />;

/** What screen readers hear as a suggestion lookup goes (a failure's Notice speaks for itself). */
export function lookupAnnouncement(lookup: Lookup<unknown[]>, noun: string) {
  if (lookup.status === 'searching') return 'Searching…';
  if (lookup.status !== 'found') return '';
  return lookup.value.length ? `${plural(lookup.value.length, 'suggestion')} found` : `No matching ${noun}`;
}

const ZOOM = 16;
const TILE = 256;

/** Where a point falls on the OpenStreetMap tile grid at ZOOM, in tiles (Web Mercator). */
function tileXY({ lat, lng }: { lat: number; lng: number }) {
  const n = 2 ** ZOOM;
  const latRad = (lat * Math.PI) / 180;
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n };
}

/**
 * A static map: the 3×3 OpenStreetMap tiles around the point, shifted so the point sits in the middle, under a pin.
 * ponytail: ignores the antimeridian and the poles; no home or restaurant is there.
 */
export function MapPreview({ point }: { point: Point }) {
  const { x, y } = tileXY(point);
  const tiles = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => ({ tx: Math.floor(x) + dx, ty: Math.floor(y) + dy })));
  return (
    <figure className="relative h-40 overflow-hidden rounded-[18px] bg-soft ring-1 ring-edge">
      <div role="img" aria-label={`Map of ${point.label}`} className="absolute inset-0">
        {tiles.map(({ tx, ty }) => (
          <img
            key={`${tx},${ty}`}
            src={`https://tile.openstreetmap.org/${ZOOM}/${tx}/${ty}.png`}
            alt=""
            width={TILE}
            height={TILE}
            className="absolute max-w-none"
            style={{ left: `calc(50% + ${(tx - x) * TILE}px)`, top: `calc(50% + ${(ty - y) * TILE}px)` }}
          />
        ))}
        <MapPin
          data-testid="map-marker"
          size={32}
          aria-hidden="true"
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full fill-tomato text-ink"
        />
      </div>
      <figcaption className="absolute right-0 bottom-0 rounded-tl-lg bg-white/85 px-1.5 py-0.5 text-[11px]">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
      </figcaption>
    </figure>
  );
}
